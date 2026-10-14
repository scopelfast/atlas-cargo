-- WMS — itens das NF canceladas × substitutas (somente LINHAS_JSON da NF-e)
-- PostgreSQL. Somente leitura. Rode no pgAdmin bloco a bloco.
--
-- NÃO compara pedido, OPL nem separação — só o que está no XML importado de cada nota.
--
-- COMO USAR
-- =========
-- 1) Edite tenant_id no CTE "params" de cada bloco.
-- 2) Bloco A = tabela plana de TODOS os itens (exporte e cruze no Excel).
-- 3) Bloco B = diferenças cancelada vs substituta (por código de produto).
--
-- EXPORTAR PARA EXCEL — NÃO use CSV do pgAdmin (dá erro de separador no Excel BR).
-- ==============================================================================
-- Rode no terminal (gera .tsv com TAB — abre no Excel sem assistente):
--
--   cd backend
--   npm run wms:export-nf-pares-tsv
--   npm run wms:export-nf-pares-tsv -- --saida C:\Temp\nf
--
-- Arquivos: nf_pares_itens.tsv  e  nf_pares_diferencas.tsv
-- Duplo-clique no .tsv abre direto no Excel.
-- Números saem como inteiros (sem . ou ,): qtd_x10000, v_prod_centavos, etc.


-- ============================================================
-- A) TABELA PLANA — todos os itens das 9 canceladas + 9 substitutas
--    Colunas prontas para pivot / VLOOKUP no Excel
-- ============================================================
WITH params AS (
  SELECT 'default'::text AS tenant_id
),
pares_nf AS (
  SELECT *
    FROM (VALUES
      ('18017', '18159', 'RENAUXVIEW — Brusque'),
      ('18022', '18160', 'RIOSULENSE — Rio do Sul'),
      ('18028', '18161', 'H BREMER — Rio do Sul'),
      ('18039', '18162', 'PAXÁ — Gaspar'),
      ('18052', '18163', 'ZANELLA — Rio do Sul'),
      ('18061', '18164', 'IRANI — Vargem Bonita'),
      ('18086', '18165', 'CRISTALCOPO MATRIZ — Içara'),
      ('18087', '18166', 'CRISTALCOPO PP — Criciúma'),
      ('18088', '18167', 'CRISTALCOPO XPS — Criciúma')
    ) t(nf_cancelada, nf_substituta, rotulo_cliente)
),
itens AS (
  /* canceladas */
  SELECT pn.nf_cancelada,
         pn.nf_substituta,
         pn.rotulo_cliente,
         n."NUMERO_NF",
         n."SERIE",
         'CANCELADA'::text AS tipo_nf,
         trim(COALESCE(ln->>'nItem', '')) AS n_item_xml,
         trim(COALESCE(ln->>'cProd', '')) AS codigo,
         upper(regexp_replace(trim(COALESCE(ln->>'cProd', '')), '[^A-Z0-9]', '', 'g')) AS codigo_norm,
         trim(COALESCE(ln->>'xProd', '')) AS descricao,
         trim(COALESCE(ln->>'uCom', '')) AS unidade,
         COALESCE(NULLIF(REPLACE(trim(COALESCE(ln->>'qCom', '')), ',', '.'), '')::numeric, 0) AS qtd,
         COALESCE(NULLIF(REPLACE(trim(COALESCE(ln->>'vProd', '')), ',', '.'), '')::numeric, 0) AS v_prod,
         COALESCE(NULLIF(REPLACE(trim(COALESCE(ln->>'vUnCom', '')), ',', '.'), '')::numeric, 0) AS v_un_com
    FROM params par
    JOIN pares_nf pn ON TRUE
    JOIN "WMS_NFE_SAIDA" n
      ON n."TENANT_ID" = par.tenant_id
     AND regexp_replace(trim(COALESCE(n."NUMERO_NF", '')), '[^0-9]', '', 'g')
         = regexp_replace(pn.nf_cancelada, '[^0-9]', '', 'g')
   CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END
         ) ln
  UNION ALL
  /* substitutas */
  SELECT pn.nf_cancelada,
         pn.nf_substituta,
         pn.rotulo_cliente,
         n."NUMERO_NF",
         n."SERIE",
         'SUBSTITUTA'::text,
         trim(COALESCE(ln->>'nItem', '')),
         trim(COALESCE(ln->>'cProd', '')),
         upper(regexp_replace(trim(COALESCE(ln->>'cProd', '')), '[^A-Z0-9]', '', 'g')),
         trim(COALESCE(ln->>'xProd', '')),
         trim(COALESCE(ln->>'uCom', '')),
         COALESCE(NULLIF(REPLACE(trim(COALESCE(ln->>'qCom', '')), ',', '.'), '')::numeric, 0),
         COALESCE(NULLIF(REPLACE(trim(COALESCE(ln->>'vProd', '')), ',', '.'), '')::numeric, 0),
         COALESCE(NULLIF(REPLACE(trim(COALESCE(ln->>'vUnCom', '')), ',', '.'), '')::numeric, 0)
    FROM params par
    JOIN pares_nf pn ON TRUE
    JOIN "WMS_NFE_SAIDA" n
      ON n."TENANT_ID" = par.tenant_id
     AND regexp_replace(trim(COALESCE(n."NUMERO_NF", '')), '[^0-9]', '', 'g')
         = regexp_replace(pn.nf_substituta, '[^0-9]', '', 'g')
   CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END
         ) ln
)
SELECT rotulo_cliente,
       nf_cancelada,
       nf_substituta,
       tipo_nf,
       "NUMERO_NF",
       "SERIE",
       n_item_xml,
       codigo,
       LEFT(descricao, 70) AS descricao,
       unidade,
       ROUND(qtd::numeric, 4) AS qtd,
       ROUND(v_un_com::numeric, 4) AS v_un_com,
       ROUND(v_prod::numeric, 2) AS v_prod
  FROM itens
 WHERE codigo_norm <> ''
 ORDER BY rotulo_cliente, tipo_nf DESC, n_item_xml::int NULLS LAST, codigo;


