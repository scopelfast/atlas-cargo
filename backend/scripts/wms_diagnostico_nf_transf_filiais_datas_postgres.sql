-- WMS — datas de emissão / encerramento de NF-e (lista OL "Dev NF Transf Entre Filiais")
-- PostgreSQL. Não altera dados. Rode no pgAdmin / DBeaver / psql.
--
-- Objetivo: cruzar números de NF do relatório OL com o que está importado no Atlas
-- (dono 1 = Mana) e ver se emissão/encerramento é anterior ou posterior ao inventário.
--
-- COMO USAR
-- =========
-- 1) Edite o CTE "params" (tenant, dono, data do inventário).
-- 2) Edite a lista em "lista_nf" — uma linha por NF (com ou sem zeros à esquerda).
-- 3) Execute o bloco principal (SELECT final).
-- 4) Opcional: rode o bloco "resumo" no final para contagem rápida.
--
-- Nota: coluna DH_SAIDA em WMS_NFE_SAIDA é opcional (script
-- adicionar_wms_nfe_saida_dh_saida_postgres.sql). Este diagnóstico não depende dela.

-- ============================================================
-- PARÂMETROS (edite aqui)
-- ============================================================
WITH params AS (
  SELECT
    'default'::text      AS tenant_id,       -- seu tenant
    1::integer           AS cd_dono,         -- 1 = Mana
    DATE '2026-05-20'    AS data_inventario  -- dia em que subiram os inventários
),

-- ============================================================
-- LISTA DE NF (edite / acrescente linhas; duplicatas são ignoradas)
-- ============================================================
lista_nf_raw AS (
  SELECT unnest(ARRAY[
    '15210', '16004', '16008', '16010', '15223', '16005', '16009',
    '16481', '16483', '16484', '15224', '17028', '17030', '16006',
    '17027', '17029', '16482', '15211', '15208', '15209', '15212',
    '15213', '15214', '15215', '16489', '17032', '16007', '16012',
    '16487', '16488', '17026', '16486', '15217', '15219', '15221',
    '16011', '15220', '15216', '15218', '16003', '16485', '15222',
    '15225', '17031'
  ]::text[]) AS nf_txt
),
lista_nf AS (
  SELECT DISTINCT
    NULLIF(regexp_replace(trim(nf_txt), '[^0-9]', '', 'g'), '')::bigint AS nf_num
  FROM lista_nf_raw
  WHERE NULLIF(regexp_replace(trim(nf_txt), '[^0-9]', '', 'g'), '') IS NOT NULL
),

-- ============================================================
-- NF-e ENTRADA (recebimento / devolução — caso mais comum p/ "Dev NF Transf")
-- ============================================================
nf_entrada AS (
  SELECT
    'ENTRADA'::text AS origem,
    e."CD_NFE"      AS cd_registro,
    e."NUMERO_NF",
    e."SERIE",
    e."CHAVE_NFE",
    e."ST_RECEBIMENTO",
    e."DH_EMISSAO",
    e."DH_IMPORTACAO",
    e."DH_CONFERENCIA",
    e."DH_ENCERRAMENTO",
    e."DT_RECEBIMENTO",
    NULL::timestamptz AS dh_saida,
    e."XNOME_EMIT",
    e."XNOME_DEST",
    regexp_replace(trim(COALESCE(e."NUMERO_NF", '')), '[^0-9]', '', 'g')::bigint AS nf_num_norm
  FROM "WMS_NFE_ENTRADA" e
  CROSS JOIN params p
  WHERE e."TENANT_ID" = p.tenant_id
    AND e."CD_DONO" = p.cd_dono
    AND NULLIF(regexp_replace(trim(COALESCE(e."NUMERO_NF", '')), '[^0-9]', '', 'g'), '') IS NOT NULL
),

-- ============================================================
-- NF-e SAÍDA (se alguma transferência estiver como saída no Atlas)
-- ============================================================
nf_saida AS (
  SELECT
    'SAIDA'::text AS origem,
    n."CD_NFE_SAIDA" AS cd_registro,
    n."NUMERO_NF",
    n."SERIE",
    n."CHAVE_NFE",
    NULL::varchar AS st_recebimento,
    n."DH_EMISSAO",
    n."DH_IMPORTACAO",
    NULL::timestamptz AS dh_conferencia,
    NULL::timestamptz AS dh_encerramento,
    NULL::date AS dt_recebimento,
    NULL::timestamptz AS dh_saida,
    n."XNOME_EMIT",
    n."XNOME_DEST",
    regexp_replace(trim(COALESCE(n."NUMERO_NF", '')), '[^0-9]', '', 'g')::bigint AS nf_num_norm
  FROM "WMS_NFE_SAIDA" n
  CROSS JOIN params p
  WHERE n."TENANT_ID" = p.tenant_id
    AND n."CD_DONO" = p.cd_dono
    AND NULLIF(regexp_replace(trim(COALESCE(n."NUMERO_NF", '')), '[^0-9]', '', 'g'), '') IS NOT NULL
),

