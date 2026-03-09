-- ============================================
-- Script para Resetar IDENTITY das Tabelas
-- ============================================
-- Este script reseta o contador IDENTITY para 0 nas tabelas que usam auto-incremento
-- IMPORTANTE: Execute apenas após limpar os dados das tabelas!
-- ============================================

USE [ATLAS_CARGO_PRD]
GO

PRINT '============================================'
PRINT 'Resetando IDENTITY das tabelas...'
PRINT '============================================'
PRINT ''

-- ============================================
-- Função auxiliar para resetar IDENTITY de uma tabela
-- ============================================
DECLARE @tabela_nome VARCHAR(100);
DECLARE @coluna_identity VARCHAR(100);
DECLARE @sql NVARCHAR(MAX);

-- ============================================
-- 1. VIAGEMOCORRENCIA
-- ============================================
SET @tabela_nome = 'VIAGEMOCORRENCIA';
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[' + @tabela_nome + ']') AND type in (N'U'))
BEGIN
    SELECT TOP 1 @coluna_identity = name
    FROM sys.identity_columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[' + @tabela_nome + ']');
    
    IF @coluna_identity IS NOT NULL
    BEGIN
        SET @sql = 'DBCC CHECKIDENT(''[dbo].[' + @tabela_nome + ']'', RESEED, 0)';
        EXEC sp_executesql @sql;
        PRINT '✅ ' + @tabela_nome + ' - IDENTITY resetado para 0 (próximo será 1) - Coluna: ' + @coluna_identity;
    END
    ELSE
    BEGIN
        PRINT '⚠️ ' + @tabela_nome + ' - Nenhuma coluna com IDENTITY encontrada';
    END
END
ELSE
BEGIN
    PRINT '⚠️ ' + @tabela_nome + ' - Tabela não existe';
END
GO

-- ============================================
-- 2. CONVOCACAO
-- ============================================
DECLARE @tabela_nome VARCHAR(100);
DECLARE @coluna_identity VARCHAR(100);
DECLARE @sql NVARCHAR(MAX);

SET @tabela_nome = 'CONVOCACAO';
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[' + @tabela_nome + ']') AND type in (N'U'))
BEGIN
    SELECT TOP 1 @coluna_identity = name
    FROM sys.identity_columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[' + @tabela_nome + ']');
    
    IF @coluna_identity IS NOT NULL
    BEGIN
        SET @sql = 'DBCC CHECKIDENT(''[dbo].[' + @tabela_nome + ']'', RESEED, 0)';
        EXEC sp_executesql @sql;
        PRINT '✅ ' + @tabela_nome + ' - IDENTITY resetado para 0 (próximo será 1) - Coluna: ' + @coluna_identity;
    END
    ELSE
    BEGIN
        PRINT '⚠️ ' + @tabela_nome + ' - Nenhuma coluna com IDENTITY encontrada';
    END
END
ELSE
BEGIN
    PRINT '⚠️ ' + @tabela_nome + ' - Tabela não existe';
END
GO

-- ============================================
-- 3. FEEDBACK
-- ============================================
DECLARE @tabela_nome VARCHAR(100);
DECLARE @coluna_identity VARCHAR(100);
DECLARE @sql NVARCHAR(MAX);

SET @tabela_nome = 'FEEDBACK';
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[' + @tabela_nome + ']') AND type in (N'U'))
BEGIN
    SELECT TOP 1 @coluna_identity = name
    FROM sys.identity_columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[' + @tabela_nome + ']');
    
    IF @coluna_identity IS NOT NULL
    BEGIN
        SET @sql = 'DBCC CHECKIDENT(''[dbo].[' + @tabela_nome + ']'', RESEED, 0)';
        EXEC sp_executesql @sql;
        PRINT '✅ ' + @tabela_nome + ' - IDENTITY resetado para 0 (próximo será 1) - Coluna: ' + @coluna_identity;
    END
    ELSE
    BEGIN
        PRINT '⚠️ ' + @tabela_nome + ' - Nenhuma coluna com IDENTITY encontrada';
    END
END
ELSE
BEGIN
    PRINT '⚠️ ' + @tabela_nome + ' - Tabela não existe';
END
GO

