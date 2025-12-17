-- Script para criar índices de performance no banco de dados
-- Versão: 1.0
-- Data: 2025-01-16
-- Descrição: Índices para otimizar consultas frequentes

USE [DIVULGACARGA_PRD]
GO

-- ==========================================
-- ÍNDICES PARA CONVOCACAO
-- ==========================================

-- Índice para buscar convocações por viagem
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CONVOCACAO_IDVIAGEM' AND object_id = OBJECT_ID('CONVOCACAO'))
BEGIN
    CREATE INDEX IX_CONVOCACAO_IDVIAGEM ON CONVOCACAO(IDVIAGEM);
    PRINT '✅ Índice IX_CONVOCACAO_IDVIAGEM criado';
END
ELSE
    PRINT 'ℹ️ Índice IX_CONVOCACAO_IDVIAGEM já existe';

-- Índice para buscar convocações por status
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CONVOCACAO_STATUS' AND object_id = OBJECT_ID('CONVOCACAO'))
BEGIN
    CREATE INDEX IX_CONVOCACAO_STATUS ON CONVOCACAO(STATUS);
    PRINT '✅ Índice IX_CONVOCACAO_STATUS criado';
END
ELSE
    PRINT 'ℹ️ Índice IX_CONVOCACAO_STATUS já existe';

-- Índice para buscar convocações por motorista
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CONVOCACAO_CDCADASTRO' AND object_id = OBJECT_ID('CONVOCACAO'))
BEGIN
    CREATE INDEX IX_CONVOCACAO_CDCADASTRO ON CONVOCACAO(CDCADASTRO_MOTORISTA);
    PRINT '✅ Índice IX_CONVOCACAO_CDCADASTRO criado';
END
ELSE
    PRINT 'ℹ️ Índice IX_CONVOCACAO_CDCADASTRO já existe';

-- Índice composto para buscar convocações por viagem e status (muito usado)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CONVOCACAO_IDVIAGEM_STATUS' AND object_id = OBJECT_ID('CONVOCACAO'))
BEGIN
    CREATE INDEX IX_CONVOCACAO_IDVIAGEM_STATUS ON CONVOCACAO(IDVIAGEM, STATUS);
    PRINT '✅ Índice IX_CONVOCACAO_IDVIAGEM_STATUS criado';
END
ELSE
    PRINT 'ℹ️ Índice IX_CONVOCACAO_IDVIAGEM_STATUS já existe';

-- ==========================================
-- ÍNDICES PARA VIAGEMMESTRE
-- ==========================================

-- Índice para filtrar por situação da viagem
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VIAGEMMESTRE_FGSITVIAGEM' AND object_id = OBJECT_ID('VIAGEMMESTRE'))
BEGIN
    CREATE INDEX IX_VIAGEMMESTRE_FGSITVIAGEM ON VIAGEMMESTRE(FGSITVIAGEM);
    PRINT '✅ Índice IX_VIAGEMMESTRE_FGSITVIAGEM criado';
END
ELSE
    PRINT 'ℹ️ Índice IX_VIAGEMMESTRE_FGSITVIAGEM já existe';

-- Índice para filtrar por tipo de viagem
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VIAGEMMESTRE_CDTIPOVIAGEM' AND object_id = OBJECT_ID('VIAGEMMESTRE'))
BEGIN
    CREATE INDEX IX_VIAGEMMESTRE_CDTIPOVIAGEM ON VIAGEMMESTRE(CDTIPOVIAGEM);
    PRINT '✅ Índice IX_VIAGEMMESTRE_CDTIPOVIAGEM criado';
END
ELSE
    PRINT 'ℹ️ Índice IX_VIAGEMMESTRE_CDTIPOVIAGEM já existe';

-- Índice para filtrar por status ativo
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VIAGEMMESTRE_FGACTIVE' AND object_id = OBJECT_ID('VIAGEMMESTRE'))
BEGIN
    CREATE INDEX IX_VIAGEMMESTRE_FGACTIVE ON VIAGEMMESTRE(FGACTIVE);
    PRINT '✅ Índice IX_VIAGEMMESTRE_FGACTIVE criado';
