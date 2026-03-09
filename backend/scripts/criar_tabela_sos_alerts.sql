-- Script para criar tabela de Alertas SOS (Emergência)
-- Botão de emergência para motoristas
-- Data: 2026-01-16

-- Tabela principal de alertas SOS
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SOS_ALERTS]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[SOS_ALERTS] (
        ID INT IDENTITY(1,1) PRIMARY KEY,
        CDMOTORISTA DECIMAL(15,0) NOT NULL,
        CDVIAGEM DECIMAL(15,0) NULL,
        LOCATION GEOGRAPHY NULL, -- Coordenadas GPS do local da emergência
        LATITUDE FLOAT NULL, -- Cache para facilitar queries (redundante com LOCATION)
        LONGITUDE FLOAT NULL, -- Cache para facilitar queries (redundante com LOCATION)
        STATUS NVARCHAR(20) DEFAULT 'active' NOT NULL, -- 'active', 'resolved', 'cancelled'
        PRIORITY NVARCHAR(10) DEFAULT 'high' NOT NULL, -- 'low', 'medium', 'high', 'critical'
        MESSAGE NVARCHAR(500) NULL, -- Mensagem opcional do motorista
        CREATED_AT DATETIME2 DEFAULT SYSUTCDATETIME() NOT NULL,
        RESOLVED_AT DATETIME2 NULL,
        RESOLVED_BY DECIMAL(15,0) NULL, -- CDUSUARIO que resolveu
        RESOLUTION_NOTES NVARCHAR(500) NULL,
        SYNCED BIT DEFAULT 1 NOT NULL, -- Se foi sincronizado (padrão 1 = sim, para online)
        CONSTRAINT FK_SOS_ALERTS_MOTORISTA FOREIGN KEY (CDMOTORISTA) REFERENCES [dbo].[CADASTROGERAL](CDCADASTRO),
        CONSTRAINT FK_SOS_ALERTS_VIAGEM FOREIGN KEY (CDVIAGEM) REFERENCES [dbo].[VIAGEMMESTRE](IDVIAGEM)
    );
    
    -- Índices para performance
    CREATE INDEX IX_SOS_ALERTS_STATUS ON [dbo].[SOS_ALERTS](STATUS);
    CREATE INDEX IX_SOS_ALERTS_MOTORISTA ON [dbo].[SOS_ALERTS](CDMOTORISTA);
    CREATE INDEX IX_SOS_ALERTS_VIAGEM ON [dbo].[SOS_ALERTS](CDVIAGEM);
    CREATE INDEX IX_SOS_ALERTS_CREATED_AT ON [dbo].[SOS_ALERTS](CREATED_AT DESC);
    
    PRINT '✅ Tabela SOS_ALERTS criada com sucesso!';
END
ELSE
BEGIN
    PRINT 'ℹ️ Tabela SOS_ALERTS já existe.';
END
GO
