-- ============================================
-- Script para verificar programas dos módulos no menu
-- ============================================
-- Data: 2025-01-18
-- IMPORTANTE: Execute este script no banco de dados DIVULGACARGA_PRD

USE [DIVULGACARGA_PRD]
GO

PRINT '========================================';
PRINT '🔍 Verificando programas dos módulos';
PRINT '========================================';
PRINT '';

-- Verificar todos os módulos e seus programas
SELECT 
    CDTIPOATIVIDADE AS 'ID',
    DSTIPOATIVIDADE AS 'Nome',
    DSPROGRAMA AS 'Programa',
    CASE 
        WHEN DSPROGRAMA IS NULL OR DSPROGRAMA = '' THEN '❌ SEM PROGRAMA'
        ELSE '✅ OK'
    END AS 'Status',
    FGACTIVE AS 'Ativo'
FROM [dbo].[TIPOATIVIDADE]
WHERE FGACTIVE = 'S'
ORDER BY CDTIPOATIVIDADE;
GO

PRINT '';
PRINT '========================================';
PRINT '📋 Módulos sem programa (precisam ser corrigidos)';
PRINT '========================================';

SELECT 
    CDTIPOATIVIDADE AS 'ID',
    DSTIPOATIVIDADE AS 'Nome'
FROM [dbo].[TIPOATIVIDADE]
WHERE FGACTIVE = 'S'
  AND (DSPROGRAMA IS NULL OR DSPROGRAMA = '')
ORDER BY CDTIPOATIVIDADE;
GO

PRINT '';
PRINT '========================================';
PRINT '✅ Verificação concluída!';
PRINT '========================================';
PRINT '';
PRINT '📝 Se houver módulos sem programa, execute o script:';
PRINT '   corrigir_programas_menu.sql';
PRINT '';
GO

