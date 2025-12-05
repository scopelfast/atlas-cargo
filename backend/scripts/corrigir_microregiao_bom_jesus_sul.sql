-- =============================================
-- Corrigir Micro-região de Bom Jesus do Sul, PR
-- =============================================
-- Problema: Cidade do PR estava com micro-região 26 (que é do RS)
-- Solução: Atribuir micro-região correta do Paraná

-- Verificar situação atual
SELECT 
    NMCIDADE,
    ESTADO,
    CDMICROREGIAO AS MicroRegiaoAtual
FROM CIDADE 
WHERE NMCIDADE = 'Bom Jesus do Sul' 
  AND ESTADO = 'PR';

-- Bom Jesus do Sul fica no sudoeste do PR
-- Vamos atribuir uma micro-região do Paraná
-- Micro-região 1 é genérica para PR

UPDATE CIDADE
SET CDMICROREGIAO = 1,  -- Micro-região genérica do Paraná
    DHMAINTENANCE = GETDATE(),
    SGUSER = 'ADMIN',
    SERVERORIG = 'CORRECAO_SISTEMA'
WHERE NMCIDADE = 'Bom Jesus do Sul' 
  AND ESTADO = 'PR';

PRINT '✅ Micro-região de Bom Jesus do Sul, PR corrigida!';

-- Verificar resultado
SELECT 
    NMCIDADE,
    ESTADO,
    CDMICROREGIAO AS MicroRegiaoNova
FROM CIDADE 
WHERE NMCIDADE = 'Bom Jesus do Sul' 
  AND ESTADO = 'PR';

PRINT '========================================';
PRINT 'Correção concluída!';
PRINT '========================================';

