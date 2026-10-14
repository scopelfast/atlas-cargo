-- ============================================================================
-- Diagnóstico do Relatório "Datas críticas / shelf-life (WMS)"
-- ============================================================================
-- Objetivo: cruzar TODAS as linhas com validade dentro do horizonte do dono
-- (ou já vencidas) contra o filtro do relatório, mostrando POR QUE cada linha
-- entra ou NÃO entra no relatório oficial.
--
-- Como usar:
--   1. Ajuste TENANT_ID e CD_DONO abaixo (Mana = 1).
--   2. Rode o bloco "DIAGNÓSTICO DETALHADO" para auditoria linha-a-linha.
--   3. Rode o bloco "RESUMO POR MOTIVO" para ver contagens consolidadas.
--   4. Rode o bloco "ALÉM DO HORIZONTE" se quiser ver o que está dentro de
--      90/180/365 dias e foi cortado pelo horizonte do dono.
-- ============================================================================

\set TENANT_ID 1
\set CD_DONO 1

-- ---------------------------------------------------------------------------
-- 1) DIAGNÓSTICO DETALHADO: cada linha da CONFERENCIA_JSON do dono, com flag
-- ---------------------------------------------------------------------------
WITH exp AS (
  SELECT
    e."CD_NFE",
    e."NUMERO_NF",
    UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) AS "ST_RECEB",
    e."CD_DONO",
    elem
  FROM "WMS_NFE_ENTRADA" e
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS elem
  WHERE e."TENANT_ID" = :TENANT_ID
    AND e."CD_DONO"  = :CD_DONO
),
parsed AS (
  SELECT
    "CD_NFE",
    "NUMERO_NF",
    "ST_RECEB",
    NULLIF(TRIM(elem->>'validade'), '') AS vtxt,
    NULLIF(TRIM(elem->>'codigoProduto'), '') AS codigo_prod,
    NULLIF(TRIM(elem->>'lote'), '') AS lote,
    COALESCE(NULLIF(TRIM(elem->>'qtdConvertida'), ''), '0')::numeric AS qtd_conv,
    elem->>'cdProduto' AS cd_produto_raw
  FROM exp
),
diag AS (
  SELECT
    p.*,
    d."NU_DIAS_REL_VENCIMENTO" AS horizonte,
    (vtxt ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') AS data_ok,
    CASE
      WHEN vtxt ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN vtxt::date
      ELSE NULL
    END AS dt_validade,
    CASE
      WHEN vtxt ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN (vtxt::date - CURRENT_DATE)::int
      ELSE NULL
    END AS dias_ate_venc
  FROM parsed p
  JOIN "WMS_DONO_ESTOQUE" d
    ON d."CD_DONO" = :CD_DONO AND d."TENANT_ID" = :TENANT_ID
)
SELECT
  "CD_NFE",
  "NUMERO_NF",
  "ST_RECEB",
  codigo_prod,
  lote,
  vtxt          AS "validade_raw",
  dt_validade,
  dias_ate_venc,
  qtd_conv,
  horizonte,
  -- ENTRA NO RELATÓRIO se: NF ENCERRADA + validade ok + qtd>0 + validade<=hoje+horizonte
  ("ST_RECEB" = 'ENCERRADA'
    AND data_ok
    AND qtd_conv > 0
    AND dt_validade <= CURRENT_DATE + horizonte
  ) AS entra_no_relatorio,
  -- MOTIVO DA EXCLUSÃO (NULL = entra)
  CASE
    WHEN "ST_RECEB" <> 'ENCERRADA'         THEN 'EXCL: NF não encerrada (' || "ST_RECEB" || ')'
    WHEN NOT data_ok                       THEN 'EXCL: validade formato inválido (' || COALESCE(vtxt, '∅') || ')'
    WHEN qtd_conv <= 0                     THEN 'EXCL: qtdConvertida <= 0'
    WHEN dt_validade > CURRENT_DATE + horizonte THEN 'EXCL: além do horizonte (' || dias_ate_venc::text || ' dias > ' || horizonte::text || ')'
    ELSE NULL
  END AS motivo_exclusao
FROM diag
ORDER BY
  CASE WHEN dt_validade IS NULL THEN 1 ELSE 0 END,  -- linhas sem data ao final
  dt_validade ASC NULLS LAST,
  "CD_NFE";

-- ---------------------------------------------------------------------------
-- 2) RESUMO POR MOTIVO (contagem por categoria)
-- ---------------------------------------------------------------------------
WITH exp AS (
  SELECT
    UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) AS "ST_RECEB",
    elem
  FROM "WMS_NFE_ENTRADA" e
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS elem
  WHERE e."TENANT_ID" = :TENANT_ID
    AND e."CD_DONO"  = :CD_DONO
),
parsed AS (
  SELECT
    "ST_RECEB",
    NULLIF(TRIM(elem->>'validade'), '') AS vtxt,
    COALESCE(NULLIF(TRIM(elem->>'qtdConvertida'), ''), '0')::numeric AS qtd_conv
  FROM exp
),
diag AS (
  SELECT
    p.*,
    d."NU_DIAS_REL_VENCIMENTO" AS horizonte,
    (vtxt ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') AS data_ok,
    CASE WHEN vtxt ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN vtxt::date END AS dt
  FROM parsed p
  JOIN "WMS_DONO_ESTOQUE" d
    ON d."CD_DONO" = :CD_DONO AND d."TENANT_ID" = :TENANT_ID
)
SELECT
  CASE
    WHEN "ST_RECEB" = 'ENCERRADA' AND data_ok AND qtd_conv > 0 AND dt <= CURRENT_DATE + horizonte
      THEN 'ENTRA NO RELATÓRIO'
    WHEN "ST_RECEB" <> 'ENCERRADA'    THEN 'EXCL: NF não encerrada'
    WHEN NOT data_ok                  THEN 'EXCL: validade formato inválido'
    WHEN qtd_conv <= 0                THEN 'EXCL: qtdConvertida <= 0'
    WHEN dt > CURRENT_DATE + horizonte THEN 'EXCL: além do horizonte'
    ELSE 'EXCL: outro'
  END AS categoria,
  COUNT(*) AS qtd_linhas
FROM diag
GROUP BY 1
ORDER BY 1;

-- ---------------------------------------------------------------------------
-- 3) ALÉM DO HORIZONTE: produtos que existem mas estão "limpos" no relatório
--    porque a validade está além do horizonte do dono. Útil para confirmar
--    se há SKU com validade próxima do horizonte que merece atenção futura.
-- ---------------------------------------------------------------------------
WITH exp AS (
  SELECT
    e."CD_NFE",
    e."NUMERO_NF",
    elem
  FROM "WMS_NFE_ENTRADA" e
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS elem
  WHERE e."TENANT_ID" = :TENANT_ID
    AND e."CD_DONO"  = :CD_DONO
    AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) = 'ENCERRADA'
)
SELECT
  exp."CD_NFE",
  exp."NUMERO_NF",
  NULLIF(TRIM(elem->>'codigoProduto'), '')         AS codigo_prod,
  NULLIF(TRIM(elem->>'lote'), '')                   AS lote,
  TRIM(elem->>'validade')                           AS validade_raw,
  CASE
    WHEN TRIM(elem->>'validade') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      THEN (TRIM(elem->>'validade')::date - CURRENT_DATE)::int
  END                                               AS dias_ate_venc,
  COALESCE(NULLIF(TRIM(elem->>'qtdConvertida'), ''), '0')::numeric AS qtd_conv,
  d."NU_DIAS_REL_VENCIMENTO"                        AS horizonte
FROM exp
JOIN "WMS_DONO_ESTOQUE" d
  ON d."CD_DONO" = :CD_DONO AND d."TENANT_ID" = :TENANT_ID
WHERE TRIM(elem->>'validade') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  AND COALESCE(NULLIF(TRIM(elem->>'qtdConvertida'), ''), '0')::numeric > 0
  AND (TRIM(elem->>'validade')::date - CURRENT_DATE) BETWEEN (d."NU_DIAS_REL_VENCIMENTO" + 1) AND (d."NU_DIAS_REL_VENCIMENTO" + 90)
ORDER BY dias_ate_venc ASC;
