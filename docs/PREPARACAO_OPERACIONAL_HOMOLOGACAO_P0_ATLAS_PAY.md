# Preparação operacional — homologação Atlas Pay P0.2

**Data:** 26/11/2026  
**Escopo:** identificar destino, backup, inventário, hash do canônico e sequência de execução.  
**Declaração:** nesta etapa **não** houve apply, DDL/DML, `DROP ROLE`, alteração de permissões nem conexão para migrar.

Referências: `PLANO_MIGRACAO_P0_ATLAS_PAY.md`, `CHECKLIST_HOMOLOGACAO_P0_ATLAS_PAY.md`, `RESULTADO_TESTES_P0_2_ATLAS_PAY.md`.

---

## 1. Como o projeto conecta ao PostgreSQL

| Peça | Detalhe |
| --- | --- |
| Runtime | Node `pg` Pool em `backend/config/db.js` |
| Config | `backend/.env` via `dotenv` (`DB_HOST` ou `DB_SERVER`, `DB_PORT`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`) |
| Default de código | Se `DB_DATABASE` ausente → `atlas_cargo_prd` |
| Exemplo Git | `backend/.env.example` → `DB_DATABASE=atlas_cargo_prd` |

Não há segundo pool / `.env.homolog` / variável `DB_*_HML` no código atual.

---

## 2. Ambiente de homologação — identificação

### Situação: **PENDENTE — ambiente isolado inexistente**

| Procurado | Achado |
| --- | --- |
| Banco `atlas_cargo_hml` / `*_homolog*` | **Não** referenciado no `.env`, `.env.example`, dumps ou docs de restore |
| Tenant homolog dedicado (ex. `homolog-fin`) | Citado como necessidade em auditoria pré-homolog; **não** provisionado como destino de apply P0 |
| Destino atual do app local | `DB_DATABASE=atlas_cargo_prd` |

### Destino atual do `.env` local (sem senha)

| Parâmetro | Valor |
| --- | --- |
| Host (`DB_SERVER`) | `localhost` |
| Porta | `5432` |
| Database | `atlas_cargo_prd` |
| Usuário | `postgres` |
| Senha | definida (omitida) |
| Cliente / binários | PostgreSQL 18 em `C:\Program Files\PostgreSQL\18\bin` (servidor local conhecido: **18.4** em trabalhos scratch anteriores) |

### Confirmação checklist item 2

O destino configurado **é** `atlas_cargo_prd` → **não** pode ser usado como homologação para o apply P0.2.

**Não improvisar** com `atlas_cargo_prd`, tenant `default` real ou produção.

### Necessidade

Criar (ou apontar) ambiente isolado, por exemplo:

1. Database dedicado: `atlas_cargo_hml` (ou nome acordado) em cluster separado ou no mesmo host **distinto** do PRD operacional.  
2. Restore a partir de dump controlado **ou** schema mínimo alinhado ao `script_db` + `financeiro_atlas_pay_postgres.sql`.  
3. `.env` / variáveis **somente** de homologação (`DB_DATABASE=atlas_cargo_hml`, …).  
4. Tenant fictício para testes de regra (ex. `homolog-fin`) — separado do apply DDL P0, mas necessário para testes de negócio posteriores.

Até existir esse destino, o item 2 do checklist permanece ☐ e o apply **não** deve ser autorizado contra o `.env` atual.

---

## 3. Backup — viabilidade e comando

`pg_dump.exe` está disponível em PostgreSQL 18. Backups do projeto usam formato custom (`-Fc`), ver `backups/README_RESTORE.md`.

**Quando o banco de homologação existir** (substituir placeholders):

```powershell
$env:PGPASSWORD = '<senha_homolog_omitida>'
$ts = Get-Date -Format 'yyyyMMdd_HHmmss'
& "C:\Program Files\PostgreSQL\18\bin\pg_dump.exe" `
  -h <HOST_HML> -p <PORTA_HML> -U <USER_HML> `
  -Fc -f "backups\atlas_cargo_hml_pre_p0_$ts.dump" `
  <DB_HML>
```

**Não** executar este dump contra `atlas_cargo_prd` como se fosse homologação.

---

## 4. Inventário pré-apply (comandos preparados)

Arquivar saída em `backups/` ou `backend/scripts/_homolog_p0_inventory/` **somente** após destino HML confirmado.

```powershell
$env:PGPASSWORD = '<senha_homolog_omitida>'
$Psql = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
$Out = "backend\scripts\_homolog_p0_inventory\pre_apply_$(Get-Date -Format 'yyyyMMdd_HHmmss').log"
# Confirmar destino antes:
& $Psql -h <HOST_HML> -p <PORTA_HML> -U <USER_HML> -d <DB_HML> -c "SELECT current_database(), version(), now();"
# Abortar se current_database() IN ('atlas_cargo_prd') ou nome de produção.
& $Psql -h <HOST_HML> -p <PORTA_HML> -U <USER_HML> -d <DB_HML> -v ON_ERROR_STOP=1 `
  -f backend\scripts\p0_homolog_inventory_pre_apply.sql `
  *> $Out
```

Conteúdo SQL (mesmo modelo do checklist — arquivo opcional a gravar no apply):

```sql
SELECT current_database(), version(), now();

SELECT rolname, rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb
  FROM pg_roles WHERE rolname = 'atlas_fin_manutencao';

SELECT conname, contype, conrelid::regclass, convalidated
  FROM pg_constraint
 WHERE conname LIKE 'CK_FIN_%' OR conname LIKE 'FK_FIN_%'
 ORDER BY 1;

SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND (indexname LIKE 'UK_FIN_%' OR indexname LIKE 'IX_FIN_%')
 ORDER BY 1;

SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE 'fn_fin_%';

SELECT tgname, tgrelid::regclass, tgenabled
  FROM pg_trigger
 WHERE NOT tgisinternal AND tgname LIKE 'trg_fin_%';
```

Registrar no inventário de rollback (§1 do plano) o que já existe vs. o que o canônico criará/renomeará.

---

## 5. SQL canônico — versionamento e hash

| Item | Valor |
| --- | --- |
| Caminho | `backend/scripts/financeiro_atlas_pay_p0_constraints_postgres.sql` |
| Versionado no Git | **Sim** (artefato do repositório) |
| SHA-256 (26/11/2026) | `5AB0CF5EC857E2AA03BBFA43FD678872E50C4E29DF25E7DD02ECC4DE5B0CC54D` |
| Tamanho | 35319 bytes |

Recalcular antes do apply:

```powershell
Get-FileHash backend\scripts\financeiro_atlas_pay_p0_constraints_postgres.sql -Algorithm SHA256
```

Se o hash divergir do commit autorizado, **não** executar.

---

## 6. Sequência operacional de execução (quando autorizado)

Só após checklist itens 1–5 e destino ≠ PRD/produção.

1. Autorização expressa arquivada.  
2. Confirmar `SELECT current_database()` = banco HML acordado.  
3. Backup `-Fc` (§3).  
4. Inventário pré-apply (§4) + mapa criado/renomeado.  
5. Apply canônico **sem edição manual**, com log integral:

```powershell
$env:PGPASSWORD = '<senha_homolog_omitida>'
$ts = Get-Date -Format 'yyyyMMdd_HHmmss'
$Log = "backend\scripts\_homolog_p0_inventory\apply_p0_$ts.log"
# Gate de segurança:
$db = (& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h <HOST_HML> -p <PORTA_HML> -U <USER_HML> -d <DB_HML> -t -A -c "SELECT current_database();").Trim()
if ($db -eq 'atlas_cargo_prd' -or $db -match 'prd|prod') { throw "RECUSA: destino $db" }
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" `
  -h <HOST_HML> -p <PORTA_HML> -U <USER_HML> -d <DB_HML> `
  -v ON_ERROR_STOP=1 `
  -f backend\scripts\financeiro_atlas_pay_p0_constraints_postgres.sql `
  *> $Log
```

6. Verificação pós-apply (mesmas queries do inventário + D13 impeditivo).  
7. Segunda execução do canônico (idempotência) → novo log.  
8. Documentar rollback a partir do inventário real.  
9. Produção: **nova** autorização (checklist item 11) — fora deste procedimento.

---

## 7. Checklist — estado atual dos itens

| # | Item | Estado |
| --- | --- | --- |
| 1 | Autorização expressa | ☐ Pendente |
| 2 | Identificação HML | ☐ **Bloqueado** — criar/apontar banco isolado |
| 3–11 | Backup → produção | ☐ Aguardando item 2 (+1) |

---

## 8. Confirmações desta preparação

- SQL canônico **não** executado.  
- Nenhum banco alterado (sem DDL/DML de migração).  
- Roles/permissões **não** modificadas.  
- `atlas_cargo_prd` / produção **não** usados como homologação.
