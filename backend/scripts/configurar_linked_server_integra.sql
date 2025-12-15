-- ============================================
-- Script para Configurar/Atualizar Linked Server INTEGRA_PRD
-- ============================================
-- Descrição: Configura o linked server para acessar o banco INTEGRA_PRD
--            com as novas credenciais e endereço
-- 
-- IMPORTANTE: Execute este script no banco DIVULGACARGA_PRD
-- NOTA: Ambos os bancos (DIVULGACARGA_PRD e INTEGRA_PRD) estão no mesmo servidor
-- ============================================

USE [DIVULGACARGA_PRD];
GO

-- Verificar se o linked server já existe
IF EXISTS (SELECT * FROM sys.servers WHERE name = 'INTEGRA_PRD')
BEGIN
    PRINT '⚠️ Linked Server INTEGRA_PRD já existe. Removendo para recriar...';
    
    -- Remover mapeamentos de login existentes
    EXEC sp_dropserverlogin 'INTEGRA_PRD', NULL;
    
    -- Remover o linked server
    EXEC sp_dropserver 'INTEGRA_PRD', 'droplogins';
    
    PRINT '✅ Linked Server antigo removido';
END
GO

-- Criar o linked server com as novas credenciais
PRINT '📡 Criando Linked Server INTEGRA_PRD...';
PRINT '   Servidor: 186.250.92.131,35987';
PRINT '   Banco: INTEGRA_PRD';
PRINT '   Usuário: sa';
PRINT '';

-- Para SQL Server remoto, usar provider SQLNCLI sem especificar srvproduct como 'SQL Server'
-- A sintaxe correta é não usar @srvproduct = 'SQL Server' quando especificamos provider e datasrc
BEGIN TRY
    EXEC sp_addlinkedserver
        @server = 'INTEGRA_PRD',
        @srvproduct = '',
        @provider = 'SQLNCLI',
        @datasrc = '186.250.92.131,35987';
    
    PRINT '✅ Linked server criado com sucesso';
END TRY
BEGIN CATCH
    PRINT '❌ Erro ao criar linked server:';
    PRINT ERROR_MESSAGE();
    PRINT '';
    PRINT 'Tentando método alternativo...';
    
    -- Método alternativo: usar apenas datasrc sem provider explícito
    BEGIN TRY
        EXEC sp_addlinkedserver
            @server = 'INTEGRA_PRD',
            @srvproduct = '',
            @datasrc = '186.250.92.131,35987';
        
        PRINT '✅ Linked server criado com método alternativo';
    END TRY
    BEGIN CATCH
        PRINT '❌ Erro no método alternativo:';
        PRINT ERROR_MESSAGE();
        THROW;
    END CATCH
END CATCH
GO

-- Configurar opções do linked server (após criar)
-- Verificar se o servidor foi criado antes de configurar opções
IF EXISTS (SELECT * FROM sys.servers WHERE name = 'INTEGRA_PRD')
BEGIN
    EXEC sp_serveroption 'INTEGRA_PRD', 'rpc out', 'true';
    EXEC sp_serveroption 'INTEGRA_PRD', 'rpc', 'true';
    EXEC sp_serveroption 'INTEGRA_PRD', 'use remote collation', 'true';
    EXEC sp_serveroption 'INTEGRA_PRD', 'collation compatible', 'false';
    EXEC sp_serveroption 'INTEGRA_PRD', 'connect timeout', '30';
    EXEC sp_serveroption 'INTEGRA_PRD', 'query timeout', '600';
    PRINT '✅ Opções do linked server configuradas';
END
ELSE
BEGIN
    PRINT '❌ Erro: Linked server não foi criado. Verifique os erros acima.';
END
GO

-- Configurar autenticação (mapear login local para remoto)
-- Verificar se o servidor foi criado antes de configurar autenticação
IF EXISTS (SELECT * FROM sys.servers WHERE name = 'INTEGRA_PRD')
BEGIN
    PRINT '🔐 Configurando autenticação...';
    EXEC sp_addlinkedsrvlogin
        @rmtsrvname = 'INTEGRA_PRD',
        @useself = 'false',
        @locallogin = NULL,  -- Aplica para todos os logins locais
        @rmtuser = 'sa',
        @rmtpassword = 'SistMSQLServer2025&*';
    PRINT '✅ Autenticação configurada';
END
ELSE
BEGIN
    PRINT '❌ Erro: Linked server não foi criado. Não é possível configurar autenticação.';
END
GO

-- Verificar se o linked server foi criado com sucesso
IF EXISTS (SELECT * FROM sys.servers WHERE name = 'INTEGRA_PRD')
BEGIN
    PRINT '';
    PRINT '✅ Linked Server INTEGRA_PRD configurado com sucesso!';
    PRINT '';
    PRINT '📋 Teste a conexão executando:';
    PRINT '   SELECT TOP 1 * FROM [INTEGRA_PRD].[dbo].[CADASTROGERAL]';
    PRINT '';
END
ELSE
BEGIN
    PRINT '';
    PRINT '❌ ATENÇÃO: Linked Server não foi criado.';
    PRINT '   Verifique os erros acima e tente novamente.';
    PRINT '';
END
GO

-- Teste de conexão (opcional - descomente para testar)
/*
PRINT '🧪 Testando conexão...';
BEGIN TRY
    DECLARE @teste INT;
    SELECT @teste = COUNT(*) FROM [INTEGRA_PRD].[dbo].[CADASTROGERAL];
    PRINT '✅ Conexão OK! Total de registros em CADASTROGERAL: ' + CAST(@teste AS VARCHAR(10));
END TRY
BEGIN CATCH
    PRINT '❌ Erro ao testar conexão:';
    PRINT ERROR_MESSAGE();
END CATCH
GO
*/

PRINT '========================================';
PRINT 'Configuração concluída!';
PRINT '========================================';
GO
