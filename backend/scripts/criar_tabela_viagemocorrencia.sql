-- =============================================
-- Tabela: VIAGEMOCORRENCIA
-- Descrição: Registra as ocorrências/macros das viagens (APP Motorista)
-- Data: 2025-12-03
-- =============================================

-- Criar tabela VIAGEMOCORRENCIA
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMOCORRENCIA]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[VIAGEMOCORRENCIA](
        -- Chave primária
        [IDVIAGEM_OCORRENCIA] [bigint] IDENTITY(1,1) NOT NULL,
        
        -- Relacionamentos
        [IDVIAGEM] [int] NOT NULL,                          -- FK para VIAGEM
        [CDTIPOOCORRENCIA] [smallint] NOT NULL,             -- FK para TIPOOCORRENCIA
        [CDMOTORISTA] [decimal](15, 0) NULL,                -- FK para CADASTROGERAL (Motorista)
        
        -- Dados da ocorrência
        [DTOCORRENCIA] [datetime] NOT NULL DEFAULT GETDATE(), -- Data/Hora do registro
        [DSOBSERVACAO] [varchar](500) NULL,                 -- Observações do motorista
        
        -- Localização GPS
        [LATITUDE] [decimal](10, 7) NULL,                   -- Latitude GPS
        [LONGITUDE] [decimal](10, 7) NULL,                  -- Longitude GPS
        [NRPRECISAO] [decimal](10, 2) NULL,                 -- Precisão em metros
        
        -- Foto da ocorrência
        [DSCAMINHOFOTO] [varchar](500) NULL,                -- Caminho da foto no servidor
        [DSFOTOBASE64] [text] NULL,                         -- Foto em base64 (offline)
        
        -- Controle de sincronização (offline)
        [FGSINCRONIZADO] [char](1) NULL DEFAULT 'S',        -- S=Sincronizado, N=Pendente
        [DTSINCRONIZACAO] [datetime] NULL,                  -- Data da sincronização
        
        -- Dados adicionais
        [DSDEVICE] [varchar](100) NULL,                     -- Modelo do celular
        [DSVERSAO_APP] [varchar](20) NULL,                  -- Versão do APP
        
        -- Campos padrão de auditoria
        [DTCADASTRO] [datetime] NULL DEFAULT GETDATE(),
        [DTALTERACAO] [datetime] NULL,
        [CDCADASTRO] [decimal](15, 0) NULL,
        [CDALTERACAO] [decimal](15, 0) NULL,
        
        -- Campos de controle
        [FGACTIVE] [char](1) NULL DEFAULT 'T',
        [DHMAINTENANCE] [datetime] NULL,
        [SGUSER] [varchar](50) NULL,
        [SERVERORIG] [varchar](50) NULL,
        
        CONSTRAINT [PK_VIAGEMOCORRENCIA] PRIMARY KEY CLUSTERED ([IDVIAGEM_OCORRENCIA] ASC)
    )
    PRINT '✅ Tabela VIAGEMOCORRENCIA criada com sucesso!'
END
ELSE
BEGIN
    PRINT '⚠️ Tabela VIAGEMOCORRENCIA já existe'
    
    -- Adicionar campos se não existirem
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMOCORRENCIA]') AND name = 'FGACTIVE')
    BEGIN
        ALTER TABLE VIAGEMOCORRENCIA ADD [FGACTIVE] [char](1) NULL DEFAULT 'T'
        PRINT '✅ Campo FGACTIVE adicionado'
    END
    
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMOCORRENCIA]') AND name = 'DHMAINTENANCE')
    BEGIN
        ALTER TABLE VIAGEMOCORRENCIA ADD [DHMAINTENANCE] [datetime] NULL
        PRINT '✅ Campo DHMAINTENANCE adicionado'
    END
    
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMOCORRENCIA]') AND name = 'SGUSER')
    BEGIN
        ALTER TABLE VIAGEMOCORRENCIA ADD [SGUSER] [varchar](50) NULL
        PRINT '✅ Campo SGUSER adicionado'
    END
    
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMOCORRENCIA]') AND name = 'SERVERORIG')
    BEGIN
        ALTER TABLE VIAGEMOCORRENCIA ADD [SERVERORIG] [varchar](50) NULL
        PRINT '✅ Campo SERVERORIG adicionado'
    END
    
    -- Renomear colunas se ainda tiverem o prefixo NR
    IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMOCORRENCIA]') AND name = 'NRLATITUDE')
    BEGIN
        EXEC sp_rename 'VIAGEMOCORRENCIA.NRLATITUDE', 'LATITUDE', 'COLUMN'
        PRINT '✅ Campo NRLATITUDE renomeado para LATITUDE'
    END
    
    IF EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMOCORRENCIA]') AND name = 'NRLONGITUDE')
    BEGIN
        EXEC sp_rename 'VIAGEMOCORRENCIA.NRLONGITUDE', 'LONGITUDE', 'COLUMN'
        PRINT '✅ Campo NRLONGITUDE renomeado para LONGITUDE'
    END
END
GO

