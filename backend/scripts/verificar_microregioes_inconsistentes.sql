-- =============================================
-- Verificar Micro-regiões Inconsistentes
-- =============================================
-- Buscar cidades com micro-região que não bate com o estado

PRINT '🔍 Verificando micro-regiões inconsistentes...';
PRINT '========================================';

-- Cidades do PR com micro-região 26 (que é do RS)
PRINT 'Cidades do PR com micro-região 26 (RS):';
SELECT 
    CDCIDADE,
    NMCIDADE,
    ESTADO,
    CDMICROREGIAO
FROM CIDADE 
WHERE ESTADO = 'PR' 
  AND CDMICROREGIAO = 26
ORDER BY NMCIDADE;

PRINT '';
PRINT '========================================';

-- Cidades do RS com micro-região 1 (que pode ser do PR)
PRINT 'Cidades do RS com micro-região 1:';
SELECT 
    CDCIDADE,
    NMCIDADE,
    ESTADO,
    CDMICROREGIAO
FROM CIDADE 
WHERE ESTADO = 'RS' 
  AND CDMICROREGIAO = 1
ORDER BY NMCIDADE;

PRINT '';
PRINT '========================================';

-- Resumo geral: quantas cidades por estado em cada micro-região
PRINT 'Resumo: Cidades por Estado x Micro-região';
SELECT 
    ESTADO,
    CDMICROREGIAO,
    COUNT(*) AS QtdCidades
FROM CIDADE
WHERE CDMICROREGIAO IS NOT NULL
GROUP BY ESTADO, CDMICROREGIAO
HAVING COUNT(*) > 0
ORDER BY CDMICROREGIAO, ESTADO;

PRINT '';
PRINT '========================================';
PRINT '✅ Verificação concluída!';

