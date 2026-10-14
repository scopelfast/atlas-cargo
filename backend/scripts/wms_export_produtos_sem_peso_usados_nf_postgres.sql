-- WMS — produtos SEM PESO que aparecem em NF-e de saída (para CSV de lote)
-- Exporte o resultado principal para CSV: CD_DONO;CODIGO;PESO_KG
--
-- Por que podem ser POUCAS linhas (ex.: 15) com 1234 sem peso no cadastro?
--   • Os 1234 = TODOS os produtos do dono sem PESO_KG no WMS_PRODUTO_DONO.
--   • Esta lista = só os que TAMBÉM aparecem em alguma NF-e de saída importada (LINHAS_JSON)
--     E batem com o cadastro (mesmo código em dígitos).
--   • O restante (1219…) nunca entrou em NF no banco — não entra no relatório de cargas hoje.
--
-- Ajuste tenant / CD_DONO abaixo.

-- ========== DIAGNÓSTICO (rode antes; 4 resultados) ==========

-- D1) Sem peso no cadastro (total)
SELECT COUNT(*) AS produtos_sem_peso_cadastro
  FROM "WMS_PRODUTO_DONO" p
 WHERE p."TENANT_ID" = 'default'
   AND p."CD_DONO" = 1
   AND (p."PESO_KG" IS NULL OR p."PESO_KG" <= 0);

-- D2) Códigos distintos nas NF-e de saída (tenant)
SELECT COUNT(DISTINCT regexp_replace(trim(COALESCE(ln->>'cProd', ln->>'codigo', '')), '[^0-9]', '', 'g')) AS skus_distintos_nas_nf
  FROM "WMS_NFE_SAIDA" n
 CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END
       ) AS ln
 WHERE n."TENANT_ID" = 'default'
   AND COALESCE(ln->>'cProd', ln->>'codigo', '') <> '';

-- D3) Sem peso no cadastro E aparecem na NF (o que o export lista)
WITH linhas AS (
  SELECT DISTINCT
         COALESCE(n."CD_DONO", 1) AS cd_dono,
         regexp_replace(trim(COALESCE(ln->>'cProd', ln->>'codigo', '')), '[^0-9]', '', 'g') AS cod_dig
    FROM "WMS_NFE_SAIDA" n
   CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END
         ) AS ln
   WHERE n."TENANT_ID" = 'default'
     AND regexp_replace(trim(COALESCE(ln->>'cProd', ln->>'codigo', '')), '[^0-9]', '', 'g') <> ''
),
sem_peso AS (
  SELECT regexp_replace(trim(p."CODIGO"), '[^0-9]', '', 'g') AS cod_dig
    FROM "WMS_PRODUTO_DONO" p
   WHERE p."TENANT_ID" = 'default'
     AND p."CD_DONO" = 1
     AND (p."PESO_KG" IS NULL OR p."PESO_KG" <= 0)
)
SELECT COUNT(*) AS sem_peso_que_aparecem_em_nf
  FROM sem_peso s
  JOIN linhas l ON l.cd_dono = 1 AND l.cod_dig = s.cod_dig;

-- D4) Linhas na NF cujo SKU (dígitos) não existe no cadastro do dono 1
WITH linhas AS (
  SELECT DISTINCT
         regexp_replace(trim(COALESCE(ln->>'cProd', ln->>'codigo', '')), '[^0-9]', '', 'g') AS cod_dig,
         trim(COALESCE(ln->>'cProd', ln->>'codigo', '')) AS cod_xml
    FROM "WMS_NFE_SAIDA" n
   CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END
         ) AS ln
   WHERE n."TENANT_ID" = 'default'
     AND regexp_replace(trim(COALESCE(ln->>'cProd', ln->>'codigo', '')), '[^0-9]', '', 'g') <> ''
)
SELECT COUNT(*) AS skus_na_nf_sem_cadastro_dono1
  FROM linhas l
 WHERE NOT EXISTS (
         SELECT 1 FROM "WMS_PRODUTO_DONO" p
          WHERE p."TENANT_ID" = 'default'
            AND p."CD_DONO" = 1
            AND regexp_replace(trim(p."CODIGO"), '[^0-9]', '', 'g') = l.cod_dig
       );

-- ========== EXPORT (prioridade: usados em cargas RASCUNHO / não expedidas) ==========

WITH cargas_abertas AS (
  SELECT DISTINCT j."CD_NFE_SAIDA"
    FROM "WMS_CARGA_PROGRAMADA_NFE" j
    JOIN "WMS_CARGA_PROGRAMADA" c
      ON c."CD_CARGA" = j."CD_CARGA" AND c."TENANT_ID" = 'default'
   WHERE c."ST_CARGA" = 'RASCUNHO'
     AND NOT EXISTS (
           SELECT 1 FROM "WMS_EXPEDICAO_CARGA" ex
            WHERE ex."CD_CARGA" = c."CD_CARGA"
              AND ex."TENANT_ID" = c."TENANT_ID"
              AND ex."ST_EXPEDICAO" = 'EXPEDIDA'
         )
),
linhas AS (
  SELECT DISTINCT
         COALESCE(n."CD_DONO", 1) AS cd_dono,
         regexp_replace(trim(COALESCE(ln->>'cProd', ln->>'codigo', '')), '[^0-9]', '', 'g') AS cod_dig,
         trim(COALESCE(ln->>'cProd', ln->>'codigo', '')) AS cod_xml,
         EXISTS (SELECT 1 FROM cargas_abertas ca WHERE ca."CD_NFE_SAIDA" = n."CD_NFE_SAIDA") AS em_carga_aberta
    FROM "WMS_NFE_SAIDA" n
   CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END
         ) AS ln
   WHERE n."TENANT_ID" = 'default'
     AND regexp_replace(trim(COALESCE(ln->>'cProd', ln->>'codigo', '')), '[^0-9]', '', 'g') <> ''
),
sem_peso AS (
  SELECT p."CD_DONO", p."CODIGO", p."NOME",
         regexp_replace(trim(p."CODIGO"), '[^0-9]', '', 'g') AS cod_dig
    FROM "WMS_PRODUTO_DONO" p
   WHERE p."TENANT_ID" = 'default'
     AND p."CD_DONO" = 1
     AND (p."PESO_KG" IS NULL OR p."PESO_KG" <= 0)
)
SELECT s."CD_DONO",
       s."CODIGO",
       '' AS "PESO_KG_PREENCHA",
       LEFT(s."NOME", 60) AS nome_cadastro,
       COUNT(DISTINCT l.cod_xml) AS vezes_em_nf,
       COUNT(DISTINCT l.cod_xml) FILTER (WHERE l.em_carga_aberta) AS vezes_em_carga_aberta
  FROM sem_peso s
  JOIN linhas l ON l.cd_dono = s."CD_DONO" AND l.cod_dig = s.cod_dig
 GROUP BY s."CD_DONO", s."CODIGO", s."NOME"
 ORDER BY vezes_em_carga_aberta DESC NULLS LAST, vezes_em_nf DESC, s."CODIGO";

-- ========== OPCIONAL: todos os 1234 sem peso (catálogo inteiro) ==========
-- Descomente se quiser planilha completa, não só os usados em NF.

/*
SELECT p."CD_DONO", p."CODIGO", '' AS "PESO_KG_PREENCHA", LEFT(p."NOME", 80) AS nome
  FROM "WMS_PRODUTO_DONO" p
 WHERE p."TENANT_ID" = 'default'
   AND p."CD_DONO" = 1
   AND (p."PESO_KG" IS NULL OR p."PESO_KG" <= 0)
 ORDER BY p."CODIGO";
*/
