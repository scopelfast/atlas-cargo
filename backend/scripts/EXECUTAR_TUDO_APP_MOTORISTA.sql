-- =============================================
-- SCRIPT COMPLETO - APP MOTORISTA
-- Descrição: Cria todas as tabelas necessárias para o APP
-- Data: 2025-12-03
-- Versão: 1.0.0
-- =============================================
--
-- EXECUÇÃO: Copiar e colar TUDO no SQL Server Management Studio
--
-- TABELAS QUE SERÃO CRIADAS/ATUALIZADAS:
--   1. TIPOOCORRENCIA (nova)
--   2. VIAGEMOCORRENCIA (nova)
--   3. VIAGEMRASTREAMENTO (atualizada)
--   4. MOTORISTARASTREAMENTO (nova)
--
-- =============================================

PRINT ''
PRINT '╔════════════════════════════════════════════════════════════╗'
PRINT '║                                                            ║'
PRINT '║     📱 APP MOTORISTA - INSTALAÇÃO COMPLETA                ║'
PRINT '║                                                            ║'
PRINT '╚════════════════════════════════════════════════════════════╝'
PRINT ''
PRINT 'Iniciando instalação...'
PRINT ''
GO

-- =============================================
-- SCRIPT 1: TIPOOCORRENCIA
-- =============================================

PRINT ''
PRINT '=========================================='
PRINT '  SCRIPT 1/3: TIPOOCORRENCIA'
PRINT '=========================================='
PRINT ''
GO

-- Criar tabela TIPOOCORRENCIA
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[TIPOOCORRENCIA]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[TIPOOCORRENCIA](
        [CDTIPOOCORRENCIA] [smallint] NOT NULL,
        [DSTIPOOCORRENCIA] [varchar](100) NOT NULL,
        [CDEDIPADRAO] [varchar](5) NULL,
        [FGSITUACAO] [char](2) NULL,
        [SEQ] [smallint] NULL,
        
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
        
        CONSTRAINT [PK_TIPOOCORRENCIA] PRIMARY KEY CLUSTERED ([CDTIPOOCORRENCIA] ASC)
    )
    PRINT '✅ Tabela TIPOOCORRENCIA criada com sucesso!'
END
ELSE
BEGIN
    PRINT '⚠️ Tabela TIPOOCORRENCIA já existe'
    
    -- Adicionar campos se não existirem
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[TIPOOCORRENCIA]') AND name = 'FGACTIVE')
    BEGIN
        ALTER TABLE TIPOOCORRENCIA ADD [FGACTIVE] [char](1) NULL DEFAULT 'T'
        PRINT '✅ Campo FGACTIVE adicionado'
    END
    
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[TIPOOCORRENCIA]') AND name = 'DHMAINTENANCE')
    BEGIN
        ALTER TABLE TIPOOCORRENCIA ADD [DHMAINTENANCE] [datetime] NULL
        PRINT '✅ Campo DHMAINTENANCE adicionado'
    END
    
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[TIPOOCORRENCIA]') AND name = 'SGUSER')
    BEGIN
        ALTER TABLE TIPOOCORRENCIA ADD [SGUSER] [varchar](50) NULL
        PRINT '✅ Campo SGUSER adicionado'
    END
    
    IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[TIPOOCORRENCIA]') AND name = 'SERVERORIG')
    BEGIN
        ALTER TABLE TIPOOCORRENCIA ADD [SERVERORIG] [varchar](50) NULL
        PRINT '✅ Campo SERVERORIG adicionado'
    END
END
GO

-- Inserir dados padrão (13 tipos de macro)
IF NOT EXISTS (SELECT * FROM TIPOOCORRENCIA WHERE CDTIPOOCORRENCIA = 103)
BEGIN
    INSERT INTO TIPOOCORRENCIA (CDTIPOOCORRENCIA, DSTIPOOCORRENCIA, CDEDIPADRAO, FGSITUACAO, SEQ) VALUES
    (103, 'Viagem - Início', '99', 'T', 1),
    (151, 'Carga - Chegada', '99', 'C', 1),
    (109, 'Carga - Início', '99', 'C', 2),
    (110, 'Carga - Fim', '99', 'C', 3),
    (159, 'Descarga - Chegada', '99', 'D', 1),
    (192, 'Descarga - Início', '99', 'D', 2),
    (111, 'Descarga - Fim', '99', 'D', 3),
    (105, 'Parada - Alimentação/Banheiro', '99', 'P', 1),
    (106, 'Parada - Abastecimento', '99', 'P', 1),
    (107, 'Parada - Descanso/Pernoite', '99', 'P', 1),
    (26, 'Retido - Posto Fiscal/Polícia', '26', 'P', 1),
    (58, 'Parada - Manutenção', '99', 'P', 1),
    (104, 'Viagem - Reinício', '99', 'T', 1);
    
    PRINT '✅ 13 tipos de ocorrência inseridos!'
