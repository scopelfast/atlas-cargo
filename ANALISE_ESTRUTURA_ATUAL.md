# 📊 Análise da Estrutura Atual
## O que já existe no projeto

**Data:** 2025-01-15  
**Status:** Análise Completa

---

## ✅ O QUE JÁ EXISTE

### 1. Banco de Dados

#### Tabela: ALERTS
**Arquivo:** `backend/scripts/criar_tabela_alerts.sql`

**Estrutura atual:**
```sql
- ID (INT, PK)
- IDVIAGEM (DECIMAL(15,0), FK)
- CDMOTORISTA (DECIMAL(15,0), FK, NULL)
- TYPE (NVARCHAR(20)) -- 'atraso', 'parada', 'desvio', 'offline'
- MESSAGE (NVARCHAR(255))
- SEVERITY (NVARCHAR(10)) -- 'low', 'medium', 'high'
- DETAILS (NVARCHAR(MAX)) -- JSON
- CREATED_AT (DATETIME2)
- RESOLVED (BIT) -- 0 ou 1
- RESOLVED_AT (DATETIME2, NULL)
- RESOLVED_BY (INT, NULL) -- CDUSUARIO
```

**O que precisa ser adicionado:**
- ❌ STATUS (Pendente, Em Análise, Tratado, Cancelado)
- ❌ ID_USUARIO_LEU
- ❌ DH_LEITURA
- ❌ ID_USUARIO_TRATOU (já existe RESOLVED_BY, mas precisa padronizar)
- ❌ DH_TRATAMENTO (já existe RESOLVED_AT, mas precisa padronizar)
- ❌ OBSERVACOES
- ❌ PRIORIDADE (já existe SEVERITY, mas precisa padronizar)

#### Tabela: MESSAGES
**Arquivo:** `backend/scripts/criar_tabela_messages.sql`

**Estrutura atual:**
```sql
- ID (INT, PK)
- IDVIAGEM (DECIMAL(15,0), FK)
- SENDER_TYPE (NVARCHAR(10)) -- 'driver' ou 'operator'
- SENDER_ID (DECIMAL(15,0))
- SENDER_NAME (NVARCHAR(255), NULL)
- CONTENT (NVARCHAR(MAX))
- READ_BY_SENDER (BIT)
- READ_BY_RECEIVER (BIT)
- CREATED_AT (DATETIME2)
- SYNCED (BIT)
```

**O que precisa ser adicionado:**
- ❌ ID_CONVERSA (para agrupar mensagens)
- ❌ TIPO (TEXTO, IMAGEM, ARQUIVO)
- ✅ READ_BY_RECEIVER já existe
- ✅ CREATED_AT já existe

**Nova tabela necessária:**
- ❌ CONVERSAS (para agrupar mensagens)

#### Tabela: SOS_ALERTS
**Arquivo:** `backend/scripts/criar_tabela_sos_alerts.sql`

**Estrutura atual:**
```sql
- ID (INT, PK)
- CDMOTORISTA (DECIMAL(15,0), FK)
- CDVIAGEM (DECIMAL(15,0), FK, NULL)
- LOCATION (GEOGRAPHY)
- LATITUDE (FLOAT, NULL)
- LONGITUDE (FLOAT, NULL)
- STATUS (NVARCHAR(20)) -- 'active', 'resolved', 'cancelled'
- PRIORITY (NVARCHAR(10)) -- 'low', 'medium', 'high', 'critical'
- MESSAGE (NVARCHAR(500), NULL)
- CREATED_AT (DATETIME2)
- RESOLVED_AT (DATETIME2, NULL)
- RESOLVED_BY (DECIMAL(15,0), NULL)
- RESOLUTION_NOTES (NVARCHAR(500), NULL)
- SYNCED (BIT)
```

**O que precisa ser adicionado:**
- ❌ ID_USUARIO_LEU
- ❌ DH_LEITURA
- ✅ STATUS já existe
- ✅ RESOLVED_BY já existe (mas é DECIMAL, precisa padronizar)
- ✅ RESOLVED_AT já existe
- ✅ RESOLUTION_NOTES já existe (pode usar como OBSERVACOES)

