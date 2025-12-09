-- ============================================
-- Script para Corrigir SP_INTGRACAO_VALIDADE
-- ============================================
-- Problema: A procedure tenta inserir dados com CDTIPOVALIDADE que não existem
-- Solução: Adicionar filtro para garantir que apenas CDTIPOVALIDADE válidos sejam processados
-- ============================================

USE [DIVULGACARGA_PRD]
GO

-- Verificar se a procedure existe antes de alterar
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SP_INTGRACAO_VALIDADE]') AND type in (N'P', N'PC'))
BEGIN
    -- Remover a procedure antiga
    DROP PROCEDURE [dbo].[SP_INTGRACAO_VALIDADE]
    PRINT '✅ Procedure antiga removida'
END
GO

-- Criar a procedure corrigida
CREATE PROCEDURE [dbo].[SP_INTGRACAO_VALIDADE]
AS
BEGIN
    SET NOCOUNT ON;
    
    -- MERGE apenas com registros que têm CDTIPOVALIDADE válido
    MERGE DIVULGACARGA_PRD.dbo.CONTROLEVALIDADE AS dest
    USING (
        SELECT 
            src.*
        FROM INTEGRA_PRD.dbo.CONTROLEVALIDADE AS src
        INNER JOIN DIVULGACARGA_PRD.dbo.TIPOVALIDADE AS tv
            ON src.CDTIPOVALIDADE = tv.CDTIPOVALIDADE
        -- Filtro adicional: garantir que o CDTIPOVALIDADE existe na tabela de destino
    ) AS src
        ON dest.TPCADASTRO     = src.TPCADASTRO
       AND dest.CDCADASTRO    = src.CDCADASTRO
       AND dest.SEQUENCIA     = src.SEQUENCIA
       AND dest.CDTIPOVALIDADE= src.CDTIPOVALIDADE
    -- Chave composta: TPCADASTRO + CDCADASTRO + SEQUENCIA + CDTIPOVALIDADE

    WHEN MATCHED THEN
        UPDATE SET
            dest.NRLIBERACAO       = src.NRLIBERACAO,
            dest.DTLIBERACAO       = src.DTLIBERACAO,
            dest.DTVALIDADE        = src.DTVALIDADE,
            dest.CDCERTIFICADORA   = src.CDCERTIFICADORA,
            dest.DSLIBERACAO       = src.DSLIBERACAO,
            dest.FGTIPOLANCTO      = src.FGTIPOLANCTO,
            dest.DHMAINTENANCE     = src.DHMAINTENANCE,
            dest.SGUSER            = src.SGUSER,
            dest.SERVERORIG        = src.SERVERORIG

    WHEN NOT MATCHED THEN
        INSERT (
            TPCADASTRO,
            CDCADASTRO,
            SEQUENCIA,
            CDTIPOVALIDADE,
            NRLIBERACAO,
            DTLIBERACAO,
            DTVALIDADE,
            CDCERTIFICADORA,
            DSLIBERACAO,
            FGTIPOLANCTO,
            DHMAINTENANCE,
            SGUSER,
            SERVERORIG
        )
        VALUES (
            src.TPCADASTRO,
            src.CDCADASTRO,
            src.SEQUENCIA,
            src.CDTIPOVALIDADE,
            src.NRLIBERACAO,
            src.DTLIBERACAO,
            src.DTVALIDADE,
            src.CDCERTIFICADORA,
            src.DSLIBERACAO,
            src.FGTIPOLANCTO,
            src.DHMAINTENANCE,
            src.SGUSER,
            src.SERVERORIG
        );
    
    -- Log de registros ignorados (opcional, para debug)
    DECLARE @registrosIgnorados INT;
    SELECT @registrosIgnorados = COUNT(*)
    FROM INTEGRA_PRD.dbo.CONTROLEVALIDADE AS src
    WHERE NOT EXISTS (
        SELECT 1 
        FROM DIVULGACARGA_PRD.dbo.TIPOVALIDADE AS tv
        WHERE tv.CDTIPOVALIDADE = src.CDTIPOVALIDADE
    );
    
    IF @registrosIgnorados > 0
    BEGIN
        PRINT '⚠️ ATENÇÃO: ' + CAST(@registrosIgnorados AS VARCHAR(10)) + ' registro(s) ignorado(s) por CDTIPOVALIDADE inválido';
    END
END;
GO

PRINT '✅ Procedure SP_INTGRACAO_VALIDADE corrigida com sucesso!'
PRINT ''
PRINT '📋 O que foi alterado:'
PRINT '  - Adicionado INNER JOIN com TIPOVALIDADE para garantir que apenas'
PRINT '    registros com CDTIPOVALIDADE válido sejam processados'
PRINT '  - Adicionado log de registros ignorados para debug'
PRINT ''
GO

