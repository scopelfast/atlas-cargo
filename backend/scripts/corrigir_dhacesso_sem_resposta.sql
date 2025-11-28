-- Script para corrigir registros com DHACESSO preenchido mas DHRESPOSTA NULL
-- Isso não deveria acontecer: se o motorista acessou e respondeu, ambos devem estar preenchidos
-- Se não respondeu, nenhum dos dois deve estar preenchido

-- Opção 1: Limpar DHACESSO para registros PENDENTE sem resposta
-- (Se está PENDENTE e não tem resposta, significa que não respondeu ainda)
UPDATE [dbo].[CONVOCACAO]
SET DHACESSO = NULL,
    DHMAINTENANCE = GETDATE(),
    SGUSER = 'SYSTEM'
WHERE STATUS = 'PENDENTE'
  AND DHRESPOSTA IS NULL
  AND DHACESSO IS NOT NULL;

-- Opção 2: Para registros que não são PENDENTE mas têm DHACESSO sem DHRESPOSTA
-- Isso pode indicar um erro de dados - vamos limpar o DHACESSO também
UPDATE [dbo].[CONVOCACAO]
SET DHACESSO = NULL,
    DHMAINTENANCE = GETDATE(),
    SGUSER = 'SYSTEM'
WHERE STATUS != 'PENDENTE'
  AND DHRESPOSTA IS NULL
  AND DHACESSO IS NOT NULL;

-- Verificar quantos registros foram corrigidos
SELECT 
    COUNT(*) AS TOTAL_CORRIGIDOS,
    SUM(CASE WHEN STATUS = 'PENDENTE' THEN 1 ELSE 0 END) AS PENDENTE_CORRIGIDOS,
    SUM(CASE WHEN STATUS != 'PENDENTE' THEN 1 ELSE 0 END) AS OUTROS_CORRIGIDOS
FROM [dbo].[CONVOCACAO]
WHERE DHRESPOSTA IS NULL
  AND DHACESSO IS NULL;

PRINT 'Script de correção executado com sucesso!';
PRINT 'DHACESSO foi limpo para registros sem DHRESPOSTA.';

