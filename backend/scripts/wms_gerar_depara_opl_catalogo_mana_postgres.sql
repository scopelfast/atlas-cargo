-- WMS — Gerar De-para OPL a partir do catálogo importado (Mana, CD_DONO = 1)
-- Mesma lógica de wms_gerar_depara_opl_catalogo_postgres.sql (piloto Nutriville = 2).
-- Rodar após: node scripts/wms_import_catalogo_ol.js --arquivo "..." --cd-dono 1

BEGIN;

INSERT INTO "WMS_DEPARA_PRODUTO"
  ("TENANT_ID", "CD_DONO", "CODIGO_EXTERNO", "CODIGO_INTERNO", "FATOR_CONVERSAO", "OBSERVACAO", "FGACTIVE", "SG_USER")
SELECT
  s."TENANT_ID",
  s."CD_DONO",
  s.cod_ext,
  s.cod_int,
  s.fator,
  'Gerado automaticamente (WMS_PRODUTO_OPERACIONAL)',
  'S',
  'script/depara-opl-mana'
FROM (
  SELECT DISTINCT ON (o."TENANT_ID", o."CD_DONO", LOWER(TRIM(o."CODIGO_OPERACIONAL")))
         o."TENANT_ID",
         o."CD_DONO",
         TRIM(o."CODIGO_OPERACIONAL") AS cod_ext,
         TRIM(o."CODIGO_ESTOQUE") AS cod_int,
         GREATEST(COALESCE(o."FATOR_CONVERSAO", 1), 0.000001) AS fator
    FROM "WMS_PRODUTO_OPERACIONAL" o
    INNER JOIN "WMS_PRODUTO_DONO" p
      ON p."CD_PRODUTO" = o."CD_PRODUTO" AND p."TENANT_ID" = o."TENANT_ID"
   WHERE o."TENANT_ID" = 'default'
     AND o."CD_DONO" = 1
     AND COALESCE(o."FGACTIVE", 'S') = 'S'
     AND COALESCE(p."FGACTIVE", 'S') = 'S'
     AND TRIM(o."CODIGO_OPERACIONAL") <> ''
     AND TRIM(o."CODIGO_ESTOQUE") <> ''
   ORDER BY o."TENANT_ID", o."CD_DONO", LOWER(TRIM(o."CODIGO_OPERACIONAL"))
) s
WHERE NOT EXISTS (
  SELECT 1 FROM "WMS_DEPARA_PRODUTO" d
   WHERE d."TENANT_ID" = s."TENANT_ID"
     AND d."CD_DONO" = s."CD_DONO"
     AND LOWER(TRIM(d."CODIGO_EXTERNO")) = LOWER(TRIM(s.cod_ext))
);

COMMIT;

SELECT COUNT(*) AS depara_opl_mana
  FROM "WMS_DEPARA_PRODUTO"
 WHERE "TENANT_ID" = 'default' AND "CD_DONO" = 1 AND "FGACTIVE" = 'S';
