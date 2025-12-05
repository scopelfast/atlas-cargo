-- =============================================
-- Script: ATUALIZAR VIAGEMRASTREAMENTO
-- Descrição: Adiciona campos novos para APP Motorista
-- Data: 2025-12-03
-- =============================================

-- Adicionar ALTITUDE (se não existir)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMRASTREAMENTO]') AND name = 'ALTITUDE')
BEGIN
    ALTER TABLE VIAGEMRASTREAMENTO ADD [ALTITUDE] [decimal](10, 2) NULL
    PRINT '✅ Campo ALTITUDE adicionado'
END
ELSE
BEGIN
    PRINT '⚠️ Campo ALTITUDE já existe'
END
GO

-- Adicionar FGSTATUS (se não existir)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMRASTREAMENTO]') AND name = 'FGSTATUS')
BEGIN
    ALTER TABLE VIAGEMRASTREAMENTO ADD [FGSTATUS] [char](1) NULL DEFAULT 'P'
    PRINT '✅ Campo FGSTATUS adicionado (P=Parado, M=Movimento)'
END
ELSE
BEGIN
    PRINT '⚠️ Campo FGSTATUS já existe'
END
GO

-- Adicionar DIRECAO (se não existir)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMRASTREAMENTO]') AND name = 'DIRECAO')
BEGIN
    ALTER TABLE VIAGEMRASTREAMENTO ADD [DIRECAO] [decimal](5, 2) NULL
    PRINT '✅ Campo DIRECAO adicionado (0-360 graus)'
END
ELSE
BEGIN
    PRINT '⚠️ Campo DIRECAO já existe'
END
GO

-- Adicionar FGACTIVE (se não existir)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMRASTREAMENTO]') AND name = 'FGACTIVE')
BEGIN
    ALTER TABLE VIAGEMRASTREAMENTO ADD [FGACTIVE] [char](1) NULL DEFAULT 'T'
    PRINT '✅ Campo FGACTIVE adicionado'
END
ELSE
BEGIN
    PRINT '⚠️ Campo FGACTIVE já existe'
END
GO

-- Adicionar DHMAINTENANCE (se não existir)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMRASTREAMENTO]') AND name = 'DHMAINTENANCE')
BEGIN
    ALTER TABLE VIAGEMRASTREAMENTO ADD [DHMAINTENANCE] [datetime] NULL
    PRINT '✅ Campo DHMAINTENANCE adicionado'
END
ELSE
BEGIN
    PRINT '⚠️ Campo DHMAINTENANCE já existe'
END
GO

-- Adicionar SGUSER (se não existir)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMRASTREAMENTO]') AND name = 'SGUSER')
BEGIN
    ALTER TABLE VIAGEMRASTREAMENTO ADD [SGUSER] [varchar](50) NULL
    PRINT '✅ Campo SGUSER adicionado'
END
ELSE
BEGIN
    PRINT '⚠️ Campo SGUSER já existe'
END
GO

-- Adicionar SERVERORIG (se não existir)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMRASTREAMENTO]') AND name = 'SERVERORIG')
BEGIN
    ALTER TABLE VIAGEMRASTREAMENTO ADD [SERVERORIG] [varchar](50) NULL
    PRINT '✅ Campo SERVERORIG adicionado'
END
ELSE
BEGIN
    PRINT '⚠️ Campo SERVERORIG já existe'
END
GO

-- Criar índice para FGSTATUS (se não existir)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IDX_RASTREAMENTO_STATUS')
BEGIN
    CREATE INDEX IDX_RASTREAMENTO_STATUS ON VIAGEMRASTREAMENTO(FGSTATUS, DHREGISTRO DESC)
    PRINT '✅ Índice IDX_RASTREAMENTO_STATUS criado'
END
GO

