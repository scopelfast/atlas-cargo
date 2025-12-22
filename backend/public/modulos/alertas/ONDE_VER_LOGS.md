# 📋 Onde Ver os Logs do Sistema de Alertas

## 🎯 Logs do Servidor Node.js

Os logs aparecem no **console/terminal** onde você iniciou o servidor Node.js.

### Como Ver os Logs?

1. **Terminal onde o servidor está rodando**
   - Se iniciou com `node server.js` ou `npm start`
   - Os logs aparecem diretamente nesse terminal

2. **Se estiver rodando como serviço**
   - Verifique o arquivo de log configurado
   - Ou use: `pm2 logs` (se usar PM2)

### 📊 O que Procurar nos Logs?

#### ✅ Logs Normais (Sistema Funcionando)

```
🔄 Job de alertas iniciado (verificação a cada 5 minutos)
🔍 Verificando alertas para 3 viagem(ns) ativa(s)...
🔍 [Alertas] Verificando viagem 83173...
   ℹ️  Nenhum alerta detectado para viagem 83173
✅ Nenhum alerta novo encontrado em 3 viagem(ns) ativa(s)
```

#### ⚠️ Logs com Alertas Encontrados

```
🔄 Job de alertas iniciado (verificação a cada 5 minutos)
🔍 Verificando alertas para 2 viagem(ns) ativa(s)...
🔍 [Alertas] Verificando viagem 83173...
   ✅ Parada prolongada detectada
   ✅ Alerta PARADA salvo com sucesso
📋 [Viagem 83173] 1 de 1 alerta(s) salvo(s) no banco
⚠️  1 alerta(s) encontrado(s) em 2 viagem(ns)
```

#### ❌ Logs de Erro

```
❌ Erro ao verificar alertas: [mensagem de erro]
❌ Erro ao salvar alerta: [detalhes]
```

### 🔍 Diagnóstico Rápido

**Se não aparecer nenhum log:**
- Verifique se o servidor está rodando
- Verifique se o job foi iniciado (procure por "Job de alertas iniciado")

**Se aparecer "Nenhuma viagem ativa":**
- Não há viagens com status "Em Andamento" ou "Confirmada"
- Verifique no banco: `SELECT * FROM VIAGEMMESTRE WHERE FGSITVIAGEM = 'T'`

**Se aparecer "Nenhum alerta detectado":**
- As condições não foram atendidas (ex: não está parado há 30+ min)
- Verifique os dados de GPS na tabela `VIAGEMRASTREAMENTO`

---

## 🧪 Teste Manual

Para testar sem esperar 5 minutos:

**Via API:**
```bash
POST http://localhost:3000/api/alertas/verificar/83173
Headers: Authorization: Bearer SEU_TOKEN
```

**Via Interface:**
- Clique no botão "Atualizar" no módulo Alertas
- Isso força uma recarga, mas não força verificação de alertas

---

## 📝 Verificar no Banco de Dados

```sql
-- Ver últimas verificações (via timestamps dos alertas)
SELECT TOP 10
  ID,
  IDVIAGEM,
  TYPE,
  MESSAGE,
  STATUS,
  PRIORIDADE,
  CREATED_AT
FROM [dbo].[ALERTS]
ORDER BY CREATED_AT DESC

-- Verificar se há viagens ativas
SELECT COUNT(*) as total_viagens_ativas
FROM [dbo].[VIAGEMMESTRE] v
INNER JOIN [dbo].[SITUACAOVIAGEM] s ON v.CDSITUACAOVIAGEM = s.CDSITUACAOVIAGEM
WHERE (UPPER(s.DSSITUACAOVIAGEM) LIKE '%ANDAMENTO%' 
    OR UPPER(s.DSSITUACAOVIAGEM) LIKE '%CONFIRMADA%')
  AND v.FGACTIVE = 'A'
```

---

## 🚨 Problemas Comuns

### Job não está rodando
- Verifique se o servidor iniciou corretamente
- Procure por "Job de alertas iniciado" nos logs

### Nenhum alerta sendo gerado
1. Verifique se há viagens ativas
2. Verifique se há dados de GPS (`VIAGEMRASTREAMENTO`)
3. Verifique se as condições estão sendo atendidas (ex: parado há 30+ min)

### Erros ao salvar alertas
- Verifique se a tabela `ALERTS` tem os campos `STATUS` e `PRIORIDADE`
- Execute: `backend/scripts/ajustar_tabela_alerts_para_modulo.sql`
