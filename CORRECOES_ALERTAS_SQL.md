# 🔧 Correções Aplicadas - Sistema de Alertas

**Data:** 2026-01-16  
**Problema:** Erros SQL ao verificar alertas  

---

## ❌ Erros Encontrados

1. **Coluna `CDMOTORISTA` não existe em `VIAGEMMESTRE`**
   - Erro: `Invalid column name 'CDMOTORISTA'`
   - Solução: Buscar de `CONVOCACAO` onde `STATUS IN ('ACEITA', 'CONFIRMADA')`

2. **Coluna `STATUS` não existe em `VIAGEMMESTRE`**
   - Erro: `Invalid column name 'STATUS'`
   - Solução: Usar `CDSITUACAOVIAGEM` com JOIN em `SITUACAOVIAGEM`

3. **Coluna `DHENTREGA` não existe**
   - Erro: `Invalid column name 'DHENTREGA'`
   - Solução: Usar `DTPREVFINAL` (data prevista final)

4. **Nome de tabela incorreto**
   - `VIAGEM_RASTREAMENTO` → `VIAGEMRASTREAMENTO` (sem underscore)

---

## ✅ Correções Aplicadas

### 1. Buscar Motorista (alert-service.js:26-35)
**Antes:**
```sql
SELECT TOP 1 CDMOTORISTA 
FROM [dbo].[VIAGEMMESTRE]
WHERE IDVIAGEM = @idviagem
```

**Depois:**
```sql
SELECT TOP 1 CDMOTORISTA 
FROM [dbo].[CONVOCACAO]
WHERE IDVIAGEM = @idviagem
  AND STATUS IN ('ACEITA', 'CONFIRMADA')
ORDER BY DHRESPOSTA DESC
```

### 2. Verificar Atraso (alert-service.js:151-163)
**Antes:**
```sql
SELECT v.IDVIAGEM, v.DHENTREGA, v.STATUS, ...
WHERE v.STATUS IN ('EM_ANDAMENTO', 'CONFIRMADA')
```

**Depois:**
```sql
SELECT v.IDVIAGEM, v.DTPREVFINAL AS DHENTREGA, v.CDSITUACAOVIAGEM, ...
WHERE v.CDSITUACAOVIAGEM IN (
  SELECT CDSITUACAOVIAGEM 
  FROM [dbo].[SITUACAOVIAGEM] 
  WHERE UPPER(DSSITUACAOVIAGEM) LIKE '%ANDAMENTO%' 
     OR UPPER(DSSITUACAOVIAGEM) LIKE '%CONFIRMADA%'
)
```

### 3. Verificar Offline (alert-service.js:236-238)
**Antes:**
```sql
SELECT STATUS FROM [dbo].[VIAGEMMESTRE]
WHERE STATUS IN ('EM_ANDAMENTO', 'CONFIRMADA')
```

**Depois:**
```sql
SELECT CDSITUACAOVIAGEM 
FROM [dbo].[VIAGEMMESTRE] v
WHERE EXISTS (
  SELECT 1 
  FROM [dbo].[SITUACAOVIAGEM] s
  WHERE s.CDSITUACAOVIAGEM = v.CDSITUACAOVIAGEM
    AND (UPPER(s.DSSITUACAOVIAGEM) LIKE '%ANDAMENTO%' 
      OR UPPER(s.DSSITUACAOVIAGEM) LIKE '%CONFIRMADA%')
)
```

### 4. Buscar Viagens Ativas (server.js:152-157)
**Antes:**
```sql
SELECT DISTINCT IDVIAGEM
FROM [dbo].[VIAGEMMESTRE]
WHERE STATUS IN ('EM_ANDAMENTO', 'CONFIRMADA', 'T')
```

**Depois:**
```sql
SELECT DISTINCT v.IDVIAGEM
FROM [dbo].[VIAGEMMESTRE] v
INNER JOIN [dbo].[SITUACAOVIAGEM] s ON v.CDSITUACAOVIAGEM = s.CDSITUACAOVIAGEM
WHERE (UPPER(s.DSSITUACAOVIAGEM) LIKE '%ANDAMENTO%' 
    OR UPPER(s.DSSITUACAOVIAGEM) LIKE '%CONFIRMADA%'
    OR v.FGSITVIAGEM = 'T')
```

### 5. Nome da Tabela de Rastreamento
**Corrigido em todas as referências:**
- `VIAGEM_RASTREAMENTO` → `VIAGEMRASTREAMENTO`

---

### 6. Buscar Motorista - Coluna Errada (CORRIGIDO)
**Antes:**
```sql
SELECT TOP 1 CDMOTORISTA 
FROM [dbo].[CONVOCACAO]
```

**Depois:**
```sql
SELECT TOP 1 CDCADASTRO_MOTORISTA 
FROM [dbo].[CONVOCACAO]
```

---

## ✅ Status

Todos os erros foram corrigidos. O sistema de alertas agora deve funcionar corretamente.

**Última correção:** 2026-01-16 - Nome da coluna de motorista na CONVOCACAO

---

**Versão:** 1.1  
**Data:** 2026-01-16  
**Status:** ✅ Corrigido
