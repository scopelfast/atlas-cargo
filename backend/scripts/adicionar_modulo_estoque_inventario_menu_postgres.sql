-- WMS — programa de menu "Inventário" (estoque-inventario).
-- PostgreSQL, idempotente. Executar no pgAdmin (ex.: atlas_cargo_prd) após backup.
-- Pasta: backend/public/modulos/estoque-inventario/
-- Orientação: docs/WMS_INVENTARIO_ORIENTACAO_PROCESSO.md

INSERT INTO "TIPOATIVIDADE" ("CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGACTIVE", "FGGRUPO", "CD_MODULO_PRODUTO")
SELECT (SELECT COALESCE(MAX("CDTIPOATIVIDADE"), 0) + 1 FROM "TIPOATIVIDADE"),
  'WMS — Inventário', 'estoque-inventario', 'S', 'WMS',
  (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM "TIPOATIVIDADE" t WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'estoque-inventario');

UPDATE "TIPOATIVIDADE" t
SET "CD_MODULO_PRODUTO" = (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' LIMIT 1),
  "FGGRUPO" = 'WMS',
  "DSTIPOATIVIDADE" = 'WMS — Inventário'
WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'estoque-inventario';
