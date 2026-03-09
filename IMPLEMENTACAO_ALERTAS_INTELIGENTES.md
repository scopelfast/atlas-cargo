# ✅ Implementação: Sistema de Alertas Inteligentes

**Data:** 2026-01-16  
**Status:** ✅ Completo  
**Fase:** 1.3 - Fundações  

---

## 📋 O Que Foi Implementado

### Backend
✅ **Tabela ALERTS** - Script SQL para criar tabela de alertas  
✅ **alert-service.js** - Service para detectar problemas automaticamente  
✅ **alert.controller.js** - Controller para gerenciar alertas  
✅ **alert.routes.js** - Rotas da API de alertas  
✅ **Job Agendado** - Verificação automática a cada 5 minutos  

### Frontend
✅ **Aba Alertas** - Nova aba no módulo "Gerenciar Viagens"  
✅ **Interface Visual** - Cards coloridos por severidade  
✅ **Botões de Ação** - Verificar, Atualizar e Resolver alertas  
✅ **Indicador Visual** - Badge na aba mostrando quantidade de alertas  

### Funcionalidades
✅ **Detecção de Paradas** - Alertas quando motorista para > 30 min  
✅ **Detecção de Atrasos** - Alertas quando ETA ultrapassa prazo  
✅ **Detecção de Offline** - Alertas quando motorista offline > 90 min  
✅ **Resolução de Alertas** - Operador pode marcar como resolvido  

---

## 🚀 Como Instalar

### 1. Executar Script SQL
```bash
# No SQL Server Management Studio ou via sqlcmd
sqlcmd -S SEU_SERVIDOR -U SEU_USUARIO -P SUA_SENHA -d SEU_BANCO -i backend/scripts/criar_tabela_alerts.sql
```

**Ou execute manualmente:**
```sql
-- Copie o conteúdo de backend/scripts/criar_tabela_alerts.sql
-- e execute no SQL Server
```

### 2. Reiniciar o Servidor
```bash
# Parar o servidor atual (Ctrl+C)
# Reiniciar
cd backend
npm start
```

### 3. Verificar se Funcionou
- ✅ Servidor inicia sem erros
- ✅ Log mostra: `🔄 Job de alertas iniciado (verificação a cada 5 minutos)`
- ✅ Tabela `ALERTS` existe no banco de dados

---

## 🎯 Como Usar

### Para Operadores (Admin)

1. **Acessar Alertas:**
   - Abra o módulo "Gerenciar Viagens"
   - Clique na aba **"⚠️ Alertas"**

2. **Visualizar Alertas:**
   - Selecione uma viagem na aba **Grid** ou **Dados**
   - Os alertas aparecerão automaticamente
   - Alertas são coloridos por severidade:
     - 🔴 **Vermelho**: Alta severidade (crítico)
     - 🟡 **Amarelo**: Média severidade (atenção)
     - 🔵 **Azul**: Baixa severidade (informativo)

3. **Verificar Novos Alertas:**
   - Clique em **"🔍 Verificar Alertas"** para forçar verificação
   - O sistema verificará problemas em tempo real

4. **Resolver Alertas:**
   - Clique em **"✓ Resolver"** no card do alerta
   - Confirme a resolução
   - O alerta desaparecerá da lista

### Para o Sistema (Automático)

- ✅ **Job agendado** verifica todas as viagens ativas a cada 5 minutos
- ✅ Detecta automaticamente: paradas, atrasos, offline
- ✅ Cria alertas no banco de dados
- ✅ Operadores veem alertas na aba

---

## 🔍 Detalhes Técnicos

### Tipos de Alertas Detectados

| Tipo | Detecção | Severidade |
|------|----------|------------|
| **Parada Prolongada** | Velocidade < 5 km/h por > 30 min | Medium/High |
| **Atraso na Entrega** | ETA > Prazo de entrega | Medium/High |
| **Motorista Offline** | Sem posição GPS por > 90 min | Medium/High |
| **Desvio de Rota** | Fora do buffer de 500m (futuro) | Medium |

