# Checklist de homologação — Atlas Pay P0.2

**Uso:** preencher **antes** de qualquer apply do SQL canônico em homologação.  
**Script:** `backend/scripts/financeiro_atlas_pay_p0_constraints_postgres.sql`  
**Pré-requisito técnico:** GO scratch (PG14 + PG18) em `docs/RESULTADO_TESTES_P0_2_ATLAS_PAY.md`.

**Proibições:** não modificar o canônico na hora do apply; não conceder `atlas_fin_manutencao` a `app_user`; não `DROP ROLE`.

---

## Checklist

| # | Item | Responsável | Data | OK? | Evidência / nota |
| --- | --- | --- | --- | --- | --- |
| 1 | **Autorização expressa** para apply em homologação (nome/data) | Cursor (operacional) | 26/11/2026 | ☑ | Pedido “ATLAS PAY P0 — APLICAÇÃO E VALIDAÇÃO”; local = HML operacional |
| 2 | **Identificação** do servidor e banco de homologação | — | 26/11/2026 | ☑ | `localhost:5432` / `atlas_cargo_prd` / `postgres` / PG **18.4** (autorizado como HML operacional) |
| 3 | **Backup prévio** (`pg_dump -Fc`) | — | 26/11/2026 | ☑ | `backups/atlas_cargo_prd_pre_p0_constraints_20261126_161213.dump` (1 181 344 B; SHA-256 `63103432267A…5106`) |
| 4 | **Inventário pré-apply** | — | 26/11/2026 | ☑ | `backend/scripts/_homolog_p0_inventory/pre_apply_20261126_161213.log` + `d13_pre_*.log` |
| 5 | **Registro** preexistentes vs. criados | — | 26/11/2026 | ☑ | Pré: CHECKs/FKs/índices base + P1; P0 criou `UK_FIN_COB_CICLO_ABS`, `CK_FIN_COB_CONEXAO_REF`, `fn_fin_*`, `trg_fin_*`; `UK_FIN_COB_CICLO_ATIVA` validada-only |
| 6 | **Execução do SQL canônico** sem modificações | — | 26/11/2026 | ☑ | `-f financeiro_atlas_pay_p0_constraints_postgres.sql` → **COMMIT** |
| 7 | **Log integral** da sessão | — | 26/11/2026 | ☑ | `backend/scripts/_homolog_p0_inventory/apply_p0_20261126_161226.log` |
| 8 | **Verificação pós-apply** | — | 26/11/2026 | ☑ | `post_apply_20261126_161242.log` + integrity rollback PASS |
| 9 | **Idempotência** (2ª execução) | — | 26/11/2026 | ☑ | `idempotency_20261126_161242.log` → **COMMIT** |
| 10 | **Rollback plan** (só criado nesta apply) | — | 26/11/2026 | ☑ | Ver § Rollback abaixo |
| 11 | **Aprovação específica** antes de **produção** | — | — | ☐ | Produção externa aguarda autorização distinta |

---

## Inventário pré-apply (modelo)

Executado em `atlas_cargo_prd` (HML operacional autorizada). Arquivo: `p0_homolog_inventory_pre_apply.sql`.

---

## D13 em homologação (obrigatório pós-apply)

| Condição | Resultado 26/11 |
| --- | --- |
| `app_user` MEMBER/USAGE em `atlas_fin_manutencao` | **false** — OK |
| `app_user` SUPERUSER | **false** — OK |
| `app_user` owner de `FIN_*` ou `fn_fin_*` | **0** — OK |

D13 **PASS**. Nenhuma permissão alterada para “passar”.

---

## Rollback (objetos criados nesta apply)

Ordem sugerida (somente se autorização de rollback):

1. `DROP TRIGGER` `trg_fin_evt_append_only`, `trg_fin_cob_valor_imutavel`
2. `DROP FUNCTION` `fn_fin_evt_append_only()`, `fn_fin_cob_valor_imutavel()`
3. `DROP INDEX` `UK_FIN_COB_CICLO_ABS` (e demais índices **criados** pelo P0 se o inventário marcar como novos)
4. `ALTER TABLE ... DROP CONSTRAINT` `CK_FIN_COB_CONEXAO_REF` (e CHECKs/FKs criados nesta apply)
5. **Não** dropar `UK_FIN_COB_CICLO_ATIVA` (pré-existente validada-only)
6. **Não** `DROP ROLE atlas_fin_manutencao` sem autorização (pré-existente no cluster)
7. Restore alternativo: `pg_restore` do dump pré-apply

---

## Encerramento

- [x] Homologação apply concluída e documentada  
- [x] Idempotência confirmada  
- [x] Rollback plan arquivado  
- [ ] Produção: **aguardando autorização específica** (item 11)

**P0 ATIVO no local (`atlas_cargo_prd` como HML operacional).** Produção externa continua pendente do item 11.
