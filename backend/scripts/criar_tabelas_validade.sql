-- =============================================
-- Script: Criar Tabelas de Validade
-- Database: ATLAS_CARGO_PRD
-- =============================================

USE ATLAS_CARGO_PRD;
GO

-- =============================================
-- Tabela: TIPOVALIDADE
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TIPOVALIDADE]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[TIPOVALIDADE](
        [CDTIPOVALIDADE] [smallint] NOT NULL,
        [DSTIPOVALIDADE] [varchar](40) NOT NULL,
        [FGVEICULO] [char](1) NOT NULL DEFAULT 'N',
        [FGMOTORISTA] [char](1) NOT NULL DEFAULT 'N',
        [FGTRANSPORTADOR] [char](1) NOT NULL DEFAULT 'N',
        [FGCLIENTE] [char](1) NULL DEFAULT 'N',
        [FGFORNECEDOR] [char](1) NULL DEFAULT 'N',
        [FGEXIGECERTIFICADORA] [char](1) NOT NULL DEFAULT 'N',
        [DHMAINTENANCE] [datetime] NULL DEFAULT GETDATE(),
        [SGUSER] [varchar](50) NULL,
        [SERVERORIG] [varchar](50) NULL,
        CONSTRAINT [PK_TIPOVALIDADE] PRIMARY KEY CLUSTERED ([CDTIPOVALIDADE] ASC)
    );
    
    PRINT '✅ Tabela TIPOVALIDADE criada com sucesso!';
END
ELSE
BEGIN
    PRINT '⚠️ Tabela TIPOVALIDADE já existe.';
END
GO

-- =============================================
-- Tabela: CONTROLEVALIDADE
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CONTROLEVALIDADE]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[CONTROLEVALIDADE](
        [TPCADASTRO] [char](3) NOT NULL,
        [CDCADASTRO] [decimal](15, 0) NOT NULL,
        [SEQUENCIA] [smallint] NOT NULL,
        [CDTIPOVALIDADE] [smallint] NOT NULL,
        [NRLIBERACAO] [varchar](30) NOT NULL,
        [DTLIBERACAO] [datetime] NOT NULL,
        [DTVALIDADE] [datetime] NOT NULL,
        [CDCERTIFICADORA] [decimal](15, 0) NULL,
        [DSLIBERACAO] [varchar](256) NULL,
        [FGTIPOLANCTO] [char](1) NULL DEFAULT 'M',
        [DHMAINTENANCE] [datetime] NULL DEFAULT GETDATE(),
        [SGUSER] [varchar](50) NULL,
        [SERVERORIG] [varchar](50) NULL,
        CONSTRAINT [PK_CONTROLEVALIDADE] PRIMARY KEY CLUSTERED (
            [TPCADASTRO] ASC,
            [CDCADASTRO] ASC,
            [SEQUENCIA] ASC
        )
    );
    
    -- Chaves estrangeiras
    ALTER TABLE [dbo].[CONTROLEVALIDADE] 
    ADD CONSTRAINT [FK_CONTROLEVALIDADE_TIPOVALIDADE] 
    FOREIGN KEY([CDTIPOVALIDADE]) REFERENCES [dbo].[TIPOVALIDADE]([CDTIPOVALIDADE]);
    
    PRINT '✅ Tabela CONTROLEVALIDADE criada com sucesso!';
END
ELSE
BEGIN
    PRINT '⚠️ Tabela CONTROLEVALIDADE já existe.';
END
GO

-- =============================================
-- Índices
-- =============================================
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_CONTROLEVALIDADE_TIPOVALIDADE')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_CONTROLEVALIDADE_TIPOVALIDADE]
    ON [dbo].[CONTROLEVALIDADE] ([CDTIPOVALIDADE]);
    PRINT '✅ Índice IX_CONTROLEVALIDADE_TIPOVALIDADE criado!';
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_CONTROLEVALIDADE_VALIDADE')
BEGIN
    CREATE NONCLUSTERED INDEX [IX_CONTROLEVALIDADE_VALIDADE]
    ON [dbo].[CONTROLEVALIDADE] ([DTVALIDADE]);
    PRINT '✅ Índice IX_CONTROLEVALIDADE_VALIDADE criado!';
END
GO

PRINT '========================================';
PRINT '✅ Script finalizado com sucesso!';
PRINT '========================================';
GO

