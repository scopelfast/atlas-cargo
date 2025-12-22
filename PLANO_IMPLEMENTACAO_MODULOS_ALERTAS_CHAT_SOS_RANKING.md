# 📋 Plano de Implementação - Módulos Separados
## Alertas | Chat | SOS | Ranking

---

## 🎯 Objetivo

Criar módulos independentes e profissionais para:
- **Alertas**: Painel de tratamento com notificações em tempo real
- **Chat**: Sistema de comunicação estilo WhatsApp com histórico
- **SOS**: Painel de tratamento de emergências com mapa
- **Ranking**: Dashboard com gráficos e métricas de motoristas

**IMPORTANTE**: Não alterar o módulo "Gerenciar Viagens" existente, apenas remover as abas internas.

---

## 📁 Fase 1: Análise e Preparação

### 1.1 Mapeamento do que já existe

**Verificar no banco de dados:**
- ✅ Tabela `ALERTS` (estrutura atual)
- ✅ Tabela `MESSAGES` (estrutura atual)
- ✅ Tabela `SOS_ALERTS` (estrutura atual)
- ✅ Tabela `DRIVER_REPUTATION` (estrutura atual)

**Verificar no código:**
- ✅ Controllers existentes (`alert.controller.js`, `message.controller.js`, `sos.controller.js`)
- ✅ Routes existentes
- ✅ Estrutura de WebSocket atual
- ✅ Integração com Meta (se aplicável)

### 1.2 Estrutura de Pastas Proposta

```
backend/
├── controllers/
│   ├── alert.controller.js      (verificar se existe)
│   ├── message.controller.js    (verificar se existe)
│   ├── sos.controller.js        (verificar se existe)
│   └── ranking.controller.js    (NOVO)
├── routes/
│   ├── alert.routes.js
│   ├── message.routes.js
│   ├── sos.routes.js
│   └── ranking.routes.js
├── services/
│   ├── websocket.service.js      (centralizar WebSocket)
│   └── notification.service.js   (NOVO - notificações)
└── public/
    └── modulos/
        ├── gerenciar-viagens/    (manter - remover abas)
        ├── alertas/              (NOVO)
        ├── chat/                 (NOVO)
        ├── sos/                  (NOVO)
        └── ranking/              (NOVO)
```

---

## 🗄️ Fase 2: Banco de Dados

### 2.1 Tabela: ALERTS (Ajustar se necessário)

**Campos a verificar/adicionar:**
```sql
-- Verificar estrutura atual e ajustar se necessário
ALTER TABLE ALERTS ADD COLUMN:
- STATUS VARCHAR(50) DEFAULT 'Pendente' 
  -- Valores: 'Pendente', 'Em Análise', 'Tratado', 'Cancelado'
- ID_USUARIO_LEU INT NULL
- DH_LEITURA DATETIME NULL
- ID_USUARIO_TRATOU INT NULL
- DH_TRATAMENTO DATETIME NULL
- OBSERVACOES TEXT NULL
- PRIORIDADE VARCHAR(20) DEFAULT 'Normal'
  -- Valores: 'Baixa', 'Normal', 'Alta', 'Urgente'
```

### 2.2 Tabela: ALERT_HISTORY (NOVO - Log de Ações)

```sql
CREATE TABLE ALERT_HISTORY (
    ID INT PRIMARY KEY IDENTITY(1,1),
    ID_ALERT INT NOT NULL,
    ID_USUARIO INT NOT NULL,
    ACAO VARCHAR(50) NOT NULL, -- 'LEU', 'TRATOU', 'CANCELOU', 'ATUALIZOU'
    STATUS_ANTERIOR VARCHAR(50) NULL,
    STATUS_NOVO VARCHAR(50) NULL,
    OBSERVACOES TEXT NULL,
    DH_ACAO DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (ID_ALERT) REFERENCES ALERTS(ID),
    FOREIGN KEY (ID_USUARIO) REFERENCES USUARIO(CDCADASTRO)
);

CREATE INDEX IX_ALERT_HISTORY_ID_ALERT ON ALERT_HISTORY(ID_ALERT);
CREATE INDEX IX_ALERT_HISTORY_DH_ACAO ON ALERT_HISTORY(DH_ACAO);
```

### 2.3 Tabela: MESSAGES (Verificar e Ajustar)

**Campos a verificar:**
```sql
-- Verificar estrutura atual
-- Garantir campos:
- ID_CONVERSA INT (agrupar mensagens)
- ID_REMETENTE INT NOT NULL
- ID_DESTINATARIO INT NOT NULL
- MENSAGEM TEXT NOT NULL
- LIDA BIT DEFAULT 0
- DH_ENVIO DATETIME DEFAULT GETDATE()
- DH_LEITURA DATETIME NULL
- TIPO VARCHAR(20) -- 'TEXTO', 'IMAGEM', 'ARQUIVO'
```

