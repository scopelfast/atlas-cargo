-- WMS — diagnóstico "por que esse SKU não soma como NF encerrada"
-- PostgreSQL. Não altera dados. Funciona em pgAdmin / DBeaver / psql.
--
-- Cenário: você sabe que recebeu um produto, mas o relatório de Posição /
-- Movimentação só vê movimentos manuais (ex.: INVENTARIO_AJUSTE) e não vê
-- a entrada vinda de NF-e. Este script roda 6 verificações em cascata
-- para localizar onde a corrente quebrou:
--   1) Existe NF-e com o código do produto em LINHAS_JSON?
--   2) Qual o status (ST_RECEBIMENTO) e se tem CD_DONO?
--   3) A CONFERENCIA_JSON tem item com cdProduto numérico?
--   4) O cdProduto preenchido bate com WMS_PRODUTO_DONO ativo?
--   5) qtdConvertida > 0 (fator aplicado)?
--   6) Quanto a posição agregada já enxerga vs. o que a NF "deveria" trazer.
--
-- COMO USAR
-- =========
-- 1) Edite os 4 literais dentro do CTE "params" no início de CADA bloco
--    abaixo (ou use Find & Replace para trocar 'default', '6.03.15.507.00',
--    '6031550700' e 1 pelos valores do seu caso).
-- 2) Rode bloco a bloco no pgAdmin. Cada bloco é independente.
--
-- Por que não usar \set: \set é sintaxe exclusiva do cliente psql (CLI).
-- pgAdmin / DBeaver / qualquer outro cliente quebra com "syntax error
-- in or near \". O padrão CTE "params" abaixo funciona em todos.

-- ============================================================
-- 1) NF-e que MENCIONAM o produto (em qualquer JSON do recebimento)
--    Mostra status, dono, datas e se tem CONFERENCIA preenchida.
-- ============================================================
WITH params AS (
  SELECT 'default'::text         AS tenant_id,    -- TROQUE pelo seu tenant
         '6.03.15.507.00'::text  AS codigo,       -- código com máscara
         '6031550700'::text      AS codigo_num,   -- código sem máscara
         1::integer              AS cd_dono       -- número do dono (1 = Mana etc.)
)
SELECT
  e."CD_NFE"                                            AS cd_nfe,
  e."CD_DONO",
  e."ST_RECEBIMENTO",
  e."NUMERO_NF"                                         AS numero_nf,
  e."SERIE"                                             AS serie,
  e."DH_EMISSAO",
  e."DH_IMPORTACAO",
  e."DH_CONFERENCIA",
  e."DH_ENCERRAMENTO",
  e."DH_REABERTURA",
  jsonb_array_length(COALESCE(e."LINHAS_JSON", '[]'::jsonb))      AS qtd_linhas_nfe,
  jsonb_array_length(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS qtd_linhas_conf
FROM "WMS_NFE_ENTRADA" e, params p
WHERE e."TENANT_ID" = p.tenant_id
  AND e."CD_DONO"   = p.cd_dono
  AND (
       e."LINHAS_JSON"::text       ILIKE '%' || p.codigo     || '%'
    OR e."LINHAS_JSON"::text       ILIKE '%' || p.codigo_num || '%'
    OR e."CONFERENCIA_JSON"::text  ILIKE '%' || p.codigo     || '%'
    OR e."CONFERENCIA_JSON"::text  ILIKE '%' || p.codigo_num || '%'
  )
ORDER BY COALESCE(e."DH_ENCERRAMENTO", e."DH_CONFERENCIA", e."DH_IMPORTACAO") DESC NULLS LAST;


-- ============================================================
-- 2) Itens da CONFERENCIA_JSON para este SKU — quebra por linha
--    Isso é o que o relatório de Posição efetivamente lê.
-- ============================================================
WITH params AS (
  SELECT 'default'::text         AS tenant_id,
         '6.03.15.507.00'::text  AS codigo,
         '6031550700'::text      AS codigo_num,
         1::integer              AS cd_dono
),
conf AS (
  SELECT
    e."CD_NFE"          AS cd_nfe,
    e."ST_RECEBIMENTO",
    e."CD_DONO",
    e."NUMERO_NF"       AS numero_nf,
    elem
  FROM "WMS_NFE_ENTRADA" e, params p
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS elem
  WHERE e."TENANT_ID" = p.tenant_id
    AND e."CD_DONO"   = p.cd_dono
)
SELECT
  c.cd_nfe,
  c.numero_nf,
  c."ST_RECEBIMENTO",
  c.elem->>'nItem'                                   AS n_item,
  c.elem->>'codigoProduto'                           AS codigo_produto_texto,
  c.elem->>'cdProduto'                               AS cd_produto_texto,
  CASE WHEN (c.elem->>'cdProduto') ~ '^[0-9]+$'
       THEN (c.elem->>'cdProduto')::integer END      AS cd_produto_numerico,
  c.elem->>'lote'                                    AS lote,
  c.elem->>'validade'                                AS validade,
  c.elem->>'qtdRecebida'                             AS qtd_recebida,
  c.elem->>'fatorConversao'                          AS fator_conversao,
  c.elem->>'qtdConvertida'                           AS qtd_convertida,
  CASE
    WHEN UPPER(TRIM(COALESCE(c."ST_RECEBIMENTO", ''))) <> 'ENCERRADA'
      THEN 'PROBLEMA: recebimento ainda não foi encerrado'
    WHEN NOT ((c.elem->>'cdProduto') ~ '^[0-9]+$')
      THEN 'PROBLEMA: cdProduto vazio ou não numérico (falta de-para)'
    WHEN COALESCE((c.elem->>'qtdConvertida')::numeric, 0) <= 0
      THEN 'PROBLEMA: qtdConvertida zero/null (Qtd recebida vazia ou fator zero)'
    WHEN c."CD_DONO" IS NULL
      THEN 'PROBLEMA: NF sem CD_DONO no cabeçalho'
    ELSE 'OK — deveria estar somando'
  END                                                AS diagnostico
