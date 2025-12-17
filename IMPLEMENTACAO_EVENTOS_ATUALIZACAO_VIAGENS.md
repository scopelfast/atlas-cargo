# 🔄 Implementação: Eventos de Atualização de Viagens via WebSocket

**Versão:** 1.0  
**Data:** 2025-01-16  
**Status:** ✅ Implementado

---

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Eventos Implementados](#eventos-implementados)
3. [Integrações](#integrações)
4. [Estrutura de Dados](#estrutura-de-dados)
5. [Testes](#testes)

---

## 🎯 Visão Geral

Implementação de eventos WebSocket que são emitidos automaticamente quando:
- Status de uma viagem é alterado
- Dados de uma viagem são atualizados
- Um motorista é confirmado para uma viagem (atribuição)

Isso permite atualizações em tempo real na Torre de Controle, sem necessidade de recarregar a página ou fazer polling.

---

## ✨ Eventos Implementados

### 1. Atualização de Viagem (`torre:viagem-update`)

**Quando é emitido:**
- Quando método `atualizar` do `viagemmestre.controller.js` é chamado
- Status, datas, distância, valores, observações, etc. são alterados

**Estrutura do Evento:**
```javascript
{
  idviagem: 123,
  viagem: {
    IDVIAGEM: 123,
    FGSITVIAGEM: 'P',
    CDSITUACAOVIAGEM: 1,
    DSSITUACAOVIAGEM: 'Programada',
    CDTIPOVIAGEM: 1,
    DSTIPOVIAGEM: 'Normal',
    FGACTIVE: 'A',
    CDCLASSEFROTA: 5,
    DSCLASSEFROTA: 'Caminhão',
    DTPREVINICIO: '2025-01-16T10:00:00Z',
    DTPREVFINAL: '2025-01-16T18:00:00Z',
    IDROTEIRO: 456,
    DSROTEIRO: 'SP → RJ',
    DISTANCIAKM: 450.5,
    VLFRETE: 2500.00,
    PESO: 10.5,
    CUBAGEM: 15.2,
    OBSERV: 'Carga frágil',
    ORIGEM_ESTADO: 'SP',
    ORIGEM_CIDADE: 'São Paulo',
    DESTINO_ESTADO: 'RJ',
    DESTINO_CIDADE: 'Rio de Janeiro',
    TEM_CONFIRMADO: 'S'
  },
  timestamp: '2025-01-16T15:30:00.000Z'
}
```

**Onde é recebido:**
- Sala específica da viagem: `torre:viagem-${idviagem}`
- Sala global: `torre:all-viagens`

---

### 2. Confirmação de Motorista (via `torre:viagem-update`)

**Quando é emitido:**
- Quando método `confirmar` do `viagemmestre.controller.js` é chamado
- Uma convocação é confirmada (motorista atribuído à viagem)

**Estrutura do Evento:**
```javascript
{
  idviagem: 123,
  viagem: {
    IDVIAGEM: 123,
    // ... todos os campos da viagem ...
    CDMOTORISTA: 789,
    MOTORISTA_NOME: 'JOÃO SILVA',
    MOTORISTA_CELULAR: '11987654321',
    TEM_CONFIRMADO: 'S'
  },
  timestamp: '2025-01-16T15:30:00.000Z'
}
```

**Diferença:**
- Inclui dados do motorista confirmado (`CDMOTORISTA`, `MOTORISTA_NOME`, `MOTORISTA_CELULAR`)
- `TEM_CONFIRMADO` sempre será `'S'`

---

## 🔌 Integrações

### Backend

#### 1. Controller: `viagemmestre.controller.js`

**Método `atualizar`:**
```javascript
// Após atualizar no banco de dados
await request.query(`UPDATE ...`);

// Emitir evento WebSocket
const websocketTorre = req.app.get('websocketTorre');
if (websocketTorre) {
  // Buscar dados atualizados
  const viagemAtualizada = await pool.request()...
  
  // Emitir evento
  websocketTorre.emitirAtualizacaoViagem(idNumerico, dadosViagem);
}
```

**Método `confirmar` (convocação):**
```javascript
// Após confirmar convocação no banco
await transaction.commit();

// Emitir evento WebSocket com dados do motorista
const websocketTorre = req.app.get('websocketTorre');
if (websocketTorre && convocacao.IDVIAGEM) {
  // Buscar dados atualizados incluindo motorista
  const viagemAtualizada = await pool.request()...
  
  // Emitir evento
  websocketTorre.emitirAtualizacaoViagem(convocacao.IDVIAGEM, dadosViagem);
}
```

#### 2. Service: `websocket-torre.service.js`

**Método `emitirAtualizacaoViagem`:**
```javascript
emitirAtualizacaoViagem(idviagem, viagem) {
  const room = `torre:viagem-${idviagem}`;
  const data = {
    idviagem,
    viagem,
    timestamp: new Date().toISOString()
  };

  // Emitir para sala específica da viagem
  this.io.to(room).emit('torre:viagem-update', data);
  
  // Emitir para sala de todas as viagens
  this.io.to('torre:all-viagens').emit('torre:viagem-update', data);
}
```

---

### Frontend

#### Cliente WebSocket Torre: `websocket-torre.js`

**Listener já implementado:**
```javascript
socket.on('torre:viagem-update', (data) => {
  const { idviagem, viagem } = data;
  
  // Chamar função global se existir
  if (typeof window.atualizarDadosViagem === 'function') {
    window.atualizarDadosViagem(idviagem, viagem);
  }
});
```

#### Função de Atualização UI: `script.js`

**Função global já implementada:**
```javascript
window.atualizarDadosViagem = async function(idviagem, viagem) {
  // Atualizar dados no objeto lastViagens
  // Se estiver visualizando a viagem, recarregar
  // Atualizar card no grid se visível
};
```

---

## 📊 Estrutura de Dados

### Dados da Viagem Enviados

**Campos principais:**
- `IDVIAGEM` - ID da viagem
- `FGSITVIAGEM` - Flag de situação ('P', 'A', 'T', 'F', etc.)
- `CDSITUACAOVIAGEM` - Código da situação
- `DSSITUACAOVIAGEM` - Descrição da situação
- `CDTIPOVIAGEM` - Código do tipo
- `DSTIPOVIAGEM` - Descrição do tipo
- `FGACTIVE` - Flag ativo ('A' ou 'I')
- `CDCLASSEFROTA` - Código da classe de frota
- `DSCLASSEFROTA` - Descrição da classe
- `DTPREVINICIO` - Data/hora prevista de início
- `DTPREVFINAL` - Data/hora prevista de final
- `IDROTEIRO` - ID do roteiro
- `DSROTEIRO` - Descrição do roteiro
- `DISTANCIAKM` - Distância em km
- `VLFRETE` - Valor do frete
- `PESO` - Peso
- `CUBAGEM` - Cubagem
- `OBSERV` - Observações
- `ORIGEM_ESTADO` - Estado de origem
- `ORIGEM_CIDADE` - Cidade de origem
- `DESTINO_ESTADO` - Estado de destino
- `DESTINO_CIDADE` - Cidade de destino
- `TEM_CONFIRMADO` - 'S' ou 'N' (se tem motorista confirmado)

**Campos adicionais quando motorista é confirmado:**
- `CDMOTORISTA` - ID do motorista
- `MOTORISTA_NOME` - Nome do motorista
- `MOTORISTA_CELULAR` - Celular do motorista

---

## 🧪 Testes

### Teste 1: Atualizar Viagem

1. Abra o módulo "Gerenciar Viagens"
2. Selecione uma viagem
3. Altere algum campo (ex: status, data, observação)
4. Salve as alterações
5. Verifique no console se evento foi emitido:
   ```
   📡 Evento WebSocket emitido: viagem 123 atualizada
   ```
6. Se estiver visualizando a viagem em outra aba, verifique se dados são atualizados automaticamente

### Teste 2: Confirmar Motorista

1. Vá para aba "Convocações" de uma viagem
2. Confirme uma convocação (botão "Confirmar")
3. Verifique no console:
   ```
   📡 Evento WebSocket emitido: viagem 123 atualizada (motorista confirmado)
   ```
4. Verifique se dados da viagem são atualizados automaticamente
5. Verifique se nome do motorista aparece na interface

---

## 📈 Benefícios

### Performance
- ✅ Atualizações instantâneas (< 100ms)
- ✅ Reduz necessidade de polling
- ✅ Apenas clientes interessados recebem eventos

### UX
- ✅ Interface sempre atualizada
- ✅ Não precisa recarregar página
- ✅ Feedback imediato de alterações

### Código
- ✅ Integrado com sistema WebSocket existente
- ✅ Não quebra funcionalidades existentes
- ✅ Tratamento de erro robusto (não interrompe resposta se WebSocket falhar)

---

## ✅ Checklist de Implementação

- [x] Método `atualizar` emite eventos WebSocket
- [x] Método `confirmar` emite eventos WebSocket
- [x] Dados completos da viagem são enviados
- [x] Dados do motorista são incluídos quando confirmado
- [x] Eventos enviados para sala específica e sala global
- [x] Tratamento de erro implementado (não interrompe resposta)
- [x] Funções de atualização UI já existem e funcionam
- [x] Documentação completa

---

**Versão:** 1.0  
**Última Atualização:** 2025-01-16  
**Autor:** Sistema LogiTrack Pro