### 2. Controllers Existentes

#### alert.controller.js
**Localização:** `backend/controllers/alert.controller.js`

**Métodos existentes:**
- ✅ `buscarPorViagem` - GET /api/alerts/viagem/:idviagem
- ✅ `verificar` - POST /api/alerts/verificar/:idviagem
- ❌ Falta: listar todos, tratar, marcar como lido, histórico

#### message.controller.js
**Localização:** `backend/controllers/message.controller.js`

**Métodos existentes:**
- ✅ `enviar` - POST /api/messages
- ✅ `buscarPorViagem` - GET /api/messages/viagem/:idviagem
- ✅ `marcarComoLida` - PUT /api/messages/:id/ler
- ❌ Falta: listar conversas, criar conversa, buscar

#### sos.controller.js
**Localização:** `backend/controllers/sos.controller.js`

**Métodos existentes:**
- ✅ `criar` - POST /api/motorista/sos
- ✅ `listar` - GET /api/sos
- ✅ `buscarPorId` - GET /api/sos/:id
- ✅ `resolver` - PUT /api/sos/:id/resolver
- ❌ Falta: marcar como lido, histórico, contador

### 3. Routes Existentes

- ✅ `backend/routes/alert.routes.js`
- ✅ `backend/routes/message.routes.js`
- ✅ `backend/routes/sos.routes.js`

### 4. Frontend - Gerenciar Viagens

**Localização:** `backend/public/modulos/gerenciar-viagens/index.html`

**Abas existentes que precisam ser removidas:**
- ❌ `tab-alertas` (linha 1561)
- ❌ `tab-chat` (linha 1764)
- ❌ `tab-sos` (linha 1827)
- ❌ `tab-ranking` (linha 1847)

**Botões de abas:**
- ❌ Linha 584: `<button class="tab-btn" data-tab="alertas">Alertas</button>`
- ❌ Linha 585: `<button class="tab-btn" data-tab="chat">Chat</button>`
- ❌ Linha 586: `<button class="tab-btn" data-tab="sos">SOS</button>`
- ❌ Linha 587: `<button class="tab-btn" data-tab="ranking">Ranking</button>`

**Abas que devem ser mantidas:**
- ✅ Filtros
- ✅ Grid
- ✅ Dados
- ✅ Histórico
- ✅ Mapa
- ✅ Compatíveis
- ✅ Convocações
- ✅ Veículo
- ✅ Motorista
- ✅ Rastreamento
- ✅ Integração Meta

### 5. WebSocket

**Status:** ⚠️ Não encontrado implementação centralizada

**O que precisa:**
- ❌ Serviço WebSocket centralizado
- ❌ Eventos para notificações em tempo real
- ❌ Gerenciamento de conexões

---

## 📋 RESUMO DO QUE PRECISA SER FEITO

### Banco de Dados

1. **Ajustar tabela ALERTS:**
   - Adicionar campos de tratamento (STATUS, ID_USUARIO_LEU, DH_LEITURA, etc)
   - Criar tabela ALERT_HISTORY

2. **Ajustar tabela MESSAGES:**
   - Adicionar ID_CONVERSA
   - Criar tabela CONVERSAS

3. **Ajustar tabela SOS_ALERTS:**
   - Adicionar campos de leitura (ID_USUARIO_LEU, DH_LEITURA)
   - Criar tabela SOS_HISTORY

4. **Criar tabela RANKING_DATA:**
   - Nova tabela para cache de rankings

### Backend

1. **Expandir alert.controller.js:**
   - Listar todos os alertas (com filtros)
   - Listar apenas pendentes
   - Tratar alerta
   - Marcar como lido
   - Histórico de ações
   - Contador de pendentes

2. **Expandir message.controller.js:**
   - Listar conversas
   - Criar conversa
   - Buscar mensagens/conversas
   - Contador de não lidas

