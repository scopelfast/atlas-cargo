-- WMS — diagnóstico peso por linha da NF-e (passo a passo)
-- NÃO use NUMERO_NF = '...' — isso é só exemplo; escolha um número da lista (passo 1).

-- ========== 1) Quais NF existem nas cargas abertas? ==========
SELECT n."CD_NFE_SAIDA",
       trim(n."NUMERO_NF") AS numero_nf,
       n."SERIE",
       n."CD_DONO",
       COALESCE(NULLIF(trim(n."XNOME_ENTREGA"), ''), trim(n."XNOME_DEST")) AS destino,
       c."CD_CARGA",
       c."NM_DESCRICAO" AS carga
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
 ORDER BY c."CD_CARGA", n."NUMERO_NF"
 LIMIT 50;

-- ========== 2) Linhas + peso (troque o número — ex. '17689' da MAKITA) ==========
-- Use LEFT JOIN para ver também itens SEM cadastro (INNER JOIN some tudo e parece "vazio").
SELECT trim(n."NUMERO_NF") AS numero_nf,
       n."CD_DONO",
       trim(ln->>'cProd') AS codigo_xml,
       ln->>'qCom' AS qcom_txt,
       ln->>'qTrib' AS qtrib_txt,
       p."CODIGO" AS codigo_cadastro,
       p."PESO_KG",
       CASE
         WHEN NULLIF(REPLACE(trim(COALESCE(ln->>'qCom', '')), ',', '.'), '') ~ '^[0-9]+(\.[0-9]+)?$'
         THEN (REPLACE(trim(ln->>'qCom'), ',', '.')::numeric * COALESCE(p."PESO_KG", 0))
         ELSE NULL
       END AS peso_calc_qcom,
       CASE
         WHEN p."CD_PRODUTO" IS NULL THEN 'SEM_CADASTRO'
         WHEN p."PESO_KG" IS NULL OR p."PESO_KG" <= 0 THEN 'SEM_PESO_KG'
         ELSE 'OK'
       END AS status_match
  FROM "WMS_NFE_SAIDA" n
 CROSS JOIN LATERAL jsonb_array_elements(
         CASE
           WHEN n."LINHAS_JSON" IS NULL THEN '[]'::jsonb
           WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON"
           ELSE '[]'::jsonb
         END
       ) AS ln
  LEFT JOIN "WMS_PRODUTO_DONO" p
    ON p."TENANT_ID" = n."TENANT_ID"
   AND p."CD_DONO" = n."CD_DONO"
   AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
   AND regexp_replace(trim(COALESCE(p."CODIGO", '')), '[^0-9]', '', 'g')
     = regexp_replace(trim(COALESCE(ln->>'cProd', '')), '[^0-9]', '', 'g')
   AND regexp_replace(trim(COALESCE(ln->>'cProd', '')), '[^0-9]', '', 'g') <> ''
 WHERE n."TENANT_ID" = 'default'
   AND trim(n."NUMERO_NF") = '17689'   -- <<< TROQUE pelo numero_nf do passo 1
 ORDER BY ln->>'cProd';

-- ========== 3) NUTRIVILLE 6004 (sem precisar do número da NF) ==========
SELECT trim(n."NUMERO_NF") AS numero_nf,
       trim(ln->>'cProd') AS codigo,
       ln->>'qCom' AS qcom,
       ln->>'qTrib' AS qtrib,
       p."PESO_KG",
       ROUND(
         (NULLIF(REPLACE(trim(COALESCE(ln->>'qCom', '')), ',', '.'), '')::numeric) * COALESCE(p."PESO_KG", 0))::numeric,
         3
       ) AS peso_qcom
  FROM "WMS_NFE_SAIDA" n
 CROSS JOIN LATERAL jsonb_array_elements(
         CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END
       ) ln
  LEFT JOIN "WMS_PRODUTO_DONO" p
    ON p."TENANT_ID" = n."TENANT_ID"
   AND p."CD_DONO" = n."CD_DONO"
   AND regexp_replace(trim(p."CODIGO"), '[^0-9]', '', 'g')
     = regexp_replace(trim(ln->>'cProd'), '[^0-9]', '', 'g')
   AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
 WHERE n."TENANT_ID" = 'default'
   AND COALESCE(n."XNOME_ENTREGA", n."XNOME_DEST", '') ILIKE '%6004%'
   AND COALESCE(n."XNOME_ENTREGA", n."XNOME_DEST", '') ILIKE '%HC.UFPR%'
 ORDER BY n."NUMERO_NF", ln->>'cProd';
