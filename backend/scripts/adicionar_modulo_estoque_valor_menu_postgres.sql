-- WMS — programa de menu "Valor de estoque" (estoque-valor).
-- PostgreSQL, idempotente. Executar após adicionar_wms_estoque_valor_snapshot_postgres.sql

INSERT INTO "TIPOATIVIDADE" ("CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGACTIVE", "FGGRUPO", "CD_MODULO_PRODUTO")
SELECT (SELECT COALESCE(MAX("CDTIPOATIVIDADE"), 0) + 1 FROM "TIPOATIVIDADE"),
  'WMS — Valor de estoque', 'estoque-valor', 'S', 'WMS',
  (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM "TIPOATIVIDADE" t WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'estoque-valor');

UPDATE "TIPOATIVIDADE" t
SET "CD_MODULO_PRODUTO" = (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' LIMIT 1),
  "FGGRUPO" = 'WMS',
  "DSTIPOATIVIDADE" = 'WMS — Valor de estoque'
WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'estoque-valor';
