-- Script para ajustar tabela SOS_ALERTS para módulo separado
-- Adiciona campos de tratamento sem remover dados existentes
-- Data: 2025-01-15
-- IMPORTANTE: Este script é seguro e pode ser executado múltiplas vezes

USE [DIVULGACARGA_PRD]
GO

-- ============================================
-- 1. ADICIONAR CAMPOS DE LEITURA (se não existirem)
-- ============================================

-- Adicionar ID_USUARIO_LEU (se não existir)
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[SOS_ALERTS]') 
    AND name = 'ID_USUARIO_LEU'
)
BEGIN
    ALTER TABLE [dbo].[SOS_ALERTS]
    ADD ID_USUARIO_LEU DECIMAL(15,0) NULL;
    
    PRINT '✅ Campo ID_USUARIO_LEU adicionado à tabela SOS_ALERTS';
END
ELSE
BEGIN
    PRINT 'ℹ️ Campo ID_USUARIO_LEU já existe na tabela SOS_ALERTS';
END
GO

-- Adicionar DH_LEITURA (se não existir)
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[SOS_ALERTS]') 
    AND name = 'DH_LEITURA'
)
BEGIN
    ALTER TABLE [dbo].[SOS_ALERTS]
    ADD DH_LEITURA DATETIME2 NULL;
    
    PRINT '✅ Campo DH_LEITURA adicionado à tabela SOS_ALERTS';
END
ELSE
BEGIN
    PRINT 'ℹ️ Campo DH_LEITURA já existe na tabela SOS_ALERTS';
END
GO

-- Adicionar TEMPO_RESPOSTA (se não existir)
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[SOS_ALERTS]') 
    AND name = 'TEMPO_RESPOSTA'
)
BEGIN
    ALTER TABLE [dbo].[SOS_ALERTS]
    ADD TEMPO_RESPOSTA INT NULL; -- em minutos
    
    PRINT '✅ Campo TEMPO_RESPOSTA adicionado à tabela SOS_ALERTS';
END
ELSE
BEGIN
    PRINT 'ℹ️ Campo TEMPO_RESPOSTA já existe na tabela SOS_ALERTS';
END
GO

-- Calcular tempo de resposta para registros já resolvidos (após garantir que TEMPO_RESPOSTA existe)
IF EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[SOS_ALERTS]') 
    AND name = 'TEMPO_RESPOSTA'
)
BEGIN
    IF EXISTS (
        SELECT * FROM sys.columns 
        WHERE object_id = OBJECT_ID(N'[dbo].[SOS_ALERTS]') 
        AND name = 'CREATED_AT'
    )
    AND EXISTS (
        SELECT * FROM sys.columns 
        WHERE object_id = OBJECT_ID(N'[dbo].[SOS_ALERTS]') 
        AND name = 'RESOLVED_AT'
    )
    BEGIN
        UPDATE [dbo].[SOS_ALERTS]
        SET TEMPO_RESPOSTA = DATEDIFF(MINUTE, CREATED_AT, RESOLVED_AT)
        WHERE RESOLVED_AT IS NOT NULL 
          AND CREATED_AT IS NOT NULL 
          AND TEMPO_RESPOSTA IS NULL;
        
        PRINT '✅ Tempo de resposta calculado para registros existentes';
    END
END
GO

-- ============================================
-- 2. CRIAR TABELA SOS_HISTORY (Log de Ações)
-- ============================================

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SOS_HISTORY]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[SOS_HISTORY] (
        ID INT IDENTITY(1,1) PRIMARY KEY,
        ID_SOS INT NOT NULL,
        ID_USUARIO DECIMAL(15,0) NOT NULL,
        ACAO NVARCHAR(50) NOT NULL, -- 'LEU', 'TRATOU', 'CANCELOU', 'ATUALIZOU'
        STATUS_ANTERIOR NVARCHAR(50) NULL,
        STATUS_NOVO NVARCHAR(50) NULL,
        OBSERVACOES NVARCHAR(MAX) NULL,
        DH_ACAO DATETIME2 DEFAULT SYSUTCDATETIME() NOT NULL,
        FOREIGN KEY (ID_SOS) REFERENCES [dbo].[SOS_ALERTS](ID)
    );
    
    -- Adicionar foreign key para USUARIO apenas se a tabela existir
    IF EXISTS (
        SELECT * FROM sys.tables WHERE name = 'USUARIO' AND schema_id = SCHEMA_ID('dbo')
    )
    BEGIN
        IF EXISTS (
            SELECT * FROM sys.columns 
            WHERE object_id = OBJECT_ID(N'[dbo].[USUARIO]') 
            AND name = 'CDCADASTRO'
        )
        BEGIN
            ALTER TABLE [dbo].[SOS_HISTORY]
            ADD CONSTRAINT FK_SOS_HISTORY_USUARIO 
            FOREIGN KEY (ID_USUARIO) REFERENCES [dbo].[USUARIO](CDCADASTRO);
            
            PRINT '✅ Foreign Key para USUARIO criada';
        END
        ELSE
        BEGIN
            PRINT '⚠️ Tabela USUARIO existe mas não tem coluna CDCADASTRO. Foreign key não criada.';
        END
    END
    ELSE
    BEGIN
        PRINT '⚠️ Tabela USUARIO não encontrada. Foreign key não criada.';
    END

    -- Índices para performance
    CREATE INDEX IX_SOS_HISTORY_ID_SOS ON [dbo].[SOS_HISTORY](ID_SOS);
    CREATE INDEX IX_SOS_HISTORY_DH_ACAO ON [dbo].[SOS_HISTORY](DH_ACAO DESC);
    CREATE INDEX IX_SOS_HISTORY_ID_USUARIO ON [dbo].[SOS_HISTORY](ID_USUARIO);

    PRINT '✅ Tabela SOS_HISTORY criada com sucesso!';
END
ELSE
BEGIN
    PRINT 'ℹ️ Tabela SOS_HISTORY já existe.';
END
GO

-- ============================================
-- 3. CRIAR ÍNDICES ADICIONAIS (se não existirem)
-- ============================================

-- Índice para STATUS (pode já existir, mas verificamos)
IF NOT EXISTS (
    SELECT * FROM sys.indexes 
    WHERE object_id = OBJECT_ID(N'[dbo].[SOS_ALERTS]') 
    AND name = 'IX_SOS_ALERTS_STATUS_PENDENTE'
)
BEGIN
    CREATE INDEX IX_SOS_ALERTS_STATUS_PENDENTE 
    ON [dbo].[SOS_ALERTS](STATUS, CREATED_AT DESC) 
    WHERE STATUS = 'active';
    
    PRINT '✅ Índice IX_SOS_ALERTS_STATUS_PENDENTE criado';
END
GO

PRINT '';
PRINT '========================================';
PRINT '✅ Script de ajuste da tabela SOS_ALERTS concluído!';
PRINT '========================================';
GO
