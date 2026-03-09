-- ============================================
-- Script para Testar Linked Server INTEGRA_PRD
-- ============================================
-- Este script verifica se o linked server está configurado
-- e se consegue acessar o banco INTEGRA_PRD
-- ============================================

USE [ATLAS_CARGO_PRD];
GO

PRINT '========================================';
PRINT 'TESTE DO LINKED SERVER INTEGRA_PRD';
PRINT '========================================';
PRINT '';

-- 1. Verificar se o linked server existe
PRINT '1. Verificando se o linked server existe...';
IF EXISTS (SELECT * FROM sys.servers WHERE name = 'INTEGRA_PRD' AND is_linked = 1)
BEGIN
    PRINT '✅ Linked Server INTEGRA_PRD existe';
    
    -- Ver detalhes
    SELECT 
        name AS 'Nome',
        product AS 'Produto',
        provider AS 'Provider',
        data_source AS 'Data Source',
        is_linked AS 'É Linked'
    FROM sys.servers 
    WHERE name = 'INTEGRA_PRD';
END
ELSE
BEGIN
    PRINT '❌ Linked Server INTEGRA_PRD NÃO existe!';
    PRINT '   Execute o script: configurar_linked_server_integra.sql';
END
GO

PRINT '';
PRINT '2. Testando acesso à tabela TIPOVALIDADE...';
BEGIN TRY
    DECLARE @contador INT;
    SELECT @contador = COUNT(*) FROM [INTEGRA_PRD].[dbo].[TIPOVALIDADE];
    PRINT '✅ Acesso OK! Total de registros em TIPOVALIDADE: ' + CAST(@contador AS VARCHAR(10));
END TRY
BEGIN CATCH
    PRINT '❌ Erro ao acessar INTEGRA_PRD.dbo.TIPOVALIDADE:';
    PRINT '   ' + ERROR_MESSAGE();
    PRINT '';
    PRINT '💡 Possíveis causas:';
    PRINT '   - Linked server não configurado corretamente';
    PRINT '   - Banco INTEGRA_PRD está offline';
    PRINT '   - Credenciais incorretas';
    PRINT '   - Firewall bloqueando conexão';
END CATCH
GO

PRINT '';
PRINT '3. Testando execução da procedure SP_INTGRACAO_TIPOVALIDADE...';
BEGIN TRY
    EXEC [dbo].[SP_INTGRACAO_TIPOVALIDADE];
    PRINT '✅ Procedure executada com sucesso!';
END TRY
BEGIN CATCH
    PRINT '❌ Erro ao executar SP_INTGRACAO_TIPOVALIDADE:';
    PRINT '   Número: ' + CAST(ERROR_NUMBER() AS VARCHAR(10));
    PRINT '   Mensagem: ' + ERROR_MESSAGE();
END CATCH
GO

PRINT '';
PRINT '========================================';
PRINT 'TESTE CONCLUÍDO';
PRINT '========================================';
GO
