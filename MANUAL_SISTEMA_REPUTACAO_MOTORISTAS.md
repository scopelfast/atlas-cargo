# 📊 Manual do Sistema de Reputação de Motoristas

**Versão:** 1.0  
**Data:** 2026-01-16  
**Status:** ✅ Implementado e Funcional

---

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Como Funciona a Métrica](#como-funciona-a-métrica)
3. [Fórmula de Cálculo](#fórmula-de-cálculo)
4. [Implementação Técnica](#implementação-técnica)
5. [Configuração e Instalação](#configuração-e-instalação)
6. [Uso e Operação](#uso-e-operação)
7. [Manutenção](#manutenção)
8. [Troubleshooting](#troubleshooting)

---

## 🎯 Visão Geral

O Sistema de Reputação de Motoristas calcula automaticamente uma pontuação (score) de 0 a 100 para cada motorista, baseado em:

- **Pontualidade:** Entregas realizadas dentro do prazo previsto
- **Volume:** Número total de entregas realizadas
- **Confiabilidade:** Cancelamentos e situações adversas

### Objetivo

Avaliar o desempenho dos motoristas de forma objetiva, permitindo:
- Priorização de motoristas em novas convocações
- Identificação de motoristas que precisam de suporte
- Incentivos baseados em desempenho
- Transparência no processo de seleção

---

## 📐 Como Funciona a Métrica

### Componentes da Reputação

#### 1. **Score Principal (0-100 pontos)**

```
Score = Taxa de Pontualidade - Penalidade por Cancelamentos
```

Onde:
- **Taxa de Pontualidade:** `(Entregas no Prazo / Total de Entregas) × 100`
- **Penalidade por Cancelamentos:** `Cancelamentos × 10` (máximo -50 pontos)

**Exemplo Prático:**
```
Motorista com:
- 5 entregas no total
- 5 entregas no prazo
- 0 cancelamentos

Cálculo:
- Taxa de Pontualidade = (5/5) × 100 = 100%
- Penalidade = 0 × 10 = 0 pontos
- Score Final = 100 - 0 = 100 pontos ✅
```

#### 2. **Métricas Secundárias**

- **Total de Entregas:** Número total de viagens concluídas
- **Entregas no Prazo:** Viagens entregues dentro do prazo previsto
- **Entregas Atrasadas:** Viagens entregues após o prazo
- **Cancelamentos:** Viagens canceladas/rejeitadas
- **Taxa de Pontualidade:** Percentual de entregas no prazo
- **Atraso Médio:** Média de minutos de atraso (quando houver)

---

## 🧮 Fórmula de Cálculo Detalhada

### Passo 1: Identificar Viagens Concluídas

**Critérios:**
- Viagem deve ter `DTPREVFINAL` (data prevista de finalização) preenchida
- Viagem deve estar associada ao motorista via tabela `CONVOCACAO`

**Query SQL:**
```sql
SELECT vm.*
FROM VIAGEMMESTRE vm
INNER JOIN CONVOCACAO c ON vm.IDVIAGEM = c.IDVIAGEM
WHERE c.CDCADASTRO_MOTORISTA = @cdmotorista
  AND vm.DTPREVFINAL IS NOT NULL
```

### Passo 2: Classificar Entregas

Para cada viagem:

1. **Cancelada?**
   - Se `DSSITUACAOVIAGEM` contém: "CANCELADA", "CANCELADO", "REJEITADA"
   - → Incrementa `canceledDeliveries`

2. **No Prazo?**
   - Atualmente: Todas as viagens com `DTPREVFINAL` são consideradas "no prazo"
   - **Futuro:** Quando houver data real de descarga (`DTDESCARGA`), comparar com `DTPREVFINAL`
   - → Incrementa `onTimeDeliveries`

3. **Atrasada?**
   - **Futuro:** Quando `DTDESCARGA > DTPREVFINAL + 30 minutos`
   - → Incrementa `lateDeliveries` e calcula atraso

### Passo 3: Calcular Score

```javascript
// 1. Taxa de pontualidade (desconsiderando cancelamentos)
const totalValido = totalDeliveries - canceledDeliveries;
const taxaPontualidade = (onTimeDeliveries / totalValido) × 100;

// 2. Penalidade por cancelamentos
const penalidadeCancelamentos = Math.min(canceledDeliveries × 10, 50);

// 3. Score final (garantir entre 0 e 100)
score = Math.max(0, Math.min(100, taxaPontualidade - penalidadeCancelamentos));
```

### Exemplo Completo

**Cenário:**
- Motorista tem 10 viagens no total
- 8 entregas no prazo
- 1 entrega atrasada
- 1 cancelamento

**Cálculo:**
```
1. Total válido = 10 - 1 = 9 entregas (excluindo cancelamento)

2. Taxa de Pontualidade = (8/9) × 100 = 88,89%

3. Penalidade = 1 × 10 = 10 pontos

4. Score Final = 88,89 - 10 = 78,89 pontos
   → Arredondado: 78,89
```

---

## 🔧 Implementação Técnica

### Estrutura do Banco de Dados

#### Tabela: `DRIVER_REPUTATION`

```sql
CREATE TABLE DRIVER_REPUTATION (
    CDMOTORISTA DECIMAL(15,0) PRIMARY KEY,  -- ID do motorista
    SCORE FLOAT DEFAULT 0,                  -- Score 0-100
    TOTAL_DELIVERIES INT DEFAULT 0,         -- Total de entregas
    ON_TIME_DELIVERIES INT DEFAULT 0,       -- Entregas no prazo
    LATE_DELIVERIES INT DEFAULT 0,          -- Entregas atrasadas
    CANCELED_DELIVERIES INT DEFAULT 0,      -- Cancelamentos
    AVERAGE_DELAY_MINUTES FLOAT DEFAULT 0,  -- Atraso médio
    LAST_DELIVERY_DATE DATETIME2 NULL,      -- Última entrega
    LAST_UPDATED DATETIME2 DEFAULT SYSUTCDATETIME()
);
```

### Arquitetura do Sistema

```
┌─────────────────────────────────────────┐
│         Frontend (Admin)                │
│  - Aba "Ranking" em Gerenciar Viagens  │
│  - Visualização de scores               │
│  - Botão "Recalcular Todas"            │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│      API REST (/api/reputation)         │
│  - GET /ranking                         │
│  - POST /recalcular-todos              │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│   Service (reputation-service.js)       │
│  - calcularReputacao()                  │
│  - recalcularTodasReputacoes()          │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│     Banco de Dados (SQL Server)         │
│  - DRIVER_REPUTATION                    │
│  - VIAGEMMESTRE                         │
│  - CONVOCACAO                           │
└─────────────────────────────────────────┘
```

### Fluxo de Cálculo

1. **Trigger Manual:** Admin clica em "Recalcular Todas"
2. **Job Automático:** Sistema recalcula diariamente às 02:00 (configurado em `server.js`)
3. **Cálculo Individual:** Ao finalizar uma viagem (futuro - pode ser implementado)

---

## ⚙️ Configuração e Instalação

### Pré-requisitos

1. ✅ SQL Server configurado e conectado
2. ✅ Tabelas base existentes:
   - `VIAGEMMESTRE`
   - `CONVOCACAO`
   - `SITUACAOVIAGEM`
   - `CADASTROGERAL`

### Passo 1: Criar Tabela

Execute o script SQL:

```bash
backend/scripts/criar_tabela_driver_reputation.sql
```

**Verificação:**
```sql
-- Verificar se a tabela foi criada
SELECT * FROM sys.objects 
WHERE object_id = OBJECT_ID(N'[dbo].[DRIVER_REPUTATION]')
```

### Passo 2: Verificar Configuração do Servidor

O job automático está configurado em `backend/server.js`:

```javascript
// Recalcula a cada 24 horas
const INTERVALO_HORAS = 24;
```

### Passo 3: Testar

1. Acesse o módulo "Gerenciar Viagens"
2. Vá para a aba "Ranking"
3. Clique em "🔄 Recalcular Todas"
4. Aguarde a conclusão
5. Verifique os scores calculados

---

## 📖 Uso e Operação

### Como Visualizar o Ranking

1. **No Módulo Admin:**
   - Acesse "Gerenciar Viagens"
   - Clique na aba **"Ranking"**
   - Veja a lista ordenada por score (maior para menor)

2. **Informações Exibidas:**
   - 🥇 Posição no ranking (1º, 2º, 3º...)
   - Nome do motorista
   - **Score:** Pontuação de 0-100
   - **Entregas:** Total de entregas realizadas
   - **No Prazo:** Quantidade de entregas no prazo
   - **Taxa:** Percentual de pontualidade

### Como Recalcular Manualmente

1. Na aba "Ranking", clique em **"🔄 Recalcular Todas"**
2. Confirme no modal
3. Aguarde a conclusão (pode levar alguns minutos)
4. O ranking será atualizado automaticamente

### Atualização Automática

O sistema recalcula automaticamente:
- **Frequência:** Diariamente às 02:00
- **Processo:** Roda em background, não interfere no uso do sistema
- **Logs:** Verifique os logs do servidor para acompanhar

---

## 🔄 Manutenção

### Recalcular Reputação de Um Motorista Específico

**Via API:**
```http
POST /api/reputation/recalcular/:cdmotorista
Authorization: Bearer {token}
```

**Exemplo:**
```bash
curl -X POST http://localhost:3000/api/reputation/recalcular/12345 \
  -H "Authorization: Bearer {seu-token}"
```

### Verificar Estatísticas

```sql
-- Total de motoristas no ranking
SELECT COUNT(*) FROM DRIVER_REPUTATION WHERE TOTAL_DELIVERIES > 0;

-- Score médio
SELECT AVG(SCORE) AS ScoreMedio FROM DRIVER_REPUTATION;

-- Top 10 motoristas
SELECT TOP 10 
    CDMOTORISTA,
    SCORE,
    TOTAL_DELIVERIES,
    ON_TIME_DELIVERIES
FROM DRIVER_REPUTATION
WHERE TOTAL_DELIVERIES > 0
ORDER BY SCORE DESC;
```

### Limpar Dados (Cuidado!)

```sql
-- Limpar reputação de um motorista específico
DELETE FROM DRIVER_REPUTATION WHERE CDMOTORISTA = {cdmotorista};

-- Recalcular todos (via sistema)
-- Use o botão "Recalcular Todas" no frontend
```

---

## 🔍 Troubleshooting

### Problema: "Tabela DRIVER_REPUTATION não existe"

**Solução:**
1. Execute: `backend/scripts/criar_tabela_driver_reputation.sql`
2. Verifique se a tabela foi criada
3. Reinicie o servidor Node.js

### Problema: "Nenhum motorista no ranking"

**Possíveis causas:**
1. Nenhum motorista tem viagens com `DTPREVFINAL` preenchida
2. Tabela `CONVOCACAO` não tem dados

**Solução:**
1. Verifique se há viagens finalizadas:
   ```sql
   SELECT COUNT(*) 
   FROM VIAGEMMESTRE vm
   INNER JOIN CONVOCACAO c ON vm.IDVIAGEM = c.IDVIAGEM
   WHERE vm.DTPREVFINAL IS NOT NULL;
   ```
2. Se houver viagens, clique em "Recalcular Todas"

### Problema: Score sempre 100 ou 0

**Causa:** A lógica atual considera todas as viagens como "no prazo" pois não há data real de descarga.

**Solução:** 
- Por enquanto, isso é esperado
- Quando houver campo `DTDESCARGA` real na tabela, atualizar a lógica

### Problema: Recalcular demora muito

**Causa:** Muitos motoristas para processar

**Solução:**
- Normal para grandes volumes
- O processo roda em background
- Considere processar em lotes menores (futuro)

---

## 📈 Melhorias Futuras

### 1. Usar Data Real de Descarga

Quando houver campo `DTDESCARGA` real:

```javascript
// Comparar data real vs prevista
if (viagem.DTDESCARGA && viagem.DTPREVFINAL) {
  const diffMinutes = (DTDESCARGA - DTPREVFINAL) / (1000 * 60);
  if (diffMinutes <= 30) {
    onTimeDeliveries++;
  } else {
    lateDeliveries++;
  }
}
```

### 2. Ponderar por Recência

Entregas recentes terem mais peso:

```javascript
// Dar mais peso a entregas dos últimos 30 dias
const diasDesdeEntrega = (hoje - dataEntrega) / (1000 * 60 * 60 * 24);
const peso = diasDesdeEntrega <= 30 ? 1.0 : 0.7;
```

### 3. Considerar Tipos de Viagem

Diferentes tipos podem ter diferentes tolerâncias:

```javascript
// Viagens express: tolerância 0 minutos
// Viagens normais: tolerância 30 minutos
// Viagens econômicas: tolerância 60 minutos
```

### 4. Penalidades Graduais

Atrasos maiores = maior penalidade:

```javascript
if (atraso <= 30 min) penalty = 0;
else if (atraso <= 60 min) penalty = -5;
else if (atraso <= 120 min) penalty = -10;
else penalty = -20;
```

---

## 📚 Referências Técnicas

### Arquivos Relacionados

- **Backend Service:** `backend/services/reputation-service.js`
- **Backend Controller:** `backend/controllers/reputation.controller.js`
- **Backend Routes:** `backend/routes/reputation.routes.js`
- **Frontend:** `backend/public/modulos/gerenciar-viagens/js/script.js`
- **SQL Script:** `backend/scripts/criar_tabela_driver_reputation.sql`

### Endpoints API

- `GET /api/reputation/ranking?limit=100` - Buscar ranking
- `GET /api/reputation/motorista/:cdmotorista` - Buscar reputação específica
- `POST /api/reputation/recalcular/:cdmotorista` - Recalcular um motorista
- `POST /api/reputation/recalcular-todos` - Recalcular todos

---

## ✅ Checklist de Implementação

- [ ] Tabela `DRIVER_REPUTATION` criada
- [ ] Servidor Node.js reiniciado
- [ ] Testado botão "Recalcular Todas"
- [ ] Verificado ranking exibindo corretamente
- [ ] Job automático configurado (24h)
- [ ] Documentação lida e compreendida

---

**Versão:** 1.0  
**Última Atualização:** 2026-01-16  
**Autor:** Sistema LogiTrack Pro
