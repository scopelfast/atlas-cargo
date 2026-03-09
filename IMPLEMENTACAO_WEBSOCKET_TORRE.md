# 🏢 Implementação: WebSocket para Torre de Controle

**Versão:** 1.0  
**Data:** 2026-01-16  
**Status:** ✅ Implementado

---

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [O Que Foi Implementado](#o-que-foi-implementado)
3. [Arquitetura](#arquitetura)
4. [Eventos WebSocket](#eventos-websocket)
5. [Como Usar](#como-usar)
6. [Integração com Controllers](#integração-com-controllers)
7. [Testes](#testes)
8. [Troubleshooting](#troubleshooting)

---

## 🎯 Visão Geral

Implementação de WebSocket (Socket.io) para atualizações em tempo real na Torre de Controle, eliminando a necessidade de polling manual e proporcionando atualizações instantâneas de:

- ✅ **Posições GPS** em tempo real
- ✅ **Status de viagens** atualizados automaticamente
- ✅ **Alertas** instantâneos
- ✅ **Mensagens de chat** em tempo real
- ✅ **Alertas SOS** com prioridade máxima
- ✅ **Atualizações de reputação** de motoristas

### Benefícios

- **Performance:** Elimina polling desnecessário
- **Tempo Real:** Atualizações instantâneas
- **Eficiência:** Reduz carga no servidor
- **UX:** Interface mais responsiva

---

## ✨ O Que Foi Implementado

### 1. Backend: WebSocket Torre Service (`websocket-torre.service.js`)

**Características:**
- ✅ Gerenciamento de salas por viagem
- ✅ Sala global para todas as viagens (torre)
- ✅ Emissão de eventos para diferentes tipos de atualizações
- ✅ Integração com Socket.io existente (chat)

**Arquivo:** `backend/services/websocket-torre.service.js`

### 2. Frontend: WebSocket Torre Client (`websocket-torre.js`)

**Características:**
- ✅ Conexão automática ao Socket.io
- ✅ Reconexão automática em caso de falha
- ✅ Listeners para todos os eventos da torre
- ✅ Funções helper para atualizar UI

**Arquivo:** `backend/public/modulos/gerenciar-viagens/js/websocket-torre.js`

### 3. Integração no Servidor (`server.js`)

**Características:**
- ✅ Inicialização automática do serviço
- ✅ Disponibilização no app Express
- ✅ Coexiste com sistema de chat existente

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────┐
│         Frontend (Torre de Controle)    │
│  - websocket-torre.js (cliente)         │
│  - Escuta eventos em tempo real         │
│  - Atualiza UI automaticamente          │
└──────────────┬──────────────────────────┘
               │
               │ WebSocket (Socket.io)
               │
               ▼
┌─────────────────────────────────────────┐
│         Backend (server.js)             │
│  - Socket.io Server                     │
│  - websocket-torre.service.js           │
│  - Gerencia salas e eventos             │
└──────────────┬──────────────────────────┘
               │
               │ Emite eventos quando:
               │ - GPS atualizado
               │ - Viagem modificada
               │ - Alerta criado/resolvido
               │
               ▼
┌─────────────────────────────────────────┐
│      Controllers (motorista-app,        │
│      alert, sos, message, etc.)         │
│  - Chamam websocketTorre.emitir...()    │
└─────────────────────────────────────────┘
```

---

## 📡 Eventos WebSocket

### Eventos que o Cliente Envia

#### `torre:join-viagem`
Entrar na sala de uma viagem específica
```javascript
socket.emit('torre:join-viagem', idviagem);
```

#### `torre:leave-viagem`
Sair da sala de uma viagem
```javascript
socket.emit('torre:leave-viagem', idviagem);
```

#### `torre:join-all`
Entrar na sala de todas as viagens (torre)
```javascript
socket.emit('torre:join-all');
```

#### `torre:leave-all`
Sair da sala de todas as viagens
```javascript
socket.emit('torre:leave-all');
```

### Eventos que o Servidor Emite

#### `torre:gps-update`
Atualização de posição GPS
```javascript
{
  idviagem: 123,
  posicao: {
    latitude: -30.123,
    longitude: -51.456,
    timestamp: '2026-01-16T10:30:00Z'
  },
  timestamp: '2026-01-16T10:30:00Z'
}
```

#### `torre:viagem-update`
Atualização de dados da viagem
```javascript
{
  idviagem: 123,
  viagem: { /* dados da viagem */ },
  timestamp: '2026-01-16T10:30:00Z'
}
```

#### `torre:novo-alerta`
Novo alerta criado
```javascript
{
  alerta: { /* dados do alerta */ },
  timestamp: '2026-01-16T10:30:00Z'
}
```

#### `torre:alerta-resolvido`
Alerta foi resolvido
```javascript
{
  idAlerta: 456,
  idviagem: 123,
  timestamp: '2026-01-16T10:30:00Z'
}
```

#### `torre:sos-alerta`
Alerta SOS (prioridade máxima)
```javascript
{
  sos: { /* dados do SOS */ },
  prioridade: 'CRITICA',
  timestamp: '2026-01-16T10:30:00Z'
}
```

#### `torre:nova-mensagem`
Nova mensagem no chat
```javascript
{
  mensagem: { /* dados da mensagem */ },
  timestamp: '2026-01-16T10:30:00Z'
}
```

#### `torre:reputacao-update`
Atualização de reputação
```javascript
{
  cdmotorista: 789,
  reputacao: { /* dados da reputação */ },
  timestamp: '2026-01-16T10:30:00Z'
}
```

#### `torre:lista-viagens-update`
Atualização da lista de viagens
```javascript
{
  viagens: [ /* array de viagens */ ],
  count: 50,
  timestamp: '2026-01-16T10:30:00Z'
}
```

---

## 🚀 Como Usar

### No Frontend

O cliente WebSocket é inicializado automaticamente quando a página carrega. Para usar:

```javascript
// Acompanhar uma viagem específica
window.WebSocketTorre.acompanharViagem(123);

// Parar de acompanhar
window.WebSocketTorre.pararAcompanharViagem(123);

// Verificar se está conectado
if (window.WebSocketTorre.estaConectado()) {
  console.log('Conectado!');
}

// Ver viagens que está acompanhando
console.log(window.WebSocketTorre.getViagensAcompanhadas());
```

### No Backend (Controllers)

Para emitir eventos, obtenha o serviço e chame os métodos:

```javascript
// Obter serviço
const websocketTorre = req.app.get('websocketTorre');

// Emitir atualização GPS
websocketTorre.emitirAtualizacaoGPS(idviagem, {
  latitude: -30.123,
  longitude: -51.456,
  timestamp: new Date()
});

// Emitir atualização de viagem
websocketTorre.emitirAtualizacaoViagem(idviagem, dadosViagem);

// Emitir novo alerta
websocketTorre.emitirNovoAlerta(dadosAlerta);
```

---

## 🔌 Integração com Controllers

### Exemplo: Emitir evento quando GPS é atualizado

No controller de posições GPS:

```javascript
// Após inserir posição GPS
await pool.request().query(`INSERT INTO VIAGEMRASTREAMENTO ...`);

// Emitir evento WebSocket
const websocketTorre = req.app.get('websocketTorre');
if (websocketTorre) {
  websocketTorre.emitirAtualizacaoGPS(idviagem, {
    latitude: posicao.latitude,
    longitude: posicao.longitude,
    timestamp: new Date()
  });
}
```

### Exemplo: Emitir evento quando alerta é resolvido

No controller de alertas (já implementado):

```javascript
const sucesso = await alertService.resolverAlerta(id, idusuario);

if (sucesso) {
  const websocketTorre = req.app.get('websocketTorre');
  if (websocketTorre) {
    websocketTorre.emitirAlertaResolvido(id, idviagem);
  }
}
```

---

## 🧪 Testes

### Teste 1: Verificar Conexão

1. Abra o módulo "Gerenciar Viagens"
2. Abra o DevTools (F12) → Console
3. Deve aparecer: `✅ WebSocket Torre conectado: [socket-id]`
4. Deve aparecer: `✅ Entrou na sala de todas as viagens (Torre de Controle)`

### Teste 2: Acompanhar Viagem

1. No console, execute:
   ```javascript
   window.WebSocketTorre.acompanharViagem(123); // Substitua 123 pelo ID real
   ```
2. Deve aparecer: `✅ Entrou na sala da viagem 123`

### Teste 3: Verificar Eventos

1. Execute uma ação que deve emitir evento (ex: resolver alerta)
2. Verifique no console se o evento foi recebido
3. Verifique se a UI foi atualizada automaticamente

---

## 🔍 Troubleshooting

### Problema: "Socket.io não disponível"

**Causa:** Script do Socket.io não carregou

**Solução:**
1. Verifique se `https://cdn.socket.io/4.5.4/socket.io.min.js` está carregando
2. Ou use Socket.io do servidor: `/socket.io/socket.io.js`

### Problema: "WebSocket não conectado"

**Causa:** Conexão falhou

**Solução:**
1. Verifique se o servidor está rodando
2. Verifique se há erros no console do servidor
3. Verifique firewall/proxy bloqueando WebSocket

### Problema: Eventos não estão sendo recebidos

**Causa:** Não entrou na sala correta

**Solução:**
1. Verifique se chamou `torre:join-all` ou `torre:join-viagem`
2. Verifique no console se apareceu "Entrou na sala..."
3. Verifique se o servidor está emitindo eventos

### Problema: UI não atualiza automaticamente

**Causa:** Funções de atualização não foram implementadas

**Solução:**
1. Implemente as funções globais no `script.js`:
   - `window.atualizarPosicaoGPS(idviagem, posicao)`
   - `window.atualizarDadosViagem(idviagem, viagem)`
   - etc.
2. Ou modifique `websocket-torre.js` para chamar funções existentes

---

## 📈 Próximos Passos

### 1. Integrar Emissão de Eventos GPS

Adicionar emissão quando posições GPS são inseridas:
- `motorista-app.controller.js` → método de salvar GPS
- `sincronizar-rastreamento-integra.controller.js`

### 2. Integrar Atualizações de Viagens

Emitir eventos quando:
- Status da viagem muda
- Motorista é atribuído
- Veículo é atribuído
- Roteiro é alterado

### 3. Implementar Funções de Atualização UI

Criar funções no `script.js` para:
- Atualizar posição GPS no mapa
- Atualizar cards de viagem
- Atualizar grid de viagens
- Mostrar notificações

### 4. Substituir Polling por WebSocket

Remover `setInterval` que fazem polling e substituir por eventos WebSocket.

---

## ✅ Checklist de Implementação

- [x] WebSocket Torre Service criado
- [x] WebSocket Torre Client criado
- [x] Integração no server.js
- [x] Script adicionado no HTML
- [x] Eventos de alertas integrados
- [x] Eventos de GPS integrados
- [x] Eventos SOS integrados
- [x] Eventos de mensagens integrados
- [ ] Eventos de viagens integrados (quando status/atribuições mudam)
- [ ] Funções de atualização UI implementadas (mapear eventos para funções existentes)
- [ ] Polling substituído por WebSocket (opcional - melhorar performance)
- [x] Documentação completa

---

**Versão:** 1.0  
**Última Atualização:** 2026-01-16  
**Autor:** Sistema LogiTrack Pro
