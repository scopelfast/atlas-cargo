-- WMS — Gerar De-para para Separação OPL a partir do catálogo (piloto Nutriville)
-- Objetivo: CODIGO_EXTERNO (código do espelho OL) → CODIGO_INTERNO (estoque mascarado)
--
-- Rodar no pgAdmin após catálogo OL (WMS_PRODUTO_DONO + WMS_PRODUTO_OPERACIONAL).
-- Não apaga de-paras existentes: só insere chaves que ainda não existem.
--
-- Ajuste aqui se necessário:
--   TENANT_ID = 'default'
--   CD_DONO   = 2  (Nutriville)

-- ========== Prévia ==========
SELECT 'operacional → de-para' AS origem, COUNT(*) AS candidatos
  FROM (
    SELECT DISTINCT ON (o."TENANT_ID", o."CD_DONO", LOWER(TRIM(o."CODIGO_OPERACIONAL")))
           o."TENANT_ID", o."CD_DONO"
      FROM "WMS_PRODUTO_OPERACIONAL" o
      INNER JOIN "WMS_PRODUTO_DONO" p
        ON p."CD_PRODUTO" = o."CD_PRODUTO" AND p."TENANT_ID" = o."TENANT_ID"
     WHERE o."TENANT_ID" = 'default'
       AND o."CD_DONO" = 2
       AND COALESCE(o."FGACTIVE", 'S') = 'S'
       AND COALESCE(p."FGACTIVE", 'S') = 'S'
       AND TRIM(o."CODIGO_OPERACIONAL") <> ''
       AND TRIM(o."CODIGO_ESTOQUE") <> ''
  ) x;

SELECT COUNT(*) AS produtos_estoque_dono
  FROM "WMS_PRODUTO_DONO" p
 WHERE p."TENANT_ID" = 'default'
   AND p."CD_DONO" = 2
   AND COALESCE(p."FGACTIVE", 'S') = 'S'
   AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N';

-- ========== Inserção ==========
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
  'script/depara-opl'
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
     AND o."CD_DONO" = 2
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

INSERT INTO "WMS_DEPARA_PRODUTO"
  ("TENANT_ID", "CD_DONO", "CODIGO_EXTERNO", "CODIGO_INTERNO", "FATOR_CONVERSAO", "OBSERVACAO", "FGACTIVE", "SG_USER")
SELECT
  p."TENANT_ID",
  p."CD_DONO",
  TRIM(p."CODIGO"),
  TRIM(p."CODIGO"),
  1,
  'Gerado automaticamente (WMS_PRODUTO_DONO — código estoque)',
  'S',
  'script/depara-opl'
FROM "WMS_PRODUTO_DONO" p
WHERE p."TENANT_ID" = 'default'
  AND p."CD_DONO" = 2
  AND COALESCE(p."FGACTIVE", 'S') = 'S'
  AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
  AND TRIM(p."CODIGO") <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "WMS_DEPARA_PRODUTO" d
     WHERE d."TENANT_ID" = p."TENANT_ID"
       AND d."CD_DONO" = p."CD_DONO"
       AND LOWER(TRIM(d."CODIGO_EXTERNO")) = LOWER(TRIM(p."CODIGO"))
  );

INSERT INTO "WMS_DEPARA_PRODUTO"
  ("TENANT_ID", "CD_DONO", "CODIGO_EXTERNO", "CODIGO_INTERNO", "FATOR_CONVERSAO", "OBSERVACAO", "FGACTIVE", "SG_USER")
SELECT
  p."TENANT_ID",
  p."CD_DONO",
  LOWER(regexp_replace(TRIM(p."CODIGO"), '[^0-9A-Za-z]', '', 'g')),
  TRIM(p."CODIGO"),
  1,
  'Gerado automaticamente (chave SKU sem máscara)',
  'S',
  'script/depara-opl'
FROM "WMS_PRODUTO_DONO" p
WHERE p."TENANT_ID" = 'default'
  AND p."CD_DONO" = 2
  AND COALESCE(p."FGACTIVE", 'S') = 'S'
  AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
  AND TRIM(p."CODIGO") <> ''
  AND LENGTH(regexp_replace(TRIM(p."CODIGO"), '[^0-9A-Za-z]', '', 'g')) >= 4
  AND LOWER(regexp_replace(TRIM(p."CODIGO"), '[^0-9A-Za-z]', '', 'g'))
      <> LOWER(TRIM(p."CODIGO"))
  AND NOT EXISTS (
    SELECT 1 FROM "WMS_DEPARA_PRODUTO" d
     WHERE d."TENANT_ID" = p."TENANT_ID"
       AND d."CD_DONO" = p."CD_DONO"
       AND LOWER(TRIM(d."CODIGO_EXTERNO")) =
           LOWER(regexp_replace(TRIM(p."CODIGO"), '[^0-9A-Za-z]', '', 'g'))
  );

COMMIT;

SELECT COUNT(*) AS total_depara_ativos
  FROM "WMS_DEPARA_PRODUTO"
 WHERE "TENANT_ID" = 'default'
   AND "CD_DONO" = 2
   AND "FGACTIVE" = 'S';