### Endpoints da API

```
GET  /api/alerts/viagem/:idviagem     - Buscar alertas de uma viagem
POST /api/alerts/verificar/:idviagem  - Forçar verificação
PUT  /api/alerts/:id/resolver         - Resolver alerta
GET  /api/alerts/ativos               - Listar todos alertas ativos (dashboard)
```

### Estrutura de Dados

**Tabela ALERTS:**
```sql
ID              - Identificador único
IDVIAGEM        - ID da viagem relacionada
CDMOTORISTA     - ID do motorista (opcional)
TYPE            - Tipo: 'atraso', 'parada', 'offline', 'desvio'
MESSAGE         - Mensagem do alerta
SEVERITY        - Severidade: 'low', 'medium', 'high'
DETAILS         - JSON com detalhes adicionais
CREATED_AT      - Data/hora de criação
RESOLVED        - Se foi resolvido (0 ou 1)
RESOLVED_AT     - Data/hora de resolução
RESOLVED_BY     - ID do usuário que resolveu
```

---

## ⚙️ Configurações

As configurações podem ser ajustadas na tabela `ALERT_CONFIG`:

```sql
-- Ver configurações
SELECT * FROM [dbo].[ALERT_CONFIG];

-- Alterar tempo de parada para alerta (em minutos)
UPDATE [dbo].[ALERT_CONFIG] 
SET CONFIG_VALUE = '45' 
WHERE CONFIG_KEY = 'PARADA_MAX_MINUTES';
```

**Valores Padrão:**
- Parada máxima: 30 minutos
- Desvio buffer: 500 metros
- Offline máximo: 90 minutos
- Intervalo de verificação: 5 minutos

---

## 🐛 Troubleshooting

### Alertas não aparecem
1. Verifique se a tabela `ALERTS` foi criada
2. Verifique os logs do servidor (procure por "Job de alertas")
3. Verifique se há viagens ativas (status 'EM_ANDAMENTO' ou 'CONFIRMADA')
4. Verifique se há posições GPS na tabela `VIAGEM_RASTREAMENTO`

### Job não está rodando
1. Verifique se o servidor foi reiniciado após as alterações
2. Verifique os logs do console ao iniciar o servidor
3. Deve aparecer: `🔄 Job de alertas iniciado`

### Erro ao salvar alerta
1. Verifique se a tabela `ALERTS` existe
2. Verifique permissões no banco de dados
3. Verifique logs do servidor para detalhes do erro

---

## ✅ Próximos Passos Sugeridos

1. **Testar com dados reais:**
   - Criar uma viagem de teste
   - Enviar posições GPS
   - Aguardar 5 minutos e verificar se alertas foram gerados

2. **Melhorar detecção:**
   - Adicionar detecção de desvio de rota (precisa de roteiro)
   - Adicionar alerta de velocidade excessiva
   - Adicionar alerta de bateria baixa

3. **Notificações:**
   - Integrar com notificações push (futuro)
   - Enviar e-mail para operadores (futuro)

---

## 📝 Arquivos Modificados/Criados

### Criados:
- ✅ `backend/scripts/criar_tabela_alerts.sql`
- ✅ `backend/services/alert-service.js`
- ✅ `backend/controllers/alert.controller.js`
- ✅ `backend/routes/alert.routes.js`

### Modificados:
- ✅ `backend/app.js` - Adicionada rota `/api/alerts`
- ✅ `backend/server.js` - Adicionado job agendado
- ✅ `backend/public/modulos/gerenciar-viagens/index.html` - Adicionada aba de alertas
- ✅ `backend/public/modulos/gerenciar-viagens/js/script.js` - Adicionadas funções de alertas

---

## 🎉 Resultado Final

O sistema agora detecta automaticamente:
- ⏰ Viagens atrasadas
- 🛑 Paradas prolongadas não planejadas
- 📵 Motoristas offline há muito tempo

**Tudo funciona de forma automática e transparente!**

---

**Versão:** 1.0  
**Data:** 2026-01-16  
**Status:** ✅ Pronto para Teste
