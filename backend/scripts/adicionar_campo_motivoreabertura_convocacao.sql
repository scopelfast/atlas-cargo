-- Script para adicionar o campo CDMOTIVOREABERTURA na tabela CONVOCACAO
-- Versão: 1.0
-- Autor: Sistema DivulgaCarga
-- Data: 2025-11-28

-- Verificar se a coluna CDMOTIVOREABERTURA já existe na tabela CONVOCACAO
IF NOT EXISTS (SELECT * FROM sys.columns WHERE object_id = OBJECT_ID(N'[dbo].[CONVOCACAO]') AND name = 'CDMOTIVOREABERTURA')
BEGIN
    -- Adicionar a coluna CDMOTIVOREABERTURA
    ALTER TABLE [dbo].[CONVOCACAO]
    ADD [CDMOTIVOREABERTURA] INT NULL;

    PRINT 'Coluna CDMOTIVOREABERTURA adicionada à tabela CONVOCACAO.';

    -- Adicionar a Foreign Key para MOTIVOREABERTURA
    IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[MOTIVOREABERTURA]') AND type in (N'U'))
    BEGIN
        IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_CONVOCACAO_MOTIVOREABERTURA')
        BEGIN
            ALTER TABLE [dbo].[CONVOCACAO]
            ADD CONSTRAINT [FK_CONVOCACAO_MOTIVOREABERTURA] FOREIGN KEY ([CDMOTIVOREABERTURA])
            REFERENCES [dbo].[MOTIVOREABERTURA] ([CDMOTIVO]);
            PRINT 'Foreign Key FK_CONVOCACAO_MOTIVOREABERTURA adicionada à tabela CONVOCACAO.';
        END
        ELSE
        BEGIN
            PRINT 'Foreign Key FK_CONVOCACAO_MOTIVOREABERTURA já existe.';
        END;
    END
    ELSE
    BEGIN
        PRINT 'Tabela MOTIVOREABERTURA não existe. Não foi possível adicionar a Foreign Key.';
    END;
END
ELSE
BEGIN
    PRINT 'Coluna CDMOTIVOREABERTURA já existe na tabela CONVOCACAO.';
END;
GO

