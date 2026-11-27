# Plano de migração P0 — integridade Atlas Pay (`FIN_*`)

**Data:** 26/11/2026 (apply HML operacional local)  
**Status atual:** **P0 ATIVO** em `atlas_cargo_prd` (localhost = homologação operacional).  
**Apply:** canônico aplicado com **COMMIT** em 26/11/2026; produção externa **não** autorizada (checklist item 11 ☐).

**Script canônico:** `backend/scripts/financeiro_atlas_pay_p0_constraints_postgres.sql`  
**SHA-256 aplicado:** `5AB0CF5EC857E2AA03BBFA43FD678872E50C4E29DF25E7DD02ECC4DE5B0CC54D`  
**Revisão P0.2:** `docs/RELATORIO_REVISAO_P0_2_ATLAS_PAY.md`  
**Resultados runtime:** `docs/RESULTADO_TESTES_P0_2_ATLAS_PAY.md`  
**Checklist homologação:** `docs/CHECKLIST_HOMOLOGACAO_P0_ATLAS_PAY.md`  
**Logs apply:** `backend/scripts/_homolog_p0_inventory/`  
**Harness scratch (prévio):** `backend/scripts/test_p0_2_disposable_harness.md`

PostgreSQL **14+** (comprovado em 14.25 Docker e 18.4 host).

---

## Histórico de status (superados)

| Quando | Status (histórico) | Situação atual |
| --- | --- | --- |
| Pré-harness | SQL revisado; testes **não executados**; aprovação limitada à bateria scratch | **Superado** — baterias executadas |
| Pós-revisão P0.2 (só código/docs) | APROVADO COM RESSALVAS para preparar bateria; **não** para apply | **Superado** |
| Pós-PG18 only | 20/20 + D13 PASS no 18.4; PG14 BLOCKED → NO-GO homologação | **Superado** — PG14 PASS |
| 26/11 fechamento | PG14 + PG18 PASS; D13 PASS | **Superado** — GO scratch |
| 26/11 apply local | Autorização HML operacional em `atlas_cargo_prd` | **Vigente** — P0 **ATIVO** local; produção externa pendente |

---

## Resultados finais da validação (scratch)

| Ambiente | Bateria (20 casos) | D13 |
| --- | --- | --- |
| PostgreSQL 18.4 (host · `atlas_pay_p0_scratch`) | **20/20 PASS** | **PASS** |
| PostgreSQL 14.25 (Docker · `atlas_pay_p0_scratch`) | **20/20 PASS** | **PASS** |

Evidências: `backend/scripts/_p0_2_results/` e `backend/scripts/_p0_2_results_pg14/`.

---

## 0. Correções P0.2 (código — histórico)

| Tema | Correção |
| --- | --- |
| Collation | `attcollation` se tipo colacionável; 0 se não |
| Opclass | Tipo base de domínio → default btree; preferência `typispreferred` (varchar → text_ops) |
| Predicado índice | Canônico via índice-sonda (espelha CHECK); `strip(NULL)` → NULL |
| FK | `convalidated` + `confmatchtype`; `confdelsetcols` só via SQL dinâmico no PG15+ |
| Função trigger | lang, corpo, retorno trigger, nargs=0, VOLATILE, INVOKER, sem proconfig |
| Trigger | `tgenabled` O/A; D = erro; `tgfoid`; normalização FUNCTION/PROCEDURE e ordem de eventos |
| D13d | Funções via `pg_proc`; tabelas via `pg_class` |
| Rollback | Inventário por classe de objeto (abaixo) |

---

## 1. Inventário para rollback

| Objeto | Se criado nesta apply | Se só validado / renomeado |
| --- | --- | --- |
| Role `atlas_fin_manutencao` | `DROP ROLE` se sem membros | Não dropar |
| CHECKs `CK_FIN_*` | `DROP CONSTRAINT` | Manter |
| FKs `FK_FIN_*` | `DROP CONSTRAINT` | Se **renomeada**, reverter nome antigo (inventariar nome prévio); não dropar se já existia |
| Índices `UK_*` / `IX_*` do script | `DROP INDEX` | Não dropar equivalentes pré-existentes |
| `UK_FIN_COB_CICLO_ABS` | Drop se novo | — |
| `UK_FIN_COB_CICLO_ATIVA` | Nunca criado pelo P0 | Não dropar |
| `fn_fin_*` | `DROP FUNCTION` se novo | Não dropar se pré-existente válido |
| `trg_fin_*` | `DROP TRIGGER` se novo | Não dropar / não ENABLE automático |