END
ELSE
BEGIN
    PRINT '⚠️ Dados já existem na tabela TIPOOCORRENCIA'
END
GO

-- Criar índices
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TIPOOCORRENCIA_FGSITUACAO')
BEGIN
    CREATE INDEX IX_TIPOOCORRENCIA_FGSITUACAO ON TIPOOCORRENCIA(FGSITUACAO)
    PRINT '✅ Índice IX_TIPOOCORRENCIA_FGSITUACAO criado'
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_TIPOOCORRENCIA_SEQ')
BEGIN
    CREATE INDEX IX_TIPOOCORRENCIA_SEQ ON TIPOOCORRENCIA(SEQ, FGSITUACAO)
    PRINT '✅ Índice IX_TIPOOCORRENCIA_SEQ criado'
END
GO

PRINT ''
PRINT '✅ Script 1/3 concluído!'
PRINT ''
GO

-- =============================================
-- SCRIPT 2: VIAGEMOCORRENCIA
-- =============================================

PRINT ''
PRINT '=========================================='
PRINT '  SCRIPT 2/3: VIAGEMOCORRENCIA'
PRINT '=========================================='
PRINT ''
GO

-- Criar tabela VIAGEMOCORRENCIA
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMOCORRENCIA]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[VIAGEMOCORRENCIA](
        [IDVIAGEM_OCORRENCIA] [bigint] IDENTITY(1,1) NOT NULL,
        [IDVIAGEM] [int] NOT NULL,
        [CDTIPOOCORRENCIA] [smallint] NOT NULL,
        [CDMOTORISTA] [decimal](15, 0) NULL,
        [DTOCORRENCIA] [datetime] NOT NULL DEFAULT GETDATE(),
        [DSOBSERVACAO] [varchar](500) NULL,
        [LATITUDE] [decimal](10, 7) NULL,
        [LONGITUDE] [decimal](10, 7) NULL,
        [NRPRECISAO] [decimal](10, 2) NULL,
        [DSCAMINHOFOTO] [varchar](500) NULL,
        [DSFOTOBASE64] [text] NULL,
        [FGSINCRONIZADO] [char](1) NULL DEFAULT 'S',
        [DTSINCRONIZACAO] [datetime] NULL,
        [DSDEVICE] [varchar](100) NULL,
        [DSVERSAO_APP] [varchar](20) NULL,
        [DTCADASTRO] [datetime] NULL DEFAULT GETDATE(),
        [DTALTERACAO] [datetime] NULL,
        [CDCADASTRO] [decimal](15, 0) NULL,
        [CDALTERACAO] [decimal](15, 0) NULL,
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

-- FK
IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_VIAGEMOCORRENCIA_TIPOOCORRENCIA')
BEGIN
    ALTER TABLE VIAGEMOCORRENCIA
    ADD CONSTRAINT FK_VIAGEMOCORRENCIA_TIPOOCORRENCIA
    FOREIGN KEY (CDTIPOOCORRENCIA) REFERENCES TIPOOCORRENCIA(CDTIPOOCORRENCIA)
    PRINT '✅ FK TIPOOCORRENCIA criada'
END
GO

-- Índices
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

-- Stored Procedure de validação
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[sp_ValidarSequenciaOcorrencia]') AND type in (N'P', N'PC'))
BEGIN
    DROP PROCEDURE [dbo].[sp_ValidarSequenciaOcorrencia]
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
    
    SELECT 
        @FGSITUACAO = FGSITUACAO,
        @SEQ = SEQ,
        @DSTIPOOCORRENCIA = DSTIPOOCORRENCIA
    FROM TIPOOCORRENCIA
    WHERE CDTIPOOCORRENCIA = @CDTIPOOCORRENCIA
    
    SELECT TOP 1
        @ULTIMA_OCORRENCIA = VO.CDTIPOOCORRENCIA,
        @ULTIMA_FGSITUACAO = TO.FGSITUACAO,
        @ULTIMA_SEQ = TO.SEQ
    FROM VIAGEMOCORRENCIA VO
    INNER JOIN TIPOOCORRENCIA TO ON VO.CDTIPOOCORRENCIA = TO.CDTIPOOCORRENCIA
    WHERE VO.IDVIAGEM = @IDVIAGEM
    ORDER BY VO.DTOCORRENCIA DESC
    
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
    
    IF @CDTIPOOCORRENCIA = 104
    BEGIN
        IF @ULTIMA_FGSITUACAO = 'P' OR @ULTIMA_OCORRENCIA IN (110, 111)
        BEGIN
            SET @RESULTADO = 'OK - Reiniciando após parada'
            SET @PERMITEREGISTRAR = 1
        END
        ELSE
        BEGIN
            SET @RESULTADO = 'ERRO - Viagem - Reinício só após PARADA'
            SET @PERMITEREGISTRAR = 0
        END
        RETURN
    END
    
    IF @SEQ = 2
    BEGIN
        IF @ULTIMA_FGSITUACAO = @FGSITUACAO AND @ULTIMA_SEQ = 1
        BEGIN
            SET @RESULTADO = 'OK - Sequência válida (2 após 1)'
            SET @PERMITEREGISTRAR = 1
        END
        ELSE
        BEGIN
            SET @RESULTADO = 'ERRO - Sequência 2 só após Sequência 1'
            SET @PERMITEREGISTRAR = 0
        END
        RETURN
    END
    
    IF @SEQ = 3
    BEGIN
        IF @ULTIMA_FGSITUACAO = @FGSITUACAO AND @ULTIMA_SEQ = 2
        BEGIN
            SET @RESULTADO = 'OK - Sequência válida (3 após 2)'
            SET @PERMITEREGISTRAR = 1
        END
        ELSE
        BEGIN
            SET @RESULTADO = 'ERRO - Sequência 3 só após Sequência 2'
            SET @PERMITEREGISTRAR = 0
        END
        RETURN
    END
    
    SET @RESULTADO = 'OK - Ocorrência válida'
    SET @PERMITEREGISTRAR = 1
END
GO

PRINT ''
PRINT '✅ Script 1/3 concluído!'
PRINT ''
GO

-- =============================================
-- SCRIPT 2: VIAGEMOCORRENCIA
-- (já incluído acima)
-- =============================================

PRINT ''
PRINT '✅ Script 2/3 concluído!'
PRINT ''
GO

-- =============================================
-- SCRIPT 3: ATUALIZAR VIAGEMRASTREAMENTO
-- =============================================

PRINT ''
PRINT '=========================================='
PRINT '  SCRIPT 3/3: VIAGEMRASTREAMENTO'
PRINT '=========================================='
PRINT ''
GO

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

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMRASTREAMENTO]') AND name = 'FGACTIVE')
BEGIN
    ALTER TABLE VIAGEMRASTREAMENTO ADD [FGACTIVE] [char](1) NULL DEFAULT 'T'
    PRINT '✅ Campo FGACTIVE adicionado'
