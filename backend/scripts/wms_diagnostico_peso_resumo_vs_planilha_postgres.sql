-- WMS — diagnóstico: resumo de cargas vs planilha de controle
--
-- Seu UPDATE com 0,1 só alterou: PESO_KG IS NULL OR PESO_KG <= 0
-- Itens que JÁ tinham peso no cadastro (OL, import, etc.) continuam com o valor antigo.
--
-- Bug corrigido no Node: não usar mais qTrib como quantidade (muitas NF trazem kg em qTrib).

-- A) Distribuição de PESO_KG nos SKUs das NF das cargas não expedidas
WITH nf_carga AS (
  SELECT n."CD_NFE_SAIDA", n."CD_DONO", n."NUMERO_NF", n."LINHAS_JSON"
    FROM "WMS_CARGA_PROGRAMADA_NFE" j
    JOIN "WMS_CARGA_PROGRAMADA" c ON c."CD_CARGA" = j."CD_CARGA" AND c."TENANT_ID" = 'default'
    JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
   WHERE NOT EXISTS (
           SELECT 1 FROM "WMS_EXPEDICAO_CARGA" ex
            WHERE ex."CD_CARGA" = c."CD_CARGA" AND ex."TENANT_ID" = c."TENANT_ID"
              AND ex."ST_EXPEDICAO" = 'EXPEDIDA'
         )
),
linhas AS (
  SELECT nc."CD_DONO",
         regexp_replace(trim(ln->>'cProd'), '[^0-9]', '', 'g') AS cod_dig
    FROM nf_carga nc
   CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(nc."LINHAS_JSON") = 'array' THEN nc."LINHAS_JSON" ELSE '[]'::jsonb END
         ) ln
   WHERE trim(COALESCE(ln->>'cProd', '')) <> ''
)
SELECT COALESCE(p."PESO_KG"::text, '(sem cadastro)') AS peso_kg_cadastro,
       COUNT(DISTINCT l.cod_dig) AS skus_distintos
  FROM linhas l
  LEFT JOIN "WMS_PRODUTO_DONO" p
    ON p."TENANT_ID" = 'default'
   AND p."CD_DONO" = l."CD_DONO"
   AND regexp_replace(trim(p."CODIGO"), '[^0-9]', '', 'g') = l.cod_dig
   AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
 GROUP BY p."PESO_KG"
 ORDER BY skus_distintos DESC;

-- B) NUTRIVILLE 6004 / HC.UFPR — qCom vs qTrib (onde estoura o peso)
SELECT n."NUMERO_NF",
       trim(ln->>'cProd') AS codigo,
       ln->>'qCom' AS qcom,
       ln->>'qTrib' AS qtrib,
       ln->>'uCom' AS ucom,
       ln->>'uTrib' AS utrib,
       p."PESO_KG",
       ROUND(
         (NULLIF(REPLACE(trim(COALESCE(ln->>'qCom', '0')), ',', '.'), '')::numeric) * COALESCE(p."PESO_KG", 0))::numeric,
         3
       ) AS peso_qcom_x_cadastro,
       ROUND(
         (NULLIF(REPLACE(trim(COALESCE(ln->>'qTrib', '0')), ',', '.'), '')::numeric) * COALESCE(p."PESO_KG", 0))::numeric,
         3
       ) AS peso_qtrib_x_cadastro_ERRADO
  FROM "WMS_NFE_SAIDA" n
 CROSS JOIN LATERAL jsonb_array_elements(n."LINHAS_JSON") ln
  LEFT JOIN "WMS_PRODUTO_DONO" p
    ON p."TENANT_ID" = 'default'
   AND p."CD_DONO" = n."CD_DONO"
   AND regexp_replace(trim(p."CODIGO"), '[^0-9]', '', 'g')
     = regexp_replace(trim(ln->>'cProd'), '[^0-9]', '', 'g')
   AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
 WHERE n."TENANT_ID" = 'default'
   AND (n."XNOME_ENTREGA" ILIKE '%6004%' OR n."XNOME_DEST" ILIKE '%6004%')
   AND (n."XNOME_ENTREGA" ILIKE '%HC.UFPR%' OR n."XNOME_DEST" ILIKE '%HC.UFPR%')
 ORDER BY n."NUMERO_NF", ln->>'cProd';
