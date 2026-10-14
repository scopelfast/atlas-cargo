-- WMS — preenche PESO_KG = 1 kg onde está NULL ou <= 0 (piloto rápido)
-- Donos 1 e 2, só produtos de estoque (não fornecedor).
-- Ajuste tenant / CD_DONO se necessário.

BEGIN;

-- Prévia
SELECT p."CD_DONO", COUNT(*) AS sera_atualizado
  FROM "WMS_PRODUTO_DONO" p
 WHERE p."TENANT_ID" = 'default'
   AND p."CD_DONO" IN (1, 2)
   AND COALESCE(p."FGACTIVE", 'S') = 'S'
   AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
   AND (p."PESO_KG" IS NULL OR p."PESO_KG" <= 0)
 GROUP BY p."CD_DONO"
 ORDER BY p."CD_DONO";

UPDATE "WMS_PRODUTO_DONO" p
   SET "PESO_KG" = 1,
       "DH_MAINTENANCE" = CURRENT_TIMESTAMP
 WHERE p."TENANT_ID" = 'default'
   AND p."CD_DONO" IN (1, 2)
   AND COALESCE(p."FGACTIVE", 'S') = 'S'
   AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
   AND (p."PESO_KG" IS NULL OR p."PESO_KG" <= 0);

-- Conferência
SELECT p."CD_DONO",
       COUNT(*) FILTER (WHERE p."PESO_KG" IS NULL OR p."PESO_KG" <= 0) AS ainda_sem_peso,
       COUNT(*) FILTER (WHERE p."PESO_KG" = 1) AS com_1kg_padrao
  FROM "WMS_PRODUTO_DONO" p
 WHERE p."TENANT_ID" = 'default'
   AND p."CD_DONO" IN (1, 2)
   AND COALESCE(p."FGACTIVE", 'S') = 'S'
   AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
 GROUP BY p."CD_DONO";

COMMIT;
