-- wms_enderecos_entrega_revisao_inativar_postgres.sql
-- Rode no pgAdmin. Gera lista de CD_ENDERECO_ENTREGA recomendados para INATIVAR (FGACTIVE = 'I').
-- NÃO apaga registro — só inativa. Revise o SELECT antes do UPDATE.
--
-- AJUSTE:
--   TENANT_ID do piloto (ex.: 'default' ou tenant Mana)
--   Filtro CNPJ matriz Mana (14 dígitos) se quiser só esse cliente

-- <<< TENANT_ID
-- <<< CNPJ_14 opcional: '00000000000000' ou deixe NULL para todos os PJ

BEGIN;

WITH params AS (
  SELECT
    'default'::varchar AS tenant_id,  -- <<< altere
    NULL::varchar AS cnpj_filtro       -- <<< ex.: '82603586000103' — CNPJ Mana; NULL = todos
),
base AS (
  SELECT
    e."CD_ENDERECO_ENTREGA",
    e."TENANT_ID",
    e."CD_CLIENTE",
    e."CHAVE_IMPORT",
    e."DS_PONTO_ENTREGA",
    e."UF_ENTREGA",
    e."NM_MUNICIPIO",
    e."CEP",
    e."LOGRADOURO",
    e."NUMERO",
    e."LATITUDE",
    e."LONGITUDE",
    e."NR_ROTA",
    e."FGACTIVE",
    e."DH_INCLUSAO",
    right(lpad(regexp_replace(trim(coalesce(cg."CGCCPF", '')), '[^0-9]', '', 'g'), 14, '0'), 14) AS cnpj_14,
    upper(trim(coalesce(e."DS_PONTO_ENTREGA", ''))) AS ponto_up,
    regexp_replace(upper(trim(coalesce(e."LOGRADOURO", ''))), '[^A-Z0-9]', '', 'g') AS logr_norm,
    regexp_replace(coalesce(e."CEP", ''), '[^0-9]', '', 'g') AS cep_d,
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            upper(regexp_replace(trim(coalesce(e."NUMERO", '')), '[[:space:]]+', '', 'g')),
            '^(S/N|SN|-|\.)$', 'SN', 'i'
          ),
          '^N\.', '', 'i'
        ),
        '^N[°º]', '', 'i'
      ),
      '[^A-Z0-9]', '', 'g'
    ) AS num_norm,
    regexp_replace(
      upper(trim(coalesce(e."DS_PONTO_ENTREGA", ''))),
      '[^A-Z0-9]', '', 'g'
    ) AS ponto_norm
  FROM "CADASTRO_ENDERECO_ENTREGA" e
  JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = e."CD_CLIENTE"
  CROSS JOIN params p
  WHERE e."TENANT_ID" = p.tenant_id
    AND e."FGACTIVE" = 'A'
    AND cg."FGACTIVE" = 'A'
    AND (p.cnpj_filtro IS NULL OR right(lpad(regexp_replace(trim(coalesce(cg."CGCCPF", '')), '[^0-9]', '', 'g'), 14, '0'), 14) = p.cnpj_filtro)
),

-- 1) Mesma CHAVE_IMPORT (cadastro duplicado real) — manter o menor CD
dup_chave AS (
  SELECT
    b."CHAVE_IMPORT",
    count(*) AS qtd,
    min(b."CD_ENDERECO_ENTREGA") AS manter_cd
  FROM base b
  WHERE trim(coalesce(b."CHAVE_IMPORT", '')) <> ''
  GROUP BY b."CHAVE_IMPORT"
  HAVING count(*) > 1
),
rec_chave AS (
  SELECT
    b."CD_ENDERECO_ENTREGA",
    'DUPLICATA_CHAVE_IMPORT' AS motivo,
    b."CHAVE_IMPORT",
    b."DS_PONTO_ENTREGA",
    b.cnpj_14,
    d.manter_cd AS manter_cd
  FROM base b
  JOIN dup_chave d ON d."CHAVE_IMPORT" = b."CHAVE_IMPORT"
  WHERE b."CD_ENDERECO_ENTREGA" <> d.manter_cd
),

-- 2) Nome explícito INATIVA no cadastro
rec_inativa AS (
  SELECT
    b."CD_ENDERECO_ENTREGA",
    'NOME_MARCA_INATIVA' AS motivo,
    b."CHAVE_IMPORT",
    b."DS_PONTO_ENTREGA",
    b.cnpj_14,
    NULL::integer AS manter_cd
  FROM base b
  WHERE b.ponto_up LIKE '%INATIVA%'
     OR b.ponto_up LIKE '%INATIVO%'
),

-- 3) Mesmo ponto_norm + endereço + CNPJ (registro gemeo) — manter menor CD
dup_fisico_nome AS (
  SELECT
    b.cnpj_14,
    b.ponto_norm,
    b.logr_norm,
    b.num_norm,
    b.cep_d,
    count(*) AS qtd,
    min(b."CD_ENDERECO_ENTREGA") AS manter_cd
  FROM base b
  WHERE b.ponto_norm <> ''
  GROUP BY b.cnpj_14, b.ponto_norm, b.logr_norm, b.num_norm, b.cep_d
  HAVING count(*) > 1
),
rec_fisico AS (
  SELECT
    b."CD_ENDERECO_ENTREGA",
    'DUPLICATA_MESMO_NOME_ENDERECO' AS motivo,
    b."CHAVE_IMPORT",
    b."DS_PONTO_ENTREGA",
    b.cnpj_14,
    d.manter_cd
  FROM base b
  JOIN dup_fisico_nome d
    ON d.cnpj_14 = b.cnpj_14
   AND d.ponto_norm = b.ponto_norm
   AND d.logr_norm = b.logr_norm
   AND d.num_norm = b.num_norm
   AND d.cep_d = b.cep_d
  WHERE b."CD_ENDERECO_ENTREGA" <> d.manter_cd
),

