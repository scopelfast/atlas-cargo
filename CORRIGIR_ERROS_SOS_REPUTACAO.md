# Como Corrigir Erros SOS e Reputação

## 🔍 Diagnóstico

Os erros 500 indicam que provavelmente as tabelas não existem no banco de dados.

## ✅ Solução Passo a Passo

### Passo 1: Verificar se as tabelas existem

Execute este script SQL no seu banco de dados:

```sql
-- Verificar SOS_ALERTS
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SOS_ALERTS]') AND type in (N'U'))
    PRINT '✅ SOS_ALERTS existe'
ELSE
    PRINT '❌ SOS_ALERTS NÃO existe - Execute criar_tabela_sos_alerts.sql'

-- Verificar DRIVER_REPUTATION
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[DRIVER_REPUTATION]') AND type in (N'U'))
    PRINT '✅ DRIVER_REPUTATION existe'
ELSE
    PRINT '❌ DRIVER_REPUTATION NÃO existe - Execute criar_tabela_driver_reputation.sql'
```

**Ou execute o script completo:**
- `backend/scripts/verificar_tabelas_sos_reputacao.sql`

---

### Passo 2: Criar as tabelas (se não existirem)

#### 2.1. Criar tabela SOS_ALERTS

Execute no SQL Server Management Studio:

**Arquivo:** `backend/scripts/criar_tabela_sos_alerts.sql`

Este script cria:
- Tabela `SOS_ALERTS`
- Índices para performance
- Foreign keys para `CADASTROGERAL` e `VIAGEMMESTRE`

---

#### 2.2. Criar tabela DRIVER_REPUTATION

Execute no SQL Server Management Studio:

**Arquivo:** `backend/scripts/criar_tabela_driver_reputation.sql`

Este script cria:
- Tabela `DRIVER_REPUTATION`
- Índices para performance
- Foreign key para `CADASTROGERAL`

---

### Passo 3: Verificar erros SQL

Se ainda houver erros após criar as tabelas, verifique:

#### 3.1. Verificar coluna RZSOCIAL

A coluna deve ser `RZSOCIAL` (não `RZSOCAL`):

```sql
SELECT COLUMN_NAME 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'CADASTROGERAL' 
  AND COLUMN_NAME LIKE '%SOCIAL%'
```

**Se a coluna for `RZSOCAL`, renomeie:**
```sql
EXEC sp_rename 'CADASTROGERAL.RZSOCAL', 'RZSOCIAL', 'COLUMN';
```

---

#### 3.2. Verificar se ROTEIRO tem IDROTEIRO

O JOIN precisa da coluna `IDROTEIRO` em `VIAGEMMESTRE`:

```sql
SELECT COLUMN_NAME 
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME = 'VIAGEMMESTRE' 
  AND COLUMN_NAME = 'IDROTEIRO'
```

---

### Passo 4: Reiniciar o servidor

Após criar as tabelas:

1. Pare o servidor Node.js (Ctrl+C)
2. Inicie novamente: `npm run dev`
3. Teste novamente as funcionalidades

---

## 📋 Scripts SQL Necessários

### Ordem de execução:

1. ✅ `criar_tabela_sos_alerts.sql` (se não existir)
2. ✅ `criar_tabela_driver_reputation.sql` (se não existir)
3. ✅ `verificar_tabelas_sos_reputacao.sql` (para validar)

---

## 🔧 Erros Comuns e Soluções

### Erro: "Invalid column name 'RZSOCAL'"
**Causa:** Coluna deveria ser `RZSOCIAL`
**Solução:** Verifique o nome correto da coluna e corrija nos controllers

### Erro: "Invalid object name 'SOS_ALERTS'"
**Causa:** Tabela não existe
**Solução:** Execute `criar_tabela_sos_alerts.sql`

### Erro: "Invalid object name 'DRIVER_REPUTATION'"
**Causa:** Tabela não existe
**Solução:** Execute `criar_tabela_driver_reputation.sql`

### Erro: Foreign key constraint
**Causa:** Tabelas referenciadas não existem ou têm estrutura diferente
**Solução:** Verifique se `CADASTROGERAL` e `VIAGEMMESTRE` existem

---

## ✅ Checklist Final

- [ ] Tabela `SOS_ALERTS` existe e tem estrutura correta
- [ ] Tabela `DRIVER_REPUTATION` existe e tem estrutura correta
- [ ] Coluna `RZSOCIAL` existe em `CADASTROGERAL` (não `RZSOCAL`)
- [ ] Coluna `IDROTEIRO` existe em `VIAGEMMESTRE`
- [ ] Servidor Node.js reiniciado após criar tabelas
- [ ] Testado endpoint `/api/sos/ativos` - deve retornar 200
- [ ] Testado endpoint `/api/reputation/recalcular-todos` - deve retornar 200

---

## 📞 Se ainda houver erros

Verifique os logs do servidor Node.js. Eles mostrarão o erro SQL específico que está acontecendo.