END
ELSE
    PRINT 'ℹ️ Índice IX_VIAGEMMESTRE_FGACTIVE já existe';

-- Índice para ordenar por data de início prevista
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VIAGEMMESTRE_DTPREVINICIO' AND object_id = OBJECT_ID('VIAGEMMESTRE'))
BEGIN
    CREATE INDEX IX_VIAGEMMESTRE_DTPREVINICIO ON VIAGEMMESTRE(DTPREVINICIO);
    PRINT '✅ Índice IX_VIAGEMMESTRE_DTPREVINICIO criado';
END
ELSE
    PRINT 'ℹ️ Índice IX_VIAGEMMESTRE_DTPREVINICIO já existe';

-- Índice para ordenar por data prevista de finalização
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VIAGEMMESTRE_DTPREVFINAL' AND object_id = OBJECT_ID('VIAGEMMESTRE'))
BEGIN
    CREATE INDEX IX_VIAGEMMESTRE_DTPREVFINAL ON VIAGEMMESTRE(DTPREVFINAL);
    PRINT '✅ Índice IX_VIAGEMMESTRE_DTPREVFINAL criado';
END
ELSE
    PRINT 'ℹ️ Índice IX_VIAGEMMESTRE_DTPREVFINAL já existe';

-- Índice para filtrar por situação da viagem (campo usado em alertas)
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VIAGEMMESTRE_CDSITUACAOVIAGEM' AND object_id = OBJECT_ID('VIAGEMMESTRE'))
BEGIN
    CREATE INDEX IX_VIAGEMMESTRE_CDSITUACAOVIAGEM ON VIAGEMMESTRE(CDSITUACAOVIAGEM);
    PRINT '✅ Índice IX_VIAGEMMESTRE_CDSITUACAOVIAGEM criado';
END
ELSE
    PRINT 'ℹ️ Índice IX_VIAGEMMESTRE_CDSITUACAOVIAGEM já existe';

-- ==========================================
-- ÍNDICES PARA VIAGEMRASTREAMENTO
-- ==========================================

-- Índice para buscar posições por viagem
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'VIAGEMRASTREAMENTO')
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VIAGEMRASTREAMENTO_IDVIAGEM' AND object_id = OBJECT_ID('VIAGEMRASTREAMENTO'))
    BEGIN
        CREATE INDEX IX_VIAGEMRASTREAMENTO_IDVIAGEM ON VIAGEMRASTREAMENTO(IDVIAGEM);
        PRINT '✅ Índice IX_VIAGEMRASTREAMENTO_IDVIAGEM criado';
    END
    ELSE
        PRINT 'ℹ️ Índice IX_VIAGEMRASTREAMENTO_IDVIAGEM já existe';

    -- Índice para ordenar por data de posição
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VIAGEMRASTREAMENTO_DHPOSICAO' AND object_id = OBJECT_ID('VIAGEMRASTREAMENTO'))
    BEGIN
        CREATE INDEX IX_VIAGEMRASTREAMENTO_DHPOSICAO ON VIAGEMRASTREAMENTO(DHPOSICAO);
        PRINT '✅ Índice IX_VIAGEMRASTREAMENTO_DHPOSICAO criado';
    END
    ELSE
        PRINT 'ℹ️ Índice IX_VIAGEMRASTREAMENTO_DHPOSICAO já existe';

    -- Índice composto para buscar últimas posições por viagem
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_VIAGEMRASTREAMENTO_IDVIAGEM_DHPOSICAO' AND object_id = OBJECT_ID('VIAGEMRASTREAMENTO'))
    BEGIN
        CREATE INDEX IX_VIAGEMRASTREAMENTO_IDVIAGEM_DHPOSICAO ON VIAGEMRASTREAMENTO(IDVIAGEM, DHPOSICAO DESC);
        PRINT '✅ Índice IX_VIAGEMRASTREAMENTO_IDVIAGEM_DHPOSICAO criado';
    END
    ELSE
        PRINT 'ℹ️ Índice IX_VIAGEMRASTREAMENTO_IDVIAGEM_DHPOSICAO já existe';
