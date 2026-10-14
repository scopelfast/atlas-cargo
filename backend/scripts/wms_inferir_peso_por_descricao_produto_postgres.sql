-- WMS — inferência de PESO_KG a partir da descrição (NOME) do produto — PRÉVIA + UPDATE opcional
-- Objetivo: preencher peso automaticamente quando o texto já traz unidade de massa/volume.
--
-- ATENÇÃO:
-- - A seção 2 abaixo tem trava de segurança (1 = 0) e NÃO grava nada.
-- - Para GRAVAR, use: wms_inferir_peso_por_descricao_APLICAR_postgres.sql
--
-- Regras da heurística:
-- 1) procura no NOME um número + unidade: KG, G, L, ML (aceita vírgula/ponto decimal)
-- 2) usa a ÚLTIMA ocorrência encontrada no texto (normalmente o tamanho da embalagem)
-- 3) conversões:
--    KG -> kg
--    G  -> kg / 1000
--    L  -> kg (assumindo densidade ~1 para estimativa logística)
--    ML -> kg / 1000 (assumindo densidade ~1)
-- 4) atualiza somente produtos com PESO_KG nulo ou <= 0
--
-- Exemplos cobertos:
-- - "PCT 100G"      -> 0,100
-- - "PCT 1,01KG"    -> 1,010
-- - "LATA 1,7 KG"   -> 1,700
-- - "PET 900ML"     -> 0,900
-- - "CX 10 KG"      -> 10,000
--
-- IMPORTANTE:
-- - para itens onde o texto não representa peso líquido real (ex.: kit, cesta, "CX 1000 UN"),
--   o script não força peso sem unidade de massa/volume.
-- - revise a prévia antes do UPDATE final.

BEGIN;

-- 1) PRÉVIA: produtos elegíveis e peso inferido
-- Diagnóstico rápido: quantos produtos sem peso existem no tenant alvo
SELECT COUNT(*) AS produtos_sem_peso
FROM "WMS_PRODUTO_DONO" p
WHERE p."TENANT_ID" = 'default' -- ajuste se necessário
  AND (p."PESO_KG" IS NULL OR p."PESO_KG" <= 0);

WITH base AS (
  SELECT
    p."CD_PRODUTO",
    p."TENANT_ID",
    p."CD_DONO",
    p."CODIGO",
    p."NOME",
    p."PESO_KG"
  FROM "WMS_PRODUTO_DONO" p
  WHERE p."TENANT_ID" = 'default' -- ajuste se necessário
    AND (p."PESO_KG" IS NULL OR p."PESO_KG" <= 0)
),
found AS (
  -- captura TODAS as ocorrências número + unidade no NOME
  SELECT
    b.*,
    rm.m AS m,
    rm.ord AS ord
  FROM base b
  CROSS JOIN LATERAL regexp_matches(
    UPPER(COALESCE(b."NOME", '')),
    '([0-9]+([.,][0-9]+)?)\s*(KG|G|ML|L)',
    'g'
  ) WITH ORDINALITY AS rm(m, ord)
),
pick AS (
  SELECT
    f."CD_PRODUTO",
    f."TENANT_ID",
    f."CD_DONO",
    f."CODIGO",
    f."NOME",
    f."PESO_KG",
    f.m[1] AS valor_raw,
    f.m[3] AS unidade_raw
  FROM found f
  WHERE f.ord = (
    SELECT MAX(f2.ord)
    FROM found f2
    WHERE f2."CD_PRODUTO" = f."CD_PRODUTO"
  )
),
calc AS (
  SELECT
    p.*,
    REPLACE(p.valor_raw, ',', '.')::numeric AS valor_num,
    UPPER(p.unidade_raw) AS un,
    CASE
      WHEN UPPER(p.unidade_raw) = 'KG' THEN REPLACE(p.valor_raw, ',', '.')::numeric
      WHEN UPPER(p.unidade_raw) = 'G'  THEN REPLACE(p.valor_raw, ',', '.')::numeric / 1000.0
      WHEN UPPER(p.unidade_raw) = 'L'  THEN REPLACE(p.valor_raw, ',', '.')::numeric
      WHEN UPPER(p.unidade_raw) = 'ML' THEN REPLACE(p.valor_raw, ',', '.')::numeric / 1000.0
      ELSE NULL
    END::numeric(12,3) AS peso_inferido_kg
  FROM pick p
)
SELECT
  c."CD_PRODUTO",
  c."CD_DONO",
  c."CODIGO",
  c."NOME",
  c.valor_raw AS valor_detectado,
  c.unidade_raw AS unidade_detectada,
  c.peso_inferido_kg
FROM calc c
WHERE c.peso_inferido_kg IS NOT NULL
  AND c.peso_inferido_kg > 0
ORDER BY c."CD_DONO", c."CODIGO"
LIMIT 500;

-- 2) UPDATE (desativado): troque 1 = 0 por 1 = 1 OU rode wms_inferir_peso_por_descricao_APLICAR_postgres.sql
WITH base AS (
  SELECT
    p."CD_PRODUTO",
    p."TENANT_ID",
    p."NOME"
  FROM "WMS_PRODUTO_DONO" p
  WHERE p."TENANT_ID" = 'default' -- ajuste se necessário
    AND (p."PESO_KG" IS NULL OR p."PESO_KG" <= 0)
),
found AS (
  SELECT
    b.*,
    rm.m AS m,
    rm.ord AS ord
  FROM base b
  CROSS JOIN LATERAL regexp_matches(
    UPPER(COALESCE(b."NOME", '')),
    '([0-9]+([.,][0-9]+)?)\s*(KG|G|ML|L)',
    'g'
  ) WITH ORDINALITY AS rm(m, ord)
),
pick AS (
  SELECT
    f."CD_PRODUTO",
    f."TENANT_ID",
    f.m[1] AS valor_raw,
    UPPER(f.m[3]) AS un
  FROM found f
  WHERE f.ord = (
    SELECT MAX(f2.ord)
    FROM found f2
    WHERE f2."CD_PRODUTO" = f."CD_PRODUTO"
  )
),
calc AS (
  SELECT
    p."CD_PRODUTO",
    p."TENANT_ID",
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
     AND 1 = 0 -- segurança: troque para 1 = 1 após validar a prévia
  RETURNING t."CD_PRODUTO"
)
SELECT COUNT(*) AS produtos_atualizados_por_inferencia
FROM upd;

COMMIT;

