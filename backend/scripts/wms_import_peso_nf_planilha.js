#!/usr/bin/env node
'use strict';
/**
 * Importa PesoNF da planilha "notas cargas.xlsx" (1 linha = 1 NF-e) → WMS_NFE_SAIDA.PESO_RESUMO_KG
 *
 * Colunas usadas: chNFe (44 dígitos) ou nNF + emitente; PesoNF (peso kg do resumo)
 *
 * Uso (pasta backend):
 *   node scripts/wms_import_peso_nf_planilha.js --arquivo "C:\Users\scope\OneDrive\Área de Trabalho\notas cargas.xlsx"
 *   node scripts/wms_import_peso_nf_planilha.js --arquivo "...\notas cargas.xlsx" --dry-run
 *
 * Pré-requisito SQL:
 *   psql -f scripts/adicionar_wms_nfe_saida_peso_resumo_postgres.sql
 */

require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../config/db');

function parseArgs() {
  const out = {
    arquivo: '',
    tenant: process.env.DEFAULT_TENANT_ID || 'default',
    dryRun: false,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--arquivo' && argv[i + 1]) out.arquivo = argv[++i];
    else if (argv[i].startsWith('--arquivo=')) out.arquivo = argv[i].slice('--arquivo='.length);
    else if (argv[i] === '--tenant' && argv[i + 1]) out.tenant = argv[++i];
    else if (argv[i] === '--dry-run') out.dryRun = true;
  }
  return out;
}

function digits(v) {
  return String(v ?? '').replace(/\D/g, '');
}

function normPeso(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Number(n.toFixed(3)) : null;
}

async function main() {
  const args = parseArgs();
  if (!args.arquivo) {
    console.error('Uso: node scripts/wms_import_peso_nf_planilha.js --arquivo "caminho\\notas cargas.xlsx"');
    process.exit(1);
  }
  const abs = path.resolve(args.arquivo);
  const wb = XLSX.readFile(abs);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  let ok = 0;
  let semNf = 0;
  let semPeso = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      const peso = normPeso(r.PesoNF ?? r.pesoNF ?? r.PESONF);
      if (peso == null) {
        semPeso++;
        continue;
      }
      const ch = digits(r.chNFe ?? r.CHAVE ?? r.chave);
      const ch44 = ch.length >= 44 ? ch.slice(-44) : null;
      const nNf = String(r.nNF ?? r.NNF ?? r.numero_nf ?? '').trim();

      let q;
      let params;
      if (ch44) {
        q = `UPDATE "WMS_NFE_SAIDA" n
                SET "PESO_RESUMO_KG" = $2::numeric
              WHERE n."TENANT_ID" = $1
                AND trim(n."CHAVE_NFE") = $3
              RETURNING n."CD_NFE_SAIDA", trim(n."NUMERO_NF") AS numero_nf`;
        params = [args.tenant, peso, ch44];
      } else if (nNf) {
        q = `UPDATE "WMS_NFE_SAIDA" n
                SET "PESO_RESUMO_KG" = $2::numeric
              WHERE n."TENANT_ID" = $1
                AND trim(n."NUMERO_NF") = $3
              RETURNING n."CD_NFE_SAIDA", trim(n."NUMERO_NF") AS numero_nf`;
        params = [args.tenant, peso, nNf];
      } else {
        semPeso++;
        continue;
      }

      if (args.dryRun) {
        console.log('[dry-run]', ch44 || nNf, '→', peso, 'kg');
        ok++;
        continue;
      }

      const res = await client.query(q, params);
      if (res.rowCount) {
        ok++;
      } else {
        semNf++;
        console.warn('NF não encontrada:', ch44 || `nNF=${nNf}`, 'PesoNF=', peso);
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

  console.log('Linhas planilha:', rows.length);
  console.log('Atualizadas / dry-run OK:', ok);
  console.log('NF não encontrada no banco:', semNf);
  console.log('Sem PesoNF na planilha:', semPeso);
  console.log('Resumo: use PESO_RESUMO_KG no relatório (reinicie Node após SQL da coluna).');
}

main();