### 2.4 Tabela: CONVERSAS (NOVO - Agrupar Mensagens)

```sql
CREATE TABLE CONVERSAS (
    ID INT PRIMARY KEY IDENTITY(1,1),
    TIPO VARCHAR(20) NOT NULL, -- 'MOTORISTA', 'VIAGEM', 'GRUPO'
    ID_MOTORISTA INT NULL,
    ID_VIAGEM INT NULL,
    ID_CRIADOR INT NOT NULL,
    ULTIMA_MENSAGEM TEXT NULL,
    DH_ULTIMA_MENSAGEM DATETIME NULL,
    MENSAGENS_NAO_LIDAS INT DEFAULT 0,
    DH_CRIACAO DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (ID_MOTORISTA) REFERENCES CADASTROGERAL(CDCADASTRO),
    FOREIGN KEY (ID_VIAGEM) REFERENCES VIAGEM(IDVIAGEM),
    FOREIGN KEY (ID_CRIADOR) REFERENCES USUARIO(CDCADASTRO)
);

CREATE INDEX IX_CONVERSAS_TIPO ON CONVERSAS(TIPO);
CREATE INDEX IX_CONVERSAS_DH_ULTIMA_MENSAGEM ON CONVERSAS(DH_ULTIMA_MENSAGEM DESC);
```

### 2.5 Tabela: SOS_ALERTS (Verificar e Ajustar)

**Similar ao ALERTS:**
```sql
-- Adicionar campos de tratamento se não existirem
ALTER TABLE SOS_ALERTS ADD COLUMN:
- STATUS VARCHAR(50) DEFAULT 'Pendente'
- ID_USUARIO_LEU INT NULL
- DH_LEITURA DATETIME NULL
- ID_USUARIO_TRATOU INT NULL
- DH_TRATAMENTO DATETIME NULL
- OBSERVACOES TEXT NULL
- TEMPO_RESPOSTA INT NULL -- em minutos
```

### 2.6 Tabela: SOS_HISTORY (NOVO - Log de Ações)

```sql
CREATE TABLE SOS_HISTORY (
    ID INT PRIMARY KEY IDENTITY(1,1),
    ID_SOS INT NOT NULL,
    ID_USUARIO INT NOT NULL,
    ACAO VARCHAR(50) NOT NULL,
    STATUS_ANTERIOR VARCHAR(50) NULL,
    STATUS_NOVO VARCHAR(50) NULL,
    OBSERVACOES TEXT NULL,
    DH_ACAO DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (ID_SOS) REFERENCES SOS_ALERTS(ID),
    FOREIGN KEY (ID_USUARIO) REFERENCES USUARIO(CDCADASTRO)
);

CREATE INDEX IX_SOS_HISTORY_ID_SOS ON SOS_HISTORY(ID_SOS);
```

### 2.7 Tabela: RANKING_DATA (NOVO - Cache de Rankings)

```sql
CREATE TABLE RANKING_DATA (
    ID INT PRIMARY KEY IDENTITY(1,1),
    ID_MOTORISTA INT NOT NULL,
    PONTUACAO_GERAL DECIMAL(10,2) DEFAULT 0,
    ENTREGAS_NO_PRAZO INT DEFAULT 0,
    ENTREGAS_TOTAL INT DEFAULT 0,
    AVALIACOES_MEDIA DECIMAL(3,2) DEFAULT 0,
    TEMPO_MEDIO_RESPOSTA INT DEFAULT 0, -- em minutos
    TAXA_ACEITACAO DECIMAL(5,2) DEFAULT 0, -- porcentagem
    PERIODO_INICIO DATE NOT NULL,
    PERIODO_FIM DATE NOT NULL,
    DH_CALCULO DATETIME DEFAULT GETDATE(),
    FOREIGN KEY (ID_MOTORISTA) REFERENCES CADASTROGERAL(CDCADASTRO)
);

CREATE INDEX IX_RANKING_DATA_ID_MOTORISTA ON RANKING_DATA(ID_MOTORISTA);
CREATE INDEX IX_RANKING_DATA_PERIODO ON RANKING_DATA(PERIODO_INICIO, PERIODO_FIM);
```

---

## 🔌 Fase 3: Backend - APIs

### 3.1 API: Alertas

