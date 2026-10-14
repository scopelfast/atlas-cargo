-- WMS — programa de menu "Transferências entre donos" (estoque-transferencias).
-- PostgreSQL, idempotente. Executar no pgAdmin (ex.: atlas_cargo_prd) após backup.
-- Pasta: backend/public/modulos/estoque-transferencias/
-- Orientação: docs/WMS_INVENTARIO_MANUAL_OPERADOR.md (seção "Transferência entre donos")
--
-- Pré-requisito: criar_wms_transferencia_dono_postgres.sql (tabela do documento).

INSERT INTO "TIPOATIVIDADE" ("CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGACTIVE", "FGGRUPO", "CD_MODULO_PRODUTO")
SELECT (SELECT COALESCE(MAX("CDTIPOATIVIDADE"), 0) + 1 FROM "TIPOATIVIDADE"),
  'WMS — Transferências entre donos', 'estoque-transferencias', 'S', 'WMS',
  (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM "TIPOATIVIDADE" t WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'estoque-transferencias');

UPDATE "TIPOATIVIDADE" t
SET "CD_MODULO_PRODUTO" = (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' LIMIT 1),
  "FGGRUPO" = 'WMS',
  "DSTIPOATIVIDADE" = 'WMS — Transferências entre donos'
WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'estoque-transferencias';
