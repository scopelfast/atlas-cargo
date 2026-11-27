# Relatório de revisão P0.2 — Atlas Pay

**Data:** 26/11/2026 (revisão técnica + apply HML operacional)  
**Escopo:** correção técnica do script P0, documentação e apply local autorizado.  
**Histórico (superado):** scratch PG18.4/PG14.25 20/20 + D13; “sem apply”.  
**Vigente:** P0 **aplicado** em `atlas_cargo_prd` (localhost HML operacional) com COMMIT; ver `docs/RESULTADO_TESTES_P0_2_ATLAS_PAY.md` e checklist.

Script: `backend/scripts/financeiro_atlas_pay_p0_constraints_postgres.sql`  
Plano: `docs/PLANO_MIGRACAO_P0_ATLAS_PAY.md`  
Checklist: `docs/CHECKLIST_HOMOLOGACAO_P0_ATLAS_PAY.md`

---

## 1. Resumo dos sete pontos

| # | Apontamento externo | Veredito na inspeção | Correção |
| --- | --- | --- | --- |
| 1 | Collation assumida zero | **Confirmado** — `v_coll \|\| 0` em `fin_p0_ensure_index` | Esperar `attcollation` se tipo colacionável |
| 2 | Função trigger incompleta | **Confirmado** — só lang + corpo | + retorno trigger, nargs, volatile, SECURITY, proconfig |
| 3 | `tgenabled` ausente | **Confirmado** | Exigir `O`/`A`; `D` → erro; sem reabilitar |
| 4 | Opclass sem domínio | **Confirmado** — `opcintype = p_typid` direto | `fin_p0_base_type` + opclass do base |
| 5 | `confdelsetcols` / PG14 | **Parcialmente válido** — coluna PG15+; referenciar direto quebraria PG14 | Check dinâmico só se `server_version_num >= 150000` |
| 6 | D13d via `pg_class` para funções | **Confirmado** no plano | Separar `pg_proc.proowner` |
| 7 | Rollback incompleto | **Confirmado** — drop genérico | Inventário criar/renomear/validar-only |

---

## 2. Detalhamento

### 2.1 Collation

- **Problema:** índices em `varchar`/`text` no PG gravam `indcollation = attcollation` (OID da collation da coluna/DB), não necessariamente 0.  
- **Evidência:** loop antigo `v_coll := v_coll || 0::oid`.  
- **Correção:** `fin_p0_expected_collation` — se `typcollation = 0` → 0; senão `attcollation`.  
- **Risco reduzido:** falso negativo na 2ª execução / índice pré-criado em colunas textuais.  
- **Teste:** #5 — **PASS** (scratch PG14/PG18; histórico “NÃO EXECUTADO” superado).

### 2.2 Funções de trigger

- **Problema:** não validava `prorettype`, `pronargs`, `provolatile`, `prosecdef`, `proconfig`.  
- **Correção:** exigir plpgsql, RETURNS trigger, 0 args, VOLATILE, SECURITY INVOKER, sem proconfig; corpo via strip sem `lower`; create com `SECURITY INVOKER VOLATILE`.  
- **Risco reduzido:** aceitar SECURITY DEFINER ou assinatura errada.  
- **Testes:** #12–14 — **PASS** (scratch; histórico “NÃO EXECUTADOS” superado).

### 2.3 Triggers

- **Problema:** só comparava `pg_get_triggerdef`.  
- **Correção:** `tgenabled` ∈ {`O`,`A`}; `D` erro explícito; `tgfoid` = função esperada; sem `ALTER … ENABLE`.  
- **Testes:** #15–17 — **PASS** (scratch; histórico “NÃO EXECUTADOS” superado).

### 2.4 Opclass / domínio

- **Problema:** domínio sobre `varchar`/`numeric` sem opclass no OID do domínio.  
- **Correção:** `fin_p0_base_type` recursivo; default btree no tipo base.  
- **Teste:** #8 — **PASS** (scratch; histórico “NÃO EXECUTADO” superado).

### 2.5 FK PG14+

- **Problema:** `confdelsetcols` inexistente no PG14.  
- **Correção:** comparação extra só em PG15+ via `EXECUTE` dinâmico; PG14 inalterado.  
- **Testes:** #9–11 — **PASS** (scratch; histórico “NÃO EXECUTADOS” superado).

### 2.6 D13d ownership

- **Problema:** funções listadas em `pg_class` (relkind de índices/tabelas).  
- **Correção no plano:** query `pg_proc` + `proowner`; tabelas em `pg_class`.  
- **Classificação GO (vigente):** membership de `app_user` em `atlas_fin_manutencao` = **impeditivo**; `app_user` SUPERUSER = **impeditivo**; `app_user` owner de `FIN_*` / `fn_fin_*` = **impeditivo**.  
- **Histórico superado:** owner/superuser como “informativo”. Scratch 26/11: nenhuma condição impeditiva encontrada → D13 PASS.

### 2.7 Rollback

Ver §4 do plano atualizado — inventário:

| Objeto | Classe |
| --- | --- |
| `atlas_fin_manutencao` | Novo se ausente; senão só validado |
| CHECKs/FKs nomeados | Novos **ou** FK renomeada (anônima→nome) |
| Índices listados no script | Novos **ou** NOTICE se equivalente outro nome |
| `UK_FIN_COB_CICLO_ATIVA` | Só validação se pré-existir |
| `fn_fin_*` / `trg_fin_*` | Novos se ausentes; senão só validação |

**Pós-COMMIT:** só reverter o que o inventário pré-apply marcar como “criado nesta execução”. Não dropar CHECKs/FKs/índices pré-existentes validados. Role: drop só se criada nesta apply e sem membros.

---

## 3. Bateria de testes (20) — status

**Executada** em scratch (ver `docs/RESULTADO_TESTES_P0_2_ATLAS_PAY.md`).

| Ambiente | 20 testes | D13 |
| --- | --- | --- |
| PostgreSQL 18.4 host · `atlas_pay_p0_scratch` | **PASS** | **PASS** |
| PostgreSQL 14.25 Docker · `atlas_pay_p0_scratch` | **PASS** | **PASS** |

Harness: `backend/scripts/test_p0_2_disposable_harness.md` / `run_p0_2_harness.ps1`.

---

## 4. Limitações remanescentes

- Owner/superuser da app ainda contorna triggers (fora do escopo P0).  
- Comparação de `prosrc`/triggerdef permanece textual (com normalização PG14–18).  
- Lacuna CHECK TIPO↔campos fora do P0.  
- Role `atlas_fin_manutencao` é global no cluster; harness deixa residual NOLOGIN (limpeza opcional sob autorização).

---

## 5. Parecer técnico final

Scratch PG14 + PG18 e D13 permaneceram aprovados.  
**Apply HML operacional (26/11/2026):** canônico executado em `atlas_cargo_prd` → **COMMIT**; idempotência OK; D13 pós-apply OK; regressão P1/fases 1–2 OK.  
**Produção externa:** ainda pendente de autorização específica (checklist item 11).