-- ============================================
-- 4. HISTORICOREABERTURA
-- ============================================
DECLARE @tabela_nome VARCHAR(100);
DECLARE @coluna_identity VARCHAR(100);
DECLARE @sql NVARCHAR(MAX);

SET @tabela_nome = 'HISTORICOREABERTURA';
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[' + @tabela_nome + ']') AND type in (N'U'))
BEGIN
    SELECT TOP 1 @coluna_identity = name
    FROM sys.identity_columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[' + @tabela_nome + ']');
    
    IF @coluna_identity IS NOT NULL
    BEGIN
        SET @sql = 'DBCC CHECKIDENT(''[dbo].[' + @tabela_nome + ']'', RESEED, 0)';
        EXEC sp_executesql @sql;
        PRINT '✅ ' + @tabela_nome + ' - IDENTITY resetado para 0 (próximo será 1) - Coluna: ' + @coluna_identity;
    END
    ELSE
    BEGIN
        PRINT '⚠️ ' + @tabela_nome + ' - Nenhuma coluna com IDENTITY encontrada';
    END
END
ELSE
BEGIN
    PRINT '⚠️ ' + @tabela_nome + ' - Tabela não existe';
END
GO

-- ============================================
-- 5. LOG_ENVIO_WHATSAPP
-- ============================================
DECLARE @tabela_nome VARCHAR(100);
DECLARE @coluna_identity VARCHAR(100);
DECLARE @sql NVARCHAR(MAX);

SET @tabela_nome = 'LOG_ENVIO_WHATSAPP';
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[' + @tabela_nome + ']') AND type in (N'U'))
BEGIN
    SELECT TOP 1 @coluna_identity = name
    FROM sys.identity_columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[' + @tabela_nome + ']');
    
    IF @coluna_identity IS NOT NULL
    BEGIN
        SET @sql = 'DBCC CHECKIDENT(''[dbo].[' + @tabela_nome + ']'', RESEED, 0)';
        EXEC sp_executesql @sql;
        PRINT '✅ ' + @tabela_nome + ' - IDENTITY resetado para 0 (próximo será 1) - Coluna: ' + @coluna_identity;
    END
    ELSE
    BEGIN
        PRINT '⚠️ ' + @tabela_nome + ' - Nenhuma coluna com IDENTITY encontrada';
    END
END
ELSE
BEGIN
    PRINT '⚠️ ' + @tabela_nome + ' - Tabela não existe';
END
GO

-- ============================================
-- 6. LOGSWEBHOOKMETA
-- ============================================
DECLARE @tabela_nome VARCHAR(100);
DECLARE @coluna_identity VARCHAR(100);
DECLARE @sql NVARCHAR(MAX);

SET @tabela_nome = 'LOGSWEBHOOKMETA';
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[' + @tabela_nome + ']') AND type in (N'U'))
BEGIN
    SELECT TOP 1 @coluna_identity = name
    FROM sys.identity_columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[' + @tabela_nome + ']');
    
    IF @coluna_identity IS NOT NULL
    BEGIN
        SET @sql = 'DBCC CHECKIDENT(''[dbo].[' + @tabela_nome + ']'', RESEED, 0)';
        EXEC sp_executesql @sql;
        PRINT '✅ ' + @tabela_nome + ' - IDENTITY resetado para 0 (próximo será 1) - Coluna: ' + @coluna_identity;
    END
    ELSE
    BEGIN
        PRINT '⚠️ ' + @tabela_nome + ' - Nenhuma coluna com IDENTITY encontrada';
    END
END
ELSE
BEGIN
    PRINT '⚠️ ' + @tabela_nome + ' - Tabela não existe';
END
GO

PRINT ''
PRINT '============================================'
PRINT '✅ Processo de reset de IDENTITY concluído!'
PRINT '============================================'
PRINT ''
PRINT '📋 RESUMO:'
PRINT 'Todas as tabelas com IDENTITY foram resetadas para 0.'
PRINT 'O próximo registro inserido em cada tabela terá ID = 1.'
PRINT ''
PRINT '⚠️ ATENÇÃO:'
PRINT 'Certifique-se de que as tabelas foram limpas antes de executar este script!'
PRINT ''