-- 4) Mesmo endereço + mesmas coordenadas, nomes diferentes só por pontuação (ex.: IRANI 2x)
dup_coord AS (
  SELECT
    b.cnpj_14,
    b.logr_norm,
    b.num_norm,
    b.cep_d,
    round(b."LATITUDE"::numeric, 5) AS lat_r,
    round(b."LONGITUDE"::numeric, 5) AS lon_r,
    count(*) AS qtd,
    min(b."CD_ENDERECO_ENTREGA") AS manter_cd
  FROM base b
  WHERE b."LATITUDE" IS NOT NULL
    AND b."LONGITUDE" IS NOT NULL
  GROUP BY b.cnpj_14, b.logr_norm, b.num_norm, b.cep_d, round(b."LATITUDE"::numeric, 5), round(b."LONGITUDE"::numeric, 5)
  HAVING count(*) > 1
),
rec_coord AS (
  SELECT
    b."CD_ENDERECO_ENTREGA",
    'DUPLICATA_MESMO_ENDERECO_COORD' AS motivo,
    b."CHAVE_IMPORT",
    b."DS_PONTO_ENTREGA",
    b.cnpj_14,
    d.manter_cd
  FROM base b
  JOIN dup_coord d
    ON d.cnpj_14 = b.cnpj_14
   AND d.logr_norm = b.logr_norm
   AND d.num_norm = b.num_norm
   AND d.cep_d = b.cep_d
   AND round(b."LATITUDE"::numeric, 5) = d.lat_r
   AND round(b."LONGITUDE"::numeric, 5) = d.lon_r
  WHERE b."CD_ENDERECO_ENTREGA" <> d.manter_cd
   AND regexp_replace(b.ponto_norm, '[^A-Z0-9]', '', 'g')
       = (SELECT regexp_replace(x.ponto_norm, '[^A-Z0-9]', '', 'g')
            FROM base x WHERE x."CD_ENDERECO_ENTREGA" = d.manter_cd LIMIT 1)
    OR (
      -- IRANI / variação SA vs S.A. no mesmo lat/lon
      b.ponto_norm LIKE '%1140%IRANI%'
      AND EXISTS (
        SELECT 1 FROM base x
         WHERE x."CD_ENDERECO_ENTREGA" = d.manter_cd
           AND x.ponto_norm LIKE '%1140%IRANI%'
      )
    )
),

uniao AS (
  SELECT * FROM rec_chave
  UNION
  SELECT * FROM rec_inativa
  UNION
  SELECT * FROM rec_fisico
  UNION
  SELECT * FROM rec_coord
),
dedup AS (
  SELECT DISTINCT ON ("CD_ENDERECO_ENTREGA")
    "CD_ENDERECO_ENTREGA",
    motivo,
    "CHAVE_IMPORT",
    "DS_PONTO_ENTREGA",
    cnpj_14,
    manter_cd
  FROM uniao
  ORDER BY "CD_ENDERECO_ENTREGA", motivo
)

-- ========== RESULTADO: copie os CDs antes de inativar ==========
SELECT
  d."CD_ENDERECO_ENTREGA" AS inativar_cd,
  d.motivo,
  d.manter_cd AS manter_cd_em_vez_deste,
  d."DS_PONTO_ENTREGA",
  d.cnpj_14
FROM dedup d
ORDER BY d.motivo, d."CD_ENDERECO_ENTREGA";

-- Array pronto para o UPDATE (só se concordar com a lista acima):
-- SELECT array_agg("CD_ENDERECO_ENTREGA" ORDER BY "CD_ENDERECO_ENTREGA") FROM dedup;

-- ========== NÃO inativar (só informativo): mesmo endereço, nomes diferentes de unidade ==========
SELECT
  b.logr_norm,
  b.num_norm,
  b.cep_d,
  b.cnpj_14,
  count(*) AS qtd_pontos,
  string_agg(b."CD_ENDERECO_ENTREGA"::text || ' — ' || left(b."DS_PONTO_ENTREGA", 60), E'\n' ORDER BY b."CD_ENDERECO_ENTREGA") AS pontos
FROM base b
GROUP BY b.cnpj_14, b.logr_norm, b.num_norm, b.cep_d
HAVING count(*) > 1
   AND count(DISTINCT b.ponto_norm) > 1
ORDER BY qtd_pontos DESC;

ROLLBACK;

-- ============================================================
-- Depois de validar, rode o UPDATE (fora desta transação):
-- ============================================================
/*
WITH ids AS (
  SELECT unnest(ARRAY[123, 456]::int[]) AS id  -- <<< cole os inativar_cd
)
UPDATE "CADASTRO_ENDERECO_ENTREGA" e
   SET "FGACTIVE" = 'I',
       "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
       "SGUSER" = 'REVISAO_DUPLICATAS'
  FROM ids
 WHERE e."CD_ENDERECO_ENTREGA" = ids.id
   AND e."FGACTIVE" = 'A';
*/
