# Alertas – Preparação para integração e próximos passos

Este documento registra o que já existe no módulo Alertas, onde futuras implementações (Switch Digital, templates, regras configuráveis) devem se encaixar, e como evitar refazer trabalho.

**Visão geral:** Ver também `docs/PLANO_INTEGRACAO_SWITCH_DIGITAL_E_REGRAS.md`.

---

## 1. O que o GUIA_TESTES_ALERTAS.md cobre

- **Testes funcionais:** lista, filtros, marcar lido, tratar, histórico, paginação, WebSocket, badge, estatísticas, responsividade.
- **Pré-requisitos:** banco (ALERTS, ALERT_HISTORY), servidor, viagens ativas.
- **Cenários:** 10 testes descritos + checklist + troubleshooting.
- **Geração:** alert-service.js (job periódico); tipos: atraso, parada prolongada, offline, desvio de rota, ETA preventivo.

Usar o guia para validar que o módulo continua estável antes e depois de novas implementações.

---

## 2. Pontos de integração no módulo Alertas

Para **não atropelar** e não refazer tudo quando integrarmos Switch Digital (e outras regras), convém concentrar as “ações externas” em poucos pontos.

### 2.1 Quando um alerta é criado (novo no banco)

| Onde | Arquivo | Função | O que fazer no futuro |
|------|---------|--------|------------------------|
| Salvamento | `backend/services/alert-service.js` | `salvarAlerta` | Após `INSERT` em ALERTS com sucesso (`return true`), chamar um **hook/callback** único: “alerta criado” com dados do alerta (idviagem, type, cdmotorista, message, severity, details). Esse hook verifica em Configurações se está habilitado envio por Switch Digital para esse tipo e, se sim, envia a mensagem (usando template configurável). |

**Dados disponíveis no objeto `alerta` ao salvar:**

- `idviagem`, `cdmotorista`, `type` (parada, atraso, offline, desvio, eta_prazo), `message`, `severity`, `details` (JSON com dados extras, ex. minutos parado, ETA).
- Com `idviagem` e `cdmotorista` dá para buscar nome do motorista, celular, rota, etc., para preencher variáveis de template (`{nome_motorista}`, `{id_viagem}`, `{tipo_alerta}`, etc.).

**Importante:** Não colocar lógica de WhatsApp direto dentro de `salvarAlerta`. Criar um módulo/camada “notificações alertas” que:

1. É chamado após salvar (ou recebe evento “alerta criado”).
2. Lê Configurações (Switch Digital habilitada? template para este tipo?).
3. Se sim, monta a mensagem (templates com variáveis) e chama a integração Switch Digital.

Assim, quando existir cadastro de várias mensagens e variáveis em Configurações, só essa camada precisa conhecer isso; o alert-service continua focado em “gerar e salvar alerta”.

### 2.2 Quando um alerta é tratado (status/observações)

| Onde | Arquivo | Endpoint / função | O que fazer no futuro |
|------|---------|-------------------|------------------------|
| Tratar | `backend/controllers/alert.controller.js` | POST/tratar (tratarAlerta ou equivalente) | Opcional: hook “alerta tratado” (ex. notificar motorista ou operador por WhatsApp que o alerta foi resolvido). Também só acionar se Configurações permitir e houver template para “alerta tratado”. |

Hoje o fluxo já atualiza status, grava histórico e emite WebSocket. A integração WhatsApp deve ser **adicional** e configurável, sem alterar o fluxo atual de tratamento.

### 2.3 Onde as configurações de alertas já estão planejadas

- **Arquivo:** `backend/public/modulos/alertas/PLANO_CONFIGURACAO_ALERTAS_SISTEMA.md`.
- **Conteúdo:** Parâmetros em CONFIGURACAO (alert_offline_minutos, alert_parada_*, alert_desvio_*, alert_atraso_*, alert_job_*, alert_tipo_*_ativo, alert_situacoes_viagem), API GET/PUT `/api/configuracoes/alertas`, e card “Alertas de viagem” em Configurações do Sistema.
- **Relação com integração:** Quando existir “envio por Switch Digital ao criar alerta”, as chaves `alert_tipo_*_ativo` continuam definindo **se** o alerta é gerado; a parte “enviar ou não WhatsApp” e “qual template” virá de outra configuração (ex. Integração Switch Digital + cadastro de mensagens por tipo de evento).

---

## 3. Tipos de alerta e variáveis úteis para templates

Para futuros templates com `{variavel}` em Configurações:

| TYPE (banco) | Descrição | Variáveis úteis (além das comuns) |
|--------------|-----------|-----------------------------------|
| PARADA | Parada prolongada | `{minutos_parado}`, `{velocidade_media}` (se estiver em details) |
| ATRASO | Atraso no ETA | `{minutos_atraso}`, `{prazo_entrega}`, `{eta_minutos}` |
| OFFLINE | Motorista offline | `{minutos_sem_posicao}` |
| DESVIO | Desvio de rota | `{distancia_metros}` (se estiver em details) |
| ETA_PRAZO | ETA além do prazo (preventivo) | Idem atraso |

Variáveis comuns para todos: `{id_viagem}`, `{tipo_alerta}`, `{nome_motorista}`, `{celular_motorista}`, `{mensagem_alerta}`, `{prioridade}`, `{rota}` (se for fácil obter da viagem).

---

## 4. Checklist antes de implementar integração Switch Digital em Alertas

- [ ] **Configurações de alertas** (PLANO_CONFIGURACAO_ALERTAS_SISTEMA) implementadas (GET/PUT alertas, card em Configurações), para não conflitar depois.
- [ ] **Um único ponto** “após salvar alerta” (hook ou chamada explícita a um serviço de notificações de alertas) em `alert-service.js`, sem espalhar lógica de WhatsApp no service.
- [ ] **Decisão de envio** (enviar ou não, e qual template) baseada em Configurações do Sistema (ex. Switch Digital habilitada + regra “enviar ao criar alerta” + template por tipo).
- [ ] **Mensagem clara** quando Switch Digital não estiver configurada (não tentar enviar; não quebrar geração de alertas).
- [ ] **GUIA_TESTES_ALERTAS.md** rodado após as mudanças, para garantir que listagem, filtros, tratar, histórico e WebSocket seguem funcionando.

---

## 5. Resumo

- **Guia de testes:** `GUIA_TESTES_ALERTAS.md` – usar sempre que mexer no módulo.
- **Plano geral de integração e regras:** `docs/PLANO_INTEGRACAO_SWITCH_DIGITAL_E_REGRAS.md`.
- **Configurações de alertas (tempos, tipos ativos, etc.):** `PLANO_CONFIGURACAO_ALERTAS_SISTEMA.md`.
- **Pontos de integração:** (1) após `salvarAlerta` em `alert-service.js` → hook “alerta criado”; (2) opcional: após tratar alerta no controller. Toda lógica de “enviar WhatsApp” e templates deve ficar em uma camada que lê Configurações, para não refazer o módulo quando forem várias mensagens e regras por cliente/tenant.

Documento criado para não perdermos o alinhamento e para que as implementações futuras (Alertas + Switch Digital e regras configuráveis) não exijam refazer o que já está pronto.
