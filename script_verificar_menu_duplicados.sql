-- ============================================================================
-- Verificar itens duplicados no menu (TIPOATIVIDADE)
-- Execute no pgAdmin no banco atlas_cargo_prd (ou divulgacarga_prd).
-- Um mesmo programa (DSPROGRAMA) não deve aparecer em mais de um grupo.
-- Atlas Cargo
-- ============================================================================

-- 1) Programas que aparecem mais de uma vez (mesmo DSPROGRAMA em vários registros)
SELECT
  "DSPROGRAMA" AS programa,
  COUNT(*) AS qtd,
  STRING_AGG("CDTIPOATIVIDADE"::text, ', ' ORDER BY "CDTIPOATIVIDADE") AS ids,
  STRING_AGG("DSTIPOATIVIDADE", ' | ' ORDER BY "CDTIPOATIVIDADE") AS nomes
FROM "TIPOATIVIDADE"
WHERE "FGACTIVE" = 'S'
  AND "DSPROGRAMA" IS NOT NULL
  AND TRIM("DSPROGRAMA") <> ''
GROUP BY "DSPROGRAMA"
HAVING COUNT(*) > 1
ORDER BY "DSPROGRAMA";

-- 2) Listagem completa: todos os itens do menu com grupo (para conferência)
--    Coluna "grupo_previsto" = grupo usado no backend para esse CDTIPOATIVIDADE
SELECT
  t."CDTIPOATIVIDADE" AS id,
  t."DSTIPOATIVIDADE" AS nome,
  t."DSPROGRAMA" AS programa,
  COALESCE(TRIM(t."FGGRUPO"), '') AS fggrupo_banco,
  CASE t."CDTIPOATIVIDADE"
    WHEN 1 THEN 'Cadastros'
    WHEN 2 THEN 'Cadastros'
    WHEN 20 THEN 'Cadastros'
    WHEN 3 THEN 'System'
    WHEN 5 THEN 'System'
    WHEN 31 THEN 'System'
    WHEN 32 THEN 'System'
    WHEN 4 THEN 'Gestão'
    WHEN 30 THEN 'Gestão'
    WHEN 33 THEN 'Gestão'
    WHEN 40 THEN 'Gestão'
    WHEN 41 THEN 'Gestão'
    WHEN 42 THEN 'Gestão'
    WHEN 43 THEN 'Gestão'
    WHEN 10 THEN 'Equipamentos'
    WHEN 11 THEN 'Equipamentos'
    WHEN 12 THEN 'Equipamentos'
    WHEN 13 THEN 'Equipamentos'
    WHEN 14 THEN 'Equipamentos'
    WHEN 23 THEN 'Equipamentos'
    WHEN 21 THEN 'Logística'
    WHEN 22 THEN 'Logística'
    WHEN 24 THEN 'Logística'
    WHEN 25 THEN 'Logística'
    ELSE COALESCE(NULLIF(TRIM(t."FGGRUPO"), ''), 'OUTROS')
  END AS grupo_previsto
FROM "TIPOATIVIDADE" t
WHERE t."FGACTIVE" = 'S'
ORDER BY grupo_previsto, t."CDTIPOATIVIDADE";

-- 3) Resumo: quantos itens por grupo (para ver se há grupo "OUTROS" com muitos itens)
SELECT
  CASE t."CDTIPOATIVIDADE"
    WHEN 1 THEN 'Cadastros'
    WHEN 2 THEN 'Cadastros'
    WHEN 20 THEN 'Cadastros'
    WHEN 3 THEN 'System'
    WHEN 5 THEN 'System'
    WHEN 31 THEN 'System'
    WHEN 32 THEN 'System'
    WHEN 4 THEN 'Gestão'
    WHEN 30 THEN 'Gestão'
    WHEN 33 THEN 'Gestão'
    WHEN 40 THEN 'Gestão'
    WHEN 41 THEN 'Gestão'
    WHEN 42 THEN 'Gestão'
    WHEN 43 THEN 'Gestão'
    WHEN 10 THEN 'Equipamentos'
    WHEN 11 THEN 'Equipamentos'
    WHEN 12 THEN 'Equipamentos'
    WHEN 13 THEN 'Equipamentos'
    WHEN 14 THEN 'Equipamentos'
    WHEN 23 THEN 'Equipamentos'
    WHEN 21 THEN 'Logística'
    WHEN 22 THEN 'Logística'
    WHEN 24 THEN 'Logística'
    WHEN 25 THEN 'Logística'
    ELSE COALESCE(NULLIF(TRIM(t."FGGRUPO"), ''), 'OUTROS')
  END AS grupo,
  COUNT(*) AS qtd_itens
