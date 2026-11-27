# Atlas Pay — Fase 3: Fechamento de uso da plataforma

**Data:** 26/11/2026  
**Ambiente:** `atlas_cargo_prd` local (HML operacional)  
**Status:** **Concluída tecnicamente** (prévia, persistência, aprovação, geração explícita, D5 fuso SP, HTTP 403 FIN_*)

## Decisões comerciais (D1–D7)

Congeladas em `docs/ATLAS_PAY_FASE3_DECISOES_COMERCIAIS.md` e aplicadas no código.

| ID | Regra aplicada |
| --- | --- |
| D1 | 1ª `CONVOCACAO` operacional por viagem (`DHCONVOCACAO`); exclui mãe agrupadora; filhas contam |
| D2 | `%` sobre soma `VLFRETE` das anunciadas; inválido → exceção (sem exclusão silenciosa) |
| D3 | Intervalos por vigência; FIXO pró-rata dias; eventos no contrato da data |
| D4 | `FG_REGRA_ATIVA=N` → prévia ok, bloqueia aprovação/cobrança |
| D5 | `America/Sao_Paulo`, `[1º 00:00, 1º mês+1 00:00)`; vencimento = aprovação + 10 dias corridos |
| D6 | `BENEFICIARIO_TENANT_ID = default` |
| D7 | Sem componente USO → status `SEM_COMPONENTE_USO_PLATAFORMA`, total 0, sem cobrança |

### Evidência de disparo (inspeção)

`CONVOCACAO` nasce `PENDENTE` com `DHCONVOCACAO` no momento da convocação pela torre — não há status de rascunho pré-disparo. `DHENVIOMETA` / `LOG_ENVIO_WHATSAPP.ENVIADO` confirmam canal WhatsApp (opcional). Filtro: status em `PENDENTE|ACEITA|CONFIRMADA|RECUSADA|ACEITA_DESCARTADA`.

## Fuso horário (D5) — correção final

**Armazenamento comprovado:** colunas `DH_*` de `FIN_*`, `CONVOCACAO` e `VIAGEMMESTRE` são `timestamp without time zone` (naive). Sessão PG local = `America/Sao_Paulo`. Não se interpreta naive como UTC.

**Implementação:** `backend/services/financeiro-fuso-sp.js` — parede civil SP via `Intl` (agora) e aritmética civil (bounds, dias, vencimento, lacunas). Aprovação/vencimento/lacunas **não** usam `Date.parse` / `toISOString` / getters do fuso do host.

**Teste de independência:** filhos Node com `TZ=UTC|Asia/Tokyo|America/Los_Angeles|Pacific/Kiritimati|America/Sao_Paulo` produzem o mesmo bounds, vencimento (+10 dias) e lacunas em parede SP.

## Permissões HTTP (P1)

Rotas de aprovar / gerar cobrança continuam em `requireFinPerm` (sem modelo paralelo):

| Rota | Permissão |
| --- | --- |
| `POST .../aprovar` | `FIN_CONFIGURAR` \| `FIN_COBRANCA_GERAR` |
| `POST .../gerar-cobranca` | `FIN_COBRANCA_GERAR` |

**Evidência automatizada (26/11):** usuário autenticado com menu `atlas-pay` e sem FIN_* → **HTTP 403** `FIN_SEM_PERMISSAO` nos dois fluxos; `admin` (FINANCEIRO_ADMIN) → `next()`. Fixture `f3_http_sem_fin` limpa ao final.

## Modelo de dados

- `FIN_FECHAMENTO_USO` — um por (`TENANT_ID`,`COMPETENCIA`)
- `FIN_FECHAMENTO_USO_EVENTO` — append-only (`CRIADO`,`RECALCULADO`,`APROVADO`,`COBRANCA_GERADA`,`BLOQUEADO`)
- Índice aditivo `UK_FIN_COB_USO_CICLO_ATIVA` em `FIN_COBRANCA` (não altera uniques de CONEXAO)

Script: `backend/scripts/financeiro_atlas_pay_fase3_fechamento_uso_postgres.sql`  
Backup pré-apply: `backups/atlas_cargo_prd_pre_fase3_fechamento_uso_20261126.dump`

## Status

`RASCUNHO` → `COM_EXCECOES` | `AGUARDANDO_APROVACAO` | `SEM_COMPONENTE_USO_PLATAFORMA` → `APROVADO` → `COBRADO`

Aprovado/cobrado: memória imutável (recálculo bloqueado).

## API (`/api/financeiro`)

| Método | Rota | Permissão |
| --- | --- | --- |
| GET | `/fechamentos-uso` | consulta |
| GET | `/fechamentos-uso/previa?competencia=` | consulta |
| GET | `/fechamentos-uso/:id` | consulta |
| POST | `/fechamentos-uso/calcular` | `FIN_COBRANCA_GERAR` \| `FIN_CONFIGURAR` |
| POST | `/fechamentos-uso/:id/recalcular` | idem |
| POST | `/fechamentos-uso/:id/aprovar` `{confirmacao:"APROVAR"}` | `FIN_CONFIGURAR` \| `FIN_COBRANCA_GERAR` |
| POST | `/fechamentos-uso/:id/gerar-cobranca` `{confirmacao:"GERAR_COBRANCA"}` | `FIN_COBRANCA_GERAR` |

Tenant sempre da sessão. Ciclo sintético: `USO:{tenant}:{AAAA-MM}` (hash se > 64 chars).

## UI

Atlas Pay → aba **Fechamento de uso**: Prévia, Calcular, Recalcular, Aprovar, Gerar cobrança.

## Testes

```powershell
cd backend
node scripts/test_atlas_pay_fase3_fechamento_uso.js
node scripts/test_atlas_pay_fases_1_2.js
node scripts/test_atlas_pay_p1_permissoes.js
```

Resultado local (correções finais D5 + HTTP 403, 26/11): F3 **32/0/0**; P2 **21/0/0**; P1 **23/0**.

## P0/P1/P2

Não reaplicados. Constraints/triggers/catálogo P1 intactos. Resíduo `atlas-pay-p2-test` **removido do HML em 27/11** (ver `docs/ATLAS_PAY_EVOLUCAO_AGENTES.md`).

## Pendências remanescentes (fora do fechamento técnico da Fase 3)

- Contratos mistos S/N na mesma competência: sem decisão automática (não interpretado).
- Produção externa / deploy: não autorizado.
- Pix/gateway: Fase 5 (não iniciada).
- Inadimplência (ALERTA/BLOQUEIO): **entregue** na Fase 4 — `docs/ATLAS_PAY_FASE4_INADIMPLENCIA.md`.
