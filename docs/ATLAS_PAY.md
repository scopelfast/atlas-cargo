# Atlas Pay — documentação técnica

Atualizado em 26/11/2026 (P0 + P1 + P2 + Fase 3 + **Fase 4 concluída e validada tecnicamente no ambiente local**).

Regras de negócio: `docs/PLANO_MODULO_FINANCEIRO.md`.  
Auditoria pré-implementação: `docs/RELATORIO_AUDITORIA_FINANCEIRO.md`.  
Fase 3: `docs/ATLAS_PAY_FASE3_FECHAMENTO_USO.md`.  
Fase 4: `docs/ATLAS_PAY_FASE4_INADIMPLENCIA.md`.

## Situação atual (local / HML operacional)

| Fase | Status em `atlas_cargo_prd` | Evidência |
| --- | --- | --- |
| Fases 1–2 (produto) | Ativas (regra padrão **N**) | `financeiro_atlas_pay_postgres.sql` + UI/API |
| **P0** integridade | **ATIVO** | Apply 26/11; SHA-256 `5AB0CF5E…C54D`; `docs/RESULTADO_TESTES_P0_2_ATLAS_PAY.md` |
| **P1** permissões | **ATIVO** (STRICT) | Apply + bootstrap `admin`/`default`; `docs/ATLAS_PAY_P1_PERMISSOES.md` |
| **P2** testes | **FECHADO** | `test_atlas_pay_fases_1_2.js` → **21/0/0**; P1 **23/0** |
| **Fase 3** uso plataforma | **CONCLUÍDA** (D5 SP + HTTP 403 FIN_*) | `financeiro-fuso-sp.js`; testes F3 **32/0/0** |
| **Fase 4** inadimplência | **ENCERRADA no HML** (com F1–3) | `financeiro-inadimplencia.service.js`; F4 **29/0/0**; D-01/D-02 **16/0**; UI **13/13** |
| **Fases 1–4** | **ENCERRADAS no ambiente local** | `docs/ATLAS_PAY_FECHAMENTO_FASES_1_A_4.md` |
| Produção externa | **Não autorizada** | Checklist P0 item 11 ☐ |

## Escopo entregue

- Contrato versionado por tenant (`FIN_CONTRATO` + componentes).
- Cobrança de **conexão** na confirmação da convocação (regra desligada por padrão).
- Cancelamento na reativação e na desistência de lote.
- Baixa manual com evento e reversão no cancelamento após paga.
- UI `atlas-pay` no padrão dos módulos (abas com ícones, `filtros-box`, Limpar/Filtrar, overlay + yield, dark mode) e API `/api/financeiro/*`.
- Proteção `FOR UPDATE` na confirmação da viagem comum.
- P0: CHECKs/FKs/índices absolutos, imutabilidade de valor, eventos append-only.
- P1: catálogo/perfis FIN_*, bootstrap `FINANCEIRO_ADMIN`, overrides `EFEITO`, auditoria.
- P2: cinco SKIPs das fases 1–2 fechados com execução real.

Fora do escopo ainda: Pix/gateway. Inadimplência: **entregue** (`docs/ATLAS_PAY_FASE4_INADIMPLENCIA.md`).

**Evolução comercial (agentes):** tabela de pacotes → piloto no 9.7 → transparência no painel do tenant → WhatsApp opcional. Roteiro: `docs/ATLAS_PAY_EVOLUCAO_AGENTES.md`.

## Scripts de banco

```text
backend/scripts/financeiro_atlas_pay_postgres.sql          # instalação fases 1–2
backend/scripts/financeiro_atlas_pay_p0_constraints_postgres.sql  # P0 (aplicado no local)
backend/scripts/financeiro_atlas_pay_p1_permissoes_postgres.sql   # P1 (aplicado no local)
backend/scripts/financeiro_atlas_pay_fase3_fechamento_uso_postgres.sql  # Fase 3 (aplicado no local)
```

Backups pré-apply locais:

- P1: `backups/atlas_cargo_prd_pre_p1_permissoes_20261126_160511.dump`
- P0: `backups/atlas_cargo_prd_pre_p0_constraints_20261126_161213.dump` (SHA-256 `63103432267A…5106`)
- Fase 3: `backups/atlas_cargo_prd_pre_fase3_fechamento_uso_20261126.dump`

## Endpoints