FROM "TIPOATIVIDADE" t
WHERE t."FGACTIVE" = 'S'
GROUP BY 1
ORDER BY 2 DESC, 1;

-- 4) Detalhe dos duplicados: todos os registros cujo DSPROGRAMA aparece mais de uma vez
--    Use isso para decidir qual CDTIPOATIVIDADE manter e qual remover/inativar
SELECT
  t."CDTIPOATIVIDADE" AS id,
  t."DSTIPOATIVIDADE" AS nome,
  t."DSPROGRAMA" AS programa,
  t."FGGRUPO" AS fggrupo,
  CASE t."CDTIPOATIVIDADE"
    WHEN 1 THEN 'Cadastros'
    WHEN 2 THEN 'Cadastros'
    WHEN 20 THEN 'Cadastros'
    WHEN 3 THEN 'System'
    WHEN 5 THEN 'System'
    WHEN 31 THEN 'System'
    WHEN 32 THEN 'System'
    WHEN 4 THEN 'Gestão'
    WHEN 30 THEN 'Gestão'
    WHEN 33 THEN 'Gestão'
    WHEN 40 THEN 'Gestão'
    WHEN 41 THEN 'Gestão'
    WHEN 42 THEN 'Gestão'
    WHEN 43 THEN 'Gestão'
    WHEN 10 THEN 'Equipamentos'
    WHEN 11 THEN 'Equipamentos'
    WHEN 12 THEN 'Equipamentos'
    WHEN 13 THEN 'Equipamentos'
    WHEN 14 THEN 'Equipamentos'
    WHEN 23 THEN 'Equipamentos'
    WHEN 21 THEN 'Logística'
    WHEN 22 THEN 'Logística'
    WHEN 24 THEN 'Logística'
    WHEN 25 THEN 'Logística'
    ELSE COALESCE(NULLIF(TRIM(t."FGGRUPO"), ''), 'OUTROS')
  END AS grupo_no_menu
FROM "TIPOATIVIDADE" t
WHERE t."FGACTIVE" = 'S'
  AND t."DSPROGRAMA" IS NOT NULL
  AND TRIM(t."DSPROGRAMA") <> ''
  AND t."DSPROGRAMA" IN (
    SELECT "DSPROGRAMA"
    FROM "TIPOATIVIDADE"
    WHERE "FGACTIVE" = 'S'
      AND "DSPROGRAMA" IS NOT NULL
      AND TRIM("DSPROGRAMA") <> ''
    GROUP BY "DSPROGRAMA"
    HAVING COUNT(*) > 1
  )
ORDER BY t."DSPROGRAMA", t."CDTIPOATIVIDADE";

-- Se encontrar duplicados:
-- 1) Escolha qual CDTIPOATIVIDADE manter (ex.: o que está no grupo correto).
-- 2) Para o duplicado, ou inative: UPDATE "TIPOATIVIDADE" SET "FGACTIVE" = 'N' WHERE "CDTIPOATIVIDADE" = ???;
--    ou remova das permissões e depois delete (se não houver FK):
--    DELETE FROM "USUARIOATIVIDADE" WHERE "CDTIPOATIVIDADE" = ???;
--    DELETE FROM "TIPOATIVIDADE" WHERE "CDTIPOATIVIDADE" = ???;