END
GO

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMRASTREAMENTO]') AND name = 'DHMAINTENANCE')
BEGIN
    ALTER TABLE VIAGEMRASTREAMENTO ADD [DHMAINTENANCE] [datetime] NULL
    PRINT '✅ Campo DHMAINTENANCE adicionado'
END
GO

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMRASTREAMENTO]') AND name = 'SGUSER')
BEGIN
    ALTER TABLE VIAGEMRASTREAMENTO ADD [SGUSER] [varchar](50) NULL
    PRINT '✅ Campo SGUSER adicionado'
END
GO

IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[VIAGEMRASTREAMENTO]') AND name = 'SERVERORIG')
BEGIN
    ALTER TABLE VIAGEMRASTREAMENTO ADD [SERVERORIG] [varchar](50) NULL
    PRINT '✅ Campo SERVERORIG adicionado'
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IDX_RASTREAMENTO_STATUS')
BEGIN
    CREATE INDEX IDX_RASTREAMENTO_STATUS ON VIAGEMRASTREAMENTO(FGSTATUS, DHREGISTRO DESC)
    PRINT '✅ Índice IDX_RASTREAMENTO_STATUS criado'
END
GO

-- View
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
PRINT '✅ Script 3/4 concluído!'
PRINT ''
GO

-- =============================================
-- SCRIPT 4: MOTORISTARASTREAMENTO
-- =============================================

