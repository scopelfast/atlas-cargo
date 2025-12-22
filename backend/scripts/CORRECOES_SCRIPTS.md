# 🔧 Correções Aplicadas nos Scripts SQL

**Data:** 2025-01-15  
**Problema:** Scripts tentavam usar colunas antes de criá-las

---

## ✅ Correções Aplicadas

### 1. Script: `ajustar_tabela_alerts_para_modulo.sql`

**Problemas corrigidos:**
- ✅ UPDATE de STATUS movido para bloco separado (após GO)
- ✅ UPDATE de ID_USUARIO_TRATOU movido para bloco separado
- ✅ UPDATE de DH_TRATAMENTO movido para bloco separado
- ✅ UPDATE de PRIORIDADE movido para bloco separado
- ✅ Removido ELSE duplicado
- ✅ Banco de dados atualizado para `DIVULGACARGA_PRD`

**Estrutura corrigida:**
```sql
-- 1. Criar coluna
IF NOT EXISTS (...) BEGIN
    ALTER TABLE ADD COLUMN;
END
GO

-- 2. Atualizar dados (em batch separado)
IF EXISTS (coluna criada) BEGIN
    UPDATE ...;
END
GO
```

### 2. Script: `ajustar_tabela_messages_para_modulo.sql`

**Problemas corrigidos:**
- ✅ UPDATE de TIPO já estava correto (após GO)
- ✅ Banco de dados atualizado para `DIVULGACARGA_PRD`

### 3. Script: `ajustar_tabela_sos_alerts_para_modulo.sql`

**Problemas corrigidos:**
- ✅ UPDATE de TEMPO_RESPOSTA movido para bloco separado
- ✅ Removido ELSE duplicado
- ✅ Banco de dados atualizado para `DIVULGACARGA_PRD`

### 4. Script: `criar_tabela_ranking_data.sql`

**Problemas corrigidos:**
- ✅ Banco de dados atualizado para `DIVULGACARGA_PRD`

---

## 🚀 Como Executar Agora

### Opção 1: Executar Scripts Individualmente (Recomendado)

Execute cada script separadamente no SQL Server Management Studio:

```sql
USE [DIVULGACARGA_PRD]
GO

-- 1. Execute: ajustar_tabela_alerts_para_modulo.sql
-- 2. Execute: ajustar_tabela_messages_para_modulo.sql
-- 3. Execute: ajustar_tabela_sos_alerts_para_modulo.sql
-- 4. Execute: criar_tabela_ranking_data.sql
```

### Opção 2: Executar Script Master

```sql
USE [DIVULGACARGA_PRD]
GO

-- Execute: EXECUTAR_TODOS_AJUSTES_MODULOS.sql
```

**Nota:** O script master pode ter problemas com o comando `:r` em alguns clientes SQL. Se der erro, use a Opção 1.

---

## ⚠️ Importante

1. **Execute os scripts na ordem:**
   - 1º: ajustar_tabela_alerts_para_modulo.sql
   - 2º: ajustar_tabela_messages_para_modulo.sql
   - 3º: ajustar_tabela_sos_alerts_para_modulo.sql
   - 4º: criar_tabela_ranking_data.sql

2. **Cada script pode ser executado múltiplas vezes** (idempotente)

3. **Nenhum dado será perdido** - apenas campos novos serão adicionados

---

## ✅ Verificação

Após executar, verifique se não há mais erros:

```sql
-- Verificar se campos foram criados
SELECT COLUMN_NAME 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'ALERTS' 
  AND COLUMN_NAME IN ('STATUS', 'PRIORIDADE', 'ID_USUARIO_TRATOU', 'DH_TRATAMENTO');

SELECT COLUMN_NAME 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'MESSAGES' 
  AND COLUMN_NAME = 'TIPO';

SELECT COLUMN_NAME 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'SOS_ALERTS' 
  AND COLUMN_NAME = 'TEMPO_RESPOSTA';
```

---

**Status:** ✅ Scripts corrigidos e prontos para execução
