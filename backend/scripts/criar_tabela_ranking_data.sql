-- Script para criar tabela RANKING_DATA
-- Cache de rankings de motoristas para performance
-- Data: 2026-01-15
-- IMPORTANTE: Este script é seguro e pode ser executado múltiplas vezes

USE [ATLAS_CARGO_PRD]
GO

-- ============================================
-- CRIAR TABELA RANKING_DATA
-- ============================================

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[RANKING_DATA]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[RANKING_DATA] (
        ID INT IDENTITY(1,1) PRIMARY KEY,
        ID_MOTORISTA DECIMAL(15,0) NOT NULL,
        PONTUACAO_GERAL DECIMAL(10,2) DEFAULT 0,
        ENTREGAS_NO_PRAZO INT DEFAULT 0,
        ENTREGAS_TOTAL INT DEFAULT 0,
        AVALIACOES_MEDIA DECIMAL(3,2) DEFAULT 0,
        TEMPO_MEDIO_RESPOSTA INT DEFAULT 0, -- em minutos
        TAXA_ACEITACAO DECIMAL(5,2) DEFAULT 0, -- porcentagem (0-100)
        PERIODO_INICIO DATE NOT NULL,
        PERIODO_FIM DATE NOT NULL,
        DH_CALCULO DATETIME2 DEFAULT SYSUTCDATETIME() NOT NULL,
        FOREIGN KEY (ID_MOTORISTA) REFERENCES [dbo].[CADASTROGERAL](CDCADASTRO)
    );

    -- Índices para performance
    CREATE INDEX IX_RANKING_DATA_ID_MOTORISTA ON [dbo].[RANKING_DATA](ID_MOTORISTA);
    CREATE INDEX IX_RANKING_DATA_PERIODO ON [dbo].[RANKING_DATA](PERIODO_INICIO, PERIODO_FIM);
    CREATE INDEX IX_RANKING_DATA_PONTUACAO ON [dbo].[RANKING_DATA](PONTUACAO_GERAL DESC, PERIODO_INICIO DESC, PERIODO_FIM DESC);

    PRINT '✅ Tabela RANKING_DATA criada com sucesso!';
END
ELSE
BEGIN
    PRINT 'ℹ️ Tabela RANKING_DATA já existe.';
END
GO

PRINT '';
PRINT '========================================';
PRINT '✅ Script de criação da tabela RANKING_DATA concluído!';
PRINT '========================================';
GO