END
ELSE
    PRINT '⚠️ Tabela VIAGEMRASTREAMENTO não encontrada';

-- ==========================================
-- ÍNDICES PARA CLASSEFROTA_CG
-- ==========================================

-- Índice para buscar classes de frota por cadastro
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CLASSEFROTA_CG')
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CLASSEFROTA_CG_CDCADASTRO' AND object_id = OBJECT_ID('CLASSEFROTA_CG'))
    BEGIN
        CREATE INDEX IX_CLASSEFROTA_CG_CDCADASTRO ON CLASSEFROTA_CG(CDCADASTRO);
        PRINT '✅ Índice IX_CLASSEFROTA_CG_CDCADASTRO criado';
    END
    ELSE
        PRINT 'ℹ️ Índice IX_CLASSEFROTA_CG_CDCADASTRO já existe';

    -- Índice para buscar por classe de frota
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CLASSEFROTA_CG_CDCLASSEFROTA' AND object_id = OBJECT_ID('CLASSEFROTA_CG'))
    BEGIN
        CREATE INDEX IX_CLASSEFROTA_CG_CDCLASSEFROTA ON CLASSEFROTA_CG(CDCLASSEFROTA);
        PRINT '✅ Índice IX_CLASSEFROTA_CG_CDCLASSEFROTA criado';
    END
    ELSE
        PRINT 'ℹ️ Índice IX_CLASSEFROTA_CG_CDCLASSEFROTA já existe';
END
ELSE
    PRINT '⚠️ Tabela CLASSEFROTA_CG não encontrada';

-- ==========================================
-- ÍNDICES PARA CIDADE
-- ==========================================

-- Índice para buscar cidades por estado
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CIDADE')
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CIDADE_ESTADO' AND object_id = OBJECT_ID('CIDADE'))
    BEGIN
        CREATE INDEX IX_CIDADE_ESTADO ON CIDADE(ESTADO);
        PRINT '✅ Índice IX_CIDADE_ESTADO criado';
    END
    ELSE
        PRINT 'ℹ️ Índice IX_CIDADE_ESTADO já existe';
END
ELSE
    PRINT '⚠️ Tabela CIDADE não encontrada';

-- ==========================================
-- ÍNDICES PARA ROTEIRO
-- ==========================================

-- Índice para buscar roteiros por cidade de origem
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ROTEIRO')
BEGIN
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ROTEIRO_CDCIDADEORIGEM' AND object_id = OBJECT_ID('ROTEIRO'))
    BEGIN
        CREATE INDEX IX_ROTEIRO_CDCIDADEORIGEM ON ROTEIRO(CDCIDADEORIGEM);
        PRINT '✅ Índice IX_ROTEIRO_CDCIDADEORIGEM criado';
    END
    ELSE
        PRINT 'ℹ️ Índice IX_ROTEIRO_CDCIDADEORIGEM já existe';

    -- Índice para buscar roteiros por cidade de destino
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ROTEIRO_CDCIDADEDESTINO' AND object_id = OBJECT_ID('ROTEIRO'))
    BEGIN
        CREATE INDEX IX_ROTEIRO_CDCIDADEDESTINO ON ROTEIRO(CDCIDADEDESTINO);
        PRINT '✅ Índice IX_ROTEIRO_CDCIDADEDESTINO criado';
    END
    ELSE
        PRINT 'ℹ️ Índice IX_ROTEIRO_CDCIDADEDESTINO já existe';
END
ELSE
    PRINT '⚠️ Tabela ROTEIRO não encontrada';

PRINT '';
PRINT '✅ Script de criação de índices concluído!';
PRINT '📊 Execute para verificar índices criados:';
PRINT '   SELECT name, type_desc FROM sys.indexes WHERE object_id = OBJECT_ID(''TABELA'')';
GO