FROM conf c, params p
WHERE (c.elem->>'codigoProduto') ILIKE p.codigo
   OR (c.elem->>'codigoProduto') ILIKE p.codigo_num
   OR (c.elem->>'cdProduto')     ILIKE p.codigo_num
   OR EXISTS (
        SELECT 1 FROM "WMS_PRODUTO_DONO" prod
         WHERE prod."TENANT_ID" = p.tenant_id
           AND prod."CD_DONO"   = p.cd_dono
           AND prod."CODIGO" IN (p.codigo, p.codigo_num)
           AND (c.elem->>'cdProduto') ~ '^[0-9]+$'
           AND prod."CD_PRODUTO" = (c.elem->>'cdProduto')::integer
      )
ORDER BY c.cd_nfe, (c.elem->>'nItem')::text;


-- ============================================================
-- 3) Cadastro do produto no dono — confirma que o de-para existe
-- ============================================================
WITH params AS (
  SELECT 'default'::text         AS tenant_id,
         '6.03.15.507.00'::text  AS codigo,
         '6031550700'::text      AS codigo_num,
         1::integer              AS cd_dono
)
SELECT pr."CD_PRODUTO", pr."CODIGO", pr."NOME", pr."UNIDADE",
       pr."FGACTIVE"
  FROM "WMS_PRODUTO_DONO" pr, params p
 WHERE pr."TENANT_ID" = p.tenant_id
   AND pr."CD_DONO"   = p.cd_dono
   AND (pr."CODIGO" = p.codigo OR pr."CODIGO" = p.codigo_num);


