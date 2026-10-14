'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const { resolverProdutoEstoque } = require('../services/wms-resolver-codigo-estoque.service');

(async () => {
  const tid = 'default';
  const cdDono = 2;

  const p = await pool.query(
    `SELECT "CD_PRODUTO", "CODIGO", "NOME"
       FROM "WMS_PRODUTO_DONO"
      WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2
        AND "CODIGO" ILIKE '%03.03.030%'
      ORDER BY "CODIGO"`,
    [tid, cdDono]
  );
  console.log('=== PRODUTOS ===');
  p.rows.forEach((r) => console.log(r.CD_PRODUTO, r.CODIGO, r.NOME));

  const op = await pool.query(
    `SELECT o."CD_PRODUTO", o."CODIGO_OPERACIONAL", o."CODIGO_ESTOQUE", o."FATOR_CONVERSAO",
            p."CODIGO", p."NOME"
       FROM "WMS_PRODUTO_OPERACIONAL" o
       JOIN "WMS_PRODUTO_DONO" p
         ON p."CD_PRODUTO" = o."CD_PRODUTO" AND p."TENANT_ID" = o."TENANT_ID"
      WHERE o."TENANT_ID" = $1 AND o."CD_DONO" = $2
        AND (
          regexp_replace(LOWER(TRIM(o."CODIGO_OPERACIONAL")), '[^0-9a-z]', '', 'g') LIKE '%303030%'
          OR o."CODIGO_ESTOQUE" ILIKE '%03.03.030%'
          OR p."CODIGO" ILIKE '%03.03.030%'
        )
      ORDER BY o."CODIGO_OPERACIONAL"`,
    [tid, cdDono]
  );
  console.log('=== OPERACIONAL ===');
  op.rows.forEach((r) => console.log(JSON.stringify(r)));

  const dp = await pool.query(
    `SELECT "CODIGO_EXTERNO", "CODIGO_INTERNO", "FATOR_CONVERSAO"
       FROM "WMS_DEPARA_PRODUTO"
      WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2
        AND (
          "CODIGO_EXTERNO" ILIKE '%303030%'
          OR "CODIGO_INTERNO" ILIKE '%03.03.030%'
          OR "CODIGO_EXTERNO" ILIKE '%60.30.30%'
          OR "CODIGO_EXTERNO" ILIKE '%6.03.03%'
        )`,
    [tid, cdDono]
  );
  console.log('=== DEPARA ===');
  dp.rows.forEach((r) => console.log(JSON.stringify(r)));

  for (const c of ['60.30.30.30.80', '6030303080', '6.03.03.030.80', '6.03.03.030.40']) {
    const h = await resolverProdutoEstoque(pool, tid, cdDono, c, { codigoExterno: c });
    console.log(
      'RESOLVE',
      c,
      '=>',
      h && {
        cd: h.cdProduto,
        estoque: h.codigoEstoque,
        op: h.codigoOperacional,
        fator: h.fatorConversao,
        origem: h.origem,
      }
    );
  }

  const nf = await pool.query(
    `SELECT n."NUMERO_NF", n."CD_DONO",
            ln.elem->>'cProd' AS cprod,
            ln.elem->>'xProd' AS xprod,
            ln.elem->>'qCom' AS qcom,
            ln.elem->>'uCom' AS ucom
       FROM "WMS_NFE_SAIDA" n
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(n."LINHAS_JSON", '[]'::jsonb)) ln(elem)
      WHERE n."TENANT_ID" = $1
        AND n."NUMERO_NF" = '1958'
        AND (
          ln.elem->>'cProd' ILIKE '%30.30%'
          OR ln.elem->>'xProd' ILIKE '%CAFE%SOLUV%'
        )`,
    [tid]
  );
  console.log('=== NF 1958 cafe ===');
  nf.rows.forEach((r) => console.log(JSON.stringify(r)));

  const m = await pool.query(
    `SELECT m."CD_MOVIMENTO", m."CD_PRODUTO", p."CODIGO", p."NOME", m."QTD",
            m."TP_MOVIMENTO", m."REF_CD_CARGA", m."IDEMPOTENCY_KEY"
       FROM "WMS_MOVIMENTO_ESTOQUE" m
       JOIN "WMS_PRODUTO_DONO" p
         ON p."CD_PRODUTO" = m."CD_PRODUTO" AND p."TENANT_ID" = m."TENANT_ID"
      WHERE m."TENANT_ID" = $1
        AND m."REF_CD_CARGA" = 199
        AND (
          p."CODIGO" ILIKE '%03.03.030%'
          OR p."NOME" ILIKE '%CAFE%SOLUV%'
        )`,
    [tid]
  );
  console.log('=== MOV CARGA 199 ===');
  m.rows.forEach((r) => console.log(JSON.stringify(r)));

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
