-- WMS — programa de menu "Baixas / Perdas" (estoque-baixas).
-- PostgreSQL, idempotente. Executar no pgAdmin (ex.: atlas_cargo_prd) após backup.
-- Pasta: backend/public/modulos/estoque-baixas/
-- Pré-requisito: adicionar_wms_baixa_estoque_postgres.sql (tabelas WMS_BAIXA_*)

INSERT INTO "TIPOATIVIDADE" ("CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGACTIVE", "FGGRUPO", "CD_MODULO_PRODUTO")
SELECT (SELECT COALESCE(MAX("CDTIPOATIVIDADE"), 0) + 1 FROM "TIPOATIVIDADE"),
  '5.8.Baixas / Perdas', 'estoque-baixas', 'S', 'WMS',
  (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM "TIPOATIVIDADE" t WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'estoque-baixas');

UPDATE "TIPOATIVIDADE" t
SET "CD_MODULO_PRODUTO" = (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' LIMIT 1),
  "FGGRUPO" = 'WMS',
  "DSTIPOATIVIDADE" = '5.8.Baixas / Perdas',
  "FGACTIVE" = 'S'
WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'estoque-baixas';

-- Conferir:
-- SELECT "CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGACTIVE"
--   FROM "TIPOATIVIDADE" WHERE "DSPROGRAMA" = 'estoque-baixas';