PRINT ''
PRINT '=========================================='
PRINT '  SCRIPT 4/4: MOTORISTARASTREAMENTO'
PRINT '=========================================='
PRINT ''
GO

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[MOTORISTARASTREAMENTO]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[MOTORISTARASTREAMENTO](
        [IDRASTREAMENTO] [bigint] IDENTITY(1,1) NOT NULL,
        [CDCADASTRO] [decimal](15, 0) NOT NULL,
        [LATITUDE] [decimal](10, 8) NOT NULL,
        [LONGITUDE] [decimal](11, 8) NOT NULL,
        [ALTITUDE] [decimal](10, 2) NULL,
        [VELOCIDADE] [decimal](5, 2) NULL,
        [FGSTATUS] [char](1) NULL DEFAULT 'P',
        [DIRECAO] [decimal](5, 2) NULL,
        [PRECISAO] [int] NULL,
        [DHREGISTRO] [datetime] NOT NULL DEFAULT GETDATE(),
        [TIPO] [char](1) DEFAULT 'M',
        [FONTE] [varchar](20) DEFAULT 'APP',
        [VERSAOAPP] [varchar](20) NULL,
        [BATERIA] [int] NULL,
        [FGACTIVE] [char](1) NULL DEFAULT 'T',
        [DHMAINTENANCE] [datetime] NULL,
        [SGUSER] [varchar](50) NULL,
        [SERVERORIG] [varchar](50) NULL,
        
        CONSTRAINT [PK_MOTORISTARASTREAMENTO] PRIMARY KEY CLUSTERED ([IDRASTREAMENTO] ASC),
        CONSTRAINT [FK_MOTORISTARASTREAMENTO_MOTORISTA] FOREIGN KEY ([CDCADASTRO]) 
            REFERENCES [dbo].[CADASTROGERAL]([CDCADASTRO])
    )
    PRINT '✅ Tabela MOTORISTARASTREAMENTO criada!'
END
ELSE
BEGIN
    PRINT '⚠️ Tabela MOTORISTARASTREAMENTO já existe'
END
GO

IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IDX_MOTORISTARASTREAMENTO_MOTORISTA')
BEGIN
    CREATE INDEX IDX_MOTORISTARASTREAMENTO_MOTORISTA ON MOTORISTARASTREAMENTO(CDCADASTRO, DHREGISTRO DESC)
    PRINT '✅ Índice criado'
END
GO

PRINT ''
PRINT '✅ Script 4/4 concluído!'
PRINT ''
GO

-- =============================================
-- FINALIZAÇÃO
-- =============================================

PRINT ''
PRINT '╔════════════════════════════════════════════════════════════╗'
PRINT '║                                                            ║'
PRINT '║     ✅ INSTALAÇÃO COMPLETA!                                ║'
PRINT '║                                                            ║'
PRINT '╚════════════════════════════════════════════════════════════╝'
PRINT ''
PRINT '📊 RESUMO:'
PRINT ''
PRINT '✅ 1. TIPOOCORRENCIA - 13 tipos de macro cadastrados'
PRINT '✅ 2. VIAGEMOCORRENCIA - Tabela de histórico criada'
PRINT '✅ 3. VIAGEMRASTREAMENTO - Campos GPS adicionados'
PRINT '✅ 4. MOTORISTARASTREAMENTO - GPS sem viagem criada'
PRINT '✅ 5. Stored Procedure de validação criada'
PRINT '✅ 6. View vw_Rastreamento_Completo criada'
PRINT ''
PRINT '🎯 PRÓXIMOS PASSOS:'
PRINT ''
PRINT '1. Reiniciar o backend (se necessário)'
PRINT '2. Acessar no celular: http://192.168.1.173:3000/motorista/'
PRINT '3. Fazer logout e login novamente'
PRINT '4. Testar todas as funcionalidades!'
PRINT ''
PRINT '📋 FUNCIONALIDADES DISPONÍVEIS:'
PRINT ''
PRINT '✅ GPS com velocidade e status (parado/movimento)'
PRINT '✅ Macros com sequenciamento validado'
PRINT '✅ Foto nas macros'
PRINT '✅ Histórico de ocorrências'
PRINT '✅ Viagens em andamento'
PRINT '✅ Sistema offline completo'
PRINT ''
PRINT '╔════════════════════════════════════════════════════════════╗'
PRINT '║     🎉 TUDO PRONTO! BOA SORTE! 🚀                          ║'
PRINT '╚════════════════════════════════════════════════════════════╝'
PRINT ''
GO

