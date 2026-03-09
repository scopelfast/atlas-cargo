-- Script para criar tabela de Mensagens (Chat Motorista ↔ Operador)
-- Sistema de chat contextual por viagem
-- Data: 2026-01-16

-- Tabela principal de mensagens
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[MESSAGES]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[MESSAGES] (
        ID INT IDENTITY(1,1) PRIMARY KEY,
        IDVIAGEM DECIMAL(15,0) NOT NULL,
        SENDER_TYPE NVARCHAR(10) NOT NULL, -- 'driver' ou 'operator'
        SENDER_ID DECIMAL(15,0) NOT NULL, -- CDMOTORISTA ou CDUSUARIO
        SENDER_NAME NVARCHAR(255) NULL, -- Nome do remetente (cache)
        CONTENT NVARCHAR(MAX) NOT NULL, -- Conteúdo da mensagem
        READ_BY_SENDER BIT DEFAULT 0 NOT NULL, -- Se foi lida pelo remetente (confirmação)
        READ_BY_RECEIVER BIT DEFAULT 0 NOT NULL, -- Se foi lida pelo destinatário
        CREATED_AT DATETIME2 DEFAULT SYSUTCDATETIME() NOT NULL,
        SYNCED BIT DEFAULT 1 NOT NULL, -- Se foi sincronizado (padrão 1 = sim)
        FOREIGN KEY (IDVIAGEM) REFERENCES [dbo].[VIAGEMMESTRE](IDVIAGEM)
    );

    -- Índices para performance
    CREATE INDEX IX_MESSAGES_VIAGEM ON [dbo].[MESSAGES](IDVIAGEM, CREATED_AT DESC);
    CREATE INDEX IX_MESSAGES_SENDER ON [dbo].[MESSAGES](SENDER_TYPE, SENDER_ID);
    CREATE INDEX IX_MESSAGES_UNREAD ON [dbo].[MESSAGES](IDVIAGEM, READ_BY_RECEIVER) WHERE READ_BY_RECEIVER = 0;

    PRINT '✅ Tabela MESSAGES criada com sucesso!';
END
ELSE
BEGIN
    PRINT '⚠️ Tabela MESSAGES já existe.';
END
GO
