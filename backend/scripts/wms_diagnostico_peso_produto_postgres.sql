-- WMS — diagnóstico de PESO_KG (produtos dono)
-- Ajuste TENANT_ID e CD_DONO nos filtros abaixo. Rode no pgAdmin (F5).

-- 1) Total sem peso
SELECT COUNT(*) AS produtos_sem_peso
  FROM "WMS_PRODUTO_DONO" p
 WHERE p."TENANT_ID" = 'default'
   AND p."CD_DONO" = 1
   AND (p."PESO_KG" IS NULL OR p."PESO_KG" <= 0);

-- 2) Quantos o script de INFERÊNCIA conseguiria preencher (prévia — mesma regra do NOME)
WITH base AS (
  SELECT p."CD_PRODUTO", p."NOME"
    FROM "WMS_PRODUTO_DONO" p
   WHERE p."TENANT_ID" = 'default'
     AND p."CD_DONO" = 1
     AND (p."PESO_KG" IS NULL OR p."PESO_KG" <= 0)
),
found AS (
  SELECT b."CD_PRODUTO", rm.m, rm.ord
    FROM base b
   CROSS JOIN LATERAL regexp_matches(
           UPPER(COALESCE(b."NOME", '')),
           '([0-9]+([.,][0-9]+)?)\s*(KG|G|ML|L)',
           'g'
         ) WITH ORDINALITY AS rm(m, ord)
),
pick AS (
  SELECT f."CD_PRODUTO", f.m[1] AS valor_raw, UPPER(f.m[3]) AS un
    FROM found f
   WHERE f.ord = (SELECT MAX(f2.ord) FROM found f2 WHERE f2."CD_PRODUTO" = f."CD_PRODUTO")
),
calc AS (
  SELECT p."CD_PRODUTO",
         CASE
           WHEN p.un = 'KG' THEN REPLACE(p.valor_raw, ',', '.')::numeric
           WHEN p.un = 'G'  THEN REPLACE(p.valor_raw, ',', '.')::numeric / 1000.0
           WHEN p.un = 'L'  THEN REPLACE(p.valor_raw, ',', '.')::numeric
           WHEN p.un = 'ML' THEN REPLACE(p.valor_raw, ',', '.')::numeric / 1000.0
           ELSE NULL
         END::numeric(12,3) AS peso_inferido_kg
    FROM pick p
)
SELECT COUNT(*) AS inferiveis_pela_descricao
  FROM calc c
 WHERE c.peso_inferido_kg IS NOT NULL AND c.peso_inferido_kg > 0;

-- 3) Amostra: sem peso e nome sem KG/G/ML/L (difícil inferir automaticamente)
SELECT p."CODIGO", LEFT(p."NOME", 80) AS nome
  FROM "WMS_PRODUTO_DONO" p
 WHERE p."TENANT_ID" = 'default'
   AND p."CD_DONO" = 1
   AND (p."PESO_KG" IS NULL OR p."PESO_KG" <= 0)
   AND UPPER(COALESCE(p."NOME", '')) !~ '([0-9]+([.,][0-9]+)?)\s*(KG|G|ML|L)'
 ORDER BY p."CODIGO"
 LIMIT 30;
