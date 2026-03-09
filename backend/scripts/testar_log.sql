-- ============================================
-- Script para Testar Sistema de Log
-- ============================================
-- Verifica se a tabela existe e testa inserção
-- ============================================

USE [ATLAS_CARGO_PRD]
GO

PRINT '============================================';
PRINT 'Testando Sistema de Log';
PRINT '============================================';
PRINT '';

-- Verificar se a tabela existe
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[USUARIOLOGACAO]') AND type in (N'U'))
BEGIN
    PRINT '✅ Tabela USUARIOLOGACAO existe.';
    
    -- Verificar estrutura
    PRINT '';
    PRINT '📋 Estrutura da tabela:';
    SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'USUARIOLOGACAO'
    ORDER BY ORDINAL_POSITION;
    
    -- Testar inserção
    PRINT '';
    PRINT '🧪 Testando inserção...';
    BEGIN TRY
        DECLARE @idLog INT;
        
        INSERT INTO USUARIOLOGACAO (
            SGUSUARIO, DHACAO, TIPOACAO, MODULO, DESCRICAO, 
            DETALHES, IDREGISTRO, TABELA, IP, USERAGENT, DHMAINTENANCE
        )
        OUTPUT INSERTED.ID
        VALUES (
            'TESTE', GETDATE(), 'Teste', 'teste-modulo', 'Teste de inserção',
            '{"teste": true}', '123', 'TABELA_TESTE', '127.0.0.1', 'Test Agent', GETDATE()
        );
        
        SET @idLog = SCOPE_IDENTITY();
        
        PRINT '✅ Inserção bem-sucedida! ID: ' + CAST(@idLog AS VARCHAR);
        
        -- Verificar se foi inserido
        IF EXISTS (SELECT 1 FROM USUARIOLOGACAO WHERE ID = @idLog)
        BEGIN
            PRINT '✅ Registro confirmado na tabela.';
            
            -- Mostrar o registro
            SELECT TOP 1 
                ID, SGUSUARIO, DHACAO, TIPOACAO, MODULO, DESCRICAO
            FROM USUARIOLOGACAO
            WHERE ID = @idLog;
            
            -- Limpar teste
            DELETE FROM USUARIOLOGACAO WHERE ID = @idLog;
            PRINT '✅ Registro de teste removido.';
        END
        ELSE
        BEGIN
            PRINT '❌ ERRO: Registro não encontrado após inserção!';
        END
    END TRY
    BEGIN CATCH
        PRINT '❌ ERRO ao inserir:';
        PRINT '   Mensagem: ' + ERROR_MESSAGE();
        PRINT '   Número: ' + CAST(ERROR_NUMBER() AS VARCHAR);
        PRINT '   Linha: ' + CAST(ERROR_LINE() AS VARCHAR);
    END CATCH
END
ELSE
BEGIN
    PRINT '❌ Tabela USUARIOLOGACAO NÃO existe!';
    PRINT '';
    PRINT '⚠️ Execute o script: backend/scripts/criar_tabela_usuariologacao.sql';
END
GO

PRINT '';
PRINT '============================================';
PRINT 'Teste concluído!';
PRINT '============================================';
GO