**Dentro da TX (antes do COMMIT):** `ROLLBACK` desfaz DDL e `CREATE ROLE` (PG14+ transacional).  
**Após COMMIT:** só o inventário “criado nesta apply”; dump `pre_p0` recomendado antes do apply em homologação.

---

## 2. D13 — classificação de segurança (alinhada)

```sql
-- Tabelas
SELECT c.relname, pg_get_userbyid(c.relowner) AS owner
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('FIN_CONTRATO','FIN_CONTRATO_COMPONENTE','FIN_COBRANCA','FIN_COBRANCA_EVENTO');

-- Funções (pg_proc — não pg_class)
SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public'
   AND p.proname IN ('fn_fin_cob_valor_imutavel','fn_fin_evt_append_only');
```

| Condição | Classificação GO |
| --- | --- |
| `app_user` com USAGE/MEMBER (direta ou indireta) em `atlas_fin_manutencao` | **Impeditivo** |
| `app_user` é SUPERUSER | **Impeditivo** |
| `app_user` é owner de tabelas `FIN_*` ou funções `fn_fin_*` | **Impeditivo** |

**Resultado scratch (26/11):** nenhuma dessas condições encontrada → D13 **PASS** em PG14 e PG18.  
Nenhuma permissão real foi alterada para produzir aprovação.

*(Histórico superado: em revisão anterior, owner/superuser constavam como “informativo”. Classificação vigente = tabela acima.)*

---

## 3. Role global residual (cluster host PG18)

| Item | Situação |
| --- | --- |
| Origem | Criada pelo P0/harness no cluster |
| Escopo | Global na instância (não fica só no scratch) |
| Atributos | NOLOGIN, NOSUPERUSER, sem CREATEDB/CREATEROLE/INHERIT/REPLICATION/BYPASSRLS |
| Memberships / owned / deps | Nenhuma identificada |
| Após drop do scratch | Role **permaneceu** na instância |
| Limpeza | `DROP ROLE atlas_fin_manutencao;` — **opcional**, só com autorização e nova verificação de dependências |
| Execução da limpeza | **Não** feita automaticamente nesta documentação |

Detalhe: `backend/scripts/_p0_2_results/role_global_diag.txt`.

---

## 4. SQL canônico

`backend/scripts/financeiro_atlas_pay_p0_constraints_postgres.sql`  
Apply em homologação: executar o arquivo **sem modificações manuais**, após checklist.

---

## 5. Testes

| Ambiente | Status | Nota |
| --- | --- | --- |
| PG 18.4 scratch | **20/20 PASS** + D13 PASS | `_p0_2_results/` |
| PG 14.25 Docker scratch | **20/20 PASS** + D13 PASS | `_p0_2_results_pg14/` |

*(Histórico superado: “Status atual: NÃO EXECUTADOS”.)*

Não repetir baterias já aprovadas sem necessidade técnica.

---

## 6. Parecer

**P0 ATIVO no ambiente local** (`localhost:5432` / `atlas_cargo_prd`), após autorização expressa de 26/11/2026.

- Scratch PG14 + PG18 (prévio): 20/20 + D13 PASS.  
- Pré-apply: backup `-Fc`, inventário, D13 sem impeditivos.  
- Apply + idempotência: **COMMIT**.  
- Pós-apply: `UK_FIN_COB_CICLO_ABS`, `CK_FIN_COB_CONEXAO_REF`, `fn_fin_*`, `trg_fin_*`; testes de imutabilidade/append-only/duplicidade em TX com **ROLLBACK**.  
- Regressão: P1 23/23; fases 1–2 15 PASS / 0 FAIL / 5 SKIP; STRICT/audit preservados.  
- Role `atlas_fin_manutencao`: NOLOGIN, sem memberships; **sem** `DROP ROLE`.  
- Produção externa: **ainda requer** checklist item 11.
