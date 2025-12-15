-- ============================================
-- Script para Verificar e Ativar Banco INTEGRA_PRD
-- ============================================
-- Descrição: Verifica o status do banco INTEGRA_PRD no servidor remoto
--            e fornece instruções para ativá-lo se estiver offline
-- 
-- IMPORTANTE: Este script deve ser executado no servidor remoto (186.250.92.131,35987)
--             ou por um administrador com acesso ao servidor remoto
-- ============================================

-- ============================================
-- OPÇÃO 1: Executar no servidor remoto diretamente
-- ============================================
-- Conecte-se ao servidor: 186.250.92.131,35987
-- Usuário: sa
-- Senha: SistMSQLServer2025&*
-- ============================================

USE [master];
GO

-- Verificar status do banco INTEGRA_PRD
PRINT '🔍 Verificando status do banco INTEGRA_PRD...';
PRINT '';

SELECT 
    name AS 'Nome do Banco',
    state_desc AS 'Status',
    recovery_model_desc AS 'Modelo de Recuperação',
    compatibility_level AS 'Nível de Compatibilidade',
    create_date AS 'Data de Criação'
FROM sys.databases
WHERE name = 'INTEGRA_PRD';
GO

-- Se o banco estiver offline, ativar
IF EXISTS (
    SELECT 1 
    FROM sys.databases 
    WHERE name = 'INTEGRA_PRD' 
    AND state_desc = 'OFFLINE'
)
BEGIN
    PRINT '';
    PRINT '⚠️ Banco INTEGRA_PRD está OFFLINE!';
    PRINT '';
    PRINT '🔄 Tentando ativar o banco...';
    
    BEGIN TRY
        ALTER DATABASE [INTEGRA_PRD] SET ONLINE;
        PRINT '✅ Banco INTEGRA_PRD ativado com sucesso!';
    END TRY
    BEGIN CATCH
        PRINT '❌ Erro ao ativar o banco:';
        PRINT ERROR_MESSAGE();
        PRINT '';
        PRINT '📋 Possíveis causas:';
        PRINT '   1. Arquivos do banco não estão acessíveis';
        PRINT '   2. Permissões insuficientes';
        PRINT '   3. Banco em modo de recuperação';
        PRINT '';
        PRINT '💡 Solução manual:';
        PRINT '   1. Abra SQL Server Management Studio';
        PRINT '   2. Conecte-se ao servidor 186.250.92.131,35987';
        PRINT '   3. Vá em Databases > INTEGRA_PRD > Tasks > Take Offline/Online';
        PRINT '   4. Ou execute: ALTER DATABASE [INTEGRA_PRD] SET ONLINE;';
    END CATCH
END
ELSE IF EXISTS (
    SELECT 1 
    FROM sys.databases 
    WHERE name = 'INTEGRA_PRD' 
    AND state_desc = 'ONLINE'
)
BEGIN
    PRINT '';
    PRINT '✅ Banco INTEGRA_PRD está ONLINE!';
END
ELSE
BEGIN
    PRINT '';
    PRINT '❌ Banco INTEGRA_PRD não encontrado!';
    PRINT '   Verifique se o banco existe no servidor remoto.';
END
GO

PRINT '';
PRINT '========================================';
PRINT 'Verificação concluída!';
PRINT '========================================';
GO

-- ============================================
-- COMANDO RÁPIDO PARA ATIVAR (se estiver offline)
-- ============================================
-- Execute no servidor remoto (186.250.92.131,35987):
--
-- ALTER DATABASE [INTEGRA_PRD] SET ONLINE;
-- GO
--
-- ============================================
