# 🎨 Implementação: Funções de Atualização UI via WebSocket

**Versão:** 1.0  
**Data:** 2025-01-16  
**Status:** ✅ Implementado

---

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Funções Implementadas](#funções-implementadas)
3. [Como Funciona](#como-funciona)
4. [Integrações](#integrações)
5. [Testes](#testes)

---

## 🎯 Visão Geral

Implementação de funções globais que mapeiam eventos WebSocket recebidos para atualizações visuais na interface do usuário, proporcionando atualizações em tempo real sem necessidade de recarregar a página.

### Objetivo

Quando eventos WebSocket chegam do servidor (GPS, alertas, mensagens, etc.), as funções correspondentes são chamadas automaticamente para atualizar a UI de forma inteligente, apenas se o usuário estiver visualizando o conteúdo relevante.

---

## ✨ Funções Implementadas

### 1. `window.atualizarPosicaoGPS(idviagem, posicao)`

**Quando é chamada:** Evento `torre:gps-update` recebido

**O que faz:**
- Verifica se está na aba de rastreamento
- Se for a viagem sendo visualizada, recarrega posições GPS
- Atualiza o mapa automaticamente

**Exemplo:**
```javascript
window.atualizarPosicaoGPS(123, {
  latitude: -30.123,
  longitude: -51.456,
  timestamp: '2025-01-16T10:30:00Z'
});
```

---

### 2. `window.atualizarDadosViagem(idviagem, viagem)`

**Quando é chamada:** Evento `torre:viagem-update` recebido

**O que faz:**
- Atualiza dados no objeto `lastViagens`
- Se estiver visualizando a viagem na aba de detalhes, recarrega
- Atualiza card da viagem no grid (se visível)

**Exemplo:**
```javascript
window.atualizarDadosViagem(123, {
  CDSITUACAOVIAGEM: 2,
  DSSITUACAOVIAGEM: 'Em Andamento',
  // ... outros campos
});
```

---

### 3. `window.adicionarAlerta(alerta)`

**Quando é chamada:** Evento `torre:novo-alerta` recebido

**O que faz:**
- Recarrega lista de alertas se estiver na aba de alertas
- Atualiza badge na aba de alertas
- Mostra notificação se for alerta crítico

**Exemplo:**
```javascript
window.adicionarAlerta({
  ID: 456,
  IDVIAGEM: 123,
  TYPE: 'atraso',
  MESSAGE: 'Viagem atrasada',
  SEVERITY: 'high'
});
```

---

### 4. `window.removerAlerta(idAlerta)`

**Quando é chamada:** Evento `torre:alerta-resolvido` recebido

**O que faz:**
- Recarrega lista de alertas
- Remove o alerta da visualização

---

### 5. `window.notificarSOS(sos)`

**Quando é chamada:** Evento `torre:sos-alerta` recebido

**O que faz:**
- Mostra notificação urgente na tela
- Toca som de alerta (se permitido)
- Recarrega lista de SOS se estiver na aba

**Exemplo:**
```javascript
window.notificarSOS({
  ID: 789,
  CDVIAGEM: 123,
  NOME_MOTORISTA: 'João Silva',
  MESSAGE: 'Emergência!'
});
```

---

### 6. `window.atualizarReputacaoMotorista(cdmotorista, reputacao)`

**Quando é chamada:** Evento `torre:reputacao-update` recebido

**O que faz:**
- Recarrega ranking se estiver na aba de ranking
- Atualiza score do motorista

---

### 7. `window.atualizarGridViagens(viagens)`

**Quando é chamada:** Evento `torre:lista-viagens-update` recebido

**O que faz:**
- Atualiza lista de viagens no grid
- Mantém dados sincronizados

---

### 8. `window.ativarAcompanhamentoViagem(idviagem)`

**Função auxiliar:**
- Ativa acompanhamento WebSocket para uma viagem específica
- Chamada automaticamente quando viagem é selecionada

### 9. `window.desativarAcompanhamentoViagem(idviagem)`

**Função auxiliar:**
- Para de acompanhar uma viagem
- Chamada quando usuário sai da viagem

---

## 🔄 Como Funciona

### Fluxo de Atualização

```
1. Evento acontece no backend (ex: GPS atualizado)
   ↓
2. Backend emite evento WebSocket: torre:gps-update
   ↓
3. Cliente WebSocket Torre recebe evento
   ↓
4. Chama função global: window.atualizarPosicaoGPS()
   ↓
5. Função verifica contexto:
   - Está na aba de rastreamento?
   - É a viagem sendo visualizada?
   ↓
6. Se SIM: Atualiza UI automaticamente
   Se NÃO: Ignora (não atualiza se usuário não está vendo)
```

### Acompanhamento Automático

Quando uma viagem é selecionada/visualizada:

```javascript
// Ao abrir detalhes de uma viagem
carregarEselecionarViagem(idViagem);
// → Automaticamente chama window.ativarAcompanhamentoViagem()

// Ao abrir aba de rastreamento
showTab('rastreamento');
// → Automaticamente ativa acompanhamento

// Ao abrir aba de alertas
// → Automaticamente ativa acompanhamento
```

---

## 🔌 Integrações

### Funções Integradas Automaticamente

As seguintes funções agora ativam acompanhamento WebSocket:

1. **`carregarEselecionarViagem(idViagem)`**
   - Quando viagem é selecionada
   - Ativa acompanhamento automaticamente

2. **`showTab('rastreamento')`**
   - Quando aba de rastreamento é aberta
   - Ativa acompanhamento da viagem sendo visualizada

3. **`carregarAlertas(idViagem)`**
   - Quando alertas são carregados
   - Ativa acompanhamento da viagem

---

## 🧪 Testes

### Teste 1: Atualização de GPS

1. Abra uma viagem no módulo "Gerenciar Viagens"
2. Vá para a aba "Rastreamento"
3. No console, simule evento:
   ```javascript
   window.atualizarPosicaoGPS(123, {
     latitude: -30.123,
     longitude: -51.456,
     timestamp: new Date().toISOString()
   });
   ```
4. Verifique se o mapa atualiza automaticamente

### Teste 2: Novo Alerta

1. Abra uma viagem e vá para aba "Alertas"
2. Crie um alerta no backend (ou espere job criar)
3. Verifique se alerta aparece automaticamente na lista
4. Verifique se badge na aba é atualizado

### Teste 3: SOS

1. Com aba SOS aberta
2. Motorista envia SOS
3. Verifique se:
   - Notificação aparece
   - Som toca (se permitido)
   - Alerta aparece na lista

---

## 📊 Benefícios

### Performance
- ✅ Atualizações apenas quando necessário
- ✅ Não recarrega dados desnecessariamente
- ✅ Verifica contexto antes de atualizar

### UX
- ✅ Atualizações instantâneas
- ✅ Interface sempre atualizada
- ✅ Sem necessidade de recarregar página

### Código
- ✅ Funções reutilizáveis
- ✅ Fácil de estender
- ✅ Bem documentadas

---

## ✅ Checklist de Implementação

- [x] Funções globais criadas
- [x] Integração com WebSocket Torre
- [x] Acompanhamento automático implementado
- [x] Verificação de contexto (só atualiza se necessário)
- [x] Tratamento de erros
- [x] Documentação completa

---

**Versão:** 1.0  
**Última Atualização:** 2025-01-16  
**Autor:** Sistema LogiTrack Pro
