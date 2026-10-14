-- Módulo comercial: Campanhas de Oportunidades
-- Pasta do programa: /modulos/campanhas-oportunidades/index.html
-- Idempotente (PostgreSQL)

INSERT INTO "TIPOATIVIDADE" (
  "CDTIPOATIVIDADE",
  "DSTIPOATIVIDADE",
  "DSPROGRAMA",
  "FGACTIVE",
  "FGGRUPO",
  "CD_MODULO_PRODUTO"
)
SELECT
  (SELECT COALESCE(MAX("CDTIPOATIVIDADE"), 0) + 1 FROM "TIPOATIVIDADE"),
  '9.7.Campanhas de Oportunidades',
  'campanhas-oportunidades',
  'S',
  'GESTAO',
  (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'divulga_cargas_torre' LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM "TIPOATIVIDADE" t WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'campanhas-oportunidades'
);

UPDATE "TIPOATIVIDADE" t
SET "CD_MODULO_PRODUTO" = (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'divulga_cargas_torre' LIMIT 1)
WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'campanhas-oportunidades'
  AND t."CD_MODULO_PRODUTO" IS NULL;
