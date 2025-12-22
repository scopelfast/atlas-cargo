# 📚 Documentação Técnica - Módulo Alertas

**Versão:** 2.0  
**Data:** 2025-01-18  
**Módulo:** Alertas do Sistema

---

## 📖 Índice

1. [Visão Geral](#visão-geral)
2. [Arquitetura](#arquitetura)
3. [Como Funciona](#como-funciona)
4. [APIs Utilizadas](#apis-utilizadas)
5. [Estrutura de Dados](#estrutura-de-dados)
6. [WebSocket](#websocket)
7. [Fluxos de Dados](#fluxos-de-dados)
8. [Manutenção](#manutenção)

---

## 🎯 Visão Geral

O módulo **Alertas** é um sistema completo para visualização, filtragem e tratamento de alertas gerados automaticamente pelo sistema. Ele permite que operadores monitorem e respondam a situações anômalas em viagens em tempo real.

### Funcionalidades Principais

- 📋 **Listagem** de alertas com paginação
- 🔍 **Filtros avançados** (Status, Tipo, Prioridade, Datas, Viagem)
- ✅ **Marcar como lido**
- 🔧 **Tratar alertas** (mudar status e adicionar observações)
- 📜 **Histórico completo** de ações
- 📊 **Estatísticas em tempo real**
- 🔔 **Notificações via WebSocket**
- 🏷️ **Badges no menu** com contador de pendentes

---

## 🏗️ Arquitetura

### Estrutura de Arquivos

```
backend/
├── controllers/
│   └── alert.controller.js      # Endpoints da API
├── routes/
│   └── alert.routes.js          # Rotas HTTP
├── services/
│   └── alert-service.js         # Lógica de geração de alertas
└── public/
    └── modulos/
        └── alertas/
            ├── index.html        # Interface HTML
            └── js/
                └── script.js     # Lógica frontend
```

### Fluxo de Dados

```
[Sistema] → [alert-service.js] → [Tabela ALERTS] → [API] → [Frontend] → [WebSocket] → [Notificação]
```

---

## 🔧 Como Funciona

### 1. Geração Automática de Alertas

Os alertas são gerados pelo serviço `alert-service.js` que:

1. **Executa periodicamente** (a cada 5 minutos via job no servidor)
2. **Verifica viagens ativas** na tabela `VIAGEMMESTRE`
3. **Analisa dados de rastreamento** na tabela `VIAGEMRASTREAMENTO`
4. **Compara com regras configuradas:**
   - Paradas > 30 minutos
   - Atrasos no ETA
   - Motorista offline > 90 minutos
   - Desvios de rota > 500m
5. **Cria alertas** na tabela `ALERTS` quando detecta anomalias

### 2. Tipos de Alertas

| Tipo | Descrição | Prioridade Padrão |
|------|-----------|-------------------|
| `ATRASO` | Atraso no ETA (tempo estimado de chegada) | Urgente/Alta |
| `PARADA` | Parada prolongada (>30 min) | Alta/Normal |
| `OFFLINE` | Motorista sem atualização GPS (>90 min) | Normal |
| `DESVIO` | Motorista fora da rota planejada (>500m) | Alta |

### 3. Status dos Alertas

| Status | Descrição |
|-------|-----------|
| `Pendente` | Alerta criado, aguardando tratamento |
| `Em Análise` | Alerta sendo analisado por operador |
| `Tratado` | Alerta resolvido |
| `Cancelado` | Alerta cancelado (falso positivo) |

### 4. Prioridades

| Prioridade | Cor | Uso |
|------------|-----|-----|
| `Urgente` | Vermelho | Situações críticas que requerem ação imediata |
| `Alta` | Laranja | Situações importantes |
| `Normal` | Azul | Situações comuns |
| `Baixa` | Cinza | Situações de baixa prioridade |

---

## 🔌 APIs Utilizadas

### Endpoints Principais

#### 1. Listar Alertas
```
GET /api/alertas?status=Pendente&tipo=ATRASO&prioridade=Urgente&limit=20&offset=0
```

**Resposta:**
```json
{
  "success": true,
  "data": [
    {
      "ID": 1,
      "IDVIAGEM": 12345,
      "CDMOTORISTA": 67890,
      "TYPE": "ATRASO",
      "MESSAGE": "Atraso crítico detectado...",
      "SEVERITY": "high",
      "PRIORIDADE": "Urgente",
      "STATUS": "Pendente",
      "DETAILS": "{...}",
      "CREATED_AT": "2025-01-18T15:00:00",
      "motorista_nome": "João Silva"
    }
  ],
  "total": 50,
  "page": 1,
  "pages": 3
}
```

#### 2. Contador de Alertas
```
GET /api/alertas/contador
```

**Resposta:**
```json
{
  "success": true,
  "data": {
    "pendentes": 15,
    "emAnalise": 3,
    "tratados": 32,
    "total": 50
  }
}
```

#### 3. Marcar como Lido
```
POST /api/alertas/:id/ler
```

#### 4. Tratar Alerta
```
POST /api/alertas/:id/tratar
Body: {
  "status": "Tratado",
  "observacoes": "Resolvido após contato com motorista"
}
```

#### 5. Histórico
```
GET /api/alertas/:id/historico
```

---

## 💾 Estrutura de Dados

### Tabela: ALERTS

```sql
CREATE TABLE ALERTS (
    ID INT PRIMARY KEY IDENTITY(1,1),
    IDVIAGEM DECIMAL(15,0) NULL,
    CDMOTORISTA DECIMAL(15,0) NULL,
    TYPE VARCHAR(50) NOT NULL,           -- ATRASO, PARADA, OFFLINE, DESVIO
    MESSAGE NVARCHAR(500) NOT NULL,
    SEVERITY VARCHAR(20) NOT NULL,         -- high, medium, low
    PRIORIDADE VARCHAR(20) DEFAULT 'Normal', -- Urgente, Alta, Normal, Baixa
    STATUS VARCHAR(50) DEFAULT 'Pendente',  -- Pendente, Em Análise, Tratado, Cancelado
    DETAILS NVARCHAR(MAX) NULL,           -- JSON com detalhes
    CREATED_AT DATETIME2 DEFAULT GETDATE(),
    RESOLVED BIT DEFAULT 0,
    ID_USUARIO_LEU INT NULL,
    DH_LEITURA DATETIME2 NULL,
    ID_USUARIO_TRATOU INT NULL,
    DH_TRATAMENTO DATETIME2 NULL,
    OBSERVACOES NVARCHAR(MAX) NULL
);
```

### Tabela: ALERT_HISTORY

```sql
CREATE TABLE ALERT_HISTORY (
    ID INT PRIMARY KEY IDENTITY(1,1),
    ID_ALERT INT NOT NULL,
    ID_USUARIO INT NOT NULL,
    ACAO VARCHAR(50) NOT NULL,            -- LEU, TRATOU, CANCELOU, ATUALIZOU
    STATUS_ANTERIOR VARCHAR(50) NULL,
    STATUS_NOVO VARCHAR(50) NULL,
    OBSERVACOES NVARCHAR(MAX) NULL,
    DH_ACAO DATETIME2 DEFAULT GETDATE(),
    FOREIGN KEY (ID_ALERT) REFERENCES ALERTS(ID),
    FOREIGN KEY (ID_USUARIO) REFERENCES CADASTROGERAL(CDCADASTRO)
);
```

---

## 🔔 WebSocket

### Eventos Emitidos pelo Servidor

#### 1. Novo Alerta
```javascript
socket.on('alerta:novo', (alerta) => {
  // Alerta criado automaticamente
  // Atualizar lista e mostrar notificação
});
```

#### 2. Alerta Atualizado
```javascript
socket.on('alerta:atualizado', (alerta) => {
  // Alerta foi modificado
  // Atualizar lista
});
```

#### 3. Alerta Tratado
```javascript
socket.on('alerta:tratado', (data) => {
  // Alerta foi tratado por outro operador
  // Atualizar lista e contadores
});
```

### Conexão

O frontend conecta automaticamente ao Socket.io quando o módulo é carregado:

```javascript
socket = io(url, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 5
});
```

---

## 📊 Fluxos de Dados

### Fluxo 1: Geração de Alerta

```
1. Job no servidor (a cada 5 min)
   ↓
2. alert-service.verificarAlertas(idViagem)
   ↓
3. Analisa VIAGEMRASTREAMENTO
   ↓
4. Detecta anomalia
   ↓
5. INSERT INTO ALERTS
   ↓
6. Emite evento WebSocket: 'alerta:novo'
   ↓
7. Frontend atualiza automaticamente
```

### Fluxo 2: Tratamento de Alerta

```
1. Operador clica "Tratar"
   ↓
2. Frontend: POST /api/alertas/:id/tratar
   ↓
3. Backend: UPDATE ALERTS + INSERT ALERT_HISTORY
   ↓
4. Emite evento WebSocket: 'alerta:tratado'
   ↓
5. Frontend atualiza lista e contadores
```

---

## 🔧 Manutenção

### Limpar Alertas Antigos

```sql
-- Remover alertas tratados com mais de 30 dias
DELETE FROM [dbo].[ALERT_HISTORY]
WHERE ID_ALERT IN (
    SELECT ID FROM [dbo].[ALERTS]
    WHERE STATUS = 'Tratado'
    AND DH_TRATAMENTO < DATEADD(DAY, -30, GETDATE())
);

DELETE FROM [dbo].[ALERTS]
WHERE STATUS = 'Tratado'
AND DH_TRATAMENTO < DATEADD(DAY, -30, GETDATE());
```

### Recalcular Estatísticas

As estatísticas são calculadas em tempo real via API `/api/alertas/contador`. Não há necessidade de manutenção manual.

### Verificar Integridade

```sql
-- Verificar alertas sem histórico
SELECT a.*
FROM [dbo].[ALERTS] a
LEFT JOIN [dbo].[ALERT_HISTORY] h ON a.ID = h.ID_ALERT
WHERE h.ID IS NULL
AND a.STATUS != 'Pendente';
```

---

## 📝 Notas Importantes

1. **Geração Automática:** Os alertas são gerados automaticamente. Não é necessário criar manualmente (exceto para testes).

2. **Performance:** O módulo usa paginação (20 itens por página) para melhor performance.

3. **WebSocket:** A conexão WebSocket é estabelecida automaticamente. Se falhar, o módulo continua funcionando (sem atualizações em tempo real).

4. **Badges:** O badge no menu atualiza automaticamente a cada 30 segundos e quando alertas são tratados.

5. **Histórico:** Todas as ações são registradas no histórico para auditoria.

---

**Documento criado em:** 2025-01-18  
**Última atualização:** 2025-01-18  
**Autor:** Sistema DivulgaCarga
