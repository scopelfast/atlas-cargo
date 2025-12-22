# 📋 Scripts SQL - Ajustes para Módulos Separados

**Data:** 2025-01-15  
**Status:** ✅ Pronto para execução

---

## 📁 Arquivos Criados

### 1. `ajustar_tabela_alerts_para_modulo.sql`
**O que faz:**
- Adiciona campos de tratamento à tabela `ALERTS`:
  - `STATUS` (Pendente, Em Análise, Tratado, Cancelado)
  - `ID_USUARIO_LEU` (quem leu)
  - `DH_LEITURA` (quando leu)
  - `ID_USUARIO_TRATOU` (quem tratou)
  - `DH_TRATAMENTO` (quando tratou)
  - `OBSERVACOES` (texto livre)
  - `PRIORIDADE` (Baixa, Normal, Alta, Urgente)
- Migra dados existentes de `RESOLVED_BY` e `RESOLVED_AT`
- Mapeia `SEVERITY` para `PRIORIDADE`
- Cria tabela `ALERT_HISTORY` (log de ações)
- Cria índices para performance

**Segurança:**
- ✅ Não remove dados existentes
- ✅ Pode ser executado múltiplas vezes
- ✅ Verifica se campos já existem antes de criar
- ✅ Migra dados automaticamente

### 2. `ajustar_tabela_messages_para_modulo.sql`
**O que faz:**
- Adiciona campos à tabela `MESSAGES`:
  - `ID_CONVERSA` (agrupar mensagens)
  - `TIPO` (TEXTO, IMAGEM, ARQUIVO)
  - `DH_LEITURA` (timestamp de leitura)
- Cria tabela `CONVERSAS` (agrupar mensagens)
- Cria foreign key e índices

**Segurança:**
- ✅ Não remove dados existentes
- ✅ Pode ser executado múltiplas vezes
- ✅ Campos novos são opcionais (NULL)

### 3. `ajustar_tabela_sos_alerts_para_modulo.sql`
**O que faz:**
- Adiciona campos de leitura à tabela `SOS_ALERTS`:
  - `ID_USUARIO_LEU` (quem leu)
  - `DH_LEITURA` (quando leu)
  - `TEMPO_RESPOSTA` (em minutos)
- Calcula tempo de resposta para registros já resolvidos
- Cria tabela `SOS_HISTORY` (log de ações)
- Cria índices para performance

**Segurança:**
- ✅ Não remove dados existentes
- ✅ Pode ser executado múltiplas vezes
- ✅ Calcula dados automaticamente

### 4. `criar_tabela_ranking_data.sql`
**O que faz:**
- Cria tabela `RANKING_DATA` (nova)
- Campos para cache de rankings:
  - Pontuação geral
  - Entregas no prazo/total
  - Avaliações média
  - Tempo médio de resposta
  - Taxa de aceitação
  - Período de cálculo
- Cria índices para performance

**Segurança:**
- ✅ Tabela nova (não afeta existentes)
- ✅ Pode ser executado múltiplas vezes

### 5. `EXECUTAR_TODOS_AJUSTES_MODULOS.sql`
**O que faz:**
- Script master que executa todos os scripts acima em sequência
- Facilita a execução de uma vez só

---

## 🚀 Como Executar

### Opção 1: Executar Script Master (Recomendado)

```sql
-- No SQL Server Management Studio (SSMS)
USE [divulgacarga]
GO

-- Execute o script master
:r backend/scripts/EXECUTAR_TODOS_AJUSTES_MODULOS.sql
```

**Nota:** O comando `:r` pode não funcionar em todos os clientes SQL. Se não funcionar, use a Opção 2.

### Opção 2: Executar Scripts Individualmente

```sql
USE [divulgacarga]
GO

-- 1. Ajustar ALERTS
-- Copie e cole o conteúdo de: ajustar_tabela_alerts_para_modulo.sql

-- 2. Ajustar MESSAGES
-- Copie e cole o conteúdo de: ajustar_tabela_messages_para_modulo.sql

-- 3. Ajustar SOS_ALERTS
-- Copie e cole o conteúdo de: ajustar_tabela_sos_alerts_para_modulo.sql

-- 4. Criar RANKING_DATA
-- Copie e cole o conteúdo de: criar_tabela_ranking_data.sql
```

### Opção 3: Via Linha de Comando (sqlcmd)

```bash
sqlcmd -S servidor -d divulgacarga -i backend/scripts/ajustar_tabela_alerts_para_modulo.sql
sqlcmd -S servidor -d divulgacarga -i backend/scripts/ajustar_tabela_messages_para_modulo.sql
sqlcmd -S servidor -d divulgacarga -i backend/scripts/ajustar_tabela_sos_alerts_para_modulo.sql
sqlcmd -S servidor -d divulgacarga -i backend/scripts/criar_tabela_ranking_data.sql
```

