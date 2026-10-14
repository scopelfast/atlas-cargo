#!/usr/bin/env node
'use strict';
/**
 * Atualiza PESO_KG (e opcionalmente NOME) em WMS_PRODUTO_DONO a partir de pesos_produto.xlsx
 * Colunas: CODIGO, DESCRICAO, PESO (mesmo código lógico nos donos 1 e 2 — match por dígitos).
 *
 * Uso (pasta backend):
 *   node scripts/wms_import_peso_cadastro_planilha.js --arquivo "C:\Users\scope\OneDrive\Área de Trabalho\pesos_produto.xlsx" --dry-run
 *   node scripts/wms_import_peso_cadastro_planilha.js --arquivo "...\pesos_produto.xlsx"
 *
 * Só cargas abertas (menor volume):
 *   node scripts/wms_import_peso_cadastro_planilha.js --arquivo "...\pesos_produto.xlsx" --somente-cargas-abertas
 */

require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../config/db');

function parseArgs() {
  const out = {
    arquivo: '',
    tenant: process.env.DEFAULT_TENANT_ID || 'default',
    donos: [1, 2],
    dryRun: false,
    somenteCargasAbertas: false,
    atualizarNome: false,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--arquivo' && argv[i + 1]) out.arquivo = argv[++i];
    else if (argv[i].startsWith('--arquivo=')) out.arquivo = argv[i].slice('--arquivo='.length);
    else if (argv[i] === '--tenant' && argv[i + 1]) out.tenant = argv[++i];
    else if (argv[i] === '--donos' && argv[i + 1]) {
      out.donos = argv[++i].split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => Number.isFinite(n));
    } else if (argv[i] === '--dry-run') out.dryRun = true;
    else if (argv[i] === '--somente-cargas-abertas') out.somenteCargasAbertas = true;
    else if (argv[i] === '--atualizar-nome') out.atualizarNome = true;
  }
  return out;
}

function codDig(v) {
  return String(v ?? '').replace(/\D/g, '');
}

function normPeso(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Number(n.toFixed(3)) : null;
}

async function carregarDigitosCargasAbertas(client, tenant) {
  const r = await client.query(
    `SELECT DISTINCT regexp_replace(trim(ln->>'cProd'), '[^0-9]', '', 'g') AS d
       FROM "WMS_CARGA_PROGRAMADA_NFE" j
       JOIN "WMS_CARGA_PROGRAMADA" c ON c."CD_CARGA" = j."CD_CARGA" AND c."TENANT_ID" = $1
       JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
      CROSS JOIN LATERAL jsonb_array_elements(
              CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END
            ) ln
      WHERE NOT EXISTS (
              SELECT 1 FROM "WMS_EXPEDICAO_CARGA" ex
               WHERE ex."CD_CARGA" = c."CD_CARGA" AND ex."TENANT_ID" = c."TENANT_ID"
                 AND ex."ST_EXPEDICAO" = 'EXPEDIDA'
            )
        AND trim(COALESCE(ln->>'cProd', '')) <> ''`,
    [tenant]
  );
  return new Set(r.rows.map((x) => x.d).filter((d) => d && d.length > 0));
}

async function main() {
  const args = parseArgs();
  if (!args.arquivo) {
    console.error(
      'Uso: node scripts/wms_import_peso_cadastro_planilha.js --arquivo "pesos_produto.xlsx" [--somente-cargas-abertas] [--dry-run]'
    );
    process.exit(1);
  }

  const wb = XLSX.readFile(path.resolve(args.arquivo));
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

  const map = new Map();
  for (const r of rows) {
    const d = codDig(r.CODIGO ?? r.codigo);
    if (!d) continue;
    const peso = normPeso(r.PESO ?? r.peso ?? r.PESO_KG);
    if (peso == null) continue;
    const nome = String(r.DESCRICAO ?? r.descricao ?? r.NOME ?? '').trim().slice(0, 255);
    map.set(d, { peso, nome, codigoPlan: String(r.CODIGO ?? '').trim() });
  }

  const client = await pool.connect();
  let filtroCargas = null;
  if (args.somenteCargasAbertas) {
    filtroCargas = await carregarDigitosCargasAbertas(client, args.tenant);
    console.log('Filtro: só SKUs das cargas abertas:', filtroCargas.size);
  }

  let atualizados = 0;
  let semProduto = 0;
  let ignoradosFiltro = 0;

  try {
    await client.query('BEGIN');
    for (const [d, info] of map.entries()) {
      if (filtroCargas && !filtroCargas.has(d)) {
        ignoradosFiltro++;
        continue;
      }
      for (const cdDono of args.donos) {
        const sql = args.atualizarNome
          ? `UPDATE "WMS_PRODUTO_DONO" p
                SET "PESO_KG" = $3::numeric,
                    "NOME" = CASE WHEN $4::text <> '' THEN $4::text ELSE p."NOME" END,
                    "DH_MAINTENANCE" = CURRENT_TIMESTAMP
              WHERE p."TENANT_ID" = $1
                AND p."CD_DONO" = $2::integer
                AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
                AND regexp_replace(trim(p."CODIGO"), '[^0-9]', '', 'g') = $5
              RETURNING p."CD_PRODUTO", p."CODIGO", p."PESO_KG"`
          : `UPDATE "WMS_PRODUTO_DONO" p
                SET "PESO_KG" = $3::numeric,
                    "DH_MAINTENANCE" = CURRENT_TIMESTAMP
              WHERE p."TENANT_ID" = $1
                AND p."CD_DONO" = $2::integer
                AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
                AND regexp_replace(trim(p."CODIGO"), '[^0-9]', '', 'g') = $4
              RETURNING p."CD_PRODUTO", p."CODIGO", p."PESO_KG"`;

        const params = args.atualizarNome
          ? [args.tenant, cdDono, info.peso, info.nome, d]
          : [args.tenant, cdDono, info.peso, d];

        if (args.dryRun) {
          console.log(`[dry-run] dono ${cdDono} ${d} → ${info.peso} kg`);
          atualizados++;
          continue;
        }

        const res = await client.query(sql, params);
        if (res.rowCount) {
          atualizados += res.rowCount;
        } else {
          semProduto++;
        }
      }
    }
    if (!args.dryRun) await client.query('COMMIT');
    else await client.query('ROLLBACK');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }

  console.log('Linhas planilha com peso:', map.size);
  console.log('Registros atualizados (dono×SKU):', atualizados);
  console.log('SKU planilha sem produto no dono:', semProduto);
  if (filtroCargas) console.log('Ignorados (fora das cargas abertas):', ignoradosFiltro);
}

main();