Prefixo: `/api/financeiro` (JWT torre + atividade `atlas-pay` / FIN_*).

| Método | Rota | Função / permissão |
| --- | --- | --- |
| GET | `/agentes` | Lista clientes SaaS para seletor (só sessão `default`) |
| GET | `/resumo` | KPIs + contrato vigente + `inadimplencia`/`warning` (Fase 4). Header opcional `X-Atlas-Pay-Tenant` (só `default`) |
| GET | `/contratos` | Histórico de versões |
| GET | `/contratos/vigente` | Vigente com componentes |
| GET | `/contratos/:id` | Detalhe |
| POST | `/contratos` | Publica nova versão (`FIN_CONTRATO_VERSIONAR` / `CRIAR`) |
| GET | `/cobrancas` | Lista (filtros status, q) |
| GET | `/cobrancas/:id` | Detalhe + eventos |
| POST | `/cobrancas/:id/baixa` | Baixa manual (`confirmacao: "BAIXAR"`) — `FIN_COBRANCA_BAIXAR` |
| POST | `/cobrancas/:id/cancelar` | Cancelamento manual (`confirmacao: "CANCELAR"`) — `FIN_COBRANCA_CANCELAR` |
| GET | `/me/permissoes` | Resumo efetivo do usuário da sessão |
| GET | `/permissoes/catalogo` | Catálogo FIN_* |
| GET | `/permissoes/perfis` | Perfis sistema |
| GET | `/permissoes/usuarios` | Usuários do tenant + efetivas |
| GET | `/permissoes/usuarios/:login` | Detalhe |
| POST | `/permissoes/bootstrap-admin` | 1ª atribuição `FINANCEIRO_ADMIN` (`confirmacao: "BOOTSTRAP_ADMIN"`) |
| POST/DELETE | `/permissoes/usuarios/:login/perfis…` | Conceder/revogar perfil |
| POST/DELETE | `/permissoes/usuarios/:login/overrides…` | Override `EFEITO` C\|R |
| GET | `/permissoes/audit` | Auditoria `FIN_PERM_AUDIT` |
| GET | `/fechamentos-uso` | Lista fechamentos do tenant (Fase 3) |
| GET | `/fechamentos-uso/previa` | Prévia ephemeral `?competencia=AAAA-MM` |
| POST | `/fechamentos-uso/calcular` | Grava/recalcula rascunho |
| POST | `/fechamentos-uso/:id/aprovar` | `confirmacao: "APROVAR"` |
| POST | `/fechamentos-uso/:id/gerar-cobranca` | `confirmacao: "GERAR_COBRANCA"` (explícito) |

## Permissão

`TIPOATIVIDADE.DSPROGRAMA = atlas-pay` (menu 9.7 Atlas Pay).  
Após bootstrap P1 no tenant: modo **STRICT** (perfil + overrides). Detalhe: `docs/ATLAS_PAY_P1_PERMISSOES.md`.

## Testes

```powershell
cd backend
node scripts/test_atlas_pay_fases_1_2.js
node scripts/test_atlas_pay_p1_permissoes.js
node scripts/test_atlas_pay_fase3_fechamento_uso.js
node scripts/test_atlas_pay_fase4_inadimplencia.js
```

| Suíte | Resultado vigente (26/11) |
| --- | --- |
| Fases 1–2 (+ P2) | **21 PASS / 0 FAIL / 0 SKIP** — regra `default` restaura **N** |
| P1 | **23 PASS / 0 FAIL** |
| Fase 3 | **32 PASS / 0 FAIL / 0 SKIP** — fuso SP multi-TZ + HTTP 403 aprovar/gerar |
| Fase 4 | **29 PASS / 0 FAIL / 0 SKIP** — 4 cenários vencimento×política; fail-open com warning; isolamento; HTTP 403 só vencida+BLOQUEIO |

Fixtures P2/F3/F4/D-01 **eram** tenants isolados (`atlas-pay-p2-test`, `atlas-pay-f3-test`, `atlas-pay-f4-test`, `atlas-pay-f4-b`, `atlas-pay-d01-*`). Em 27/11 foram **apagados** do HML operacional (`excluirTenantCompleto`); clientes restantes: `default`, `cleverson-scopel`. Testes automatizados podem recriar fixtures efêmeros — não deixar no HML após a suíte.
