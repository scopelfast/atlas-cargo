-- =============================================
-- Script: Migrar Dados de Validade
-- Origem: INTEGRA_PRD
-- Destino: ATLAS_CARGO_PRD
-- =============================================

-- =============================================
-- Migrar TIPOVALIDADE
-- =============================================
PRINT 'Iniciando migração de TIPOVALIDADE...';

INSERT INTO ATLAS_CARGO_PRD.dbo.TIPOVALIDADE (
    CDTIPOVALIDADE,
    DSTIPOVALIDADE,
    FGVEICULO,
    FGMOTORISTA,
    FGTRANSPORTADOR,
    FGCLIENTE,
    FGFORNECEDOR,
    FGEXIGECERTIFICADORA,
    DHMAINTENANCE,
    SGUSER,
    SERVERORIG
)
SELECT 
    CDTIPOVALIDADE,
    DSTIPOVALIDADE,
    FGVEICULO,
    FGMOTORISTA,
    FGTRANSPORTADOR,
    FGCLIENTE,
    FGFORNECEDOR,
    FGEXIGECERTIFICADORA,
    DHMAINTENANCE,
    SGUSER,
    SERVERORIG
FROM INTEGRA_PRD.dbo.TIPOVALIDADE
WHERE NOT EXISTS (
    SELECT 1 
    FROM ATLAS_CARGO_PRD.dbo.TIPOVALIDADE D
    WHERE D.CDTIPOVALIDADE = INTEGRA_PRD.dbo.TIPOVALIDADE.CDTIPOVALIDADE
);

PRINT '✅ TIPOVALIDADE migrado: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' registros';
GO

-- =============================================
-- Verificar tipos inválidos antes da migração
-- =============================================
PRINT 'Verificando integridade dos dados...';

SELECT 
    C.CDTIPOVALIDADE,
    COUNT(*) AS QtdValidades
FROM INTEGRA_PRD.dbo.CONTROLEVALIDADE C
WHERE NOT EXISTS (
    SELECT 1 
    FROM ATLAS_CARGO_PRD.dbo.TIPOVALIDADE T
    WHERE T.CDTIPOVALIDADE = C.CDTIPOVALIDADE
)
GROUP BY C.CDTIPOVALIDADE
ORDER BY C.CDTIPOVALIDADE;

DECLARE @TiposInvalidos INT;
SELECT @TiposInvalidos = COUNT(DISTINCT CDTIPOVALIDADE)
FROM INTEGRA_PRD.dbo.CONTROLEVALIDADE
WHERE CDTIPOVALIDADE NOT IN (SELECT CDTIPOVALIDADE FROM ATLAS_CARGO_PRD.dbo.TIPOVALIDADE);

IF @TiposInvalidos > 0
BEGIN
    PRINT '⚠️ ATENÇÃO: Existem ' + CAST(@TiposInvalidos AS VARCHAR) + ' tipos de validade inválidos!';
    PRINT 'Apenas registros com tipos válidos serão migrados.';
END
GO

-- =============================================
-- Migrar CONTROLEVALIDADE (apenas com tipos válidos)
-- =============================================
PRINT 'Iniciando migração de CONTROLEVALIDADE...';

INSERT INTO ATLAS_CARGO_PRD.dbo.CONTROLEVALIDADE (
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
SELECT 
    C.TPCADASTRO,
    C.CDCADASTRO,
    C.SEQUENCIA,
    C.CDTIPOVALIDADE,
    C.NRLIBERACAO,
    C.DTLIBERACAO,
    C.DTVALIDADE,
    C.CDCERTIFICADORA,
    C.DSLIBERACAO,
    C.FGTIPOLANCTO,
    C.DHMAINTENANCE,
    C.SGUSER,
    C.SERVERORIG
FROM INTEGRA_PRD.dbo.CONTROLEVALIDADE C
WHERE EXISTS (
    -- Apenas tipos válidos
    SELECT 1 
    FROM ATLAS_CARGO_PRD.dbo.TIPOVALIDADE T
    WHERE T.CDTIPOVALIDADE = C.CDTIPOVALIDADE
)
AND NOT EXISTS (
    -- Não duplicar
    SELECT 1 
    FROM ATLAS_CARGO_PRD.dbo.CONTROLEVALIDADE D
    WHERE D.TPCADASTRO = C.TPCADASTRO
      AND D.CDCADASTRO = C.CDCADASTRO
      AND D.SEQUENCIA = C.SEQUENCIA
);

PRINT '✅ CONTROLEVALIDADE migrado: ' + CAST(@@ROWCOUNT AS VARCHAR) + ' registros';
GO

-- =============================================
-- Resumo da Migração
-- =============================================
PRINT '========================================';
PRINT 'RESUMO DA MIGRAÇÃO:';
PRINT '----------------------------------------';

SELECT 
    'TIPOVALIDADE' AS Tabela,
    COUNT(*) AS Total_Registros
FROM ATLAS_CARGO_PRD.dbo.TIPOVALIDADE

UNION ALL

SELECT 
    'CONTROLEVALIDADE' AS Tabela,
    COUNT(*) AS Total_Registros
FROM ATLAS_CARGO_PRD.dbo.CONTROLEVALIDADE;

PRINT '========================================';
PRINT '✅ Migração finalizada com sucesso!';
PRINT '========================================';
GO