```
GET    /api/alertas                    - Listar alertas (com filtros)
GET    /api/alertas/pendentes          - Apenas pendentes
GET    /api/alertas/:id                - Detalhes de um alerta
GET    /api/alertas/:id/historico      - Histórico de ações
POST   /api/alertas/:id/ler            - Marcar como lido
POST   /api/alertas/:id/tratar         - Tratar alerta (mudar status)
PUT    /api/alertas/:id                - Atualizar alerta
DELETE /api/alertas/:id                - Cancelar alerta
GET    /api/alertas/contador           - Contador de pendentes (para badge)
```

**Exemplo de Request/Response:**

```javascript
// GET /api/alertas?status=Pendente&tipo=Entrega&dataInicio=2024-01-01
{
  "success": true,
  "data": [
    {
      "id": 1,
      "tipo": "Entrega",
      "prioridade": "Alta",
      "status": "Pendente",
      "mensagem": "Entrega atrasada",
      "idViagem": 123,
      "idMotorista": 456,
      "dhCriacao": "2024-01-15T10:30:00",
      "idUsuarioLeu": null,
      "dhLeitura": null,
      "idUsuarioTratou": null,
      "dhTratamento": null
    }
  ],
  "total": 1,
  "pendentes": 5
}

// POST /api/alertas/1/tratar
{
  "status": "Tratado",
  "observacoes": "Problema resolvido"
}
```

### 3.2 API: Chat

```
GET    /api/chat/conversas              - Lista de conversas
GET    /api/chat/conversas/:id          - Mensagens de uma conversa
POST   /api/chat/conversas              - Criar nova conversa
POST   /api/chat/mensagens              - Enviar mensagem
GET    /api/chat/mensagens/:id/ler      - Marcar como lida
GET    /api/chat/nao-lidas              - Contador de não lidas
GET    /api/chat/buscar                 - Buscar em conversas/mensagens
PUT    /api/chat/conversas/:id          - Atualizar conversa
```

**Exemplo de Request/Response:**

```javascript
// GET /api/chat/conversas
{
  "success": true,
  "data": [
    {
      "id": 1,
      "tipo": "MOTORISTA",
      "idMotorista": 456,
      "nomeMotorista": "João Silva",
      "ultimaMensagem": "Obrigado!",
      "dhUltimaMensagem": "2024-01-15T14:30:00",
      "mensagensNaoLidas": 2
    }
  ]
}

// POST /api/chat/mensagens
{
  "idConversa": 1,
  "mensagem": "Olá, tudo bem?",
  "tipo": "TEXTO"
}
```

### 3.3 API: SOS

```
GET    /api/sos                         - Listar SOS (com filtros)
GET    /api/sos/pendentes               - Apenas pendentes
GET    /api/sos/:id                     - Detalhes de um SOS
GET    /api/sos/:id/historico           - Histórico de ações
POST   /api/sos/:id/ler                 - Marcar como lido
POST   /api/sos/:id/tratar              - Tratar SOS (mudar status)
PUT    /api/sos/:id                     - Atualizar SOS
GET    /api/sos/contador                - Contador de pendentes (para badge)
```

**Exemplo de Request/Response:**

```javascript
// GET /api/sos/pendentes
{
  "success": true,
  "data": [
    {
      "id": 1,
      "idViagem": 123,
      "idMotorista": 456,
      "nomeMotorista": "João Silva",
      "status": "Pendente",
      "latitude": -23.5505,
      "longitude": -46.6333,
      "dhCriacao": "2024-01-15T10:30:00",
      "tempoResposta": null
    }
  ],
  "total": 1
}
```

### 3.4 API: Ranking

```
GET    /api/ranking                     - Lista completa (com filtros)
GET    /api/ranking/top10               - Top 10 motoristas
GET    /api/ranking/graficos            - Dados para gráficos
GET    /api/ranking/exportar            - Exportar (PDF/Excel)
POST   /api/ranking/calcular            - Recalcular rankings (admin)
GET    /api/ranking/motorista/:id      - Detalhes de um motorista
```

**Exemplo de Request/Response:**

```javascript
// GET /api/ranking?periodoInicio=2024-01-01&periodoFim=2024-01-31
{
  "success": true,
  "data": [
    {
      "idMotorista": 456,
      "nomeMotorista": "João Silva",
      "pontuacaoGeral": 95.5,
      "entregasNoPrazo": 48,
      "entregasTotal": 50,
      "avaliacoesMedia": 4.8,
      "tempoMedioResposta": 15,
      "taxaAceitacao": 98.5,
      "posicao": 1
    }
  ],
  "total": 100
}

// GET /api/ranking/graficos?periodoInicio=2024-01-01&periodoFim=2024-01-31
{
  "success": true,
  "top10": [...],
  "evolucaoMensal": [...],
  "distribuicaoPontuacao": [...]
}
```

---

## 🔔 Fase 4: WebSocket - Notificações em Tempo Real

### 4.1 Eventos WebSocket

