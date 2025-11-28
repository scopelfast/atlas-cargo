-- Script para adicionar campo CDMOTIVORECUSA na tabela CONVOCACAO
-- Autor: Sistema DivulgaCarga
-- Data: 2025-11-29

-- Verificar se a coluna já existe antes de adicionar
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[CONVOCACAO]') 
    AND name = 'CDMOTIVORECUSA'
)
BEGIN
    ALTER TABLE [dbo].[CONVOCACAO]
    ADD [CDMOTIVORECUSA] INT NULL;
    
    -- Adicionar foreign key para MOTIVORECUSA
    IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[MOTIVORECUSA]') AND type in (N'U'))
    BEGIN
        ALTER TABLE [dbo].[CONVOCACAO]
        ADD CONSTRAINT [FK_CONVOCACAO_MOTIVORECUSA] 
        FOREIGN KEY ([CDMOTIVORECUSA]) 
        REFERENCES [dbo].[MOTIVORECUSA] ([CDMOTIVO]);
    END
    
    PRINT 'Campo CDMOTIVORECUSA adicionado à tabela CONVOCACAO com sucesso!';
END
ELSE
BEGIN
    PRINT 'Campo CDMOTIVORECUSA já existe na tabela CONVOCACAO.';
END

