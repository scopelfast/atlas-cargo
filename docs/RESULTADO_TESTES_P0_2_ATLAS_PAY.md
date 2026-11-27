# Resultado dos testes P0.2 — Atlas Pay

**Atualizado:** 2026-11-26 (fechamento documental P0+P1+P2)  
**SQL canônico:** `backend/scripts/financeiro_atlas_pay_p0_constraints_postgres.sql`  
**SHA-256 (apply local):** `5AB0CF5EC857E2AA03BBFA43FD678872E50C4E29DF25E7DD02ECC4DE5B0CC54D`  
**Harness scratch:** `backend/scripts/run_p0_2_harness.ps1`  
**Apply local:** `atlas_cargo_prd` (HML operacional) — **COMMIT** 26/11/2026  

**Situação vigente:** P0 **ATIVO** no local · P1 **ATIVO** (STRICT) · P2 testes **FECHADO** · produção externa **não** autorizada.

---

## 1. Ambientes

| Ambiente | Servidor | Banco | Evidências |
| --- | --- | --- | --- |
| Host local scratch *(histórico)* | PostgreSQL **18.4** | `atlas_pay_p0_scratch` | `backend/scripts/_p0_2_results/` |
| Docker descartável *(histórico)* | PostgreSQL **14.25** | `atlas_pay_p0_scratch` | `backend/scripts/_p0_2_results_pg14/` |
| **HML operacional (apply)** | PostgreSQL **18.4** `localhost:5432` | **`atlas_cargo_prd`** | `backend/scripts/_homolog_p0_inventory/` |

---

## 2. Scratch prévio (preservado)

| Ambiente | Resultado |
| --- | --- |
| PG 18.4 | **20/20 PASS** + D13 PASS + idempotência |
| PG 14.25 Docker | **20/20 PASS** + D13 PASS |

*(Histórico: essas baterias antecederam o apply; não substituem a validação pós-apply abaixo.)*

---

## 3. Apply em `atlas_cargo_prd` (26/11/2026)

| Etapa | Resultado |
| --- | --- |
| Destino confirmado | `atlas_cargo_prd` / `postgres` / porta 5432 |
| Backup `-Fc` | `backups/atlas_cargo_prd_pre_p0_constraints_20261126_161213.dump` (1 181 344 B; SHA-256 `63103432267A…5106`) |
| Inventário + D13 pré | PASS — `app_user` sem MEMBER/SUPERUSER/owner FIN_* |
| Apply canônico | **COMMIT** — log `apply_p0_20261126_161226.log` |
| Idempotência (2ª `-f`) | **COMMIT** |
| Pós-apply estrutural | `CK_FIN_COB_CONEXAO_REF`, `UK_FIN_COB_CICLO_ABS`, `fn_fin_cob_valor_imutavel`, `fn_fin_evt_append_only`, triggers `O` |
| `UK_FIN_COB_CICLO_ATIVA` | Pré-existente — **validada-only** (não recriada) |
| Integridade (TX+ROLLBACK) | PASS_IMUT, PASS_APPEND_UPDATE/DELETE, PASS_DUP_CICLO (`UK_FIN_COB_CICLO_ABS`), PASS_D13_NO_MEMBER |
| Contagens pós-ROLLBACK | cob=3 (antes da regressão fases), evt=10, perfil admin=1 |

---

## 4. D13 (segurança) — pós-apply local

| Verificação | Resultado |
| --- | --- |
| `app_user` SUPERUSER | não |
| `app_user` owner `FIN_*` / `fn_fin_*` | 0 |
| Membership → `atlas_fin_manutencao` | não |
| Role manutenção LOGIN/SUPERUSER | não |
| Funções `prosecdef` | não (INVOKER) |

**D13 PASS.** Sem alteração de permissões para “passar”.

---

## 5. Role `atlas_fin_manutencao`

| Item | Achado |
| --- | --- |
| Atributos | NOLOGIN, NOSUPERUSER, NOINHERIT, … |
| Memberships | 0 |
| `DROP ROLE` | **não executado** |

---

## 6. Regressão e P2 (após P0)

| Suíte | Resultado vigente |
| --- | --- |
| `test_atlas_pay_p1_permissoes.js` | **23 PASS / 0 FAIL** |
| `test_atlas_pay_fases_1_2.js` | **21 PASS / 0 FAIL / 0 SKIP** (P2 fechou os 5 SKIP) |
| Regra `default` | **N** (confirmado pós-suíte) |
| API P1 | STRICT + `FINANCEIRO_ADMIN`; audit OK |
| P1 bootstrap | preservado |

*(Histórico imediato pós-P0, antes do P2: fases 1–2 = 15 PASS / 0 FAIL / 5 SKIP — superado.)*

---

## 7. Resíduo tenant `atlas-pay-p2-test` (somente leitura, 26/11)

| Objeto | Qtd | Detalhe |
| --- | --- | --- |
| `FIN_COBRANCA` | 1 | ID **17**, `CANCELADA`, conv/viagem fixture `920011`, ciclo `p2-lote-…`, R$100 |
| `FIN_COBRANCA_EVENTO` | 2 | ID **30** `CRIADA`; ID **31** `CANCELADA` (motivo teste desistir lote) |
| `FIN_CONTRATO` / viagem / convocação / SaaS | 0 | Limpeza das fixtures concluída |
| Origem | — | Execução intermediária do teste de lote **com COMMIT**, antes do padrão TX+ROLLBACK |
| Providência | — | **Preservar** (append-only P0; sem limpeza sem autorização de manutenção) |

`default` não foi alterado por essa investigação: regra vigente **N**, P1 `admin`/`FINANCEIRO_ADMIN` intacto.

---

## 8. Parecer

| Critério | Situação |
| --- | --- |
| Scratch PG14/18 | PASS (preservado) |
| Apply local + COMMIT | **Feito** |
| D13 local | **PASS** |
| P1 STRICT + 23/23 | **PASS** |
| P2 21/0/0 | **PASS** |
| Produção externa | **Não** — checklist item 11 |

### Situação: **P0 ATIVO · P1 ATIVO (STRICT) · P2 FECHADO** no local (HML operacional)
