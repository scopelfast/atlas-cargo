-- ============================================
-- Script para Verificar e Ativar Banco INTEGRA_PRD
-- ============================================
-- Descrição: Verifica o status do banco INTEGRA_PRD e o ativa se estiver offline
-- 
-- IMPORTANTE: Execute este script conectado DIRETAMENTE ao servidor INTEGRA_PRD
-- Servidor: 186.250.92.131,35987
-- ============================================

-- Verificar status do banco
PRINT '🔍 Verificando status do banco INTEGRA_PRD...';
PRINT '';

SELECT 
    name AS 'Nome do Banco',
    state_desc AS 'Status',
    CASE 
        WHEN state_desc = 'ONLINE' THEN '✅ Banco está ONLINE'
        WHEN state_desc = 'OFFLINE' THEN '❌ Banco está OFFLINE'
        ELSE '⚠️ Status: ' + state_desc
    END AS 'Situação'
FROM sys.databases 
WHERE name = 'INTEGRA_PRD';
GO

-- Tentar ativar o banco se estiver offline
PRINT '';
PRINT '🔄 Tentando ativar o banco INTEGRA_PRD...';
PRINT '';

BEGIN TRY
    ALTER DATABASE [INTEGRA_PRD] SET ONLINE;
    PRINT '✅ Banco INTEGRA_PRD ativado com sucesso!';
END TRY
BEGIN CATCH
    PRINT '❌ Erro ao ativar o banco:';
    PRINT ERROR_MESSAGE();
    PRINT '';
    PRINT '💡 Possíveis causas:';
    PRINT '   - Banco está em modo de recuperação';
    PRINT '   - Arquivos do banco não estão acessíveis';
    PRINT '   - Permissões insuficientes';
    PRINT '';
    PRINT '📋 Verifique os arquivos do banco:';
    PRINT '   SELECT name, physical_name, state_desc FROM sys.master_files WHERE database_id = DB_ID(''INTEGRA_PRD'')';
END CATCH
GO

-- Verificar novamente o status após tentativa de ativação
PRINT '';
PRINT '🔍 Verificando status após tentativa de ativação...';
PRINT '';

SELECT 
    name AS 'Nome do Banco',
    state_desc AS 'Status',
    CASE 
        WHEN state_desc = 'ONLINE' THEN '✅ Banco está ONLINE e pronto para uso'
        WHEN state_desc = 'OFFLINE' THEN '❌ Banco ainda está OFFLINE - Verifique os arquivos do banco'
        ELSE '⚠️ Status: ' + state_desc
    END AS 'Situação'
FROM sys.databases 
WHERE name = 'INTEGRA_PRD';
GO

PRINT '';
PRINT '========================================';
PRINT 'Verificação concluída!';
PRINT '========================================';
GO
