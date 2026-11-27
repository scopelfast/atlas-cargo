# Harness P0.2 — banco descartável

**Proibição:** não usar `atlas_cargo_prd`, tenant `default` real, homologação ou produção.  
**Banco autorizado:** somente `atlas_pay_p0_scratch`.  
**Scripts:** `p0_2_scratch_setup.sql`, `financeiro_atlas_pay_p0_constraints_postgres.sql`, `run_p0_2_harness.ps1`.

## Criação e limpeza do scratch

```text
# Criar
dropdb --if-exists atlas_pay_p0_scratch
createdb atlas_pay_p0_scratch
psql -d atlas_pay_p0_scratch -f backend/scripts/p0_2_scratch_setup.sql

# Rodar bateria
powershell -File backend/scripts/run_p0_2_harness.ps1

# Limpar
dropdb --if-exists atlas_pay_p0_scratch
```

O harness recria o banco a cada execução. Evidências em `backend/scripts/_p0_2_results/`.

## Caso 20 — rollback (procedimento correto)

O SQL canônico tem `BEGIN`/`COMMIT` próprios. **Não** basta `BEGIN; \i canônico; ROLLBACK`.

Procedimento usado:

1. Estado inicial conhecido (`Reset-Scratch`).
2. Cópia descartável do canônico com `RAISE EXCEPTION` **antes** do `COMMIT` final.
3. Executar a cópia (`ON_ERROR_STOP=1`) e capturar falha.
4. A transação do script aborta (sem COMMIT) → objetos da TX não persistem.
5. Verificar: role `atlas_fin_manutencao` = 0, `CK_FIN_%` = 0, `fn_fin_%` = 0.
6. Registrar evidência em `_p0_2_results/20_fail.log`.

## Resultados reais (execução 26/11/2026)

**Ambientes:** PostgreSQL 18.4 (Windows host) e PostgreSQL 14.25 (Docker `postgres:14` :55414) · banco `atlas_pay_p0_scratch`  
**Relatório completo:** `docs/RESULTADO_TESTES_P0_2_ATLAS_PAY.md`  
**PG14:** `powershell -File backend/scripts/run_p0_2_harness.ps1 -PgPort 55414 -PgPassword … -OutDirName _p0_2_results_pg14` → **20/20 PASS**

| # | Caso | Resultado | Evidência |
| --- | --- | --- | --- |
| 1 | Primeira execução | **PASS** | `01_first.log` · ck=15 role=1 |
| 2 | Idempotência | **PASS** | `02_idem.log` |
| 3 | Índice equivalente outro nome | **PASS** | `03_equiv.log` · sem duplicar ABS |
| 4 | Índice mesmo nome colunas erradas | **PASS** | `04_badidx.log` · erro esperado |
| 5 | Collation textual | **PASS** | indcollation[0]=100 |
| 6 | DESC NULLS FIRST | **PASS** | indoption[2]=3 |
| 7 | Opclass padrão | **PASS** | indclass presente |
| 8 | Domínio sobre varchar | **PASS** | `08_domain.log` |
| 9 | FK anônima equivalente | **PASS** | FK_FIN_COMP_CONTRATO |
| 10 | FK NOT VALID | **PASS** | erro esperado |
| 11 | FK estrutura incorreta | **PASS** | erro esperado |
| 12 | Função idêntica | **PASS** | `12_fn_ok.log` |
| 13 | Função corpo diferente | **PASS** | erro esperado |
| 14 | Função SECURITY DEFINER | **PASS** | erro esperado |
| 15 | Trigger habilitado | **PASS** | tgenabled=O |
| 16 | Trigger desabilitado | **PASS** | erro esperado |
| 17 | Trigger divergente | **PASS** | erro esperado |
| 18 | Role ausente | **PASS** | role recriada |
| 19 | Role com LOGIN | **PASS** | erro esperado |
| 20 | Rollback após falha proposital | **PASS** | role/ck/fn permaneceram 0 |

**Compatibilidade:** PG15+ **PASS** (18.4) · PG14 **PASS** (14.25 Docker).  
**D13:** **PASS** em ambos — `app_user` sem SUPERUSER, sem ownership FIN_/fn_fin_, sem membership em `atlas_fin_manutencao`.  
**Role global (host):** residual `atlas_fin_manutencao` NOLOGIN após harness — ver `_p0_2_results/role_global_diag.txt`; `DROP ROLE` só com autorização.