-- ============================================================
-- B) DIFERENÇAS — cancelada vs substituta (só código produto, sem pedido)
--    Agrega qtd se o mesmo código repetir na mesma NF
-- ============================================================
WITH params AS (
  SELECT 'default'::text AS tenant_id
),
pares_nf AS (
  SELECT *
    FROM (VALUES
      ('18017', '18159', 'RENAUXVIEW — Brusque'),
      ('18022', '18160', 'RIOSULENSE — Rio do Sul'),
      ('18028', '18161', 'H BREMER — Rio do Sul'),
      ('18039', '18162', 'PAXÁ — Gaspar'),
      ('18052', '18163', 'ZANELLA — Rio do Sul'),
      ('18061', '18164', 'IRANI — Vargem Bonita'),
      ('18086', '18165', 'CRISTALCOPO MATRIZ — Içara'),
      ('18087', '18166', 'CRISTALCOPO PP — Criciúma'),
      ('18088', '18167', 'CRISTALCOPO XPS — Criciúma')
    ) t(nf_cancelada, nf_substituta, rotulo_cliente)
),
itens AS (
  SELECT pn.nf_cancelada,
         pn.nf_substituta,
         pn.rotulo_cliente,
         'CANCELADA'::text AS tipo_nf,
         upper(regexp_replace(trim(COALESCE(ln->>'cProd', '')), '[^A-Z0-9]', '', 'g')) AS cod_norm,
         trim(COALESCE(ln->>'cProd', '')) AS codigo,
         trim(COALESCE(ln->>'xProd', '')) AS descricao,
         trim(COALESCE(ln->>'uCom', '')) AS unidade,
         SUM(COALESCE(NULLIF(REPLACE(trim(COALESCE(ln->>'qCom', '')), ',', '.'), '')::numeric, 0)) AS qtd
    FROM params par
    JOIN pares_nf pn ON TRUE
    JOIN "WMS_NFE_SAIDA" n
      ON n."TENANT_ID" = par.tenant_id
     AND regexp_replace(trim(COALESCE(n."NUMERO_NF", '')), '[^0-9]', '', 'g')
         = regexp_replace(pn.nf_cancelada, '[^0-9]', '', 'g')
   CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END
         ) ln
   GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
  UNION ALL
  SELECT pn.nf_cancelada,
         pn.nf_substituta,
         pn.rotulo_cliente,
         'SUBSTITUTA',
         upper(regexp_replace(trim(COALESCE(ln->>'cProd', '')), '[^A-Z0-9]', '', 'g')),
         trim(COALESCE(ln->>'cProd', '')),
         trim(COALESCE(ln->>'xProd', '')),
         trim(COALESCE(ln->>'uCom', '')),
         SUM(COALESCE(NULLIF(REPLACE(trim(COALESCE(ln->>'qCom', '')), ',', '.'), '')::numeric, 0))
    FROM params par
    JOIN pares_nf pn ON TRUE
    JOIN "WMS_NFE_SAIDA" n
      ON n."TENANT_ID" = par.tenant_id
     AND regexp_replace(trim(COALESCE(n."NUMERO_NF", '')), '[^0-9]', '', 'g')
         = regexp_replace(pn.nf_substituta, '[^0-9]', '', 'g')
   CROSS JOIN LATERAL jsonb_array_elements(
           CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END
         ) ln
   GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
),
cancel AS (
  SELECT * FROM itens WHERE tipo_nf = 'CANCELADA' AND cod_norm <> ''
),
subst AS (
  SELECT * FROM itens WHERE tipo_nf = 'SUBSTITUTA' AND cod_norm <> ''
),
chaves AS (
  SELECT nf_cancelada, nf_substituta, rotulo_cliente, cod_norm FROM cancel
  UNION
  SELECT nf_cancelada, nf_substituta, rotulo_cliente, cod_norm FROM subst
)
SELECT k.rotulo_cliente,
       k.nf_cancelada,
       k.nf_substituta,
       COALESCE(c.codigo, s.codigo) AS codigo,
       LEFT(COALESCE(c.descricao, s.descricao), 60) AS descricao,
       COALESCE(c.unidade, s.unidade) AS unidade,
       ROUND(COALESCE(c.qtd, 0)::numeric, 4) AS qtd_cancelada,
       ROUND(COALESCE(s.qtd, 0)::numeric, 4) AS qtd_substituta,
       ROUND((COALESCE(c.qtd, 0) - COALESCE(s.qtd, 0))::numeric, 4) AS diff_qtd,
       CASE
         WHEN c.cod_norm IS NULL THEN 'SOMENTE_SUBSTITUTA'
         WHEN s.cod_norm IS NULL THEN 'SOMENTE_CANCELADA'
         WHEN abs(COALESCE(c.qtd, 0) - COALESCE(s.qtd, 0)) > 0.0005 THEN 'QTD_DIFERENTE'
         WHEN COALESCE(c.unidade, '') <> COALESCE(s.unidade, '') THEN 'UNIDADE_DIFERENTE'
         ELSE 'IGUAL'
       END AS situacao
  FROM chaves k
  LEFT JOIN cancel c
    ON c.nf_cancelada = k.nf_cancelada AND c.nf_substituta = k.nf_substituta AND c.cod_norm = k.cod_norm
  LEFT JOIN subst s
    ON s.nf_cancelada = k.nf_cancelada AND s.nf_substituta = k.nf_substituta AND s.cod_norm = k.cod_norm
 WHERE NOT (
         c.cod_norm IS NOT NULL AND s.cod_norm IS NOT NULL
         AND abs(COALESCE(c.qtd, 0) - COALESCE(s.qtd, 0)) <= 0.0005
         AND COALESCE(c.unidade, '') = COALESCE(s.unidade, '')
       )
 ORDER BY k.rotulo_cliente, situacao, codigo;


