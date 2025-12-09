-- ============================================
-- Script para Criar Tabela USUARIOLOGACESSO
-- ============================================
-- Tabela para registrar acessos e tempo de sessão dos usuários
-- ============================================

USE [DIVULGACARGA_PRD]
GO

-- Verificar se a tabela já existe
IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[USUARIOLOGACESSO]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[USUARIOLOGACESSO] (
        [ID] INT IDENTITY(1,1) NOT NULL,
        [SGUSUARIO] VARCHAR(50) NOT NULL,
        [DHLOGIN] DATETIME NOT NULL DEFAULT GETDATE(),
        [DHLOGOUT] DATETIME NULL,
        [TEMPOSESSAO] INT NULL, -- Tempo em minutos
        [DHMAINTENANCE] DATETIME NULL DEFAULT GETDATE(),
        [SGUSER] VARCHAR(50) NULL,
        [SERVERORIG] VARCHAR(50) NULL,
        
        CONSTRAINT [PK_USUARIOLOGACESSO] PRIMARY KEY CLUSTERED ([ID] ASC),
        CONSTRAINT [FK_USUARIOLOGACESSO_USUARIO] FOREIGN KEY ([SGUSUARIO]) 
            REFERENCES [dbo].[USUARIO] ([SGUSUARIO])
    );
    
    PRINT '✅ Tabela USUARIOLOGACESSO criada com sucesso!';
END
ELSE
BEGIN
    PRINT '⚠️ Tabela USUARIOLOGACESSO já existe.';
END
GO

-- Criar índice para melhorar performance nas consultas
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_USUARIOLOGACESSO_SGUSUARIO' AND object_id = OBJECT_ID(N'[dbo].[USUARIOLOGACESSO]'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_USUARIOLOGACESSO_SGUSUARIO] 
    ON [dbo].[USUARIOLOGACESSO] ([SGUSUARIO] ASC);
    PRINT '✅ Índice IX_USUARIOLOGACESSO_SGUSUARIO criado.';
END
GO

-- Criar índice para consultas por data de login
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_USUARIOLOGACESSO_DHLOGIN' AND object_id = OBJECT_ID(N'[dbo].[USUARIOLOGACESSO]'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_USUARIOLOGACESSO_DHLOGIN] 
    ON [dbo].[USUARIOLOGACESSO] ([DHLOGIN] DESC);
    PRINT '✅ Índice IX_USUARIOLOGACESSO_DHLOGIN criado.';
END
GO

-- Criar índice para consultas de sessões ativas (sem logout)
IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_USUARIOLOGACESSO_DHLOGOUT' AND object_id = OBJECT_ID(N'[dbo].[USUARIOLOGACESSO]'))
BEGIN
    CREATE NONCLUSTERED INDEX [IX_USUARIOLOGACESSO_DHLOGOUT] 
    ON [dbo].[USUARIOLOGACESSO] ([DHLOGOUT] ASC) 
    WHERE [DHLOGOUT] IS NULL;
    PRINT '✅ Índice IX_USUARIOLOGACESSO_DHLOGOUT criado.';
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
PRINT '   - DHLOGIN: DATETIME (data/hora do login)';
PRINT '   - DHLOGOUT: DATETIME (data/hora do logout, NULL se ainda ativo)';
PRINT '   - TEMPOSESSAO: INT (tempo em minutos)';
PRINT '   - DHMAINTENANCE: DATETIME (manutenção)';
PRINT '   - SGUSER: VARCHAR(50) (usuário que fez manutenção)';
PRINT '   - SERVERORIG: VARCHAR(50) (servidor de origem)';
PRINT '';
GO

