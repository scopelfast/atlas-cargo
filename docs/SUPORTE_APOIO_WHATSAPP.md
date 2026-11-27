# Suporte e Pedido de apoio via WhatsApp

## Fluxo

1. Usuário (painel ou motorista) abre Ajuda / Suporte / Pedido de apoio.
2. API recebe tenant **somente da sessão**, usuário autenticado, assunto ou tipo de ajuda, descrição e página/módulo.
3. Serviço resolve destino em `CONFIGURACAO.whatsapp_destino_suporte` (`default`) ou `TELEFONE_SUPORTE`.
4. Se não houver destino → HTTP 503 + registro em `APOIO_WHATSAPP_LOG` (`RESULTADO=N`).
5. Envio via `enviarUmaMensagemSwitchDigital` com `tenantId = default` (canal existente).
6. Sucesso ou falha gravados no log (destino mascarado; sem token).

## API

| Método | Rota | Auth |
| --- | --- | --- |
| GET | `/api/apoio/status` | Torre ou motorista |
| POST | `/api/apoio/suporte` | Torre |
| POST | `/api/apoio/apoio` | Torre |
| POST | `/api/apoio/motorista/suporte` | Motorista |
| POST | `/api/apoio/motorista/apoio` | Motorista |
| GET | `/api/apoio/log` | Torre + tenant `default` |

## Ativação

1. Rodar `backend/scripts/apoio_whatsapp_log_postgres.sql` (já no `script_db_postgres.sql` para banco novo).
2. Em Configurações → Switch / WhatsApp (tenant `default`), preencher **Destino Atlas — Suporte / Pedido de apoio**.
3. Manter token Switch do `default` válido (mesmo da recuperação de senha).

## Resultado da ativação operacional (26/11 — local)

| Item | Estado |
| --- | --- |
| Switch endpoint / método | OK (`api.switchdigital.com.br`, POST) |
| Token Switch (`default`) | Preenchido (não exibido) |
| userId / queueId | Presentes |
| `whatsapp_destino_suporte` | **Vazio** (mantido vazio) |
| `TELEFONE_SUPORTE` (.env) | **Vazio** |
| Envio E2E painel / motorista | **Não executado** — falta número de destino |
| `APOIO_WHATSAPP_LOG` / dedup | Validados em teste unitário anterior; E2E pendente do destino |

**Bloqueio:** é necessário fornecer o celular de destino da Atlas. Sem esse número não há envio real nem confirmação de recebimento.

## O que não muda

Atlas Pay P0/P1/P2, `FIN_*`, canal Switch, recuperação de senha.
