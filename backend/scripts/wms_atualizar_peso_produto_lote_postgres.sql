-- WMS — atualização em lote de PESO_KG (via SQL / COPY)
--
-- Se Excel/país usa VÍRGULA como decimal E como separador de campo, o COPY quebra.
-- Use o importador Node (recomendado):
--
--   cd backend
--   node scripts/wms_import_peso_produto_lote.js --arquivo "C:\caminho\pesos.txt"
--   node scripts/wms_import_peso_produto_lote.js --arquivo "...\pesos.txt" --dry-run
--
-- Export: wms_export_produtos_peso_lote_donos_1_2_postgres.sql
-- Salve no Excel como: Texto Unicode (separado por tabulações) .txt
--   ou CSV com separador ; e decimal com PONTO no PESO_KG (ex.: 0.100)
--
-- ========== OPÇÃO SQL (só se o arquivo usar TAB ou ; sem vírgula no meio da linha) ==========

BEGIN;

CREATE TEMP TABLE IF NOT EXISTS tmp_wms_peso_produto (
  "CD_DONO" INTEGER,
  "CODIGO" TEXT,
  "PESO_KG_RAW" TEXT
) ON COMMIT DROP;

TRUNCATE TABLE tmp_wms_peso_produto;

-- IMPORTAR (escolha UMA linha, descomente):
--
-- TAB (melhor para Excel BR):
-- \copy tmp_wms_peso_produto ("CD_DONO","CODIGO","PESO_KG_RAW") FROM 'C:/temp/pesos.txt' WITH (FORMAT csv, HEADER true, DELIMITER E'\t', ENCODING 'UTF8');
--
-- Ponto-e-vírgula + decimal com PONTO no arquivo:
-- COPY tmp_wms_peso_produto ("CD_DONO","CODIGO","PESO_KG_RAW") FROM 'C:/temp/pesos.csv' WITH (FORMAT csv, HEADER true, DELIMITER ';', ENCODING 'UTF8');

SELECT COUNT(*) AS linhas_no_staging FROM tmp_wms_peso_produto;

WITH s AS (
  SELECT
    "CD_DONO",
    TRIM(COALESCE("CODIGO", '')) AS codigo_trim,
    NULLIF(
      REPLACE(
        REPLACE(TRIM(COALESCE("PESO_KG_RAW", '')), ' ', ''),
        ',',
        '.'
      ),
      ''
    ) AS peso_txt
  FROM tmp_wms_peso_produto
),
norm AS (
  SELECT
    "CD_DONO",
    codigo_trim,
    CASE
      WHEN peso_txt ~ '^[0-9]+(\.[0-9]+)?$' THEN peso_txt::numeric(12, 3)
      ELSE NULL
    END AS peso_kg
  FROM s
  WHERE "CD_DONO" IS NOT NULL
    AND codigo_trim <> ''
),
dedup AS (
  SELECT "CD_DONO", codigo_trim, MAX(peso_kg) AS peso_kg
  FROM norm
  WHERE peso_kg IS NOT NULL AND peso_kg >= 0
  GROUP BY "CD_DONO", codigo_trim
),
upd AS (
  UPDATE "WMS_PRODUTO_DONO" p
     SET "PESO_KG" = d.peso_kg,
         "DH_MAINTENANCE" = CURRENT_TIMESTAMP
    FROM dedup d
   WHERE p."TENANT_ID" = 'default'
     AND p."CD_DONO" = d."CD_DONO"
     AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
     AND LOWER(TRIM(p."CODIGO")) = LOWER(d.codigo_trim)
  RETURNING p."CD_PRODUTO"
)
SELECT COUNT(*) AS produtos_atualizados FROM upd;

COMMIT;
