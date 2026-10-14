-- Aplicação segura de categoria sugerida (somente CONFIANCA = 'alta').
-- Segurança:
-- 1) Mantém escopo por TENANT_ID + CD_DONO + TIPO_ARMAZENAGEM.
-- 2) Não altera produtos com CD_CATEGORIA já preenchido.
-- 3) Não altera produto de fornecedor (FG_FORNECEDOR_REF = 'S').
--
-- Fluxo recomendado:
-- 1) Rode em transação.
-- 2) Confira o preview (SELECT final).
-- 3) Faça UPDATE e valide quantidade.
--
-- Dica:
-- - Para aplicar por dono específico, ajuste params.cd_dono_filtro.
-- - Para evitar erro de comparação, sempre use os mesmos critérios da simulação.

BEGIN;

WITH params AS (
  SELECT
    NULL::integer AS tenant_id_filtro,  -- ex.: 2
    NULL::integer AS cd_dono_filtro
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
    p.tipo_armazenagem,
    p.cd_categoria_sugerida,
    MAX(p.score) AS score_categoria,
    COUNT(*) AS qtd_evidencias
  FROM pares p
  WHERE p.score >= 0.45
  GROUP BY p."TENANT_ID", p.cd_produto, p.cd_dono, p.tipo_armazenagem, p.cd_categoria_sugerida
),
ranking AS (
  SELECT
    pc.*,
    ROW_NUMBER() OVER (PARTITION BY pc."TENANT_ID", pc.cd_produto ORDER BY pc.score_categoria DESC, pc.qtd_evidencias DESC, pc.cd_categoria_sugerida) AS rn,
    LEAD(pc.score_categoria) OVER (PARTITION BY pc."TENANT_ID", pc.cd_produto ORDER BY pc.score_categoria DESC, pc.qtd_evidencias DESC, pc.cd_categoria_sugerida) AS prox_score
  FROM por_categoria pc
),
final AS (
  SELECT
    r."TENANT_ID",
    r.cd_produto,
    r.cd_dono,
    r.tipo_armazenagem,
    r.cd_categoria_sugerida,
    r.score_categoria,
    r.qtd_evidencias
  FROM ranking r
  WHERE r.rn = 1
    AND r.score_categoria >= 0.86
    AND COALESCE(r.score_categoria - r.prox_score, 0.99) >= 0.08
)
UPDATE "WMS_PRODUTO_DONO" p
   SET "CD_CATEGORIA" = f.cd_categoria_sugerida,
       "DH_MAINTENANCE" = CURRENT_TIMESTAMP
  FROM final f
 WHERE p."TENANT_ID" = f."TENANT_ID"
   AND p."CD_PRODUTO" = f.cd_produto
   AND p."CD_DONO" = f.cd_dono
   AND COALESCE(UPPER(p."TIPO_ARMAZENAGEM"), '') = COALESCE(UPPER(f.tipo_armazenagem), '')
   AND p."CD_CATEGORIA" IS NULL
   AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N';

-- Validação rápida pós-update:
SELECT
  p."TENANT_ID",
  p."CD_DONO",
  p."TIPO_ARMAZENAGEM",
  COUNT(*) AS produtos_ainda_sem_categoria
FROM "WMS_PRODUTO_DONO" p
WHERE p."CD_CATEGORIA" IS NULL
  AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
GROUP BY p."TENANT_ID", p."CD_DONO", p."TIPO_ARMAZENAGEM"
ORDER BY p."TENANT_ID", p."CD_DONO", p."TIPO_ARMAZENAGEM";

COMMIT;
