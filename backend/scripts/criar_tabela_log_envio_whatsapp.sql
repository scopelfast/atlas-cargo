-- ============================================================================
-- Script: Criar Tabela de Log de Envios WhatsApp (Waboxapp)
-- Data: 2025-11-24
-- Descrição: Tabela para auditoria de envios automáticos via Waboxapp
-- IMPORTANTE: Execute este script APENAS quando estiver pronto para testar
-- ============================================================================

PRINT '';
PRINT '========================================';
PRINT 'Criando tabela LOG_ENVIO_WHATSAPP...';
PRINT '========================================';
GO

-- Verificar se a tabela já existe
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[LOG_ENVIO_WHATSAPP]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[LOG_ENVIO_WHATSAPP] (
        IDLOG INT IDENTITY(1,1) PRIMARY KEY,
        IDCONVOCACAO INT NOT NULL,
        NRCELULAR VARCHAR(20) NULL,
        STATUS_ENVIO VARCHAR(20) NOT NULL DEFAULT 'PENDENTE', -- 'ENVIADO', 'ERRO', 'PENDENTE', 'CANCELADO'
        MENSAGEM_ERRO NVARCHAR(500) NULL,
        DHENVIO DATETIME NULL,
        DHRESPOSTA_API DATETIME NULL,
        IDRESPOSTA_API VARCHAR(100) NULL, -- ID retornado pela API Waboxapp
        TENTATIVAS INT NOT NULL DEFAULT 0, -- Quantidade de tentativas de envio
        DHMAINTENANCE DATETIME NOT NULL DEFAULT GETDATE(),
        SGUSER VARCHAR(50) NOT NULL DEFAULT 'SYSTEM',
        SERVERORIG VARCHAR(50) NOT NULL DEFAULT 'AppDVcargas',
        
        -- Índices para performance
        CONSTRAINT FK_LOG_ENVIO_WHATSAPP_CONVOCACAO 
            FOREIGN KEY (IDCONVOCACAO) 
            REFERENCES [dbo].[CONVOCACAO](IDCONVOCACAO)
            ON DELETE CASCADE
    );
    
    -- Criar índices para consultas rápidas
    CREATE INDEX IX_LOG_ENVIO_WHATSAPP_IDCONVOCACAO 
        ON [dbo].[LOG_ENVIO_WHATSAPP](IDCONVOCACAO);
    
    CREATE INDEX IX_LOG_ENVIO_WHATSAPP_STATUS 
        ON [dbo].[LOG_ENVIO_WHATSAPP](STATUS_ENVIO);
    
    CREATE INDEX IX_LOG_ENVIO_WHATSAPP_DHENVIO 
        ON [dbo].[LOG_ENVIO_WHATSAPP](DHENVIO);
    
    PRINT '✅ Tabela LOG_ENVIO_WHATSAPP criada com sucesso!';
    PRINT '✅ Índices criados para otimização de consultas.';
END
ELSE
BEGIN
    PRINT '⚠️  Tabela LOG_ENVIO_WHATSAPP já existe. Nenhuma alteração realizada.';
END
GO

PRINT '';
PRINT '========================================';
PRINT 'Script concluído!';
PRINT '========================================';
PRINT '';
PRINT '📋 Próximos passos:';
PRINT '   1. Configure as variáveis WABOXAPP_* no arquivo .env';
PRINT '   2. Implemente o endpoint /api/convocacoes/enviar-whatsapp-automatico';
PRINT '   3. Teste o envio automático em ambiente de desenvolvimento';
PRINT '';
GO

