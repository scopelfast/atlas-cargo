-- Script para ajustar tabela ALERTS para módulo separado
-- Adiciona campos de tratamento sem remover dados existentes
-- Data: 2025-01-15
-- IMPORTANTE: Este script é seguro e pode ser executado múltiplas vezes

USE [DIVULGACARGA_PRD]
GO

-- ============================================
-- 1. ADICIONAR CAMPOS DE TRATAMENTO (se não existirem)
-- ============================================

-- Adicionar STATUS (se não existir)
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') 
    AND name = 'STATUS'
)
BEGIN
    ALTER TABLE [dbo].[ALERTS]
    ADD STATUS NVARCHAR(50) DEFAULT 'Pendente' NOT NULL;
    
    PRINT '✅ Campo STATUS adicionado à tabela ALERTS';
END
ELSE
BEGIN
    PRINT 'ℹ️ Campo STATUS já existe na tabela ALERTS';
END
GO

-- Atualizar registros existentes baseado em RESOLVED (após garantir que STATUS existe)
IF EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') 
    AND name = 'STATUS'
)
BEGIN
    IF EXISTS (
        SELECT * FROM sys.columns 
        WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') 
        AND name = 'RESOLVED'
    )
    BEGIN
        -- Atualizar apenas registros que foram resolvidos mas ainda têm STATUS 'Pendente'
        UPDATE [dbo].[ALERTS]
        SET STATUS = 'Tratado'
        WHERE RESOLVED = 1 AND STATUS = 'Pendente';
        
        PRINT '✅ Dados migrados de RESOLVED para STATUS';
    END
END
GO

-- Adicionar ID_USUARIO_LEU (se não existir)
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') 
    AND name = 'ID_USUARIO_LEU'
)
BEGIN
    ALTER TABLE [dbo].[ALERTS]
    ADD ID_USUARIO_LEU INT NULL;
    
    PRINT '✅ Campo ID_USUARIO_LEU adicionado à tabela ALERTS';
END
ELSE
BEGIN
    PRINT 'ℹ️ Campo ID_USUARIO_LEU já existe na tabela ALERTS';
END
GO

-- Adicionar DH_LEITURA (se não existir)
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') 
    AND name = 'DH_LEITURA'
)
BEGIN
    ALTER TABLE [dbo].[ALERTS]
    ADD DH_LEITURA DATETIME2 NULL;
    
    PRINT '✅ Campo DH_LEITURA adicionado à tabela ALERTS';
END
ELSE
BEGIN
    PRINT 'ℹ️ Campo DH_LEITURA já existe na tabela ALERTS';
END
GO

-- Adicionar ID_USUARIO_TRATOU (se não existir)
-- Nota: RESOLVED_BY já existe, mas vamos criar um campo padronizado
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') 
    AND name = 'ID_USUARIO_TRATOU'
)
BEGIN
    ALTER TABLE [dbo].[ALERTS]
    ADD ID_USUARIO_TRATOU INT NULL;
    
    PRINT '✅ Campo ID_USUARIO_TRATOU adicionado à tabela ALERTS';
END
ELSE
BEGIN
    PRINT 'ℹ️ Campo ID_USUARIO_TRATOU já existe na tabela ALERTS';
END
GO

-- Adicionar DH_TRATAMENTO (se não existir)
-- Nota: RESOLVED_AT já existe, mas vamos criar um campo padronizado
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') 
    AND name = 'DH_TRATAMENTO'
)
BEGIN
    ALTER TABLE [dbo].[ALERTS]
    ADD DH_TRATAMENTO DATETIME2 NULL;
    
    PRINT '✅ Campo DH_TRATAMENTO adicionado à tabela ALERTS';
END
ELSE
BEGIN
    PRINT 'ℹ️ Campo DH_TRATAMENTO já existe na tabela ALERTS';
END
GO

-- Copiar dados de RESOLVED_AT para DH_TRATAMENTO (após garantir que coluna existe)
IF EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') 
    AND name = 'DH_TRATAMENTO'
)
AND EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') 
    AND name = 'RESOLVED_AT'
)
BEGIN
    UPDATE [dbo].[ALERTS]
    SET DH_TRATAMENTO = RESOLVED_AT
    WHERE RESOLVED_AT IS NOT NULL AND DH_TRATAMENTO IS NULL;
    
    PRINT '✅ Dados migrados de RESOLVED_AT para DH_TRATAMENTO';
END
GO

-- Adicionar OBSERVACOES (se não existir)
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') 
    AND name = 'OBSERVACOES'
)
BEGIN
    ALTER TABLE [dbo].[ALERTS]
    ADD OBSERVACOES NVARCHAR(MAX) NULL;
    
    PRINT '✅ Campo OBSERVACOES adicionado à tabela ALERTS';
END
ELSE
BEGIN
    PRINT 'ℹ️ Campo OBSERVACOES já existe na tabela ALERTS';
END
GO

-- Adicionar PRIORIDADE (se não existir)
-- Nota: SEVERITY já existe, mas vamos manter ambos para compatibilidade
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') 
    AND name = 'PRIORIDADE'
)
BEGIN
    ALTER TABLE [dbo].[ALERTS]
    ADD PRIORIDADE NVARCHAR(20) DEFAULT 'Normal' NULL;
    
    PRINT '✅ Campo PRIORIDADE adicionado à tabela ALERTS';
END
ELSE
BEGIN
    PRINT 'ℹ️ Campo PRIORIDADE já existe na tabela ALERTS';
