-- WMS — diagnóstico: por que uma unidade não está sendo agrupada na rota cadastrada
-- Troque os códigos abaixo se quiser olhar outras unidades.
-- Use no banco para confirmar que o cadastro tem NR_ROTA e que o índice por código é único.

-- 1) Cadastro das 3 unidades-alvo (TRG/KRONA ACESSORIOS/TRANSMAGNA)
SELECT "CD_ENDERECO_ENTREGA",
       "DS_PONTO_ENTREGA",
       "NR_ROTA",
       "FGACTIVE",
       "LOGRADOURO",
       "NUMERO",
       "CEP"
  FROM "CADASTRO_ENDERECO_ENTREGA"
 WHERE "TENANT_ID" = 'default'
   AND ("DS_PONTO_ENTREGA" LIKE '%- 1148 -%'
     OR "DS_PONTO_ENTREGA" LIKE '%- 1002 -%'
     OR "DS_PONTO_ENTREGA" LIKE '%- 1076 -%')
 ORDER BY "DS_PONTO_ENTREGA";

-- 2) Algum desses códigos aparece em DUAS rotas diferentes?
--    Se sim, o fallback por código fica "ambíguo" e devolve null → cai em "Rota cad.: —".
WITH cods AS (
  SELECT (regexp_matches(coalesce("DS_PONTO_ENTREGA", ''), '-\s*(\d{3,5})\s*-'))[1] AS cod,
         "NR_ROTA",
         "DS_PONTO_ENTREGA"
    FROM "CADASTRO_ENDERECO_ENTREGA"
   WHERE "TENANT_ID" = 'default'
     AND "FGACTIVE" = 'A'
     AND "NR_ROTA" IS NOT NULL
)
SELECT cod,
       COUNT(DISTINCT "NR_ROTA") AS qtd_rotas,
       string_agg(DISTINCT "NR_ROTA"::text, ', ' ORDER BY "NR_ROTA"::text) AS rotas,
       COUNT(*) AS qtd_enderecos
  FROM cods
 WHERE cod IN ('1148', '1002', '1076')
 GROUP BY cod
 ORDER BY cod;

-- 3) Como vem o XNOME_ENTREGA das NFs problemáticas (deve ter "- 1002 -" no nome)
SELECT "CD_NFE_SAIDA",
       "NUMERO_NF",
       "XNOME_ENTREGA",
       "XNOME_DEST",
       "CNPJ_ENTREGA",
       "CNPJ_DEST",
       "XMUN_DEST",
       "UF_DEST"
  FROM "WMS_NFE_SAIDA"
 WHERE "TENANT_ID" = 'default'
   AND ("XNOME_ENTREGA" ILIKE '%1148%TRG%'
     OR "XNOME_ENTREGA" ILIKE '%1002%KRONA%'
     OR "XNOME_ENTREGA" ILIKE '%1076%TRANSMAGNA%')
 ORDER BY "XNOME_ENTREGA", "NUMERO_NF"
 LIMIT 20;