todas_nf AS (
  SELECT * FROM nf_entrada
  UNION ALL
  SELECT * FROM nf_saida
),

-- Uma linha por (NF da lista × registro no Atlas); se não importou, origem NULL
cruzamento AS (
  SELECT
    l.nf_num,
    lpad(l.nf_num::text, 10, '0') AS nf_formatada_ol,
    t.origem,
    t.cd_registro,
    t."NUMERO_NF"     AS numero_nf_gravado,
    t."SERIE",
    right(t."CHAVE_NFE", 8) AS chave_sufixo,
    t."ST_RECEBIMENTO",
    t."DH_EMISSAO",
    t."DH_IMPORTACAO",
    t."DH_CONFERENCIA",
    t."DH_ENCERRAMENTO",
    t."DT_RECEBIMENTO",
    t.dh_saida        AS "DH_SAIDA",
    t."XNOME_EMIT",
    t."XNOME_DEST",
    p.data_inventario,
    (t."DH_EMISSAO" IS NOT NULL AND t."DH_EMISSAO"::date < p.data_inventario) AS emissao_antes_inventario,
    (t."DH_ENCERRAMENTO" IS NOT NULL AND t."DH_ENCERRAMENTO"::date < p.data_inventario) AS encerramento_antes_inventario,
    (t."DH_ENCERRAMENTO" IS NOT NULL AND t."DH_ENCERRAMENTO"::date > p.data_inventario) AS encerramento_depois_inventario,
    (t."DH_IMPORTACAO" IS NOT NULL AND t."DH_IMPORTACAO"::date > p.data_inventario) AS importacao_depois_inventario,
    CASE
      WHEN t.cd_registro IS NULL THEN 'NAO ENCONTRADA no Atlas (dono ' || p.cd_dono::text || ')'
      WHEN t.origem = 'ENTRADA' AND upper(trim(COALESCE(t."ST_RECEBIMENTO", ''))) <> 'ENCERRADA'
        THEN 'Importada mas recebimento NAO encerrado — nao entrou no saldo'
      WHEN t."DH_ENCERRAMENTO" IS NOT NULL AND t."DH_ENCERRAMENTO"::date > p.data_inventario
        THEN 'ATENCAO: encerrada DEPOIS do inventario — pode explicar divergencia'
      WHEN t."DH_EMISSAO" IS NOT NULL AND t."DH_EMISSAO"::date < p.data_inventario
           AND (t."DH_ENCERRAMENTO" IS NULL OR t."DH_ENCERRAMENTO"::date > p.data_inventario)
        THEN 'Emissao antes do inventario mas saldo entrou depois (ou ainda aberta)'
      WHEN t."DH_ENCERRAMENTO" IS NOT NULL AND t."DH_ENCERRAMENTO"::date <= p.data_inventario
        THEN 'Saldo ja estava no sistema na data do inventario'
      ELSE 'Verificar manualmente'
    END AS interpretacao
  FROM lista_nf l
  CROSS JOIN params p
  LEFT JOIN todas_nf t ON t.nf_num_norm = l.nf_num
)

SELECT *
FROM cruzamento
ORDER BY nf_num, origem NULLS LAST, cd_registro;


-- ============================================================
-- RESUMO (rode separadamente se quiser só contagem)
-- ============================================================
/*
WITH params AS (
  SELECT 'default'::text AS tenant_id, 1::integer AS cd_dono, DATE '2026-05-20' AS data_inventario
),
-- (repita lista_nf_raw / lista_nf / nf_entrada / nf_saida / todas_nf / cruzamento acima)
...
SELECT
  count(DISTINCT nf_num) FILTER (WHERE cd_registro IS NULL)     AS nfs_nao_importadas,
  count(DISTINCT nf_num) FILTER (WHERE encerramento_depois_inventario) AS nfs_encerradas_depois,
  count(DISTINCT nf_num) FILTER (WHERE emissao_antes_inventario AND encerramento_depois_inventario) AS emissao_ant_encerramento_pos,
  count(*) AS linhas_total
FROM cruzamento;
*/
