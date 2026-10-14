#!/usr/bin/env node
'use strict';
/**
 * Exporta itens NF cancelada × substituta em TSV (tab) — abre no Excel BR sem erro de separador.
 *
 *   npm run wms:export-nf-pares-tsv
 *   node scripts/wms_export_nf_pares_itens_tsv.js --saida C:\Temp\nf_pares
 *
 * Gera dois arquivos .tsv (UTF-8 BOM, colunas separadas por TAB):
 *   nf_pares_itens.tsv      — todos os itens (bloco A)
 *   nf_pares_diferencas.tsv — diferenças por código (bloco B)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const PARES_VALUES = `
      ('18017', '18159', 'RENAUXVIEW — Brusque'),
      ('18022', '18160', 'RIOSULENSE — Rio do Sul'),
      ('18028', '18161', 'H BREMER — Rio do Sul'),
      ('18039', '18162', 'PAXÁ — Gaspar'),
      ('18052', '18163', 'ZANELLA — Rio do Sul'),
      ('18061', '18164', 'IRANI — Vargem Bonita'),
      ('18086', '18165', 'CRISTALCOPO MATRIZ — Içara'),
      ('18087', '18166', 'CRISTALCOPO PP — Criciúma'),
      ('18088', '18167', 'CRISTALCOPO XPS — Criciúma')`;

function parseArgs() {
  const out = {
    tenant: process.env.DEFAULT_TENANT_ID || 'default',
    saida: process.cwd(),
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tenant' && argv[i + 1]) out.tenant = argv[++i];
    else if ((argv[i] === '--saida' || argv[i] === '--out') && argv[i + 1]) out.saida = argv[++i];
  }
  return out;
}

function tsvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

/** Número só com dígitos (sem . ou ,) — escala fixa no nome da coluna. */
function numInteiro(v, casasDecimais) {
  if (v == null || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  const mul = 10 ** casasDecimais;
  return String(Math.round(n * mul));
}

function formatRowItens(row) {
  return {
    ...row,
    qtd: numInteiro(row.qtd, 4),
    v_un_com: numInteiro(row.v_un_com, 4),
    v_prod: numInteiro(row.v_prod, 2),
  };
}

function formatRowDiff(row) {
  return {
    ...row,
    qtd_cancelada: numInteiro(row.qtd_cancelada, 4),
    qtd_substituta: numInteiro(row.qtd_substituta, 4),
    diff_qtd: numInteiro(row.diff_qtd, 4),
  };
}

function rowsToTsv(rows, columns) {
  const lines = [columns.map((c) => tsvCell(c.header || c.key)).join('\t')];
  for (const row of rows) {
    lines.push(columns.map((c) => tsvCell(row[c.key])).join('\t'));
  }
  return '\uFEFF' + lines.join('\r\n');
}

function sqlItensPlano(tenant) {
  return `
WITH params AS (SELECT '${tenant.replace(/'/g, "''")}'::text AS tenant_id),
pares_nf AS (
  SELECT * FROM (VALUES ${PARES_VALUES}) t(nf_cancelada, nf_substituta, rotulo_cliente)
),
itens AS (
  SELECT pn.nf_cancelada, pn.nf_substituta, pn.rotulo_cliente, n."NUMERO_NF", n."SERIE",
         'CANCELADA'::text AS tipo_nf,
         trim(COALESCE(ln->>'nItem', '')) AS n_item_xml,
         trim(COALESCE(ln->>'cProd', '')) AS codigo,
         upper(regexp_replace(trim(COALESCE(ln->>'cProd', '')), '[^A-Z0-9]', '', 'g')) AS codigo_norm,
         trim(COALESCE(ln->>'xProd', '')) AS descricao,
         trim(COALESCE(ln->>'uCom', '')) AS unidade,
         COALESCE(NULLIF(REPLACE(trim(COALESCE(ln->>'qCom', '')), ',', '.'), '')::numeric, 0) AS qtd,
         COALESCE(NULLIF(REPLACE(trim(COALESCE(ln->>'vProd', '')), ',', '.'), '')::numeric, 0) AS v_prod,
         COALESCE(NULLIF(REPLACE(trim(COALESCE(ln->>'vUnCom', '')), ',', '.'), '')::numeric, 0) AS v_un_com
    FROM params par JOIN pares_nf pn ON TRUE
    JOIN "WMS_NFE_SAIDA" n ON n."TENANT_ID" = par.tenant_id
     AND regexp_replace(trim(COALESCE(n."NUMERO_NF", '')), '[^0-9]', '', 'g') = regexp_replace(pn.nf_cancelada, '[^0-9]', '', 'g')
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END) ln
  UNION ALL
  SELECT pn.nf_cancelada, pn.nf_substituta, pn.rotulo_cliente, n."NUMERO_NF", n."SERIE", 'SUBSTITUTA',
         trim(COALESCE(ln->>'nItem', '')), trim(COALESCE(ln->>'cProd', '')),
         upper(regexp_replace(trim(COALESCE(ln->>'cProd', '')), '[^A-Z0-9]', '', 'g')),
         trim(COALESCE(ln->>'xProd', '')), trim(COALESCE(ln->>'uCom', '')),
         COALESCE(NULLIF(REPLACE(trim(COALESCE(ln->>'qCom', '')), ',', '.'), '')::numeric, 0),
         COALESCE(NULLIF(REPLACE(trim(COALESCE(ln->>'vProd', '')), ',', '.'), '')::numeric, 0),
         COALESCE(NULLIF(REPLACE(trim(COALESCE(ln->>'vUnCom', '')), ',', '.'), '')::numeric, 0)
    FROM params par JOIN pares_nf pn ON TRUE
    JOIN "WMS_NFE_SAIDA" n ON n."TENANT_ID" = par.tenant_id
     AND regexp_replace(trim(COALESCE(n."NUMERO_NF", '')), '[^0-9]', '', 'g') = regexp_replace(pn.nf_substituta, '[^0-9]', '', 'g')
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END) ln
)
SELECT rotulo_cliente, nf_cancelada, nf_substituta, tipo_nf, "NUMERO_NF", "SERIE", n_item_xml, codigo,
       LEFT(descricao, 70) AS descricao, unidade,
       ROUND(qtd::numeric, 4) AS qtd, ROUND(v_un_com::numeric, 4) AS v_un_com, ROUND(v_prod::numeric, 2) AS v_prod
  FROM itens WHERE codigo_norm <> ''
 ORDER BY rotulo_cliente, tipo_nf DESC, n_item_xml::int NULLS LAST, codigo`;
}

function sqlDiferencas(tenant) {
  return `
WITH params AS (SELECT '${tenant.replace(/'/g, "''")}'::text AS tenant_id),
pares_nf AS (
  SELECT * FROM (VALUES ${PARES_VALUES}) t(nf_cancelada, nf_substituta, rotulo_cliente)
),
itens AS (
  SELECT pn.nf_cancelada, pn.nf_substituta, pn.rotulo_cliente, 'CANCELADA'::text AS tipo_nf,
         upper(regexp_replace(trim(COALESCE(ln->>'cProd', '')), '[^A-Z0-9]', '', 'g')) AS cod_norm,
         trim(COALESCE(ln->>'cProd', '')) AS codigo, trim(COALESCE(ln->>'xProd', '')) AS descricao,
         trim(COALESCE(ln->>'uCom', '')) AS unidade,
         SUM(COALESCE(NULLIF(REPLACE(trim(COALESCE(ln->>'qCom', '')), ',', '.'), '')::numeric, 0)) AS qtd
    FROM params par JOIN pares_nf pn ON TRUE
    JOIN "WMS_NFE_SAIDA" n ON n."TENANT_ID" = par.tenant_id
     AND regexp_replace(trim(COALESCE(n."NUMERO_NF", '')), '[^0-9]', '', 'g') = regexp_replace(pn.nf_cancelada, '[^0-9]', '', 'g')
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END) ln
   GROUP BY 1,2,3,4,5,6,7,8
  UNION ALL
  SELECT pn.nf_cancelada, pn.nf_substituta, pn.rotulo_cliente, 'SUBSTITUTA',
         upper(regexp_replace(trim(COALESCE(ln->>'cProd', '')), '[^A-Z0-9]', '', 'g')),
         trim(COALESCE(ln->>'cProd', '')), trim(COALESCE(ln->>'xProd', '')), trim(COALESCE(ln->>'uCom', '')),
         SUM(COALESCE(NULLIF(REPLACE(trim(COALESCE(ln->>'qCom', '')), ',', '.'), '')::numeric, 0))
    FROM params par JOIN pares_nf pn ON TRUE
    JOIN "WMS_NFE_SAIDA" n ON n."TENANT_ID" = par.tenant_id
     AND regexp_replace(trim(COALESCE(n."NUMERO_NF", '')), '[^0-9]', '', 'g') = regexp_replace(pn.nf_substituta, '[^0-9]', '', 'g')
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END) ln
   GROUP BY 1,2,3,4,5,6,7,8
),
cancel AS (SELECT * FROM itens WHERE tipo_nf = 'CANCELADA' AND cod_norm <> ''),
subst AS (SELECT * FROM itens WHERE tipo_nf = 'SUBSTITUTA' AND cod_norm <> ''),
chaves AS (
  SELECT nf_cancelada, nf_substituta, rotulo_cliente, cod_norm FROM cancel
  UNION SELECT nf_cancelada, nf_substituta, rotulo_cliente, cod_norm FROM subst
)
SELECT k.rotulo_cliente, k.nf_cancelada, k.nf_substituta, COALESCE(c.codigo, s.codigo) AS codigo,
       LEFT(COALESCE(c.descricao, s.descricao), 60) AS descricao, COALESCE(c.unidade, s.unidade) AS unidade,
       ROUND(COALESCE(c.qtd, 0)::numeric, 4) AS qtd_cancelada,
       ROUND(COALESCE(s.qtd, 0)::numeric, 4) AS qtd_substituta,
       ROUND((COALESCE(c.qtd, 0) - COALESCE(s.qtd, 0))::numeric, 4) AS diff_qtd,
       CASE WHEN c.cod_norm IS NULL THEN 'SOMENTE_SUBSTITUTA'
            WHEN s.cod_norm IS NULL THEN 'SOMENTE_CANCELADA'
            WHEN abs(COALESCE(c.qtd, 0) - COALESCE(s.qtd, 0)) > 0.0005 THEN 'QTD_DIFERENTE'
            WHEN COALESCE(c.unidade, '') <> COALESCE(s.unidade, '') THEN 'UNIDADE_DIFERENTE'
            ELSE 'IGUAL' END AS situacao
  FROM chaves k
  LEFT JOIN cancel c ON c.nf_cancelada = k.nf_cancelada AND c.nf_substituta = k.nf_substituta AND c.cod_norm = k.cod_norm
  LEFT JOIN subst s ON s.nf_cancelada = k.nf_cancelada AND s.nf_substituta = k.nf_substituta AND s.cod_norm = k.cod_norm
 WHERE NOT (c.cod_norm IS NOT NULL AND s.cod_norm IS NOT NULL
            AND abs(COALESCE(c.qtd, 0) - COALESCE(s.qtd, 0)) <= 0.0005
            AND COALESCE(c.unidade, '') = COALESCE(s.unidade, ''))
 ORDER BY k.rotulo_cliente, situacao, codigo`;
}

const COLS_ITENS = [
  { key: 'rotulo_cliente', header: 'cliente' },
  { key: 'nf_cancelada', header: 'nf_cancelada' },
  { key: 'nf_substituta', header: 'nf_substituta' },
  { key: 'tipo_nf', header: 'tipo_nf' },
  { key: 'numero_nf', header: 'numero_nf' },
  { key: 'serie', header: 'serie' },
  { key: 'n_item_xml', header: 'n_item_xml' },
  { key: 'codigo', header: 'codigo' },
  { key: 'descricao', header: 'descricao' },
  { key: 'unidade', header: 'unidade' },
  { key: 'qtd', header: 'qtd_x10000' },
  { key: 'v_un_com', header: 'v_un_com_x10000' },
  { key: 'v_prod', header: 'v_prod_centavos' },
];

const COLS_DIFF = [
  { key: 'rotulo_cliente', header: 'cliente' },
  { key: 'nf_cancelada', header: 'nf_cancelada' },
  { key: 'nf_substituta', header: 'nf_substituta' },
  { key: 'codigo', header: 'codigo' },
  { key: 'descricao', header: 'descricao' },
  { key: 'unidade', header: 'unidade' },
  { key: 'qtd_cancelada', header: 'qtd_cancelada_x10000' },
  { key: 'qtd_substituta', header: 'qtd_substituta_x10000' },
  { key: 'diff_qtd', header: 'diff_qtd_x10000' },
  { key: 'situacao', header: 'situacao' },
];

function normalizeRow(row) {
  const o = {};
  for (const [k, v] of Object.entries(row)) {
    o[k.toLowerCase()] = v;
  }
  return o;
}

async function main() {
  const args = parseArgs();
  const dir = path.resolve(args.saida);
  fs.mkdirSync(dir, { recursive: true });

  const r1 = await pool.query(sqlItensPlano(args.tenant));
  const r2 = await pool.query(sqlDiferencas(args.tenant));

  const rows1 = (r1.rows || []).map(normalizeRow).map(formatRowItens);
  const rows2 = (r2.rows || []).map(normalizeRow).map(formatRowDiff);

  const f1 = path.join(dir, 'nf_pares_itens.tsv');
  const f2 = path.join(dir, 'nf_pares_diferencas.tsv');

  fs.writeFileSync(f1, rowsToTsv(rows1, COLS_ITENS), 'utf8');
  fs.writeFileSync(f2, rowsToTsv(rows2, COLS_DIFF), 'utf8');

  console.log('Tenant:', args.tenant);
  console.log('Itens:', rows1.length, '→', f1);
  console.log('Diferencas:', rows2.length, '→', f2);
  console.log('');
  console.log('Abra no Excel com duplo-clique (.tsv). Números = inteiros (sem ponto/vírgula).');
  console.log('  qtd_x10000 → divida por 10000 | v_prod_centavos → divida por 100');

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch (_) {}
  process.exit(1);
});