-- ============================================================
-- C) RESUMO — só linhas que sumiram ou entraram na reemissão
-- ============================================================
WITH params AS (
  SELECT 'default'::text AS tenant_id
),
pares_nf AS (
  SELECT *
    FROM (VALUES
      ('18017', '18159', 'RENAUXVIEW — Brusque'),
      ('18022', '18160', 'RIOSULENSE — Rio do Sul'),
      ('18028', '18161', 'H BREMER — Rio do Sul'),
      ('18039', '18162', 'PAXÁ — Gaspar'),
      ('18052', '18163', 'ZANELLA — Rio do Sul'),
      ('18061', '18164', 'IRANI — Vargem Bonita'),
      ('18086', '18165', 'CRISTALCOPO MATRIZ — Içara'),
      ('18087', '18166', 'CRISTALCOPO PP — Criciúma'),
      ('18088', '18167', 'CRISTALCOPO XPS — Criciúma')
    ) t(nf_cancelada, nf_substituta, rotulo_cliente)
),
itens AS (
  SELECT pn.nf_cancelada, pn.nf_substituta, pn.rotulo_cliente,
         'CANCELADA'::text AS tipo_nf,
         upper(regexp_replace(trim(COALESCE(ln->>'cProd', '')), '[^A-Z0-9]', '', 'g')) AS cod_norm,
         trim(COALESCE(ln->>'cProd', '')) AS codigo,
         trim(COALESCE(ln->>'xProd', '')) AS descricao,
         trim(COALESCE(ln->>'uCom', '')) AS unidade,
         SUM(COALESCE(NULLIF(REPLACE(trim(COALESCE(ln->>'qCom', '')), ',', '.'), '')::numeric, 0)) AS qtd
    FROM params par
    JOIN pares_nf pn ON TRUE
    JOIN "WMS_NFE_SAIDA" n ON n."TENANT_ID" = par.tenant_id
     AND regexp_replace(trim(COALESCE(n."NUMERO_NF", '')), '[^0-9]', '', 'g') = regexp_replace(pn.nf_cancelada, '[^0-9]', '', 'g')
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END) ln
   GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
  UNION ALL
  SELECT pn.nf_cancelada, pn.nf_substituta, pn.rotulo_cliente, 'SUBSTITUTA',
         upper(regexp_replace(trim(COALESCE(ln->>'cProd', '')), '[^A-Z0-9]', '', 'g')),
         trim(COALESCE(ln->>'cProd', '')),
         trim(COALESCE(ln->>'xProd', '')),
         trim(COALESCE(ln->>'uCom', '')),
         SUM(COALESCE(NULLIF(REPLACE(trim(COALESCE(ln->>'qCom', '')), ',', '.'), '')::numeric, 0))
    FROM params par
    JOIN pares_nf pn ON TRUE
    JOIN "WMS_NFE_SAIDA" n ON n."TENANT_ID" = par.tenant_id
     AND regexp_replace(trim(COALESCE(n."NUMERO_NF", '')), '[^0-9]', '', 'g') = regexp_replace(pn.nf_substituta, '[^0-9]', '', 'g')
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END) ln
   GROUP BY 1, 2, 3, 4, 5, 6, 7, 8
),
cancel AS (SELECT * FROM itens WHERE tipo_nf = 'CANCELADA' AND cod_norm <> ''),
subst AS (SELECT * FROM itens WHERE tipo_nf = 'SUBSTITUTA' AND cod_norm <> '')
SELECT c.rotulo_cliente,
       c.nf_cancelada,
       c.nf_substituta,
       c.codigo,
       LEFT(c.descricao, 55) AS descricao,
       c.unidade,
       ROUND(c.qtd::numeric, 4) AS qtd_saiu_na_reemissao
  FROM cancel c
  LEFT JOIN subst s ON s.nf_substituta = c.nf_substituta AND s.cod_norm = c.cod_norm
 WHERE s.cod_norm IS NULL
 ORDER BY c.rotulo_cliente, c.codigo;
