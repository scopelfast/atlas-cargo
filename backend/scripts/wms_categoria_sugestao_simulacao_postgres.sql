-- Simulação de sugestão de categoria para produtos sem CD_CATEGORIA
-- Segurança: NUNCA mistura TIPO_ARMAZENAGEM (SECO/REFRIGERADO/CONGELADO).
-- Não depende de pg_trgm (evita erro "function similarity does not exist").
--
-- Uso:
-- 1) (Opcional) ajuste tenant/dono/tipo nos CTE params.
-- 2) Rode como SELECT para validar as sugestões.
-- 3) Aplique somente "alta" automaticamente.

WITH params AS (
  SELECT
    NULL::integer AS tenant_id_filtro,     -- ex.: 2
    NULL::integer AS cd_dono_filtro,       -- ex.: 1
    NULL::text AS tipo_arm_filtro          -- 'SECO' | 'REFRIGERADO' | 'CONGELADO'
),
faltantes AS (
  SELECT
    p."TENANT_ID",
    p."CD_PRODUTO",
    p."CD_DONO",
    p."CODIGO",
    p."NOME",
    p."TIPO_ARMAZENAGEM",
    UPPER(regexp_replace(translate(COALESCE(p."NOME", ''), 'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇ', 'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcC'), '[^A-Z0-9 ]', '', 'g')) AS nm_norm,
    regexp_replace(COALESCE(p."CODIGO", ''), '[^0-9A-Za-z]', '', 'g') AS cod_norm
  FROM "WMS_PRODUTO_DONO" p
  CROSS JOIN params pr
  WHERE p."CD_CATEGORIA" IS NULL
    AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
    AND (pr.tenant_id_filtro IS NULL OR p."TENANT_ID" = pr.tenant_id_filtro)
    AND (pr.cd_dono_filtro IS NULL OR p."CD_DONO" = pr.cd_dono_filtro)
    AND (pr.tipo_arm_filtro IS NULL OR COALESCE(UPPER(p."TIPO_ARMAZENAGEM"), '') = UPPER(pr.tipo_arm_filtro))
),
base AS (
  SELECT
    c."TENANT_ID",
    c."CD_PRODUTO",
    c."CD_DONO",
    c."CD_CATEGORIA",
    c."CODIGO",
    c."NOME",
    c."TIPO_ARMAZENAGEM",
    UPPER(regexp_replace(translate(COALESCE(c."NOME", ''), 'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇ', 'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcC'), '[^A-Z0-9 ]', '', 'g')) AS nm_norm,
    regexp_replace(COALESCE(c."CODIGO", ''), '[^0-9A-Za-z]', '', 'g') AS cod_norm
  FROM "WMS_PRODUTO_DONO" c
  WHERE c."CD_CATEGORIA" IS NOT NULL
    AND COALESCE(c."FG_FORNECEDOR_REF", 'N') = 'N'
),
pares AS (
  SELECT
    f."TENANT_ID",
    f."CD_PRODUTO" AS cd_produto,
    f."CD_DONO" AS cd_dono,
    f."CODIGO" AS codigo_produto,
    f."NOME" AS nome_produto,
    f."TIPO_ARMAZENAGEM" AS tipo_armazenagem,
    b."CD_CATEGORIA" AS cd_categoria_sugerida,
    (
      CASE WHEN f.nm_norm <> '' AND f.nm_norm = b.nm_norm THEN 0.62 ELSE 0 END +
      CASE WHEN f.nm_norm <> '' AND b.nm_norm <> '' AND (f.nm_norm LIKE '%' || b.nm_norm || '%' OR b.nm_norm LIKE '%' || f.nm_norm || '%') THEN 0.12 ELSE 0 END +
      CASE WHEN left(f.cod_norm, 10) <> '' AND left(f.cod_norm, 10) = left(b.cod_norm, 10) THEN 0.18
           WHEN left(f.cod_norm, 8) <> '' AND left(f.cod_norm, 8) = left(b.cod_norm, 8) THEN 0.14
           WHEN left(f.cod_norm, 6) <> '' AND left(f.cod_norm, 6) = left(b.cod_norm, 6) THEN 0.10
           WHEN left(f.cod_norm, 4) <> '' AND left(f.cod_norm, 4) = left(b.cod_norm, 4) THEN 0.05
           ELSE 0 END +
      CASE WHEN COALESCE(UPPER(f."TIPO_ARMAZENAGEM"), '') <> '' AND COALESCE(UPPER(f."TIPO_ARMAZENAGEM"), '') = COALESCE(UPPER(b."TIPO_ARMAZENAGEM"), '') THEN 0.12 ELSE 0 END
    )::numeric(10, 4) AS score
  FROM faltantes f
  JOIN base b
    ON b."TENANT_ID" = f."TENANT_ID"
   AND b."CD_DONO" = f."CD_DONO"
   AND COALESCE(UPPER(b."TIPO_ARMAZENAGEM"), '') = COALESCE(UPPER(f."TIPO_ARMAZENAGEM"), '')
),
por_categoria AS (
  SELECT
    p."TENANT_ID",
    p.cd_produto,
    p.cd_dono,
    p.codigo_produto,
    p.nome_produto,
    p.tipo_armazenagem,
    p.cd_categoria_sugerida,
    MAX(p.score) AS score_categoria,
    COUNT(*) AS qtd_evidencias
  FROM pares p
  WHERE p.score >= 0.45
  GROUP BY p."TENANT_ID", p.cd_produto, p.cd_dono, p.codigo_produto, p.nome_produto, p.tipo_armazenagem, p.cd_categoria_sugerida
),
ranking AS (
  SELECT
    pc.*,
    ROW_NUMBER() OVER (PARTITION BY pc."TENANT_ID", pc.cd_produto ORDER BY pc.score_categoria DESC, pc.qtd_evidencias DESC, pc.cd_categoria_sugerida) AS rn,
    LEAD(pc.score_categoria) OVER (PARTITION BY pc."TENANT_ID", pc.cd_produto ORDER BY pc.score_categoria DESC, pc.qtd_evidencias DESC, pc.cd_categoria_sugerida) AS prox_score
  FROM por_categoria pc
)
SELECT
  r."TENANT_ID",
  r.cd_produto AS "CD_PRODUTO",
  r.cd_dono AS "CD_DONO",
  r.codigo_produto AS "CODIGO",
  r.nome_produto AS "NOME",
  r.tipo_armazenagem AS "TIPO_ARMAZENAGEM",
  r.cd_categoria_sugerida AS "CD_CATEGORIA_SUGERIDA",
  c."CODIGO" AS "CODIGO_CATEGORIA",
  c."NOME" AS "NM_CATEGORIA",
  g."NOME" AS "NM_GRUPO",
  r.score_categoria AS "SCORE",
  r.qtd_evidencias AS "QTD_EVIDENCIAS",
  CASE
    WHEN r.score_categoria >= 0.86 AND COALESCE(r.score_categoria - r.prox_score, 0.99) >= 0.08 THEN 'alta'
    WHEN r.score_categoria >= 0.66 AND COALESCE(r.score_categoria - r.prox_score, 0.99) >= 0.03 THEN 'media'
    ELSE 'baixa'
  END AS "CONFIANCA"
FROM ranking r
INNER JOIN "WMS_CATEGORIA_PRODUTO" c
  ON c."TENANT_ID" = r."TENANT_ID" AND c."CD_CATEGORIA" = r.cd_categoria_sugerida
LEFT JOIN "WMS_GRUPO_PRODUTO" g
  ON g."TENANT_ID" = c."TENANT_ID" AND g."CD_GRUPO" = c."CD_GRUPO"
WHERE r.rn = 1
ORDER BY
  CASE
    WHEN r.score_categoria >= 0.86 AND COALESCE(r.score_categoria - r.prox_score, 0.99) >= 0.08 THEN 1
    WHEN r.score_categoria >= 0.66 AND COALESCE(r.score_categoria - r.prox_score, 0.99) >= 0.03 THEN 2
    ELSE 3
  END,
  r.score_categoria DESC,
  r.cd_produto;
