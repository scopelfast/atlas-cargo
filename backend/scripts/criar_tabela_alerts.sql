-- Script para criar tabela de Alertas Inteligentes
-- Sistema de detecção automática de problemas em viagens
-- Data: 2026-01-16

-- Tabela principal de alertas
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[ALERTS] (
        ID INT IDENTITY(1,1) PRIMARY KEY,
        IDVIAGEM DECIMAL(15,0) NOT NULL,
        CDMOTORISTA DECIMAL(15,0) NULL, -- FK para CADASTROGERAL (mesmo tipo que CDCADASTRO)
        TYPE NVARCHAR(20) NOT NULL, -- 'atraso', 'parada', 'desvio', 'offline'
        MESSAGE NVARCHAR(255) NOT NULL,
        SEVERITY NVARCHAR(10) NOT NULL DEFAULT 'medium', -- 'low', 'medium', 'high'
        DETAILS NVARCHAR(MAX), -- JSON com detalhes adicionais
        CREATED_AT DATETIME2 DEFAULT SYSUTCDATETIME() NOT NULL,
        RESOLVED BIT DEFAULT 0 NOT NULL,
        RESOLVED_AT DATETIME2 NULL,
        RESOLVED_BY INT NULL, -- CDUSUARIO que resolveu
        FOREIGN KEY (IDVIAGEM) REFERENCES [dbo].[VIAGEMMESTRE](IDVIAGEM),
        FOREIGN KEY (CDMOTORISTA) REFERENCES [dbo].[CADASTROGERAL](CDCADASTRO)
    );

    -- Índices para performance
    CREATE INDEX IX_ALERTS_VIAGEM ON [dbo].[ALERTS](IDVIAGEM);
    CREATE INDEX IX_ALERTS_RESOLVED ON [dbo].[ALERTS](RESOLVED, CREATED_AT);
    CREATE INDEX IX_ALERTS_TYPE ON [dbo].[ALERTS](TYPE, SEVERITY);

    PRINT '✅ Tabela ALERTS criada com sucesso!';
END
ELSE
BEGIN
    PRINT '⚠️ Tabela ALERTS já existe.';
END
GO

-- Tabela de configurações de alertas (opcional - para parametrização)
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ALERT_CONFIG]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[ALERT_CONFIG] (
        CONFIG_KEY NVARCHAR(50) PRIMARY KEY,
        CONFIG_VALUE NVARCHAR(255) NOT NULL,
        DESCRIPTION NVARCHAR(255),
        UPDATED_AT DATETIME2 DEFAULT SYSUTCDATETIME()
    );

    -- Valores padrão
    INSERT INTO [dbo].[ALERT_CONFIG] (CONFIG_KEY, CONFIG_VALUE, DESCRIPTION)
    VALUES
        ('PARADA_MAX_MINUTES', '30', 'Minutos de parada para gerar alerta'),
        ('DESVIO_BUFFER_METERS', '500', 'Buffer em metros para detectar desvio de rota'),
        ('OFFLINE_MAX_MINUTES', '90', 'Minutos offline para gerar alerta'),
        ('CHECK_INTERVAL_MINUTES', '5', 'Intervalo em minutos para verificar alertas');

    PRINT '✅ Tabela ALERT_CONFIG criada com sucesso!';
END
ELSE
BEGIN
    PRINT '⚠️ Tabela ALERT_CONFIG já existe.';
END
GO
