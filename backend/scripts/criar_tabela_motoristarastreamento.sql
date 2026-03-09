-- =============================================
-- Tabela: MOTORISTARASTREAMENTO
-- Descrição: Posições GPS do motorista SEM viagem associada
-- Data: 2026-12-03
-- =============================================

-- Criar tabela MOTORISTARASTREAMENTO
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[MOTORISTARASTREAMENTO]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[MOTORISTARASTREAMENTO](
        [IDRASTREAMENTO] [bigint] IDENTITY(1,1) NOT NULL,
        [CDCADASTRO] [decimal](15, 0) NOT NULL,     -- FK CADASTROGERAL (Motorista)
        [LATITUDE] [decimal](10, 8) NOT NULL,
        [LONGITUDE] [decimal](11, 8) NOT NULL,
        [ALTITUDE] [decimal](10, 2) NULL,
        [VELOCIDADE] [decimal](5, 2) NULL,          -- km/h
        [FGSTATUS] [char](1) NULL DEFAULT 'P',      -- P=Parado, M=Movimento
        [DIRECAO] [decimal](5, 2) NULL,             -- 0-360 graus
        [PRECISAO] [int] NULL,                      -- metros
        [DHREGISTRO] [datetime] NOT NULL DEFAULT GETDATE(),
        [TIPO] [char](1) DEFAULT 'M',               -- M=Manual, A=Automático
        [FONTE] [varchar](20) DEFAULT 'APP',        -- APP, WEB, API
        [VERSAOAPP] [varchar](20) NULL,
        [BATERIA] [int] NULL,                       -- % bateria
        
        -- Campos de controle
        [FGACTIVE] [char](1) NULL DEFAULT 'T',
        [DHMAINTENANCE] [datetime] NULL,
        [SGUSER] [varchar](50) NULL,
        [SERVERORIG] [varchar](50) NULL,
        
        CONSTRAINT [PK_MOTORISTARASTREAMENTO] PRIMARY KEY CLUSTERED ([IDRASTREAMENTO] ASC),
        CONSTRAINT [FK_MOTORISTARASTREAMENTO_MOTORISTA] FOREIGN KEY ([CDCADASTRO]) 
            REFERENCES [dbo].[CADASTROGERAL]([CDCADASTRO])
    )
    PRINT '✅ Tabela MOTORISTARASTREAMENTO criada com sucesso!'
END
ELSE
BEGIN
    PRINT '⚠️ Tabela MOTORISTARASTREAMENTO já existe'
END
GO

-- Criar índices
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IDX_MOTORISTARASTREAMENTO_MOTORISTA')
BEGIN
    CREATE INDEX IDX_MOTORISTARASTREAMENTO_MOTORISTA ON MOTORISTARASTREAMENTO(CDCADASTRO, DHREGISTRO DESC)
    PRINT '✅ Índice IDX_MOTORISTARASTREAMENTO_MOTORISTA criado'
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IDX_MOTORISTARASTREAMENTO_DATA')
BEGIN
    CREATE INDEX IDX_MOTORISTARASTREAMENTO_DATA ON MOTORISTARASTREAMENTO(DHREGISTRO DESC)
    PRINT '✅ Índice IDX_MOTORISTARASTREAMENTO_DATA criado'
END
GO

PRINT ''
PRINT '✅ Tabela MOTORISTARASTREAMENTO pronta!'
PRINT ''
PRINT 'USO: Armazena posições GPS do motorista quando NÃO está em viagem'
PRINT ''
GO

