# 📋 Como Funciona a Geração Automática de Alertas

## 🎯 Visão Geral

Os alertas são gerados **automaticamente** por um **job agendado** que roda no servidor Node.js. O sistema verifica viagens ativas periodicamente e detecta situações anômalas.

---

## ⚙️ Onde Está o Código?

### 1. **Job Agendado (Servidor)**
📁 **Arquivo:** `backend/server.js`  
📍 **Função:** `iniciarJobAlertas()`  
⏰ **Frequência:** A cada **5 minutos** (configurável)

```javascript
// Linha ~138 do server.js
function iniciarJobAlertas() {
  const INTERVALO_MINUTOS = 5; // Verifica a cada 5 minutos
  // ...
}
```

### 2. **Serviço de Verificação**
📁 **Arquivo:** `backend/services/alert-service.js`  
📍 **Função Principal:** `verificarAlertas(idViagem)`

### 3. **Controller (API)**
📁 **Arquivo:** `backend/controllers/alert.controller.js`  
📍 **Endpoint:** `POST /api/alertas/verificar/:idviagem` (verificação manual)

---

## 🔄 Como Funciona o Processo?

### Passo 1: Job Agendado Inicia
```
Servidor inicia → iniciarJobAlertas() → setInterval(5 minutos)
```

### Passo 2: Buscar Viagens Ativas
O sistema busca viagens com status:
- "Em Andamento"
- "Confirmada"

### Passo 3: Para Cada Viagem, Verificar 5 Tipos de Alertas

#### ✅ **1. PARADA PROLONGADA** (`verificarParadaProlongada`)
**Regra:**
- Motorista parado há **mais de 30 minutos**
- Velocidade < 5 km/h nas últimas 3 posições GPS
- Verifica últimas posições das últimas 60 minutos

**Prioridade:**
- `high` se parado > 60 minutos
- `medium` se parado entre 30-60 minutos

**Dados Salvos:**
```json
{
  "minutosParado": 45,
  "velocidadeMedia": 2.5
}
```

---

#### ✅ **2. ATRASO NO ETA** (`verificarAtraso`)
**Regra:**
- Calcula ETA dinâmico usando **OSRM** (Open Source Routing Machine)
- Compara ETA estimado com prazo de entrega (`DTPREVFINAL`)
- Se ETA > prazo OU já passou do prazo → **ALERTA**

**Prioridade:**
- `high` se atraso > 120 minutos
- `medium` se atraso ≤ 120 minutos

**Dados Salvos:**
```json
{
  "minutosAtraso": 125,
  "prazoEntrega": "2025-01-18T14:00:00",
  "etaMinutos": 180,
  "usandoETADinamico": true
}
```

---

#### ✅ **3. ETA PREVENTIVO** (`verificarETAPrazo`)
**Regra:**
- Alerta **preventivo** quando ETA estimado > prazo
- Mas ainda **não passou** do prazo (antes do vencimento)
- Avisa com antecedência

**Prioridade:**
- `high` se > 60 minutos além do prazo
- `medium` se ≤ 60 minutos além do prazo

---

#### ✅ **4. MOTORISTA OFFLINE** (`verificarOffline`)
**Regra:**
- Sem atualização GPS há **mais de 90 minutos**
- Viagem deve estar em andamento/confirmada

**Prioridade:**
- `high` se offline > 180 minutos
- `medium` se offline entre 90-180 minutos

**Dados Salvos:**
```json
{
  "minutosOffline": 95,
  "ultimaPosicao": "2025-01-18T13:45:00"
}
```

---

#### ✅ **5. DESVIO DE ROTA** (`verificarDesvioRota`)
**Regra:**
- Posição atual está **mais de 500m** fora da rota planejada
- Compara com pontos do roteiro (`ROTEIROPONTOS`)
- Ou calcula distância até linha origem-destino

**Prioridade:**
- `high` se desvio > 2000m
- `medium` se desvio entre 500-2000m

**Dados Salvos:**
```json
{
  "distanciaMetros": 850,
  "posicaoAtual": {
    "lat": -23.5,
    "lon": -46.6
  }
}
```

---

## 📊 Fluxo Completo

```
┌─────────────────────────────────────┐
│  Job Agendado (a cada 5 minutos)   │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│  Buscar Viagens Ativas              │
│  (Status: Em Andamento/Confirmada)  │
└──────────────┬──────────────────────┘
               │
               ▼
    ┌──────────┴──────────┐
    │                     │
    ▼                     ▼
┌─────────┐        ┌─────────┐
│ Viagem 1│        │ Viagem 2│
└────┬────┘        └────┬────┘
     │                  │
     ▼                  ▼
┌─────────────────────────────┐
│ verificarAlertas(idViagem)   │
└──────┬───────────────────────┘
       │
       ├─► Verificar PARADA
       ├─► Verificar ATRASO
       ├─► Verificar ETA PRAZO
       ├─► Verificar OFFLINE
       └─► Verificar DESVIO
       │
       ▼
┌─────────────────────────────┐
│ Salvar Alertas no Banco     │
│ (se não existir alerta ativo)│
└──────┬──────────────────────┘
       │
       ▼
┌─────────────────────────────┐
│ Emitir Evento WebSocket     │
│ (atualizar interface)       │
└─────────────────────────────┘
```

