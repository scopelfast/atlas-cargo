-- Script para verificar se as tabelas SOS e Reputação existem
-- Execute este script para verificar o status das tabelas

-- Verificar tabela SOS_ALERTS
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SOS_ALERTS]') AND type in (N'U'))
BEGIN
    PRINT '✅ Tabela SOS_ALERTS existe.';
    SELECT 
        COUNT(*) AS TotalAlertas,
        SUM(CASE WHEN STATUS = 'active' THEN 1 ELSE 0 END) AS AlertasAtivos,
        SUM(CASE WHEN STATUS = 'resolved' THEN 1 ELSE 0 END) AS AlertasResolvidos
    FROM [dbo].[SOS_ALERTS];
END
ELSE
BEGIN
    PRINT '❌ Tabela SOS_ALERTS NÃO existe. Execute: criar_tabela_sos_alerts.sql';
END
GO

-- Verificar tabela DRIVER_REPUTATION
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[DRIVER_REPUTATION]') AND type in (N'U'))
BEGIN
    PRINT '✅ Tabela DRIVER_REPUTATION existe.';
    SELECT 
        COUNT(*) AS TotalMotoristas,
        AVG(SCORE) AS ScoreMedio,
        SUM(TOTAL_DELIVERIES) AS TotalEntregas
    FROM [dbo].[DRIVER_REPUTATION];
END
ELSE
BEGIN
    PRINT '❌ Tabela DRIVER_REPUTATION NÃO existe. Execute: criar_tabela_driver_reputation.sql';
END
GO

-- Verificar estrutura das colunas (se as tabelas existirem)
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SOS_ALERTS]') AND type in (N'U'))
BEGIN
    PRINT '📋 Estrutura da tabela SOS_ALERTS:';
    SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'SOS_ALERTS'
    ORDER BY ORDINAL_POSITION;
END
GO

IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[DRIVER_REPUTATION]') AND type in (N'U'))
BEGIN
    PRINT '📋 Estrutura da tabela DRIVER_REPUTATION:';
    SELECT 
        COLUMN_NAME,
        DATA_TYPE,
        IS_NULLABLE,
        CHARACTER_MAXIMUM_LENGTH
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'DRIVER_REPUTATION'
    ORDER BY ORDINAL_POSITION;
END
GO
