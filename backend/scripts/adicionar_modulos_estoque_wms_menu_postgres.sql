-- Módulos WMS / Estoque no menu (grupo WMS, módulo de produto "estoque").
-- PostgreSQL, idempotente. Executar no pgAdmin (ex.: atlas_cargo_prd) após backup.
-- Pastas: /modulos/estoque/, estoque-recebimento/, estoque-separacao/, estoque-cargas/, estoque-expedicao/, estoque-cadastros-wms/, estoque-inventario/, estoque-relatorios/
--
-- Depois de rodar:
--   1) Selecionar módulo de produto "Gestão de Estoque" no dashboard (se usar seletor de módulo).
--   2) Gerenciar Usuário → vincular cada CDTIPOATIVIDADE ao perfil (USUARIOATIVIDADE).

-- Garantir linha em MODULO_PRODUTO (já criada por modulo_produto_torre_postgres.sql em instalações alinhadas)
INSERT INTO "MODULO_PRODUTO" ("CD_MODULO", "CODIGO", "NOME", "DESCRICAO", "ORDEM", "FGACTIVE")
SELECT (SELECT COALESCE(MAX(m."CD_MODULO"), 0) + 1 FROM "MODULO_PRODUTO" m),
  'estoque', 'Gestão de Estoque', 'WMS: recebimento, separação, cargas, expedição e cadastros.', 2, 'S'
WHERE NOT EXISTS (SELECT 1 FROM "MODULO_PRODUTO" WHERE "CODIGO" = 'estoque');

INSERT INTO "TIPOATIVIDADE" ("CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGACTIVE", "FGGRUPO", "CD_MODULO_PRODUTO")
SELECT (SELECT COALESCE(MAX("CDTIPOATIVIDADE"), 0) + 1 FROM "TIPOATIVIDADE"), 'WMS — Estoque', 'estoque', 'S', 'WMS',
  (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM "TIPOATIVIDADE" t WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'estoque');

INSERT INTO "TIPOATIVIDADE" ("CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGACTIVE", "FGGRUPO", "CD_MODULO_PRODUTO")
SELECT (SELECT COALESCE(MAX("CDTIPOATIVIDADE"), 0) + 1 FROM "TIPOATIVIDADE"), 'WMS — Recebimento', 'estoque-recebimento', 'S', 'WMS',
  (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM "TIPOATIVIDADE" t WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'estoque-recebimento');

INSERT INTO "TIPOATIVIDADE" ("CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGACTIVE", "FGGRUPO", "CD_MODULO_PRODUTO")
SELECT (SELECT COALESCE(MAX("CDTIPOATIVIDADE"), 0) + 1 FROM "TIPOATIVIDADE"), 'WMS — Separação', 'estoque-separacao', 'S', 'WMS',
  (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM "TIPOATIVIDADE" t WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'estoque-separacao');

INSERT INTO "TIPOATIVIDADE" ("CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGACTIVE", "FGGRUPO", "CD_MODULO_PRODUTO")
SELECT (SELECT COALESCE(MAX("CDTIPOATIVIDADE"), 0) + 1 FROM "TIPOATIVIDADE"), 'WMS — Cargas programadas', 'estoque-cargas', 'S', 'WMS',
  (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM "TIPOATIVIDADE" t WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'estoque-cargas');

INSERT INTO "TIPOATIVIDADE" ("CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGACTIVE", "FGGRUPO", "CD_MODULO_PRODUTO")
SELECT (SELECT COALESCE(MAX("CDTIPOATIVIDADE"), 0) + 1 FROM "TIPOATIVIDADE"), 'WMS — Expedição', 'estoque-expedicao', 'S', 'WMS',
  (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM "TIPOATIVIDADE" t WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'estoque-expedicao');

INSERT INTO "TIPOATIVIDADE" ("CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGACTIVE", "FGGRUPO", "CD_MODULO_PRODUTO")
SELECT (SELECT COALESCE(MAX("CDTIPOATIVIDADE"), 0) + 1 FROM "TIPOATIVIDADE"), 'WMS — Cadastros (armazém, doca, dono)', 'estoque-cadastros-wms', 'S', 'WMS',
  (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM "TIPOATIVIDADE" t WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'estoque-cadastros-wms');

INSERT INTO "TIPOATIVIDADE" ("CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGACTIVE", "FGGRUPO", "CD_MODULO_PRODUTO")
SELECT (SELECT COALESCE(MAX("CDTIPOATIVIDADE"), 0) + 1 FROM "TIPOATIVIDADE"), 'WMS — Inventário', 'estoque-inventario', 'S', 'WMS',
  (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM "TIPOATIVIDADE" t WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'estoque-inventario');

UPDATE "TIPOATIVIDADE" t
SET "CD_MODULO_PRODUTO" = (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' LIMIT 1),
  "FGGRUPO" = 'WMS'
WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) IN (
  'estoque', 'estoque-recebimento', 'estoque-separacao', 'estoque-cargas', 'estoque-expedicao', 'estoque-cadastros-wms', 'estoque-inventario', 'estoque-relatorios', 'estoque-valor', 'estoque-transferencias'
)
  AND (
    t."CD_MODULO_PRODUTO" IS DISTINCT FROM (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' LIMIT 1)
    OR TRIM(COALESCE(t."FGGRUPO", '')) IS DISTINCT FROM 'WMS'
  );
