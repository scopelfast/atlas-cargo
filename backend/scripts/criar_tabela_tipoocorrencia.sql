-- =============================================
-- Tabela: TIPOOCORRENCIA
-- Descrição: Tipos de ocorrências/macros para o APP Motorista
-- Data: 2025-12-03
-- =============================================

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

-- Inserir dados padrão
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
    
    PRINT '✅ Dados inseridos com sucesso! (13 tipos de ocorrência)'
END
ELSE
BEGIN
    PRINT '⚠️ Dados já existem na tabela TIPOOCORRENCIA'
END
GO

-- Criar índices para melhor performance
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

-- Consultar dados inseridos
SELECT 
    CDTIPOOCORRENCIA,
    DSTIPOOCORRENCIA,
    CDEDIPADRAO,
    CASE FGSITUACAO
        WHEN 'T' THEN 'TRÂNSITO'
        WHEN 'C' THEN 'CARREGAMENTO'
        WHEN 'D' THEN 'DESCARGA'
        WHEN 'P' THEN 'PARADA'
    END AS SITUACAO,
    SEQ
FROM TIPOOCORRENCIA
ORDER BY 
    CASE FGSITUACAO 
        WHEN 'T' THEN 1 
        WHEN 'C' THEN 2 
        WHEN 'D' THEN 3 
        WHEN 'P' THEN 4 
    END,
    SEQ,
    CDTIPOOCORRENCIA
GO

PRINT ''
PRINT '==========================================='
PRINT '✅ Script executado com sucesso!'
PRINT '==========================================='
PRINT ''
PRINT '📋 REGRAS DE SEQUENCIAMENTO:'
PRINT '1. Primeira macro DEVE ser: Viagem - Início (103)'
PRINT '2. Viagem - Reinício (104) só após macros de PARADA'
PRINT '3. SEQ 2 só após SEQ 1 (mesma FGSITUACAO)'
PRINT '4. SEQ 3 só após SEQ 2 (mesma FGSITUACAO)'
PRINT ''
GO