END
GO

-- Mapear SEVERITY para PRIORIDADE (após garantir que coluna existe)
-- Usar sp_executesql para evitar validação prévia do SQL Server
IF EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') 
    AND name = 'PRIORIDADE'
)
AND EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') 
    AND name = 'SEVERITY'
)
BEGIN
    DECLARE @sqlPrio NVARCHAR(MAX);
    SET @sqlPrio = N'
        UPDATE [dbo].[ALERTS]
        SET PRIORIDADE = CASE SEVERITY
            WHEN ''low'' THEN ''Baixa''
            WHEN ''medium'' THEN ''Normal''
            WHEN ''high'' THEN ''Alta''
            ELSE ''Normal''
        END
        WHERE PRIORIDADE IS NULL OR PRIORIDADE = ''Normal'';
    ';
    EXEC sp_executesql @sqlPrio;
    
    PRINT '✅ Dados migrados de SEVERITY para PRIORIDADE';
END
GO

-- ============================================
-- 2. CRIAR TABELA ALERT_HISTORY (Log de Ações)
-- ============================================

IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[ALERT_HISTORY]') AND type in (N'U'))
BEGIN
    CREATE TABLE [dbo].[ALERT_HISTORY] (
        ID INT IDENTITY(1,1) PRIMARY KEY,
        ID_ALERT INT NOT NULL,
        ID_USUARIO INT NOT NULL,
        ACAO NVARCHAR(50) NOT NULL, -- 'LEU', 'TRATOU', 'CANCELOU', 'ATUALIZOU'
        STATUS_ANTERIOR NVARCHAR(50) NULL,
        STATUS_NOVO NVARCHAR(50) NULL,
        OBSERVACOES NVARCHAR(MAX) NULL,
        DH_ACAO DATETIME2 DEFAULT SYSUTCDATETIME() NOT NULL,
        FOREIGN KEY (ID_ALERT) REFERENCES [dbo].[ALERTS](ID)
    );

    -- Adicionar foreign key para USUARIO apenas se a tabela existir
    -- Verificar se tabela USUARIO existe e tem coluna CDCADASTRO
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
            ALTER TABLE [dbo].[ALERT_HISTORY]
            ADD CONSTRAINT FK_ALERT_HISTORY_USUARIO 
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
    CREATE INDEX IX_ALERT_HISTORY_ID_ALERT ON [dbo].[ALERT_HISTORY](ID_ALERT);
    CREATE INDEX IX_ALERT_HISTORY_DH_ACAO ON [dbo].[ALERT_HISTORY](DH_ACAO DESC);
    CREATE INDEX IX_ALERT_HISTORY_ID_USUARIO ON [dbo].[ALERT_HISTORY](ID_USUARIO);

    PRINT '✅ Tabela ALERT_HISTORY criada com sucesso!';
END
ELSE
BEGIN
    PRINT 'ℹ️ Tabela ALERT_HISTORY já existe.';
END
GO

-- ============================================
-- 3. CRIAR ÍNDICES ADICIONAIS (se não existirem)
-- ============================================

-- Índice para STATUS (apenas se a coluna existir)
IF NOT EXISTS (
    SELECT * FROM sys.indexes 
    WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') 
    AND name = 'IX_ALERTS_STATUS'
)
BEGIN
    IF EXISTS (
        SELECT * FROM sys.columns 
        WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') 
        AND name = 'STATUS'
    )
    BEGIN
        CREATE INDEX IX_ALERTS_STATUS ON [dbo].[ALERTS](STATUS, CREATED_AT DESC);
        PRINT '✅ Índice IX_ALERTS_STATUS criado';
    END
    ELSE
    BEGIN
        PRINT '⚠️ Coluna STATUS não existe. Índice não criado.';
    END
END
GO

-- Índice para PRIORIDADE (apenas se a coluna existir)
-- Usar sp_executesql para evitar validação prévia
IF NOT EXISTS (
    SELECT * FROM sys.indexes 
    WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') 
    AND name = 'IX_ALERTS_PRIORIDADE'
)
BEGIN
    IF EXISTS (
        SELECT * FROM sys.columns 
        WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') 
        AND name = 'PRIORIDADE'
    )
    BEGIN
        DECLARE @sqlIdx NVARCHAR(MAX);
        IF EXISTS (
            SELECT * FROM sys.columns 
            WHERE object_id = OBJECT_ID(N'[dbo].[ALERTS]') 
            AND name = 'STATUS'
        )
        BEGIN
            SET @sqlIdx = N'CREATE INDEX IX_ALERTS_PRIORIDADE ON [dbo].[ALERTS](PRIORIDADE, STATUS);';
            EXEC sp_executesql @sqlIdx;
            PRINT '✅ Índice IX_ALERTS_PRIORIDADE criado';
        END
        ELSE
        BEGIN
            SET @sqlIdx = N'CREATE INDEX IX_ALERTS_PRIORIDADE ON [dbo].[ALERTS](PRIORIDADE);';
            EXEC sp_executesql @sqlIdx;
            PRINT '✅ Índice IX_ALERTS_PRIORIDADE criado (sem STATUS)';
        END
    END
    ELSE
    BEGIN
        PRINT '⚠️ Coluna PRIORIDADE não existe. Índice não criado.';
    END
END
GO

PRINT '';
PRINT '========================================';
PRINT '✅ Script de ajuste da tabela ALERTS concluído!';
PRINT '========================================';
GO