```javascript
// Alertas
'alert:novo'              - Novo alerta criado
'alert:atualizado'         - Alerta foi atualizado
'alert:tratado'            - Alerta foi tratado
'alert:lido'               - Alerta foi lido

// Chat
'chat:mensagem'            - Nova mensagem recebida
'chat:lida'                - Mensagem foi lida
'chat:conversa'            - Nova conversa iniciada

// SOS
'sos:novo'                 - Novo SOS criado
'sos:atualizado'           - SOS foi atualizado
'sos:tratado'              - SOS foi tratado
'sos:lido'                 - SOS foi lido
```

### 4.2 Serviço WebSocket Centralizado

```javascript
// backend/services/websocket.service.js
- Gerenciar conexões por usuário
- Broadcast de eventos para todos
- Enviar notificações para usuários específicos
- Gerenciar reconexão automática
```

**Estrutura:**
```javascript
class WebSocketService {
  constructor() {
    this.clients = new Map(); // userId -> ws connection
  }
  
  addClient(userId, ws) { }
  removeClient(userId) { }
  broadcast(event, data) { }
  sendToUser(userId, event, data) { }
}
```

---

## 🎨 Fase 5: Frontend - Módulos

### 5.1 Módulo: Alertas

**Estrutura:**
```
alertas/
├── index.html
├── js/
│   ├── script.js              - Lógica principal
│   ├── websocket.js           - Conexão WebSocket
│   ├── tratamento.js          - Tratamento de alertas
│   └── notificacao.js         - Pop-up de notificação
└── css/
    └── style.css
```

**Funcionalidades:**
- ✅ Lista de alertas pendentes (cards)
- ✅ Filtros (status, tipo, data, prioridade)
- ✅ Modal de tratamento
- ✅ Histórico de ações
- ✅ Pop-up de notificação
- ✅ Badge no menu com contador
- ✅ Atualização em tempo real via WebSocket

**Layout:**
```
┌─────────────────────────────────────────┐
│  Alertas                    [Filtros ▼] │
├─────────────────────────────────────────┤
│  ┌───────────────────────────────────┐ │
│  │ 🔴 ALTA | Entrega Atrasada        │ │
│  │ Viagem #123 | Motorista: João     │ │
│  │ [Tratar] [Ver Detalhes]           │ │
│  └───────────────────────────────────┘ │
│  ┌───────────────────────────────────┐ │
│  │ 🟡 NORMAL | Documento Pendente    │ │
│  │ Viagem #124 | Motorista: Maria     │ │
│  │ [Tratar] [Ver Detalhes]           │ │
│  └───────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 5.2 Módulo: Chat

**Estrutura:**
```
chat/
├── index.html
├── js/
│   ├── script.js              - Lógica principal
│   ├── websocket.js           - Mensagens em tempo real
│   ├── conversas.js           - Gerenciar conversas
│   └── historico.js           - Busca e filtros
└── css/
    └── style.css
```

**Funcionalidades:**
- ✅ Layout estilo WhatsApp
- ✅ Lista de conversas (esquerda)
- ✅ Área de mensagens (direita)
- ✅ Input de mensagem
- ✅ Indicadores de leitura
- ✅ Busca de conversas/mensagens
- ✅ Badge no menu com não lidas
- ✅ Mensagens em tempo real

**Layout:**
```
┌──────────────┬──────────────────────────┐
│ Conversas    │ Mensagens                 │
├──────────────┼──────────────────────────┤
│ 🔍 Buscar    │ João Silva                │
│              ├──────────────────────────┤
│ João Silva   │ [Você] Olá!               │
│ (2)          │ 10:30                     │
│              │                           │
│ Maria Santos │ [João] Tudo bem!          │
│              │ 10:31 ✓✓                  │
│ Pedro Costa  │                           │
│              │ [Você] Como está?         │
│              │ 10:32                     │
│              ├──────────────────────────┤
│              │ [Digite uma mensagem...] │
│              │                    [Enviar]│
└──────────────┴──────────────────────────┘
```

### 5.3 Módulo: SOS

**Estrutura:**
```
sos/
├── index.html
├── js/
│   ├── script.js              - Lógica principal
│   ├── websocket.js           - Conexão WebSocket
│   ├── tratamento.js          - Tratamento de SOS
│   ├── mapa.js                - Visualização no mapa
│   └── notificacao.js         - Pop-up urgente
└── css/
    └── style.css
