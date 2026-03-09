-- Script para ajustar tabela MESSAGES para módulo Chat separado
-- Adiciona campos necessários sem remover dados existentes
-- Data: 2026-01-15
-- IMPORTANTE: Este script é seguro e pode ser executado múltiplas vezes

USE [ATLAS_CARGO_PRD]
GO

-- ============================================
-- 1. ADICIONAR CAMPOS À TABELA MESSAGES
-- ============================================

-- Adicionar ID_CONVERSA (se não existir)
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[MESSAGES]') 
    AND name = 'ID_CONVERSA'
)
BEGIN
    ALTER TABLE [dbo].[MESSAGES]
    ADD ID_CONVERSA INT NULL;
    
    PRINT '✅ Campo ID_CONVERSA adicionado à tabela MESSAGES';
END
ELSE
BEGIN
    PRINT 'ℹ️ Campo ID_CONVERSA já existe na tabela MESSAGES';
END
GO

-- Adicionar TIPO (se não existir)
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[MESSAGES]') 
    AND name = 'TIPO'
)
BEGIN
    ALTER TABLE [dbo].[MESSAGES]
    ADD TIPO NVARCHAR(20) DEFAULT 'TEXTO' NULL;
    
    PRINT '✅ Campo TIPO adicionado à tabela MESSAGES';
END
ELSE
BEGIN
    PRINT 'ℹ️ Campo TIPO já existe na tabela MESSAGES';
END
GO

-- Atualizar registros existentes (após garantir que TIPO existe)
IF EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[MESSAGES]') 
    AND name = 'TIPO'
)
BEGIN
    UPDATE [dbo].[MESSAGES]
    SET TIPO = 'TEXTO'
    WHERE TIPO IS NULL;
    
    PRINT '✅ Dados atualizados na coluna TIPO';
END
ELSE
BEGIN
    PRINT 'ℹ️ Campo TIPO já existe na tabela MESSAGES';
END
GO

-- Adicionar DH_LEITURA (se não existir)
-- Nota: READ_BY_RECEIVER já existe, mas vamos adicionar timestamp
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[MESSAGES]') 
    AND name = 'DH_LEITURA'
)
BEGIN
    ALTER TABLE [dbo].[MESSAGES]
    ADD DH_LEITURA DATETIME2 NULL;
    
    PRINT '✅ Campo DH_LEITURA adicionado à tabela MESSAGES';
END
ELSE
BEGIN
    PRINT 'ℹ️ Campo DH_LEITURA já existe na tabela MESSAGES';
END
GO

-- ============================================
-- 2. CRIAR TABELA CONVERSAS (Agrupar Mensagens)
-- ============================================

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[CONVERSAS]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[CONVERSAS] (
        ID INT IDENTITY(1,1) PRIMARY KEY,
        TIPO NVARCHAR(20) NOT NULL, -- 'MOTORISTA', 'VIAGEM', 'GRUPO'
        ID_MOTORISTA DECIMAL(15,0) NULL,
        ID_VIAGEM DECIMAL(15,0) NULL,
        ID_CRIADOR INT NOT NULL,
        ULTIMA_MENSAGEM NVARCHAR(MAX) NULL,
        DH_ULTIMA_MENSAGEM DATETIME2 NULL,
        MENSAGENS_NAO_LIDAS INT DEFAULT 0,
        DH_CRIACAO DATETIME2 DEFAULT SYSUTCDATETIME() NOT NULL,
        FOREIGN KEY (ID_MOTORISTA) REFERENCES [dbo].[CADASTROGERAL](CDCADASTRO),
        FOREIGN KEY (ID_VIAGEM) REFERENCES [dbo].[VIAGEMMESTRE](IDVIAGEM)
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
            ALTER TABLE [dbo].[CONVERSAS]
            ADD CONSTRAINT FK_CONVERSAS_USUARIO 
            FOREIGN KEY (ID_CRIADOR) REFERENCES [dbo].[USUARIO](CDCADASTRO);
            
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
    CREATE INDEX IX_CONVERSAS_TIPO ON [dbo].[CONVERSAS](TIPO);
    CREATE INDEX IX_CONVERSAS_DH_ULTIMA_MENSAGEM ON [dbo].[CONVERSAS](DH_ULTIMA_MENSAGEM DESC);
    CREATE INDEX IX_CONVERSAS_ID_MOTORISTA ON [dbo].[CONVERSAS](ID_MOTORISTA);
    CREATE INDEX IX_CONVERSAS_ID_VIAGEM ON [dbo].[CONVERSAS](ID_VIAGEM);

    PRINT '✅ Tabela CONVERSAS criada com sucesso!';
END
ELSE
BEGIN
    PRINT 'ℹ️ Tabela CONVERSAS já existe.';
END
GO

-- ============================================
-- 3. ADICIONAR FOREIGN KEY PARA ID_CONVERSA (se não existir)
-- ============================================

IF NOT EXISTS (
    SELECT * FROM sys.foreign_keys 
    WHERE parent_object_id = OBJECT_ID(N'[dbo].[MESSAGES]') 
    AND name = 'FK_MESSAGES_CONVERSAS'
)
BEGIN
    -- Primeiro, garantir que a coluna existe
    IF EXISTS (
        SELECT * FROM sys.columns 
        WHERE object_id = OBJECT_ID(N'[dbo].[MESSAGES]') 
        AND name = 'ID_CONVERSA'
    )
    BEGIN
        ALTER TABLE [dbo].[MESSAGES]
        ADD CONSTRAINT FK_MESSAGES_CONVERSAS 
        FOREIGN KEY (ID_CONVERSA) REFERENCES [dbo].[CONVERSAS](ID);
        
        PRINT '✅ Foreign Key FK_MESSAGES_CONVERSAS criada';
    END
END
ELSE
BEGIN
    PRINT 'ℹ️ Foreign Key FK_MESSAGES_CONVERSAS já existe';
END
GO

-- ============================================
-- 4. CRIAR ÍNDICES ADICIONAIS (se não existirem)
-- ============================================

-- Índice para ID_CONVERSA
IF NOT EXISTS (
    SELECT * FROM sys.indexes 
    WHERE object_id = OBJECT_ID(N'[dbo].[MESSAGES]') 
    AND name = 'IX_MESSAGES_ID_CONVERSA'
)
BEGIN
    IF EXISTS (
        SELECT * FROM sys.columns 
        WHERE object_id = OBJECT_ID(N'[dbo].[MESSAGES]') 
        AND name = 'ID_CONVERSA'
    )
    BEGIN
        CREATE INDEX IX_MESSAGES_ID_CONVERSA ON [dbo].[MESSAGES](ID_CONVERSA, CREATED_AT DESC);
        PRINT '✅ Índice IX_MESSAGES_ID_CONVERSA criado';
    END
END
GO

-- Índice para não lidas
IF NOT EXISTS (
    SELECT * FROM sys.indexes 
    WHERE object_id = OBJECT_ID(N'[dbo].[MESSAGES]') 
    AND name = 'IX_MESSAGES_NAO_LIDAS'
)
BEGIN
    CREATE INDEX IX_MESSAGES_NAO_LIDAS 
    ON [dbo].[MESSAGES](ID_CONVERSA, READ_BY_RECEIVER) 
    WHERE READ_BY_RECEIVER = 0;
    
    PRINT '✅ Índice IX_MESSAGES_NAO_LIDAS criado';
END
GO

PRINT '';
PRINT '========================================';
PRINT '✅ Script de ajuste da tabela MESSAGES concluído!';
PRINT '========================================';
GO
