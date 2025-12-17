-- ============================================
-- Script para Corrigir SP_INTGRACAO_VALIDADE
-- ============================================
-- Problema 1: A procedure tenta inserir dados com CDTIPOVALIDADE que não existem
-- Problema 2: A procedure usa CDTIPOVALIDADE na condição MERGE, mas a chave primária
--             é apenas (TPCADASTRO, CDCADASTRO, SEQUENCIA), causando erro de duplicata
-- Solução: 
--   - Adicionar filtro para garantir que apenas CDTIPOVALIDADE válidos sejam processados
--   - Remover CDTIPOVALIDADE da condição MERGE (não faz parte da PK)
--   - Usar apenas as colunas da chave primária no MERGE
--   - Se houver múltiplos registros na origem com mesma PK, usar o mais recente (por DHMAINTENANCE)
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
    -- Se houver múltiplos registros na origem com mesma chave primária, usar o mais recente
    MERGE DIVULGACARGA_PRD.dbo.CONTROLEVALIDADE AS dest
    USING (
        SELECT 
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
        FROM (
            SELECT 
                src.*,
                ROW_NUMBER() OVER (
                    PARTITION BY src.TPCADASTRO, src.CDCADASTRO, src.SEQUENCIA 
                    ORDER BY src.DHMAINTENANCE DESC, src.DTVALIDADE DESC
                ) AS rn
            FROM INTEGRA_PRD.dbo.CONTROLEVALIDADE AS src
            INNER JOIN DIVULGACARGA_PRD.dbo.TIPOVALIDADE AS tv
                ON src.CDTIPOVALIDADE = tv.CDTIPOVALIDADE
        ) AS src
        WHERE src.rn = 1  -- Apenas o registro mais recente para cada chave primária
    ) AS src
        ON dest.TPCADASTRO     = src.TPCADASTRO
       AND dest.CDCADASTRO    = src.CDCADASTRO
       AND dest.SEQUENCIA     = src.SEQUENCIA
    -- Chave primária: TPCADASTRO + CDCADASTRO + SEQUENCIA (SEM CDTIPOVALIDADE)

    WHEN MATCHED THEN
        UPDATE SET
            dest.CDTIPOVALIDADE    = src.CDTIPOVALIDADE,  -- Pode mudar se houver atualização
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
PRINT '  - CORRIGIDO: Removido CDTIPOVALIDADE da condição MERGE (não faz parte da PK)'
PRINT '  - Adicionado ROW_NUMBER para lidar com múltiplos registros com mesma PK'
PRINT '    (usa o registro mais recente por DHMAINTENANCE)'
PRINT '  - Adicionado log de registros ignorados para debug'
PRINT ''
GO

