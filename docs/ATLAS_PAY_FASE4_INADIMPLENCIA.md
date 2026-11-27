# Atlas Pay — Fase 4: Inadimplência inteligente

**Data:** 26/11/2026  
**Ambiente:** `atlas_cargo_prd` local (HML operacional)  
**Status:** **CONCLUÍDA E VALIDADA TECNICAMENTE NO AMBIENTE LOCAL.**

Proposta: `docs/ATLAS_PAY_FASE4_INADIMPLENCIA_PROPOSTA.md`.  
Produção externa: **NÃO AUTORIZADA**.

## Regra comercial definitiva

Não existe status `VENCIDA` no banco. Vencimento = `STATUS = 'ABERTA'` **e** `DH_VENCIMENTO` &lt; agora em `America/Sao_Paulo`.

| Situação | Política | Resultado |
| --- | --- | --- |
| `ABERTA` **não** vencida | `ALERTA` | Opera com warning (`FIN_INADIMPLENTE_ALERTA`) |
| `ABERTA` **não** vencida | `BLOQUEIO` | Opera com warning (nunca 403) |
| `ABERTA` **vencida** | `ALERTA` | Opera com warning (nunca 403) |
| `ABERTA` **vencida** | `BLOQUEIO` | HTTP **403** `FIN_INADIMPLENTE_BLOQUEIO` |
| `PAGA` / `CANCELADA` | qualquer | Sem alerta nem bloqueio |
| `FG_REGRA_ATIVA = 'N'` | — | Sem enforcement |
| Falha de consulta financeira | — | **FAIL-OPEN** (log `[fin-inad]` + warning `FIN_INAD_FAIL_OPEN`) |
| Tenant `default` (dívida TENANT contra si) | mesmo `BLOQUEIO` | Nunca bloqueado; no máximo ALERTA |
| Isolamento | — | MOTORISTA ≠ TENANT; escopo pelo tenant da operação |

## Serviço

`backend/services/financeiro-inadimplencia.service.js`

- `avaliarPagador`, `aplicarGate`, `warningFromAvaliacao`, `anexarWarning`
- Somente leitura; sem tabela/flag de bloqueio; reversão = próxima avaliação após PAGA/CANCELADA
- Fuso: `America/Sao_Paulo` via `financeiro-fuso-sp.js`

## Gates (somente operações novas)

| Papel | Handler |
| --- | --- |
| Motorista | `aceitarConvocacao`, `aceitarCarga`, `publicoInteresse` (só novo ACEITA) |
| Tenant | `criarConvocacoes`, `dispararCampanha`, `confirmarConvocacao` (antes da TX) |

Não bloqueia: login, sessão, mapa, estoque/WMS, consulta, cadastro, viagem já confirmada, rascunho de viagem.

Confirmação: TX confirmação + cobrança de conexão **inalterada** (P0 / Fase 2). Gate roda **antes** da TX.

## UI

- Atlas Pay: banner + `showMessage` no resumo (`GET /resumo` inclui `inadimplencia`/`warning`)
- Gerenciar Viagens / Campanhas: 403 e warning via toast
- App motorista: `GET /api/motorista/situacao-financeira` + toasts no aceite
- Link público oportunidades: toast de warning/403
- Sem `alert()` nativo; frontend **não** escolhe o tenant de avaliação

## Testes executados (26/11/2026)

```powershell
cd backend
node scripts/test_atlas_pay_fase4_inadimplencia.js
node scripts/test_atlas_pay_fase3_fechamento_uso.js
node scripts/test_atlas_pay_fases_1_2.js
node scripts/test_atlas_pay_p1_permissoes.js
```

| Suíte | Resultado |
| --- | --- |
| Fase 4 | **29 PASS / 0 FAIL / 0 SKIP** |
| Fase 3 | **32 PASS / 0 FAIL / 0 SKIP** |
| Fases 1–2 (P2) | **21 PASS / 0 FAIL / 0 SKIP** |
| P1 | **23 PASS / 0 FAIL** |

Cenários principais (F4): (1) ABERTA não vencida + ALERTA → warning; (2) ABERTA não vencida + BLOQUEIO → warning; (3) ABERTA vencida + ALERTA → warning; (4) ABERTA vencida + BLOQUEIO → 403 `FIN_INADIMPLENTE_BLOQUEIO`.

## Restrições respeitadas

Sem SQL/migration nesta fase; sem status `VENCIDA`; sem reabrir/reaplicar P0/P1/P2/Fase 3; sem Pix; sem alteração estoque 7.1; sem deploy externo; sem permissões FIN paralelas. Fixtures em `atlas-pay-f4-test` / `atlas-pay-f4-b` (cobranças canceladas na limpeza; append-only preservado).
