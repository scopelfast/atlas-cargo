-- ============================================
-- Script para Resetar IDENTITY da Tabela CONVOCACAO
-- ============================================
-- Este script verifica se IDCONVOCACAO é IDENTITY e reseta para 0
-- IMPORTANTE: Execute apenas após limpar os dados da tabela!
-- ============================================

USE [ATLAS_CARGO_PRD]
GO

PRINT '============================================'
PRINT 'Verificando e Resetando IDENTITY de CONVOCACAO'
PRINT '============================================'
PRINT ''

-- Verificar se a tabela existe
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CONVOCACAO]') AND type in (N'U'))
BEGIN
    PRINT '❌ ERRO: Tabela CONVOCACAO não existe!'
    RETURN
END

PRINT '✅ Tabela CONVOCACAO encontrada.'
PRINT ''

-- Verificar se IDCONVOCACAO é IDENTITY
DECLARE @coluna_identity VARCHAR(100);
DECLARE @sql NVARCHAR(MAX);
DECLARE @valor_atual BIGINT;

SELECT TOP 1 @coluna_identity = name
FROM sys.identity_columns 
WHERE object_id = OBJECT_ID(N'[dbo].[CONVOCACAO]')
  AND name = 'IDCONVOCACAO';

IF @coluna_identity IS NOT NULL
BEGIN
    -- Obter valor atual do IDENTITY
    SELECT @valor_atual = IDENT_CURRENT('CONVOCACAO');
    
    PRINT '📊 Informações da Coluna IDCONVOCACAO:'
    PRINT '   - Tipo: IDENTITY (Auto Increment)'
    PRINT '   - Valor atual do contador: ' + CAST(@valor_atual AS VARCHAR(20));
    PRINT ''
    
    -- Resetar IDENTITY para 0
    SET @sql = 'DBCC CHECKIDENT(''[dbo].[CONVOCACAO]'', RESEED, 0)';
    EXEC sp_executesql @sql;
    
    PRINT '✅ IDENTITY resetado para 0'
    PRINT '   O próximo registro inserido terá IDCONVOCACAO = 1'
    PRINT ''
    PRINT '============================================'
    PRINT '✅ Processo concluído com sucesso!'
    PRINT '============================================'
END
ELSE
BEGIN
    PRINT '⚠️ ATENÇÃO: IDCONVOCACAO NÃO é uma coluna IDENTITY!'
    PRINT ''
    PRINT 'Isso significa que:'
    PRINT '   - O campo NÃO é auto increment'
    PRINT '   - Você precisa inserir o ID manualmente'
    PRINT '   - Não é necessário resetar nada'
    PRINT ''
    PRINT 'Para verificar a estrutura completa da tabela, execute:'
    PRINT '   SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ''CONVOCACAO'''
END
GO

