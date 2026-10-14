-- Diagnóstico: destinatário OPL sem [ Rota de Entrega ] no romaneio
-- Ajuste CD_OPL_ARQUIVO, COD_DESTINATARIO e TENANT_ID abaixo. Rode no pgAdmin.

-- Pedido no espelho (ex.: IRANI 1140)
SELECT p."SEQ_PEDIDO",
       p."COD_DESTINATARIO",
       p."RAZ_SOC_DEST",
       p."CNPJ_DEST",
       p."ENDE_ENTREGA",
       p."CEP_ENTREGA",
       p."CIDADE_ENTREGA",
       p."UF_ENTREGA"
  FROM "WMS_OPL_PEDIDO" p
 WHERE trim(coalesce(p."COD_DESTINATARIO", '')) = '1140'
   AND upper(coalesce(p."RAZ_SOC_DEST", '')) LIKE '%IRANI%';

-- Pontos de entrega no cadastro (mesmo CNPJ ou nome com 1140 / IRANI)
SELECT e."CD_ENDERECO_ENTREGA",
       e."DS_PONTO_ENTREGA",
       e."NR_ROTA",
       e."UF_ENTREGA",
       e."NM_MUNICIPIO",
       e."CEP",
       e."LOGRADOURO",
       e."NUMERO",
       e."FGACTIVE",
       right(lpad(regexp_replace(trim(coalesce(cg."CGCCPF", '')), '[^0-9]', '', 'g'), 14, '0'), 14) AS cnpj_14
  FROM "CADASTRO_ENDERECO_ENTREGA" e
  JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = e."CD_CLIENTE"
 WHERE e."TENANT_ID" = 'default'
   AND (
     upper(coalesce(e."DS_PONTO_ENTREGA", '')) LIKE '%IRANI%'
     OR upper(coalesce(e."DS_PONTO_ENTREGA", '')) LIKE '%1140%'
     OR right(lpad(regexp_replace(trim(coalesce(cg."CGCCPF", '')), '[^0-9]', '', 'g'), 14, '0'), 14) IN (
       SELECT right(lpad(regexp_replace(trim(coalesce(p."CNPJ_DEST", '')), '[^0-9]', '', 'g'), 14, '0'), 14)
         FROM "WMS_OPL_PEDIDO" p
        WHERE trim(coalesce(p."COD_DESTINATARIO", '')) = '1140'
          AND upper(coalesce(p."RAZ_SOC_DEST", '')) LIKE '%IRANI%'
     )
   )
 ORDER BY e."FGACTIVE", e."NR_ROTA" NULLS LAST, e."DS_PONTO_ENTREGA";