---

## ✅ Verificação Pós-Execução

### Verificar se campos foram adicionados:

```sql
-- Verificar ALERTS
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'ALERTS'
ORDER BY ORDINAL_POSITION;

-- Verificar MESSAGES
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'MESSAGES'
ORDER BY ORDINAL_POSITION;

-- Verificar SOS_ALERTS
SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'SOS_ALERTS'
ORDER BY ORDINAL_POSITION;
```

### Verificar se tabelas novas foram criadas:

```sql
-- Verificar tabelas novas
SELECT TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME IN ('ALERT_HISTORY', 'CONVERSAS', 'SOS_HISTORY', 'RANKING_DATA')
ORDER BY TABLE_NAME;
```

### Verificar dados migrados:

```sql
-- Verificar migração de STATUS em ALERTS
SELECT STATUS, COUNT(*) as Total
FROM ALERTS
GROUP BY STATUS;

-- Verificar migração de PRIORIDADE em ALERTS
SELECT PRIORIDADE, COUNT(*) as Total
FROM ALERTS
GROUP BY PRIORIDADE;
```

---

## ⚠️ Importante

1. **Backup:** Sempre faça backup antes de executar scripts em produção
2. **Teste:** Execute primeiro em ambiente de teste
3. **Idempotente:** Os scripts podem ser executados múltiplas vezes sem problemas
4. **Dados:** Nenhum dado existente será removido ou alterado (apenas adicionados campos)

---

## 📊 Estrutura Final das Tabelas

### ALERTS (ajustada)
```
- ID
- IDVIAGEM
- CDMOTORISTA
- TYPE
- MESSAGE
- SEVERITY (mantido para compatibilidade)
- PRIORIDADE (novo)
- STATUS (novo)
- DETAILS
- CREATED_AT
- RESOLVED (mantido para compatibilidade)
- RESOLVED_AT (mantido para compatibilidade)
- RESOLVED_BY (mantido para compatibilidade)
- ID_USUARIO_LEU (novo)
- DH_LEITURA (novo)
- ID_USUARIO_TRATOU (novo)
- DH_TRATAMENTO (novo)
- OBSERVACOES (novo)
```

### MESSAGES (ajustada)
```
- ID
- IDVIAGEM
- ID_CONVERSA (novo)
- SENDER_TYPE
- SENDER_ID
- SENDER_NAME
- CONTENT
- TIPO (novo)
- READ_BY_SENDER
- READ_BY_RECEIVER
- DH_LEITURA (novo)
- CREATED_AT
- SYNCED
```

### SOS_ALERTS (ajustada)
```
- ID
- CDMOTORISTA
- CDVIAGEM
- LOCATION
- LATITUDE
- LONGITUDE
- STATUS
- PRIORITY
- MESSAGE
- CREATED_AT
- RESOLVED_AT
- RESOLVED_BY
- RESOLUTION_NOTES
- ID_USUARIO_LEU (novo)
- DH_LEITURA (novo)
- TEMPO_RESPOSTA (novo)
- SYNCED
```

### Tabelas Novas

**ALERT_HISTORY:**
- ID, ID_ALERT, ID_USUARIO, ACAO, STATUS_ANTERIOR, STATUS_NOVO, OBSERVACOES, DH_ACAO

**CONVERSAS:**
- ID, TIPO, ID_MOTORISTA, ID_VIAGEM, ID_CRIADOR, ULTIMA_MENSAGEM, DH_ULTIMA_MENSAGEM, MENSAGENS_NAO_LIDAS, DH_CRIACAO

**SOS_HISTORY:**
- ID, ID_SOS, ID_USUARIO, ACAO, STATUS_ANTERIOR, STATUS_NOVO, OBSERVACOES, DH_ACAO

**RANKING_DATA:**
- ID, ID_MOTORISTA, PONTUACAO_GERAL, ENTREGAS_NO_PRAZO, ENTREGAS_TOTAL, AVALIACOES_MEDIA, TEMPO_MEDIO_RESPOSTA, TAXA_ACEITACAO, PERIODO_INICIO, PERIODO_FIM, DH_CALCULO

---

## 🎯 Próximos Passos

Após executar os scripts:

1. ✅ Verificar se todas as alterações foram aplicadas
2. ✅ Testar queries nas novas tabelas
3. ✅ Iniciar desenvolvimento do backend (controllers)
4. ✅ Criar módulos frontend separados

---

**Criado em:** 2025-01-15  
**Versão:** 1.0
