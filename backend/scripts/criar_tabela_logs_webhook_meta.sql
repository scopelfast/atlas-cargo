-- Script para criar tabela de logs do webhook Meta
-- Data: 2026-12-01
-- Descrição: Armazena logs de envios para o webhook de integração Meta

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[LOGSWEBHOOKMETA]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[LOGSWEBHOOKMETA] (
        IDLOG INT IDENTITY(1,1) PRIMARY KEY,
        IDCONVOCACAO INT NOT NULL,
        TIPO VARCHAR(20) NOT NULL, -- 'envio', 'resposta', 'sucesso', 'erro'
        TITULO NVARCHAR(200),
        MENSAGEM NVARCHAR(MAX),
        DETALHES NVARCHAR(MAX), -- JSON com detalhes completos
        STATUS_HTTP INT,
        TEMPO_RESPOSTA INT, -- em milissegundos
        DHLOG DATETIME NOT NULL DEFAULT GETDATE(),
        DHMAINTENANCE DATETIME NOT NULL DEFAULT GETDATE(),
        SGUSER VARCHAR(50) DEFAULT 'SYSTEM',
        SERVERORIG VARCHAR(50) DEFAULT 'AppDVcargas',
        
        CONSTRAINT FK_LOGSWEBHOOKMETA_CONVOCACAO FOREIGN KEY (IDCONVOCACAO) 
            REFERENCES [dbo].[CONVOCACAO](IDCONVOCACAO)
    );
    
    -- Índices para melhor performance
    CREATE INDEX IX_LOGSWEBHOOKMETA_IDCONVOCACAO ON [dbo].[LOGSWEBHOOKMETA](IDCONVOCACAO);
    CREATE INDEX IX_LOGSWEBHOOKMETA_DHLOG ON [dbo].[LOGSWEBHOOKMETA](DHLOG DESC);
    CREATE INDEX IX_LOGSWEBHOOKMETA_TIPO ON [dbo].[LOGSWEBHOOKMETA](TIPO);
    
    PRINT 'Tabela LOGSWEBHOOKMETA criada com sucesso!';
END
ELSE
BEGIN
    PRINT 'Tabela LOGSWEBHOOKMETA já existe.';
END
GO

