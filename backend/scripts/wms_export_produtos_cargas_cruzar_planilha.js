#!/usr/bin/env node
'use strict';
/**
 * CSV de validação: produtos das cargas abertas × pesos_produto.xlsx
 *
 * node scripts/wms_export_produtos_cargas_cruzar_planilha.js \
 *   --planilha "C:\Users\scope\OneDrive\Área de Trabalho\pesos_produto.xlsx" \
 *   --saida "C:\Users\scope\OneDrive\Área de Trabalho\validar_peso_cargas.csv"
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../config/db');

function parseArgs() {
  const out = {
    planilha: '',
    saida: path.join(process.cwd(), 'validar_peso_cargas.csv'),
    tenant: process.env.DEFAULT_TENANT_ID || 'default',
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--planilha' && argv[i + 1]) out.planilha = argv[++i];
    else if (argv[i] === '--saida' && argv[i + 1]) out.saida = argv[++i];
    else if (argv[i] === '--tenant' && argv[i + 1]) out.tenant = argv[++i];
  }
  return out;
}

function codDig(v) {
  return String(v ?? '').replace(/\D/g, '');
}

function escCsv(v) {
  const s = String(v ?? '');
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const args = parseArgs();
  if (!args.planilha) {
    console.error('Informe --planilha pesos_produto.xlsx');
    process.exit(1);
  }

  const wb = XLSX.readFile(path.resolve(args.planilha));
  const plan = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  const pesoPlan = new Map();
  for (const r of plan) {
    const d = codDig(r.CODIGO);
    if (!d) continue;
    const p = Number(r.PESO ?? r.peso);
    if (Number.isFinite(p)) pesoPlan.set(d, { peso: p, nome: String(r.DESCRICAO || '').trim() });
  }

  const r = await pool.query(
    `WITH nf_carga AS (
       SELECT n."LINHAS_JSON"
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_CARGA_PROGRAMADA" c ON c."CD_CARGA" = j."CD_CARGA" AND c."TENANT_ID" = $1
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA" AND n."TENANT_ID" = $1
        WHERE NOT EXISTS (
                SELECT 1 FROM "WMS_EXPEDICAO_CARGA" ex
                 WHERE ex."CD_CARGA" = c."CD_CARGA" AND ex."TENANT_ID" = c."TENANT_ID"
                   AND ex."ST_EXPEDICAO" = 'EXPEDIDA'
              )
     ),
     itens AS (
       SELECT regexp_replace(trim(ln->>'cProd'), '[^0-9]', '', 'g') AS cod_dig,
              trim(ln->>'cProd') AS cod_xml,
              trim(ln->>'xProd') AS nome_xml,
              NULLIF(REPLACE(trim(COALESCE(ln->>'qCom','')), ',', '.'), '')::numeric AS qcom
         FROM nf_carga nc
        CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(nc."LINHAS_JSON") = 'array' THEN nc."LINHAS_JSON" ELSE '[]'::jsonb END
              ) ln
        WHERE trim(COALESCE(ln->>'cProd','')) <> ''
     ),
     agg AS (
       SELECT cod_dig,
              MIN(cod_xml) AS cod_xml,
              MAX(nome_xml) AS nome_xml,
              COUNT(*)::int AS linhas_nf,
              ROUND(SUM(COALESCE(qcom,0))::numeric, 3) AS soma_qcom
         FROM itens
        GROUP BY cod_dig
     )
     SELECT a.*,
            p1."PESO_KG" AS peso_kg_dono1,
            p1."CODIGO" AS codigo_cad_dono1,
            p2."PESO_KG" AS peso_kg_dono2
       FROM agg a
       LEFT JOIN "WMS_PRODUTO_DONO" p1
         ON p1."TENANT_ID" = $1 AND p1."CD_DONO" = 1
        AND regexp_replace(trim(p1."CODIGO"), '[^0-9]', '', 'g') = a.cod_dig
        AND COALESCE(p1."FG_FORNECEDOR_REF", 'N') = 'N'
       LEFT JOIN "WMS_PRODUTO_DONO" p2
         ON p2."TENANT_ID" = $1 AND p2."CD_DONO" = 2
        AND regexp_replace(trim(p2."CODIGO"), '[^0-9]', '', 'g') = a.cod_dig
        AND COALESCE(p2."FG_FORNECEDOR_REF", 'N') = 'N'
      ORDER BY a.linhas_nf DESC`,
    [args.tenant]
  );

  const hdr =
    'cod_dig;cod_xml;nome_nf;linhas_nf;soma_qcom;codigo_cad_dono1;peso_kg_dono1;peso_kg_dono2;peso_planilha;nome_planilha;status';
  const lines = [hdr];

  for (const row of r.rows) {
    const pl = pesoPlan.get(row.cod_dig);
    let status = 'OK_PLANILHA';
    if (!pl) status = 'FALTA_NA_PLANILHA';
    else if (!row.codigo_cad_dono1 && row.peso_kg_dono2 == null) status = 'SEM_CADASTRO';
    else if (
      pl.peso &&
      row.peso_kg_dono1 != null &&
      Math.abs(Number(row.peso_kg_dono1) - pl.peso) > 0.001
    ) {
      status = 'PESO_DIFERENTE';
    }

    lines.push(
      [
        row.cod_dig,
        row.cod_xml,
        row.nome_xml,
        row.linhas_nf,
        row.soma_qcom,
        row.codigo_cad_dono1 ?? '',
        row.peso_kg_dono1 ?? '',
        row.peso_kg_dono2 ?? '',
        pl ? pl.peso : '',
        pl ? pl.nome : '',
        status,
      ]
        .map(escCsv)
        .join(';')
    );
  }

  await pool.end();
  fs.writeFileSync(args.saida, '\uFEFF' + lines.join('\n'), 'utf8');
  console.log('SKUs nas cargas abertas:', r.rows.length);
  console.log('Com peso na planilha:', lines.filter((l) => l.includes('OK_PLANILHA')).length - 1);
  console.log('Arquivo:', args.saida);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