```

**Funcionalidades:**
- ✅ Lista de SOS pendentes (cards)
- ✅ Filtros (status, data, motorista, viagem)
- ✅ Modal de tratamento
- ✅ Mapa com localização
- ✅ Histórico de ações
- ✅ Pop-up urgente (vermelho)
- ✅ Badge no menu com contador
- ✅ Atualização em tempo real

**Layout:**
```
┌─────────────────────────────────────────┐
│  SOS                        [Filtros ▼] │
├─────────────────────────────────────────┤
│  ┌───────────────────────────────────┐ │
│  │ 🚨 URGENTE | Emergência           │ │
│  │ Viagem #123 | Motorista: João     │ │
│  │ 📍 Localização: Rua X, 123        │ │
│  │ [Ver no Mapa] [Tratar]            │ │
│  └───────────────────────────────────┘ │
│                                         │
│  ┌─────────── Mapa ───────────────┐   │
│  │                                │   │
│  │         [📍 SOS]              │   │
│  │                                │   │
│  └────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

### 5.4 Módulo: Ranking

**Estrutura:**
```
ranking/
├── index.html
├── js/
│   ├── script.js              - Lógica principal
│   ├── graficos.js            - Gráficos (Chart.js)
│   ├── filtros.js             - Filtros avançados
│   └── exportar.js            - Exportação
└── css/
    └── style.css
```

**Funcionalidades:**
- ✅ Dashboard com gráficos
- ✅ Tabela de ranking
- ✅ Filtros (período, tipo, status)
- ✅ Gráficos (top 10, evolução, distribuição)
- ✅ Exportação (PDF/Excel)
- ✅ Detalhes do motorista

**Layout:**
```
┌─────────────────────────────────────────┐
│  Ranking                    [Filtros ▼] │
├─────────────────────────────────────────┤
│  ┌─────────── Gráficos ─────────────┐ │
│  │  [Top 10] [Evolução] [Distribuição]│ │
│  └───────────────────────────────────┘ │
│                                         │
│  ┌─────────── Tabela ────────────────┐ │
│  │ # | Motorista | Pontuação | ...  │ │
│  │ 1 | João      | 95.5      | ...  │ │
│  │ 2 | Maria     | 94.2      | ...  │ │
│  └───────────────────────────────────┘ │
│                    [Exportar PDF/Excel] │
└─────────────────────────────────────────┘
```

---

## 🔗 Fase 6: Integração com Menu

### 6.1 Atualizar Menu Principal

**Adicionar novos itens:**
```javascript
{
  nome: "Alertas",
  url: "/modulos/alertas/index.html",
  badge: true, // mostrar contador
  icon: "bx-bell"
},
{
  nome: "Chat",
  url: "/modulos/chat/index.html",
  badge: true, // mostrar não lidas
  icon: "bx-message"
},
{
  nome: "SOS",
  url: "/modulos/sos/index.html",
  badge: true, // mostrar pendentes
  icon: "bx-error-circle",
  urgent: true // badge vermelho
},
{
  nome: "Ranking",
  url: "/modulos/ranking/index.html",
  badge: false,
  icon: "bx-trophy"
}
```

### 6.2 Remover Abas do Gerenciar Viagens

**Manter abas:**
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

**Remover abas:**
- ❌ Alertas (mover para módulo separado)
- ❌ Chat (mover para módulo separado)
- ❌ SOS (mover para módulo separado)
- ❌ Ranking (mover para módulo separado)

---

## 🔔 Fase 7: Notificações

### 7.1 Sistema de Notificações

**Funcionalidades:**
- ✅ Pop-up (toast) no canto superior direito
- ✅ Som opcional (configurável)
- ✅ Badge no menu com contador
- ✅ Diferenciação visual (normal vs urgente)
- ✅ Auto-fechar após X segundos
- ✅ Histórico de notificações (opcional)

**Tipos:**
- 🟢 **Info**: Azul (informações gerais)
- 🟡 **Warning**: Amarelo (avisos)
- 🔴 **Urgent**: Vermelho (SOS, alertas críticos)
- 🔵 **Success**: Verde (ações concluídas)

### 7.2 Biblioteca Sugerida

**Opção 1: SweetAlert2**
- Pop-ups elegantes
- Customizável
- Suporte a ícones

**Opção 2: toastr.js**
- Notificações simples
- Leve
- Fácil de usar

**Opção 3: Custom (recomendado)**
- Controle total
- Integrado com o design
- Sem dependências extras

---

## ✅ Fase 8: Testes e Validação

### 8.1 Checklist de Testes

**Funcionalidades:**
- [ ] Alertas: Listar, filtrar, tratar, histórico
- [ ] Chat: Enviar, receber, buscar, histórico
- [ ] SOS: Listar, tratar, mapa, histórico
- [ ] Ranking: Listar, filtrar, gráficos, exportar

**Integração:**
- [ ] WebSocket funcionando em todos os módulos
- [ ] Notificações aparecendo corretamente
- [ ] Badges no menu atualizando
- [ ] Gerenciar Viagens continua funcionando

