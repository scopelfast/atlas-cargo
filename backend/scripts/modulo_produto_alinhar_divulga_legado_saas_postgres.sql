-- Remove o produto legado "divulga_cargas_torre" (seed antigo) e aponta vínculos para o código SaaS "divulga".
-- Rode após backup. Idempotente.

UPDATE "TIPOATIVIDADE" t
SET "CD_MODULO_PRODUTO" = (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'divulga' LIMIT 1)
WHERE t."CD_MODULO_PRODUTO" = (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'divulga_cargas_torre' LIMIT 1)
  AND EXISTS (SELECT 1 FROM "MODULO_PRODUTO" WHERE "CODIGO" = 'divulga');

DELETE FROM "MODULO_PRODUTO" WHERE "CODIGO" = 'divulga_cargas_torre';