PRINT ''
PRINT '==========================================='
PRINT '✅ VIAGEMRASTREAMENTO atualizada!'
PRINT '==========================================='
PRINT ''
PRINT '📋 CAMPOS ADICIONADOS:'
PRINT '  - ALTITUDE (decimal 10,2)'
PRINT '  - FGSTATUS (char 1) - P=Parado, M=Movimento'
PRINT '  - DIRECAO (decimal 5,2) - 0-360 graus'
PRINT '  - FGACTIVE (char 1)'
PRINT '  - DHMAINTENANCE (datetime)'
PRINT '  - SGUSER (varchar 50)'
PRINT '  - SERVERORIG (varchar 50)'
PRINT ''
PRINT '📊 ESTRUTURA COMPLETA:'
PRINT '  - LATITUDE, LONGITUDE (já existiam)'
PRINT '  - VELOCIDADE (já existia)'
PRINT '  - PRECISAO (já existia)'
PRINT '  - ALTITUDE (novo!)'
PRINT '  - FGSTATUS (novo!) - Detecta parado/movimento'
PRINT '  - DIRECAO (novo!) - Norte, Sul, etc'
PRINT ''
PRINT '✅ Agora a tabela está COMPLETA para o APP!'
PRINT ''
GO

-- View melhorada para consultas
IF EXISTS (SELECT * FROM sys.views WHERE name = 'vw_Rastreamento_Completo')
BEGIN
    DROP VIEW vw_Rastreamento_Completo
END
GO

CREATE VIEW vw_Rastreamento_Completo AS
SELECT 
    R.IDRASTREAMENTO,
    R.IDVIAGEM,
    R.CDCADASTRO,
    M.RZSOCIAL AS NMMOTORISTA,
    R.LATITUDE,
    R.LONGITUDE,
    R.ALTITUDE,
    R.VELOCIDADE,
    CASE R.FGSTATUS 
        WHEN 'P' THEN 'Parado'
        WHEN 'M' THEN 'Em Movimento'
        ELSE 'Desconhecido'
    END AS STATUS,
    R.DIRECAO,
    CASE 
        WHEN R.DIRECAO BETWEEN 0 AND 22.5 THEN 'Norte'
        WHEN R.DIRECAO BETWEEN 22.5 AND 67.5 THEN 'Nordeste'
        WHEN R.DIRECAO BETWEEN 67.5 AND 112.5 THEN 'Leste'
        WHEN R.DIRECAO BETWEEN 112.5 AND 157.5 THEN 'Sudeste'
        WHEN R.DIRECAO BETWEEN 157.5 AND 202.5 THEN 'Sul'
        WHEN R.DIRECAO BETWEEN 202.5 AND 247.5 THEN 'Sudoeste'
        WHEN R.DIRECAO BETWEEN 247.5 AND 292.5 THEN 'Oeste'
        WHEN R.DIRECAO BETWEEN 292.5 AND 337.5 THEN 'Noroeste'
        WHEN R.DIRECAO BETWEEN 337.5 AND 360 THEN 'Norte'
        ELSE NULL
    END AS DIRECAO_CARDINAL,
    R.PRECISAO,
    R.BATERIA,
    R.DHREGISTRO,
    CASE R.TIPO
        WHEN 'A' THEN 'Automático'
        WHEN 'M' THEN 'Manual'
        ELSE 'Desconhecido'
    END AS TIPO_ENVIO,
    R.FONTE,
    R.VERSAOAPP
FROM VIAGEMRASTREAMENTO R
LEFT JOIN CADASTROGERAL M ON R.CDCADASTRO = M.CDCADASTRO
GO

PRINT ''
PRINT '✅ View vw_Rastreamento_Completo criada!'
PRINT ''
PRINT '📝 QUERY DE EXEMPLO:'
PRINT ''
PRINT 'SELECT * FROM vw_Rastreamento_Completo'
PRINT 'WHERE IDVIAGEM = 123'
PRINT 'ORDER BY DHREGISTRO DESC'
PRINT ''
GO