**Performance:**
- [ ] Carregamento rápido
- [ ] Sem erros no console
- [ ] WebSocket reconecta automaticamente
- [ ] Notificações não travam a interface

**Compatibilidade:**
- [ ] Chrome/Edge
- [ ] Firefox
- [ ] Safari (se aplicável)
- [ ] Mobile (responsivo)

### 8.2 Validação Final

**Antes de considerar completo:**
1. ✅ Todos os módulos funcionando
2. ✅ WebSocket estável
3. ✅ Notificações funcionando
4. ✅ Gerenciar Viagens intacto
5. ✅ Sem erros no console
6. ✅ Performance adequada
7. ✅ Design consistente
8. ✅ Responsivo (se necessário)

---

## 📊 Status de Implementação

**Última atualização:** 2025-01-18

### ✅ Concluído

#### Fase 2: Banco de Dados ✅
- ✅ Scripts SQL criados e executados
  - `ajustar_tabela_alerts_para_modulo.sql` - Executado
  - `ajustar_tabela_messages_para_modulo.sql` - Executado
  - `ajustar_tabela_sos_alerts_para_modulo.sql` - Executado
  - `criar_tabela_ranking_data.sql` - Executado
- ✅ Tabelas criadas/ajustadas:
  - `ALERTS` - Campos adicionados (STATUS, PRIORIDADE, ID_USUARIO_LEU, DH_LEITURA, etc.)
  - `ALERT_HISTORY` - Criada
  - `MESSAGES` - Campos adicionados (ID_CONVERSA, TIPO, DH_LEITURA)
  - `CONVERSAS` - Criada
  - `SOS_ALERTS` - Campos adicionados (ID_USUARIO_LEU, DH_LEITURA, TEMPO_RESPOSTA)
  - `SOS_HISTORY` - Criada
  - `RANKING_DATA` - Criada

#### Fase 3: Backend APIs ✅
- ✅ **Controller de Alertas** (`alert.controller.js`)
  - ✅ `listar()` - Listar com filtros
  - ✅ `listarPendentes()` - Apenas pendentes
  - ✅ `buscarPorId()` - Detalhes
  - ✅ `buscarHistorico()` - Histórico de ações
  - ✅ `marcarComoLido()` - Marcar como lido
  - ✅ `tratar()` - Tratar alerta
  - ✅ `atualizar()` - Atualizar alerta
  - ✅ `cancelar()` - Cancelar alerta
  - ✅ `contador()` - Contador para badge
- ✅ **Controller de Chat** (`message.controller.js`)
  - ✅ `listarConversas()` - Listar conversas
  - ✅ `buscarMensagensConversa()` - Mensagens de uma conversa
  - ✅ `criarConversa()` - Criar nova conversa
  - ✅ `atualizarConversa()` - Atualizar conversa
  - ✅ `buscar()` - Buscar conversas/mensagens
  - ✅ `contadorNaoLidas()` - Contador de não lidas
  - ✅ `enviar()` - Atualizado para usar conversas
- ✅ **Controller de SOS** (`sos.controller.js`)
  - ✅ `listar()` - Listar com filtros
  - ✅ `listarPendentes()` - Apenas pendentes
  - ✅ `buscarPorId()` - Detalhes
  - ✅ `buscarHistorico()` - Histórico de ações
  - ✅ `marcarComoLido()` - Marcar como lido
  - ✅ `tratar()` - Tratar SOS
  - ✅ `atualizar()` - Atualizar SOS
  - ✅ `contador()` - Contador para badge
- ✅ **Controller de Ranking** (`reputation.controller.js`)
  - ✅ `listar()` - Listar completo
  - ✅ `top10()` - Top 10 motoristas
  - ✅ `graficos()` - Dados para gráficos
  - ✅ `detalhesMotorista()` - Detalhes do motorista
  - ✅ `calcular()` - Calcular rankings
- ✅ **Rotas criadas/atualizadas:**
  - ✅ `alert.routes.js` - Novas rotas + legadas
  - ✅ `message.routes.js` - Novas rotas + legadas
  - ✅ `sos.routes.js` - Novas rotas + legadas
  - ✅ `reputation.routes.js` - Novas rotas + legadas
- ✅ **Registro no app.js:**
  - ✅ `/api/alertas` → `alertRoutes`
  - ✅ `/api/chat` → `messageRoutes`
  - ✅ `/api/sos` → `sosRoutes`
  - ✅ `/api/ranking` → `reputationRoutes`

### 🚧 Em Andamento

- Nenhum no momento

### ⏳ Pendente

