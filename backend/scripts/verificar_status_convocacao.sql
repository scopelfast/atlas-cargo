-- Script para verificar estrutura do campo STATUS na tabela CONVOCACAO
-- Database: DIVULGACARGA_PRD
-- Data: 2025-11-21

USE [DIVULGACARGA_PRD];
GO

-- Verificar estrutura da coluna STATUS
SELECT 
    COLUMN_NAME,
    DATA_TYPE,
    CHARACTER_MAXIMUM_LENGTH,
    IS_NULLABLE,
    COLUMN_DEFAULT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo'
  AND TABLE_NAME = 'CONVOCACAO'
  AND COLUMN_NAME = 'STATUS';
GO

-- Verificar se há constraints CHECK no campo STATUS
SELECT 
    CONSTRAINT_NAME,
    CHECK_CLAUSE
FROM INFORMATION_SCHEMA.CHECK_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = 'dbo'
  AND CONSTRAINT_NAME LIKE '%STATUS%'
  OR CHECK_CLAUSE LIKE '%STATUS%';
GO

-- Verificar valores únicos de STATUS atualmente na tabela
SELECT DISTINCT STATUS, COUNT(*) AS QUANTIDADE
FROM [dbo].[CONVOCACAO]
GROUP BY STATUS
ORDER BY STATUS;
GO

-- Verificar se o campo aceita o novo valor (teste)
-- Este comando apenas verifica, não altera dados
SELECT 
    CASE 
        WHEN CHARACTER_MAXIMUM_LENGTH >= 18 THEN '✅ Campo aceita o novo status (ACEITA_DESCARTADA tem 18 caracteres)'
        ELSE '❌ Campo muito pequeno, precisa aumentar'
    END AS RESULTADO
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = 'dbo'
  AND TABLE_NAME = 'CONVOCACAO'
  AND COLUMN_NAME = 'STATUS';
GO

PRINT 'Verificação concluída!';
GO

