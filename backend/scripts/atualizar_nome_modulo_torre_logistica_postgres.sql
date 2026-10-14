-- Exibe o produto Torre com o nome curto "Torre Logística" (antes: "Divulga Cargas com Torre Logística").
-- PostgreSQL. Idempotente. Rode após backup.

UPDATE "MODULO_PRODUTO"
SET "NOME" = 'Torre Logística'
WHERE LOWER(TRIM("CODIGO")) IN ('divulga_cargas_torre', 'divulga');

UPDATE "SAAS_MODULO"
SET "NM_EXIBICAO" = 'Torre Logística'
WHERE LOWER(TRIM("CODIGO")) IN ('divulga_cargas_torre', 'divulga');
