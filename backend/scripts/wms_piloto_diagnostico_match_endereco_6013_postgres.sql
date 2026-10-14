-- Diagnóstico: match parada NF 9001 × ponto 6013 HPMP (Curitiba)
-- Execute no pgAdmin e confira se existe linha com coordenadas.

SELECT cg."CDCADASTRO",
       cg."RZSOCIAL",
       cg."CGCCPF",
       right(lpad(regexp_replace(trim(coalesce(cg."CGCCPF", '')), '[^0-9]', '', 'g'), 14, '0'), 14) AS cnpj_14,
       cg."TENANT_ID" AS tenant_cg,
       e."TENANT_ID" AS tenant_end,
       e."DS_PONTO_ENTREGA",
       e."LOGRADOURO",
       e."NUMERO",
       e."CEP",
       e."UF_ENTREGA",
       e."LATITUDE",
       e."LONGITUDE",
       e."FGACTIVE",
       e."CHAVE_IMPORT"
  FROM "CADASTRO_ENDERECO_ENTREGA" e
  JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = e."CD_CLIENTE"
 WHERE e."FGACTIVE" = 'A'
   AND upper(trim(e."DS_PONTO_ENTREGA")) LIKE '%6013%HPMP%'
 ORDER BY e."CD_ENDERECO_ENTREGA" DESC;

-- CNPJ esperado na NF de saída (emitente/entrega Nutriville):
-- 08742760004840
