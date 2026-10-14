-- WMS — APLICAR inferência de PESO_KG a partir do NOME (grava no banco)
-- Rode ANTES a prévia em wms_inferir_peso_por_descricao_produto_postgres.sql (seção 1).
-- Ajuste tenant se necessário.

BEGIN;

WITH base AS (
  SELECT p."CD_PRODUTO", p."TENANT_ID", p."NOME"
    FROM "WMS_PRODUTO_DONO" p
   WHERE p."TENANT_ID" = 'default'
     AND (p."PESO_KG" IS NULL OR p."PESO_KG" <= 0)
),
found AS (
  SELECT b.*, rm.m AS m, rm.ord AS ord
    FROM base b
   CROSS JOIN LATERAL regexp_matches(
           UPPER(COALESCE(b."NOME", '')),
           '([0-9]+([.,][0-9]+)?)\s*(KG|G|ML|L)',
           'g'
         ) WITH ORDINALITY AS rm(m, ord)
),
pick AS (
  SELECT f."CD_PRODUTO", f."TENANT_ID", f.m[1] AS valor_raw, UPPER(f.m[3]) AS un
    FROM found f
   WHERE f.ord = (SELECT MAX(f2.ord) FROM found f2 WHERE f2."CD_PRODUTO" = f."CD_PRODUTO")
),
calc AS (
  SELECT p."CD_PRODUTO", p."TENANT_ID",
         CASE
           WHEN p.un = 'KG' THEN REPLACE(p.valor_raw, ',', '.')::numeric
           WHEN p.un = 'G'  THEN REPLACE(p.valor_raw, ',', '.')::numeric / 1000.0
           WHEN p.un = 'L'  THEN REPLACE(p.valor_raw, ',', '.')::numeric
           WHEN p.un = 'ML' THEN REPLACE(p.valor_raw, ',', '.')::numeric / 1000.0
           ELSE NULL
         END::numeric(12,3) AS peso_inferido_kg
    FROM pick p
),
upd AS (
  UPDATE "WMS_PRODUTO_DONO" t
     SET "PESO_KG" = c.peso_inferido_kg,
         "DH_MAINTENANCE" = CURRENT_TIMESTAMP
    FROM calc c
   WHERE t."CD_PRODUTO" = c."CD_PRODUTO"
     AND t."TENANT_ID" = c."TENANT_ID"
     AND c.peso_inferido_kg IS NOT NULL
     AND c.peso_inferido_kg > 0
  RETURNING t."CD_PRODUTO", t."CD_DONO", t."CODIGO", t."PESO_KG"
)
SELECT COUNT(*) AS produtos_atualizados_por_inferencia FROM upd;

COMMIT;