-- Criar Foreign Keys
IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_VIAGEMOCORRENCIA_TIPOOCORRENCIA')
BEGIN
    ALTER TABLE VIAGEMOCORRENCIA
    ADD CONSTRAINT FK_VIAGEMOCORRENCIA_TIPOOCORRENCIA
    FOREIGN KEY (CDTIPOOCORRENCIA) REFERENCES TIPOOCORRENCIA(CDTIPOOCORRENCIA)
    PRINT '✅ FK TIPOOCORRENCIA criada'
END
GO

-- Criar índices para performance
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_VIAGEMOCORRENCIA_IDVIAGEM')
BEGIN
    CREATE INDEX IX_VIAGEMOCORRENCIA_IDVIAGEM ON VIAGEMOCORRENCIA(IDVIAGEM, DTOCORRENCIA DESC)
    PRINT '✅ Índice IX_VIAGEMOCORRENCIA_IDVIAGEM criado'
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_VIAGEMOCORRENCIA_MOTORISTA')
BEGIN
    CREATE INDEX IX_VIAGEMOCORRENCIA_MOTORISTA ON VIAGEMOCORRENCIA(CDMOTORISTA, DTOCORRENCIA DESC)
    PRINT '✅ Índice IX_VIAGEMOCORRENCIA_MOTORISTA criado'
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_VIAGEMOCORRENCIA_SINCRONIZADO')
BEGIN
    CREATE INDEX IX_VIAGEMOCORRENCIA_SINCRONIZADO ON VIAGEMOCORRENCIA(FGSINCRONIZADO, DTCADASTRO)
    PRINT '✅ Índice IX_VIAGEMOCORRENCIA_SINCRONIZADO criado'
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_VIAGEMOCORRENCIA_TIPO')
BEGIN
    CREATE INDEX IX_VIAGEMOCORRENCIA_TIPO ON VIAGEMOCORRENCIA(CDTIPOOCORRENCIA, DTOCORRENCIA DESC)
    PRINT '✅ Índice IX_VIAGEMOCORRENCIA_TIPO criado'
END
GO

PRINT ''
PRINT '==========================================='
PRINT '✅ Tabela VIAGEMOCORRENCIA criada com sucesso!'
PRINT '==========================================='
PRINT ''
PRINT '📋 ESTRUTURA DA TABELA:'
PRINT ''
PRINT 'CAMPOS PRINCIPAIS:'
PRINT '  - IDVIAGEM_OCORRENCIA (PK, IDENTITY)'
PRINT '  - IDVIAGEM (FK)'
PRINT '  - CDTIPOOCORRENCIA (FK)'
PRINT '  - DTOCORRENCIA (Data/Hora)'
PRINT '  - DSOBSERVACAO (Texto livre)'
PRINT ''
PRINT 'LOCALIZAÇÃO GPS:'
PRINT '  - LATITUDE'
PRINT '  - LONGITUDE'
PRINT '  - NRPRECISAO'
PRINT ''
PRINT 'FOTO:'
PRINT '  - DSCAMINHOFOTO (servidor)'
PRINT '  - DSFOTOBASE64 (offline)'
PRINT ''
PRINT 'SINCRONIZAÇÃO:'
PRINT '  - FGSINCRONIZADO (S/N)'
PRINT '  - DTSINCRONIZACAO'
PRINT ''
PRINT 'CONTROLE:'
PRINT '  - FGACTIVE (T/F)'
PRINT '  - DHMAINTENANCE'
PRINT '  - SGUSER'
PRINT '  - SERVERORIG'
PRINT ''
PRINT '==========================================='
GO

-- Query exemplo: Ver histórico de uma viagem
PRINT ''
PRINT '📝 QUERY EXEMPLO - Histórico de Ocorrências:'
PRINT ''
PRINT 'SELECT '
PRINT '    VO.IDVIAGEM_OCORRENCIA,'
PRINT '    VO.IDVIAGEM,'
PRINT '    TO.DSTIPOOCORRENCIA,'
PRINT '    TO.FGSITUACAO,'
PRINT '    TO.SEQ,'
PRINT '    VO.DTOCORRENCIA,'
PRINT '    VO.DSOBSERVACAO,'
PRINT '    VO.LATITUDE,'
PRINT '    VO.LONGITUDE,'
PRINT '    CASE WHEN VO.DSCAMINHOFOTO IS NOT NULL OR VO.DSFOTOBASE64 IS NOT NULL THEN ''Sim'' ELSE ''Não'' END AS TEM_FOTO,'
PRINT '    VO.FGSINCRONIZADO'
PRINT 'FROM VIAGEMOCORRENCIA VO'
PRINT 'INNER JOIN TIPOOCORRENCIA TO ON VO.CDTIPOOCORRENCIA = TO.CDTIPOOCORRENCIA'
PRINT 'WHERE VO.IDVIAGEM = @IDVIAGEM'
PRINT 'ORDER BY VO.DTOCORRENCIA DESC'
PRINT ''
GO

-- Stored Procedure para validar sequenciamento
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[sp_ValidarSequenciaOcorrencia]') AND type in (N'P', N'PC'))
BEGIN
    DROP PROCEDURE [dbo].[sp_ValidarSequenciaOcorrencia]
    PRINT '⚠️ Procedure antiga removida'