#### Fase 4: WebSocket - Notificações em Tempo Real
- ⏳ Centralizar serviço WebSocket
- ⏳ Implementar eventos específicos dos módulos
- ⏳ Testar conexões

#### Fase 5: Frontend - Módulos
- ✅ **Estrutura básica criada** (para evitar erro de login)
  - ✅ `alertas/index.html` - HTML básico com mensagem "Em desenvolvimento"
  - ✅ `alertas/js/script.js` - Script básico
  - ✅ `chat/index.html` - HTML básico com mensagem "Em desenvolvimento"
  - ✅ `chat/js/script.js` - Script básico
  - ✅ `sos/index.html` - HTML básico com mensagem "Em desenvolvimento"
  - ✅ `sos/js/script.js` - Script básico
  - ✅ `ranking/index.html` - HTML básico com mensagem "Em desenvolvimento"
  - ✅ `ranking/js/script.js` - Script básico
- ✅ **Módulo Alertas** - Funcionalidades completas
  - ✅ `index.html` - Interface completa com filtros, cards, modais
  - ✅ `js/script.js` - JavaScript completo com todas as funcionalidades
  - ✅ Integração WebSocket para atualizações em tempo real
  - ✅ Sistema de badges no menu
  - ✅ Estatísticas em tempo real
  - ✅ Paginação
  - ✅ Tratamento de alertas
  - ✅ Histórico de ações
- ⏳ **Módulo Chat** - Funcionalidades completas
  - ⏳ Interface estilo WhatsApp
  - ⏳ `js/websocket.js` - Mensagens em tempo real
  - ⏳ `js/conversas.js` - Gerenciar conversas
  - ⏳ `css/style.css` - Estilos completos
- ⏳ **Módulo SOS** - Funcionalidades completas
  - ⏳ `js/websocket.js` - Conexão WebSocket
  - ⏳ `js/mapa.js` - Visualização no mapa
  - ⏳ `css/style.css` - Estilos completos
- ⏳ **Módulo Ranking** - Funcionalidades completas
  - ⏳ `js/graficos.js` - Gráficos (Chart.js)
  - ⏳ `js/filtros.js` - Filtros avançados
  - ⏳ `css/style.css` - Estilos completos

#### Fase 6: Integração
- ✅ Script SQL criado para adicionar módulos ao menu
  - `adicionar_modulos_alertas_chat_sos_ranking_menu.sql` - Criado
  - Adiciona registros na TIPOATIVIDADE (códigos 40, 41, 42, 43)
  - Concede permissão ao usuário Admin
  - Inclui seção opcional para conceder a todos os usuários
- ✅ Ícones adicionados no dashboard.js
  - Alertas: `bell` (bx-bell)
  - Chat: `message` (bx-message)
  - SOS: `error-circle` (bx-error-circle)
  - Ranking: `trophy` (bx-trophy)
- ⏳ Executar script SQL no banco de dados
- ⏳ Remover abas do Gerenciar Viagens
- ⏳ Adicionar badges com contadores

#### Fase 7: Notificações
- ⏳ Sistema de notificações (toast)
- ⏳ Integração com WebSocket
- ⏳ Badges no menu

#### Fase 8: Testes
- ⏳ Testes funcionais
- ⏳ Testes de integração
- ⏳ Ajustes finais

---

## 📅 Ordem de Implementação

### Etapa 1: Análise (1-2 dias) ✅
1. ✅ Verificar estrutura atual do banco
2. ✅ Verificar código existente
3. ✅ Mapear o que precisa ser criado/ajustado

### Etapa 2: Banco de Dados (1 dia) ✅
1. ✅ Criar tabelas novas
2. ✅ Ajustar tabelas existentes
3. ✅ Criar índices
4. ✅ Testar queries

### Etapa 3: Backend APIs (2-3 dias) ✅
1. ✅ Criar/ajustar controllers
2. ✅ Criar routes
3. ✅ Implementar lógica de negócio
4. ⏳ Testar endpoints (pendente testes manuais)

### Etapa 4: WebSocket (1 dia)
1. Centralizar serviço WebSocket
2. Implementar eventos
3. Testar conexões

### Etapa 5: Frontend - Módulos (5-7 dias)
1. **Alertas** (2 dias)
2. **SOS** (1-2 dias - reutiliza estrutura de Alertas)
3. **Chat** (2 dias)
4. **Ranking** (1-2 dias)

### Etapa 6: Integração (1 dia)
1. Atualizar menu
2. Remover abas do Gerenciar Viagens
3. Adicionar badges

### Etapa 7: Notificações (1 dia)
1. Implementar sistema de notificações
2. Integrar com WebSocket
3. Testar

### Etapa 8: Testes (2 dias)
1. Testes funcionais
2. Testes de integração
3. Ajustes finais

