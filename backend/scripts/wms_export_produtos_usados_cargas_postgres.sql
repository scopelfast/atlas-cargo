-- WMS — produtos (SKU) usados nas NF-e das cargas ainda não expedidas
-- Lista enxuta para validar peso no cadastro (não são os 900+ da planilha geral).
-- Exporte o resultado para Excel e cruze com pesos_produto.xlsx (coluna CODIGO em dígitos).

WITH nf_carga AS (
  SELECT n."CD_NFE_SAIDA", n."CD_DONO", n."NUMERO_NF", n."LINHAS_JSON"
    FROM "WMS_CARGA_PROGRAMADA_NFE" j
    JOIN "WMS_CARGA_PROGRAMADA" c
      ON c."CD_CARGA" = j."CD_CARGA" AND c."TENANT_ID" = 'default'
    JOIN "WMS_NFE_SAIDA" n
      ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA" AND n."TENANT_ID" = 'default'
   WHERE NOT EXISTS (
           SELECT 1 FROM "WMS_EXPEDICAO_CARGA" ex
            WHERE ex."CD_CARGA" = c."CD_CARGA"
              AND ex."TENANT_ID" = c."TENANT_ID"
              AND ex."ST_EXPEDICAO" = 'EXPEDIDA'
         )
),
itens AS (
  SELECT nc."CD_DONO",
         trim(ln->>'cProd') AS codigo_xml,
         regexp_replace(trim(COALESCE(ln->>'cProd', '')), '[^0-9]', '', 'g') AS cod_dig,
         trim(COALESCE(ln->>'xProd', '')) AS nome_xml,
         NULLIF(REPLACE(trim(COALESCE(ln->>'qCom', '')), ',', '.'), '')::numeric AS qcom
    FROM nf_carga nc
   CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(nc."LINHAS_JSON") = 'array' THEN nc."LINHAS_JSON" ELSE '[]'::jsonb END
         ) ln
   WHERE regexp_replace(trim(COALESCE(ln->>'cProd', '')), '[^0-9]', '', 'g') <> ''
),
agg AS (
  SELECT cod_dig,
         MIN(codigo_xml) AS codigo_exemplo,
         MAX(nome_xml) AS nome_xml,
         COUNT(*) AS linhas_nf,
         SUM(COALESCE(qcom, 0)) AS soma_qcom,
         COUNT(DISTINCT "CD_DONO") AS qtd_donos_nf
    FROM itens
   GROUP BY cod_dig
)
SELECT a.cod_dig,
       a.codigo_exemplo,
       LEFT(a.nome_xml, 80) AS nome_na_nf,
       a.linhas_nf,
       ROUND(a.soma_qcom::numeric, 3) AS soma_qcom,
       p1."CODIGO" AS codigo_cad_dono1,
       p1."NOME" AS nome_cad_dono1,
       p1."PESO_KG" AS peso_kg_dono1,
       p2."CODIGO" AS codigo_cad_dono2,
       p2."PESO_KG" AS peso_kg_dono2,
       CASE
         WHEN p1."CD_PRODUTO" IS NULL AND p2."CD_PRODUTO" IS NULL THEN 'SEM_CADASTRO'
         WHEN (p1."PESO_KG" IS NULL OR p1."PESO_KG" <= 0)
          AND (p2."PESO_KG" IS NULL OR p2."PESO_KG" <= 0) THEN 'SEM_PESO'
         ELSE 'COM_PESO'
       END AS status_peso
  FROM agg a
  LEFT JOIN "WMS_PRODUTO_DONO" p1
    ON p1."TENANT_ID" = 'default'
   AND p1."CD_DONO" = 1
   AND regexp_replace(trim(p1."CODIGO"), '[^0-9]', '', 'g') = a.cod_dig
   AND COALESCE(p1."FG_FORNECEDOR_REF", 'N') = 'N'
  LEFT JOIN "WMS_PRODUTO_DONO" p2
    ON p2."TENANT_ID" = 'default'
   AND p2."CD_DONO" = 2
   AND regexp_replace(trim(p2."CODIGO"), '[^0-9]', '', 'g') = a.cod_dig
   AND COALESCE(p2."FG_FORNECEDOR_REF", 'N') = 'N'
 ORDER BY a.linhas_nf DESC, a.cod_dig;

-- Resumo
WITH nf_carga AS (
  SELECT n."LINHAS_JSON"
    FROM "WMS_CARGA_PROGRAMADA_NFE" j
    JOIN "WMS_CARGA_PROGRAMADA" c ON c."CD_CARGA" = j."CD_CARGA" AND c."TENANT_ID" = 'default'
    JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
   WHERE NOT EXISTS (
           SELECT 1 FROM "WMS_EXPEDICAO_CARGA" ex
            WHERE ex."CD_CARGA" = c."CD_CARGA" AND ex."ST_EXPEDICAO" = 'EXPEDIDA'
         )
),
dig AS (
  SELECT DISTINCT regexp_replace(trim(ln->>'cProd'), '[^0-9]', '', 'g') AS d
    FROM nf_carga nc
   CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(nc."LINHAS_JSON") = 'array' THEN nc."LINHAS_JSON" ELSE '[]'::jsonb END
         ) ln
   WHERE trim(COALESCE(ln->>'cProd', '')) <> ''
)
SELECT COUNT(*) AS skus_distintos_nas_cargas_abertas FROM dig WHERE d <> '';
