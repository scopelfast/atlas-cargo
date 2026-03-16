# Próximos passos: regras e formatação de mensagens

Documento de apoio após o cadastro do motorista (FGRASTREADO, Classe de frota, Locais preferidos) estar em uso. Foco em **regras de negócio** e **formatação/envio de mensagens**.

---

## O que já está feito

- **Cadastro motorista:** FGRASTREADO, Classe de frota, Locais preferidos (CADASTRO_LOCAL_PREFERIDO) — funcionando.
- **Mensagem de convocação (Switch Digital / manual):** texto padrão com ID, tipo, classe, rota, horários, contratador, valores, detalhes, link. **Incluído:** bloco *REQUISITOS – Exige veículo rastreado: SIM* quando a viagem tem `FGRASTREADO = 'S'`.
- **Mensagem de confirmação:** “Parabéns, você foi selecionado” + dados da viagem + contato do contratador.
- **Documentação:** `DOCUMENTACAO_MENSAGENS_CONVOCACOES.md`, `DOCUMENTACAO_SISTEMA_CONVOCACOES.md`, `GUIA_RAPIDO_ENVIO.md`.

---

## 1. Regras (validações antes do envio)

| Item | Onde | Descrição |
|------|------|-----------|
| Celular válido | Backend / front | Não enviar convocação se motorista sem celular (DDI+DDD+número válido). Já há checagem; reforçar mensagem de erro amigável. |
| Link público | Backend | Aviso na mensagem quando `PUBLIC_URL` for local (já existe: “Links locais não são clicáveis…”). Manter e, se quiser, encurtar texto. |
| Limite de envios | WaboxApp / Switch | Respeitar cota da API; endpoint de status já existe. Opcional: bloquear “Enviar” quando acima de X% do limite. |
| Uma convocação aceita por viagem | Já implementado | Regra de negócio: só um motorista confirmado por viagem. Manter como está. |
| Situação da viagem | Opcional | Só permitir disparar convocação para viagem em situação “Programada (P)” ou “Preparação (D)” (evitar enviar para cancelada/finalizada). |

---

## 2. Formatação das mensagens

| Item | Onde | Descrição |
|------|------|-----------|
| Data/hora | Backend | Usar `formatarDataHora()` em todos os textos (convocação e confirmação). Padrão único: ex. `DD/MM/AAAA HH:mm`. |
| Moeda | Backend | Já usa `toLocaleString('pt-BR', { style: 'currency', currency: config.moeda })`. Manter; garantir que `config.moeda` vem da viagem ou padrão (ex. BRL). |
| Peso / cubagem | Backend | Peso em ton com vírgula; cubagem em m³. Já feito. Opcional: esconder “0,00 ton” / “0,00 m³” quando zero. |
| Nome do motorista | Backend | Maiúsculas na saudação. Manter. |
| Emojis e quebras de linha | Backend / front | Manter padrão atual (🚚, 📅, ✅, etc.) para consistência. Definir “template oficial” em um único lugar (ex. backend) para evitar divergência com o front. |
| Tamanho da mensagem | Opcional | WhatsApp tem limite; mensagens muito longas podem ser cortadas. Opcional: truncar observações com “(…)”. |

---

## 3. Envio (fluxo e integração)

| Item | Onde | Descrição |
|------|------|-----------|
| Método manual | Front | Link WhatsApp com texto pré-preenchido. Já existe. Revisar encoding do link (acentos, quebras). |
| Switch Digital | Backend | Envio em lote com intervalo; log em LOG_ENVIO_WHATSAPP / LOGSWEBHOOKMETA. Manter. |
| WaboxApp | Se ainda em uso | Documentado em `DOCUMENTACAO_MENSAGENS_CONVOCACOES.md`. Desativar ou migrar para Switch se for o caso. |
| Retry em falha | Opcional | Em falha de API (ex. 5xx), não retentar automaticamente de imediato para não duplicar envio. Deixar retry manual ou fila com backoff. |
| Logs e auditoria | Já existe | Tabelas de log; manter e consultar em caso de “não recebi a mensagem”. |

---

## 4. Outros pontos (mensagens no sistema)

| Item | Onde | Descrição |
|------|------|-----------|
| Alertas (módulo alertas) | services/alert-service, etc. | Formatação e regras de quando gerar alertas — ver documentação em `public/modulos/alertas/`. |
| Chat / SOS | message.controller, chat, sos | Se houver templates de mensagem (ex. SOS, avisos), unificar estilo (data, moeda, texto curto). |
| E-mail (se existir) | - | Usar mesmo padrão de data/moeda e texto breve. |

---

## 5. Ordem sugerida para implementar

1. **Regras:** validar situação da viagem (P ou D) antes de disparar; mensagem clara quando “sem celular”.
2. **Formatação:** centralizar em um único lugar (ex. funções no `viagemmestre.controller` ou em um `message-format.service.js`) os helpers de data, moeda e montagem do texto da convocação/confirmação.
3. **Template único:** backend como fonte da verdade do texto; front apenas chama API e exibe preview quando necessário.
4. **Opcional:** truncar observações longas; esconder peso/cubagem zerados; limite de envios no front.

---

## Referência rápida de arquivos

- **Mensagem de convocação (Switch Digital):** `controllers/viagemmestre.controller.js` (busca viagem com `FGRASTREADO`, monta `textoWhatsApp` com bloco REQUISITOS quando rastreado).
- **Mensagem de confirmação:** `controllers/viagemmestre.controller.js` (confirmar convocação → “Parabéns, você foi selecionado”).
- **Front – preparar anúncio / links:** `public/modulos/gerenciar-viagens/js/script.js` (texto base “CARGA DISPONÍVEL” e chamada ao backend).
- **Documentação:** `DOCUMENTACAO_MENSAGENS_CONVOCACOES.md`, `DOCUMENTACAO_SISTEMA_CONVOCACOES.md`, `GUIA_RAPIDO_ENVIO.md`, `SOLUCAO_LINKS_WHATSAPP.md`.

---

*Atualizado após inclusão do bloco “Exige veículo rastreado” na mensagem de convocação (backend).*
