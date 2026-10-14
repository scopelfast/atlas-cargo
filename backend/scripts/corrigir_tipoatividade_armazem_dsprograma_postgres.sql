-- Corrige item de menu com nome tipo "8.0.Armazém" que ficou com DSPROGRAMA = 'default'
-- (o dashboard só carrega módulos quando programa <> 'default').
-- O cadastro de armazéns WMS é a mesma tela: /modulos/estoque-cadastros-wms/ (aba Armazém).
--
-- Não substitui o script wms_cadastros_mestre_postgres.sql (tabelas WMS); isso é só cadastro de menu.
-- Idempotente: pode rodar mais de uma vez.

-- Pré-visualização (opcional): descomente para conferir antes do UPDATE.
-- SELECT "CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGGRUPO", "CD_MODULO_PRODUTO"
-- FROM "TIPOATIVIDADE"
-- WHERE TRIM(LOWER(COALESCE("DSPROGRAMA", ''))) IN ('default', '')
--   AND "DSTIPOATIVIDADE" ILIKE '%armaz%';

UPDATE "TIPOATIVIDADE" t
SET
  "DSPROGRAMA" = 'estoque-cadastros-wms',
  "FGGRUPO" = 'WMS',
  "CD_MODULO_PRODUTO" = COALESCE(
    t."CD_MODULO_PRODUTO",
    (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'estoque' AND m."FGACTIVE" = 'S' LIMIT 1)
  )
WHERE TRIM(LOWER(COALESCE(t."DSPROGRAMA", ''))) IN ('default', '')
  AND t."DSTIPOATIVIDADE" ILIKE '%armaz%'
  AND t."FGACTIVE" = 'S';

-- Se o item antigo não tinha "armazém" no nome mas é claramente o placeholder 8.0 (ajuste o padrão se precisar):
-- UPDATE "TIPOATIVIDADE" SET "DSPROGRAMA" = 'estoque-cadastros-wms', "FGGRUPO" = 'WMS'
-- WHERE "CDTIPOATIVIDADE" = <id_visto_no_SELECT>;