---

## 🧪 Como Testar a Geração de Alertas?

### Opção 1: Aguardar o Job Automático
- O job roda **a cada 5 minutos**
- Verifique os logs do servidor:
  ```
  🔄 Job de alertas iniciado (verificação a cada 5 minutos)
  🔍 Verificando alertas para X viagem(ns) ativa(s)...
  ⚠️  Y alerta(s) encontrado(s)
  ```

### Opção 2: Verificação Manual via API
**Endpoint:** `POST /api/alertas/verificar/:idviagem`

**Exemplo:**
```bash
curl -X POST http://localhost:3000/api/alertas/verificar/83173 \
  -H "Authorization: Bearer SEU_TOKEN"
```

**Resposta:**
```json
{
  "success": true,
  "alertasEncontrados": 2,
  "alertas": [
    {
      "type": "atraso",
      "message": "Viagem atrasada em 125 minutos",
      "severity": "high"
    },
    {
      "type": "parada",
      "message": "Motorista parado há 45 minutos",
      "severity": "medium"
    }
  ]
}
```

### Opção 3: Testar com Dados Reais

**Pré-requisitos:**
1. Viagem ativa (status "Em Andamento" ou "Confirmada")
2. Dados de rastreamento GPS (`VIAGEMRASTREAMENTO`)
3. Roteiro com coordenadas (`ROTEIROPONTOS`)
4. Prazo de entrega definido (`DTPREVFINAL`)

**Cenários de Teste:**

#### Teste 1: Parada Prolongada
1. Insira posições GPS com velocidade < 5 km/h
2. Aguarde 30+ minutos
3. Execute verificação manual ou aguarde job

#### Teste 2: Atraso
1. Configure `DTPREVFINAL` para um horário próximo
2. Insira posição GPS distante do destino
3. Execute verificação

#### Teste 3: Offline
1. Não insira posições GPS por 90+ minutos
2. Execute verificação

#### Teste 4: Desvio
1. Insira posição GPS a mais de 500m da rota
2. Execute verificação

---

## ⚙️ Configurações

### Alterar Intervalo do Job
📁 **Arquivo:** `backend/server.js`  
📍 **Linha ~139:**
```javascript
const INTERVALO_MINUTOS = 5; // Altere aqui (em minutos)
```

### Alterar Regras de Detecção
📁 **Arquivo:** `backend/services/alert-service.js`

**Parada Prolongada:**
- Linha ~96: `@paradaMinutos INT = 30` (minutos)
- Linha ~114: `VELOCIDADE < 5` (km/h)

**Offline:**
- Linha ~525: `data.minutosOffline >= 90` (minutos)

**Desvio:**
- Linha ~683: `distanciaMinima > 500` (metros)

---

## 📝 Logs e Monitoramento

### Logs do Servidor
O servidor registra:
- ✅ Início do job
- 🔍 Viagens verificadas
- ⚠️ Alertas encontrados
- ❌ Erros

**Exemplo de log:**
```
🔄 Job de alertas iniciado (verificação a cada 5 minutos)
🔍 Verificando alertas para 3 viagem(ns) ativa(s)...
⚠️  2 alerta(s) encontrado(s) em 1 viagem(ns)
```

### Verificar no Banco de Dados
```sql
-- Ver alertas gerados recentemente
SELECT TOP 10
  ID,
  IDVIAGEM,
  TYPE,
  MESSAGE,
  SEVERITY,
  STATUS,
  CREATED_AT
FROM [dbo].[ALERTS]
ORDER BY CREATED_AT DESC
```

---

## 🚨 Importante

1. **Não Duplica Alertas:** O sistema verifica se já existe alerta ativo do mesmo tipo antes de criar novo
2. **Apenas Viagens Ativas:** Só verifica viagens com status "Em Andamento" ou "Confirmada"
3. **Depende de Dados GPS:** Precisa de dados em `VIAGEMRASTREAMENTO` para funcionar
4. **ETA Dinâmico:** Usa API externa (OSRM) - requer internet

---

## 📞 Suporte

Para dúvidas ou problemas:
- Verifique os logs do servidor
- Confirme que há viagens ativas
- Verifique se há dados de rastreamento GPS
- Teste manualmente via API
