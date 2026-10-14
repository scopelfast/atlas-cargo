-- WMS — programa de menu "Relatórios" (estoque-relatorios).
-- PostgreSQL, idempotente. Executar no pgAdmin (ex.: atlas_cargo_prd) após backup.
-- Pasta: backend/public/modulos/estoque-relatorios/

INSERT INTO "TIPOATIVIDADE" ("CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGACTIVE", "FGGRUPO", "CD_MODULO_PRODUTO")
SELECT (SELECT COALESCE(MAX("CDTIPOATIVIDADE"), 0) + 1 FROM "TIPOATIVIDADE"),
  'WMS — Relatórios', 'estoque-relatorios', 'S', 'WMS',
  (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM "TIPOATIVIDADE" t WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'estoque-relatorios');

UPDATE "TIPOATIVIDADE" t
SET "CD_MODULO_PRODUTO" = (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' LIMIT 1),
  "FGGRUPO" = 'WMS',
  "DSTIPOATIVIDADE" = 'WMS — Relatórios'
WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'estoque-relatorios';