3. **Expandir sos.controller.js:**
   - Marcar como lido
   - Histórico de ações
   - Contador de pendentes

4. **Criar ranking.controller.js:**
   - Listar ranking
   - Top 10
   - Dados para gráficos
   - Exportar

5. **Criar websocket.service.js:**
   - Serviço centralizado de WebSocket
   - Gerenciamento de conexões
   - Broadcast de eventos

### Frontend

1. **Criar módulo alertas/**
   - index.html
   - js/script.js
   - js/websocket.js
   - js/tratamento.js
   - js/notificacao.js
   - css/style.css

2. **Criar módulo chat/**
   - index.html
   - js/script.js
   - js/websocket.js
   - js/conversas.js
   - js/historico.js
   - css/style.css

3. **Criar módulo sos/**
   - index.html
   - js/script.js
   - js/websocket.js
   - js/tratamento.js
   - js/mapa.js
   - js/notificacao.js
   - css/style.css

4. **Criar módulo ranking/**
   - index.html
   - js/script.js
   - js/graficos.js
   - js/filtros.js
   - js/exportar.js
   - css/style.css

5. **Remover abas do Gerenciar Viagens:**
   - Remover botões das abas
   - Remover conteúdo das abas
   - Remover JavaScript relacionado

6. **Atualizar menu principal:**
   - Adicionar novos itens
   - Adicionar badges com contadores

---

## 🎯 PRÓXIMOS PASSOS SUGERIDOS

### Ordem de Implementação:

1. **Fase 1: Banco de Dados** (1 dia)
   - Criar scripts SQL para ajustar tabelas
   - Criar tabelas novas (HISTORY, CONVERSAS, RANKING_DATA)
   - Testar scripts

2. **Fase 2: Backend - APIs** (2-3 dias)
   - Expandir controllers existentes
   - Criar ranking.controller.js
   - Criar websocket.service.js
   - Testar endpoints

3. **Fase 3: Frontend - Módulos** (5-7 dias)
   - Criar módulo alertas (2 dias)
   - Criar módulo sos (1-2 dias - reutiliza estrutura)
   - Criar módulo chat (2 dias)
   - Criar módulo ranking (1-2 dias)

4. **Fase 4: Integração** (1 dia)
   - Remover abas do Gerenciar Viagens
   - Atualizar menu
   - Adicionar badges

5. **Fase 5: Notificações** (1 dia)
   - Implementar sistema de notificações
   - Integrar com WebSocket

6. **Fase 6: Testes** (2 dias)
   - Testes funcionais
   - Ajustes finais

---

## ⚠️ OBSERVAÇÕES IMPORTANTES

1. **Padronização de campos:**
   - ALERTS usa `RESOLVED_BY` (INT)
   - SOS_ALERTS usa `RESOLVED_BY` (DECIMAL)
   - Precisamos padronizar (sugestão: usar INT/CDUSUARIO)

2. **Campos similares:**
   - ALERTS: `SEVERITY` vs novo `PRIORIDADE`
   - SOS_ALERTS: `PRIORITY` já existe
   - Precisamos decidir qual usar ou manter ambos

3. **Status:**
   - SOS_ALERTS já tem `STATUS` ('active', 'resolved', 'cancelled')
   - ALERTS tem `RESOLVED` (BIT)
   - Precisamos padronizar

4. **WebSocket:**
   - Não há implementação centralizada
   - Precisamos criar do zero ou verificar se há algo no código que não encontramos

---

## ✅ CONCLUSÃO

**Boa notícia:** A base já existe! Temos:
- ✅ Tabelas criadas
- ✅ Controllers básicos
- ✅ Routes configuradas
- ✅ Frontend com abas funcionais

**O que falta:**
- ⚠️ Ajustar/expandir tabelas
- ⚠️ Expandir controllers
- ⚠️ Criar módulos frontend separados
- ⚠️ Implementar WebSocket
- ⚠️ Sistema de notificações

**Estimativa total:** 14-18 dias úteis

---

**Próximo passo:** Começar pela Fase 1 (Banco de Dados)?
