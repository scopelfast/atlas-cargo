-- WMS — excluir importações de NF-e de saída (canceladas / órfãs)
-- PostgreSQL. REVISE antes de executar DELETE. Preferível usar a tela Cargas → Filtros → lixeira.
--
-- Regra: só apaga se NÃO estiver em WMS_CARGA_PROGRAMADA_NFE e tenant correto.

-- ============================================================
-- 1) Conferir o que será apagado (RODE PRIMEIRO)
-- ============================================================
WITH params AS (
  SELECT 'default'::text AS tenant_id
),
numeros AS (
  SELECT unnest(ARRAY[
    '18017', '18022', '18028', '18039', '18052',
    '18061', '18086', '18087', '18088', '17723'
  ]::text[]) AS numero_nf
)
SELECT n."CD_NFE_SAIDA",
       n."NUMERO_NF",
       n."SERIE",
       n."CHAVE_NFE",
       LEFT(n."XNOME_ENTREGA", 45) AS entrega,
       EXISTS (SELECT 1 FROM "WMS_CARGA_PROGRAMADA_NFE" j WHERE j."CD_NFE_SAIDA" = n."CD_NFE_SAIDA") AS em_carga,
       CASE
         WHEN EXISTS (SELECT 1 FROM "WMS_CARGA_PROGRAMADA_NFE" j WHERE j."CD_NFE_SAIDA" = n."CD_NFE_SAIDA")
         THEN 'BLOQUEADO — remova da carga antes'
         ELSE 'OK_EXCLUIR'
       END AS acao
  FROM params p
  JOIN numeros num ON TRUE
  JOIN "WMS_NFE_SAIDA" n
    ON n."TENANT_ID" = p.tenant_id
   AND regexp_replace(trim(COALESCE(n."NUMERO_NF", '')), '[^0-9]', '', 'g')
       = regexp_replace(num.numero_nf, '[^0-9]', '', 'g')
 ORDER BY n."NUMERO_NF"::bigint;


-- ============================================================
-- 2) DELETE (somente NF sem vínculo em carga)
--    Descomente após validar o bloco 1
-- ============================================================
/*
WITH params AS (
  SELECT 'default'::text AS tenant_id
),
numeros AS (
  SELECT unnest(ARRAY[
    '18017', '18022', '18028', '18039', '18052',
    '18061', '18086', '18087', '18088', '17723'
  ]::text[]) AS numero_nf
),
alvo AS (
  SELECT n."CD_NFE_SAIDA"
    FROM params p
    JOIN numeros num ON TRUE
    JOIN "WMS_NFE_SAIDA" n
      ON n."TENANT_ID" = p.tenant_id
     AND regexp_replace(trim(COALESCE(n."NUMERO_NF", '')), '[^0-9]', '', 'g')
         = regexp_replace(num.numero_nf, '[^0-9]', '', 'g')
   WHERE NOT EXISTS (
           SELECT 1 FROM "WMS_CARGA_PROGRAMADA_NFE" j WHERE j."CD_NFE_SAIDA" = n."CD_NFE_SAIDA"
         )
)
DELETE FROM "WMS_NFE_SAIDA" n
 USING alvo a
 WHERE n."CD_NFE_SAIDA" = a."CD_NFE_SAIDA"
 RETURNING n."CD_NFE_SAIDA", n."NUMERO_NF", n."SERIE";
*/
