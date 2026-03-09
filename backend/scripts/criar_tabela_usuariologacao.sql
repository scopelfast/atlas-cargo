-- ============================================
-- Script para Criar Tabela USUARIOLOGACAO
-- ============================================
-- Tabela para registrar todas as ações dos usuários no sistema
-- ============================================

USE [ATLAS_CARGO_PRD]
GO

-- Verificar se a tabela já existe
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[USUARIOLOGACAO]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[USUARIOLOGACAO] (
        [ID] INT IDENTITY(1,1) NOT NULL,
        [SGUSUARIO] VARCHAR(50) NOT NULL,
        [DHACAO] DATETIME NOT NULL DEFAULT GETDATE(),
        [TIPOACAO] VARCHAR(50) NOT NULL, -- 'Abertura de Tela', 'Inclusão', 'Exclusão', 'Alteração', 'Pesquisa', 'Filtro', etc.
        [MODULO] VARCHAR(100) NULL, -- Nome do módulo/tela (ex: 'gerenciar-viagens', 'gerenciar-roteiros')
        [DESCRICAO] NVARCHAR(500) NULL, -- Descrição da ação
        [DETALHES] NVARCHAR(MAX) NULL, -- JSON com detalhes adicionais (filtros, dados alterados, etc.)
        [IDREGISTRO] VARCHAR(50) NULL, -- ID do registro afetado (se aplicável)
        [TABELA] VARCHAR(100) NULL, -- Nome da tabela afetada (se aplicável)
        [IP] VARCHAR(50) NULL, -- IP do usuário
        [USERAGENT] VARCHAR(500) NULL, -- User Agent do navegador
        [DHMAINTENANCE] DATETIME NULL DEFAULT GETDATE(),
        [SGUSER] VARCHAR(50) NULL,
        [SERVERORIG] VARCHAR(50) NULL,
        
        CONSTRAINT [PK_USUARIOLOGACAO] PRIMARY KEY CLUSTERED ([ID] ASC),
        CONSTRAINT [FK_USUARIOLOGACAO_USUARIO] FOREIGN KEY ([SGUSUARIO]) 
            REFERENCES [dbo].[USUARIO] ([SGUSUARIO])
    );
    
    PRINT '✅ Tabela USUARIOLOGACAO criada com sucesso!';
END
ELSE
BEGIN
    PRINT '⚠️ Tabela USUARIOLOGACAO já existe.';
END
GO

-- Criar índice para melhorar performance nas consultas por usuário
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_USUARIOLOGACAO_SGUSUARIO' AND object_id = OBJECT_ID(N'[dbo].[USUARIOLOGACAO]'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_USUARIOLOGACAO_SGUSUARIO] 
    ON [dbo].[USUARIOLOGACAO] ([SGUSUARIO] ASC, [DHACAO] DESC);
    PRINT '✅ Índice IX_USUARIOLOGACAO_SGUSUARIO criado.';
END
GO

-- Criar índice para consultas por tipo de ação
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_USUARIOLOGACAO_TIPOACAO' AND object_id = OBJECT_ID(N'[dbo].[USUARIOLOGACAO]'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_USUARIOLOGACAO_TIPOACAO] 
    ON [dbo].[USUARIOLOGACAO] ([TIPOACAO] ASC, [DHACAO] DESC);
    PRINT '✅ Índice IX_USUARIOLOGACAO_TIPOACAO criado.';
END
GO

-- Criar índice para consultas por módulo
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_USUARIOLOGACAO_MODULO' AND object_id = OBJECT_ID(N'[dbo].[USUARIOLOGACAO]'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_USUARIOLOGACAO_MODULO] 
    ON [dbo].[USUARIOLOGACAO] ([MODULO] ASC, [DHACAO] DESC);
    PRINT '✅ Índice IX_USUARIOLOGACAO_MODULO criado.';
END
GO

-- Criar índice para consultas por data
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_USUARIOLOGACAO_DHACAO' AND object_id = OBJECT_ID(N'[dbo].[USUARIOLOGACAO]'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_USUARIOLOGACAO_DHACAO] 
    ON [dbo].[USUARIOLOGACAO] ([DHACAO] DESC);
    PRINT '✅ Índice IX_USUARIOLOGACAO_DHACAO criado.';
END
GO

PRINT '';
PRINT '============================================';
PRINT '✅ Script de criação da tabela concluído!';
PRINT '============================================';
PRINT '';
PRINT '📋 Estrutura da tabela:';
PRINT '   - ID: INT IDENTITY (chave primária)';
PRINT '   - SGUSUARIO: VARCHAR(50) (FK para USUARIO)';
PRINT '   - DHACAO: DATETIME (data/hora da ação)';
PRINT '   - TIPOACAO: VARCHAR(50) (tipo da ação)';
PRINT '   - MODULO: VARCHAR(100) (módulo/tela acessada)';
PRINT '   - DESCRICAO: NVARCHAR(500) (descrição da ação)';
PRINT '   - DETALHES: NVARCHAR(MAX) (JSON com detalhes)';
PRINT '   - IDREGISTRO: VARCHAR(50) (ID do registro afetado)';
PRINT '   - TABELA: VARCHAR(100) (tabela afetada)';
PRINT '   - IP: VARCHAR(50) (IP do usuário)';
PRINT '   - USERAGENT: VARCHAR(500) (User Agent)';
PRINT '   - DHMAINTENANCE, SGUSER, SERVERORIG (auditoria)';
PRINT '';
PRINT '📊 Tipos de ação suportados:';
PRINT '   - Abertura de Tela';
PRINT '   - Inclusão';
PRINT '   - Alteração';
PRINT '   - Exclusão';
PRINT '   - Pesquisa';
PRINT '   - Filtro';
PRINT '   - Exportação';
PRINT '   - Impressão';
PRINT '   - Outros';
PRINT '';
GO

