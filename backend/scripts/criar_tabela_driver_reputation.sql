-- Script para criar tabela de Reputação de Motoristas
-- Sistema de pontuação baseado em pontualidade e desempenho
-- Data: 2026-01-16

-- Tabela principal de reputação
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[DRIVER_REPUTATION]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[DRIVER_REPUTATION] (
        CDMOTORISTA DECIMAL(15,0) PRIMARY KEY,
        SCORE FLOAT DEFAULT 0 NOT NULL, -- 0 a 100
        TOTAL_DELIVERIES INT DEFAULT 0 NOT NULL, -- Total de entregas
        ON_TIME_DELIVERIES INT DEFAULT 0 NOT NULL, -- Entregas no prazo
        LATE_DELIVERIES INT DEFAULT 0 NOT NULL, -- Entregas atrasadas
        CANCELED_DELIVERIES INT DEFAULT 0 NOT NULL, -- Entregas canceladas
        AVERAGE_DELAY_MINUTES FLOAT DEFAULT 0 NULL, -- Atraso médio em minutos (quando houver atraso)
        LAST_DELIVERY_DATE DATETIME2 NULL, -- Data da última entrega
        LAST_UPDATED DATETIME2 DEFAULT SYSUTCDATETIME() NOT NULL,
        CONSTRAINT FK_DRIVER_REPUTATION_MOTORISTA FOREIGN KEY (CDMOTORISTA) REFERENCES [dbo].[CADASTROGERAL](CDCADASTRO)
    );
    
    -- Índices para performance
    CREATE INDEX IX_DRIVER_REPUTATION_SCORE ON [dbo].[DRIVER_REPUTATION](SCORE DESC);
    CREATE INDEX IX_DRIVER_REPUTATION_LAST_UPDATED ON [dbo].[DRIVER_REPUTATION](LAST_UPDATED DESC);
    
    PRINT '✅ Tabela DRIVER_REPUTATION criada com sucesso!';
END
ELSE
BEGIN
    PRINT 'ℹ️ Tabela DRIVER_REPUTATION já existe.';
END
GO