-- ============================================================
-- 4) Posição atual agregada (mesmo cálculo que o relatório usa)
-- ============================================================
WITH params AS (
  SELECT 'default'::text         AS tenant_id,
         '6.03.15.507.00'::text  AS codigo,
         '6031550700'::text      AS codigo_num,
         1::integer              AS cd_dono
),
cad AS (
  SELECT pr."CD_PRODUTO"
    FROM "WMS_PRODUTO_DONO" pr, params p
   WHERE pr."TENANT_ID" = p.tenant_id
     AND pr."CD_DONO"   = p.cd_dono
     AND (pr."CODIGO" = p.codigo OR pr."CODIGO" = p.codigo_num)
   LIMIT 1
),
ent AS (
  SELECT COALESCE(SUM(COALESCE(NULLIF(TRIM(elem->>'qtdConvertida'), ''), '0')::numeric), 0) AS total
    FROM "WMS_NFE_ENTRADA" e, params p
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS elem
   WHERE e."TENANT_ID" = p.tenant_id
     AND e."CD_DONO"   = p.cd_dono
     AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) = 'ENCERRADA'
     AND (elem->>'cdProduto') ~ '^[0-9]+$'
     AND (elem->>'cdProduto')::integer IN (SELECT "CD_PRODUTO" FROM cad)
),
mov AS (
  SELECT COALESCE(SUM(m."QTD"), 0) AS total
    FROM "WMS_MOVIMENTO_ESTOQUE" m, params p
   WHERE m."TENANT_ID" = p.tenant_id
     AND m."CD_DONO"   = p.cd_dono
     AND m."CD_PRODUTO" IN (SELECT "CD_PRODUTO" FROM cad)
)
SELECT
  (SELECT "CD_PRODUTO" FROM cad)        AS cd_produto,
  ent.total                             AS qtd_entrada_nf_encerrada,
  mov.total                             AS qtd_movimentos_ledger,
  ent.total + mov.total                 AS qtd_saldo_sku
FROM ent, mov;


-- ============================================================
-- 5) Detalhe dos movimentos no ledger (para o SKU)
-- ============================================================
WITH params AS (
  SELECT 'default'::text         AS tenant_id,
         '6.03.15.507.00'::text  AS codigo,
         '6031550700'::text      AS codigo_num,
         1::integer              AS cd_dono
)
SELECT m."CD_MOVIMENTO",
       m."DH_REGISTRO",
       m."TP_MOVIMENTO",
       m."QTD",
       m."REF_CD_CARGA",
       m."REF_CD_OPL_ARQUIVO",
       m."SG_USER"
  FROM "WMS_MOVIMENTO_ESTOQUE" m, params p
 WHERE m."TENANT_ID" = p.tenant_id
   AND m."CD_DONO"   = p.cd_dono
   AND m."CD_PRODUTO" IN (
        SELECT pr."CD_PRODUTO" FROM "WMS_PRODUTO_DONO" pr
         WHERE pr."TENANT_ID" = p.tenant_id AND pr."CD_DONO" = p.cd_dono
           AND (pr."CODIGO" = p.codigo OR pr."CODIGO" = p.codigo_num))
 ORDER BY m."DH_REGISTRO" DESC NULLS LAST;


-- ============================================================
-- 6) NF-e ABERTAS (não encerradas) com este código no LINHAS_JSON
--    Estas NÃO entram no relatório de Posição até serem encerradas.
-- ============================================================
WITH params AS (
  SELECT 'default'::text         AS tenant_id,
         '6.03.15.507.00'::text  AS codigo,
         '6031550700'::text      AS codigo_num,
         1::integer              AS cd_dono
)
SELECT e."CD_NFE",
       e."ST_RECEBIMENTO",
       e."CD_DONO",
       e."NUMERO_NF",
       e."SERIE",
       e."DH_EMISSAO",
       e."DH_IMPORTACAO",
       e."DH_CONFERENCIA",
       jsonb_array_length(COALESCE(e."LINHAS_JSON", '[]'::jsonb)) AS qtd_linhas
  FROM "WMS_NFE_ENTRADA" e, params p
 WHERE e."TENANT_ID" = p.tenant_id
   AND e."CD_DONO"   = p.cd_dono
   AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) <> 'ENCERRADA'
   AND (e."LINHAS_JSON"::text     ILIKE '%' || p.codigo     || '%'
        OR e."LINHAS_JSON"::text  ILIKE '%' || p.codigo_num || '%')
 ORDER BY COALESCE(e."DH_CONFERENCIA", e."DH_IMPORTACAO", e."DH_EMISSAO") DESC NULLS LAST;