END
GO

CREATE PROCEDURE [dbo].[sp_ValidarSequenciaOcorrencia]
    @IDVIAGEM INT,
    @CDTIPOOCORRENCIA SMALLINT,
    @RESULTADO VARCHAR(500) OUTPUT,
    @PERMITEREGISTRAR BIT OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    
    DECLARE @FGSITUACAO CHAR(2)
    DECLARE @SEQ SMALLINT
    DECLARE @DSTIPOOCORRENCIA VARCHAR(100)
    DECLARE @ULTIMA_OCORRENCIA SMALLINT
    DECLARE @ULTIMA_FGSITUACAO CHAR(2)
    DECLARE @ULTIMA_SEQ SMALLINT
    
    -- Buscar dados da ocorrência que está sendo registrada
    SELECT 
        @FGSITUACAO = FGSITUACAO,
        @SEQ = SEQ,
        @DSTIPOOCORRENCIA = DSTIPOOCORRENCIA
    FROM TIPOOCORRENCIA
    WHERE CDTIPOOCORRENCIA = @CDTIPOOCORRENCIA
    
    -- Buscar última ocorrência registrada na viagem
    SELECT TOP 1
        @ULTIMA_OCORRENCIA = VO.CDTIPOOCORRENCIA,
        @ULTIMA_FGSITUACAO = TO.FGSITUACAO,
        @ULTIMA_SEQ = TO.SEQ
    FROM VIAGEMOCORRENCIA VO
    INNER JOIN TIPOOCORRENCIA TO ON VO.CDTIPOOCORRENCIA = TO.CDTIPOOCORRENCIA
    WHERE VO.IDVIAGEM = @IDVIAGEM
    ORDER BY VO.DTOCORRENCIA DESC
    
    -- REGRA 1: Primeira ocorrência DEVE ser "Viagem - Início" (103)
    IF @ULTIMA_OCORRENCIA IS NULL
    BEGIN
        IF @CDTIPOOCORRENCIA = 103
        BEGIN
            SET @RESULTADO = 'OK - Primeira ocorrência: Viagem - Início'
            SET @PERMITEREGISTRAR = 1
        END
        ELSE
        BEGIN
            SET @RESULTADO = 'ERRO - Primeira ocorrência deve ser: Viagem - Início'
            SET @PERMITEREGISTRAR = 0
        END
        RETURN
    END
    
    -- REGRA 2: Viagem - Reinício (104) só após PARADA
    IF @CDTIPOOCORRENCIA = 104
    BEGIN
        IF @ULTIMA_FGSITUACAO = 'P' OR @ULTIMA_OCORRENCIA IN (110, 111)
        BEGIN
            SET @RESULTADO = 'OK - Reiniciando após parada'
            SET @PERMITEREGISTRAR = 1
        END
        ELSE
        BEGIN
            SET @RESULTADO = 'ERRO - Viagem - Reinício só é permitido após uma PARADA'
            SET @PERMITEREGISTRAR = 0
        END
        RETURN
    END
    
    -- REGRA 3: Sequência 2 só após Sequência 1 (mesma situação)
    IF @SEQ = 2
    BEGIN
        IF @ULTIMA_FGSITUACAO = @FGSITUACAO AND @ULTIMA_SEQ = 1
        BEGIN
            SET @RESULTADO = 'OK - Sequência válida (2 após 1)'
            SET @PERMITEREGISTRAR = 1
        END
        ELSE
        BEGIN
            SET @RESULTADO = 'ERRO - Sequência 2 só após Sequência 1 (mesma situação)'
            SET @PERMITEREGISTRAR = 0
        END
        RETURN
    END
    
    -- REGRA 4: Sequência 3 só após Sequência 2 (mesma situação)
    IF @SEQ = 3
    BEGIN
        IF @ULTIMA_FGSITUACAO = @FGSITUACAO AND @ULTIMA_SEQ = 2
        BEGIN
            SET @RESULTADO = 'OK - Sequência válida (3 após 2)'
            SET @PERMITEREGISTRAR = 1
        END
        ELSE
        BEGIN
            SET @RESULTADO = 'ERRO - Sequência 3 só após Sequência 2 (mesma situação)'
            SET @PERMITEREGISTRAR = 0
        END
        RETURN
    END
    
    -- Se passou por todas as regras, permite registrar
    SET @RESULTADO = 'OK - Ocorrência válida'
    SET @PERMITEREGISTRAR = 1
END
GO

PRINT ''
PRINT '✅ Stored Procedure sp_ValidarSequenciaOcorrencia criada!'
PRINT ''
PRINT '📝 USO:'
PRINT 'DECLARE @MSG VARCHAR(500), @PODE BIT'
PRINT 'EXEC sp_ValidarSequenciaOcorrencia @IDVIAGEM=123, @CDTIPOOCORRENCIA=103, @RESULTADO=@MSG OUTPUT, @PERMITEREGISTRAR=@PODE OUTPUT'
PRINT 'SELECT @MSG AS Mensagem, @PODE AS PodeRegistrar'
PRINT ''
GO