**Total estimado: 14-18 dias úteis**

---

## ❓ Perguntas para Definir

### 1. Banco de Dados
- [ ] As tabelas ALERTS, MESSAGES, SOS_ALERTS já existem?
- [ ] Qual a estrutura atual dessas tabelas?
- [ ] Há dados existentes que precisam ser migrados?

### 2. Alertas/SOS
- [ ] Quais tipos de alertas/SOS existem?
- [ ] Há níveis de prioridade? Quais?
- [ ] Quem pode criar alertas/SOS? (sistema, motorista, operador)
- [ ] Há regras de negócio específicas?

### 3. Chat
- [ ] Conversas são por motorista, por viagem ou ambos?
- [ ] Há grupos de chat?
- [ ] Operadores podem conversar entre si?
- [ ] Há limite de caracteres por mensagem?

### 4. Ranking
- [ ] Como calcular a pontuação? (fórmula)
- [ ] Quais métricas são mais importantes?
- [ ] Período de cálculo (mensal, semanal, anual)?
- [ ] Há pesos diferentes para cada métrica?

### 5. Permissões
- [ ] Todos os usuários podem tratar alertas/SOS?
- [ ] Há níveis de acesso?
- [ ] Alguns usuários só podem visualizar?

### 6. Notificações
- [ ] Apenas pop-up ou também som?
- [ ] Notificações apenas quando módulo está aberto ou sempre?
- [ ] Há preferências de notificação por usuário?

---

## 🚀 Próximos Passos

1. **Responder as perguntas acima**
2. **Verificar estrutura atual do banco de dados**
3. **Ajustar plano conforme necessário**
4. **Começar pela Fase 1 (Análise)**

---

## 📝 Notas Importantes

- ⚠️ **NÃO alterar** o módulo "Gerenciar Viagens" existente
- ✅ Criar módulos **separados e independentes**
- ✅ Reutilizar código existente quando possível
- ✅ Manter padrão visual **consistente**
- ✅ Testar cada módulo **isoladamente**
- ✅ Documentar APIs e funcionalidades

---

## 📚 Referências

- WebSocket: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket
- Chart.js: https://www.chartjs.org/
- Leaflet: https://leafletjs.com/ (já usado no projeto)
- SweetAlert2: https://sweetalert2.github.io/

---

---

## 📝 Notas de Desenvolvimento

### Documentação de Código ✅
- ✅ Todos os controllers foram documentados com JSDoc completo
- ✅ Comentários explicativos em todas as funções
- ✅ Exemplos de uso nos comentários
- ✅ Descrição de parâmetros e retornos
- ✅ Tratamento de erros documentado

### Padrões Implementados ✅
- ✅ Controllers seguem padrão RESTful
- ✅ Respostas padronizadas com `success` e `data`
- ✅ Tratamento de erros consistente
- ✅ Uso de transações SQL para operações críticas
- ✅ Histórico de ações para auditoria
- ✅ Eventos WebSocket para atualizações em tempo real

### Próximas Ações Recomendadas
1. ✅ **Executar script SQL** `adicionar_modulos_alertas_chat_sos_ranking_menu.sql` no banco - CONCLUÍDO
2. ✅ **Implementar frontend do módulo Alertas** - CONCLUÍDO
3. ✅ **Criar documentação e guias de teste** - CONCLUÍDO
4. ⏳ Testar módulo Alertas no ambiente de produção/teste
5. ⏳ Implementar frontend dos módulos SOS, Chat e Ranking
6. ⏳ Integrar WebSocket nos módulos restantes
7. ⏳ Adicionar sistema de notificações global

### Scripts SQL Criados
- ✅ `adicionar_modulos_alertas_chat_sos_ranking_menu.sql` - Adiciona os 4 módulos ao menu
  - Cria registros na tabela TIPOATIVIDADE (códigos 40, 41, 42, 43)
  - Concede permissão ao usuário Admin
  - Inclui seção opcional para conceder a todos os usuários
  - Segue padrão dos outros scripts do sistema
  - Documentação: `README_ADICIONAR_MODULOS_MENU.md`

---

**Documento criado em:** 2024-01-15  
**Versão:** 2.1  
**Última atualização:** 2025-01-18  
**Status:** Módulo Alertas Completo - SOS/Chat/Ranking Pendentes

### Documentação Criada
- ✅ `GUIA_TESTES_ALERTAS.md` - Guia completo de testes
- ✅ `PASSO_A_PASSO_TESTE_RAPIDO.md` - Guia rápido (5 minutos)
- ✅ `DOCUMENTACAO_MODULO_ALERTAS.md` - Documentação técnica completa
- ✅ `criar_alertas_teste.sql` - Script SQL para criar dados de teste
