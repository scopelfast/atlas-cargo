# Plano: mensagens Switch / WhatsApp configuráveis (sem quebrar o que existe)

**Objetivo:** permitir que o administrador personalize textos de convocações, confirmações, “não escolhido”, etc., e evoluir depois os textos de **alertas de viagem**, usando a mesma integração Switch Digital já configurada em **Configurações do Sistema**.

**Status (mar/2026):** **Fase 1 (convocações)** e **Fase 2 (alertas automáticos)** implementadas. Fase 3 abaixo permanece como evolução.

---

## 1. Princípio obrigatório (não negociável)

**Fallback:** se não houver template salvo, ou estiver vazio, ou o resultado após placeholders ficar vazio → o sistema usa **exatamente** a montagem **legada** no código (`montarCorpoDisparoPadrao`, confirmações; alertas: `montarMensagemPadrao` em `alert-mensagem-template.service.js`).

---

## 2. O que já existe hoje (referência)

| Área | Onde | O que faz |
|------|------|-----------|
| **Integração Switch** | Configurações → *Integração Switch Digital* | Endpoint, token, fila, assinatura, etc. |
| **Alertas → WhatsApp** | Configurações → *Alertas de viagem* → *Notificações por WhatsApp (Switch)* + *Modelos de mensagem* | Alertas automáticos; corpo com fallback em `alert-mensagem-template.service.js` / `alert-notification-service.js`. |
| **Convocações** | `viagemmestre.controller.js` + Configurações → *Mensagens WhatsApp – convocações* | Disparo em fila Switch, confirmação (selecionado + ACEITA_DESCARTADA); templates em `CONFIGURACAO` com fallback. |

---

## 3. Organização na Configurações (UX)

- Card **Alertas de viagem** descreve no próprio bloco WhatsApp que **não** cobre convocações; em *Modelos de mensagem (opcional)* há um modelo por tipo de alerta (7), pré-visualização e **Salvar modelos**.
- Card **Mensagens WhatsApp – convocações:** três modelos (disparo, motorista selecionado, não selecionado), variáveis na tela, modelo sugerido, pré-visualização com dados de exemplo, **Salvar só esta** ou **Salvar todas**.

---

## 4. Fase 1 — entregue (referência técnica)

| Peça | Detalhe |
|------|---------|
| **Chaves `CONFIGURACAO`** | `msg_conv_disparo_corpo`, `msg_conv_confirmacao_selecionado_corpo`, `msg_conv_confirmacao_nao_selecionado_corpo` |
| **Serviço** | `backend/services/convocacao-mensagem-template.service.js` — placeholders `{{VAR}}`, `obterTemplatesSugeridos()`, `previewComExemplo()` |
| **Uso no fluxo** | `enviarWebhookSwitchDigital` (disparo); `confirmarConvocacao` (selecionado + não selecionados) |
| **API** | `GET/PUT /api/configuracoes/mensagens-convocacao`; `POST .../preview` |
| **UI** | `backend/public/modulos/gerenciar-configuracoes/` (`index.html`, `js/script.js`) |

**Fora do escopo da Fase 1:** reativação de convocação (sem WhatsApp no fluxo mapeado), templates por locale, teste de envio com corpo de convocação.

---

## 5. Fase 2 — Alertas (entregue)

| Peça | Detalhe |
|------|---------|
| **Chaves `CONFIGURACAO`** | `msg_alert_parada_corpo`, `msg_alert_atraso_corpo`, `msg_alert_eta_prazo_corpo`, `msg_alert_offline_corpo`, `msg_alert_desvio_corpo`, `msg_alert_atraso_inicio_corpo`, `msg_alert_excesso_velocidade_corpo` |
| **Serviço** | `backend/services/alert-mensagem-template.service.js` — placeholders `{{VAR}}`, `obterTemplatesSugeridos()`, `previewComExemplo()`, fallback = `montarMensagemPadrao` |
| **Uso no fluxo** | `notificarAlertaCriado` em `alert-notification-service.js` chama `resolverMensagemAlerta` (variáveis incluem `CONTEXTO_DESTINATARIO_LEGIVEL` para motorista / contratador / central) |
| **API** | `GET/PUT /api/configuracoes/mensagens-alertas`; `POST .../preview` |
| **UI** | Card *Alertas de viagem* → *Modelos de mensagem (opcional)* |

## 6. Fase seguinte (pendente)

1. **Fase 3 — Qualidade:** botão restaurar padrão por mensagem; envio de teste para número; auditoria se necessário; ajustes finos de tom por destinatário.

---

## 7. Modelo original (evolução)

- Placeholders adicionais, **um corpo por (evento × destinatário)** ou i18n por locale — podem entrar nas fases acima conforme prioridade.

---

*Documento revisado após entrega das Fases 1 e 2.*
