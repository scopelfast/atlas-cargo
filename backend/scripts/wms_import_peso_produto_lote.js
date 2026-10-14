#!/usr/bin/env node
'use strict';
/**
 * Importa planilha de PESO_KG (export wms_export_produtos_peso_lote_donos_1_2_postgres.sql).
 * Aceita separador TAB, ; ou | e decimal com vírgula ou ponto — sem conflito do CSV BR.
 *
 * Uso (pasta backend):
 *   node scripts/wms_import_peso_produto_lote.js --arquivo "C:\temp\pesos.txt"
 *   node scripts/wms_import_peso_produto_lote.js --arquivo "...\pesos.csv" --dry-run
 *
 * Colunas (cabeçalho): CD_DONO, CODIGO, PESO_KG (nome_referencia é ignorada se existir).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
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
    else if (argv[i] === '--tenant' && argv[i + 1]) out.tenant = argv[++i];
    else if (argv[i] === '--dry-run') out.dryRun = true;
  }
  return out;
}

function detectDelimiter(headerLine) {
  const h = String(headerLine || '');
  if (h.includes('\t')) return '\t';
  if (h.includes(';')) return ';';
  if (h.includes('|')) return '|';
  return '\t';
}

function splitRow(line, delim) {
  return String(line)
    .split(delim)
    .map((c) => c.trim().replace(/^"|"$/g, '').replace(/\r$/, ''));
}

function normPesoBr(raw) {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  s = s.replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n >= 0 ? Number(n.toFixed(3)) : null;
}

function mapHeader(cols) {
  const idx = { cdDono: -1, codigo: -1, peso: -1 };
  cols.forEach((c, i) => {
    const k = String(c || '')
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9_]/g, '');
    if (k === 'CD_DONO' || k === 'CDDONO') idx.cdDono = i;
    else if (k === 'CODIGO') idx.codigo = i;
    else if (k === 'PESO_KG' || k === 'PESOKG' || k === 'PESO') idx.peso = i;
  });
  return idx;
}

function lerLinhas(arquivo) {
  const txt = fs.readFileSync(arquivo, 'utf8');
  const lines = txt.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) throw new Error('Arquivo vazio.');
  const delim = detectDelimiter(lines[0]);
  const hdr = splitRow(lines[0], delim);
  const col = mapHeader(hdr);
  if (col.cdDono < 0 || col.codigo < 0 || col.peso < 0) {
    throw new Error(
      `Cabeçalho inválido. Esperado CD_DONO, CODIGO, PESO_KG. Encontrado: ${lines[0].slice(0, 120)}`
    );
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const p = splitRow(lines[i], delim);
    if (p.length < 3) continue;
    const cdDono = parseInt(p[col.cdDono], 10);
    let codigo = String(p[col.codigo] || '').trim();
    if (codigo.startsWith("'")) codigo = codigo.slice(1).trim();
    const peso = normPesoBr(p[col.peso]);
    if (!Number.isFinite(cdDono) || !codigo) continue;
    if (peso == null) continue;
    rows.push({ cdDono, codigo, peso });
  }
  return { delim, rows };
}

async function main() {
  const args = parseArgs();
  if (!args.arquivo) {
    console.error('Informe --arquivo "caminho\\pesos.txt"');
    process.exit(1);
  }
  const abs = path.resolve(args.arquivo);
  if (!fs.existsSync(abs)) {
    console.error('Arquivo não encontrado:', abs);
    process.exit(1);
  }

  const { delim, rows } = lerLinhas(abs);
  console.log('Arquivo:', abs);
  console.log('Separador detectado:', delim === '\t' ? 'TAB' : delim);
  console.log('Linhas com peso válido:', rows.length);
  if (!rows.length) {
    console.error('Nenhuma linha válida. Confira CD_DONO, CODIGO e PESO_KG.');
    process.exit(1);
  }

  if (args.dryRun) {
    console.log('Dry-run — amostra (5 primeiras):');
    rows.slice(0, 5).forEach((r) => console.log(r));
    process.exit(0);
  }

  const client = await pool.connect();
  let atualizados = 0;
  let semMatch = 0;
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      const q = await client.query(
        `UPDATE "WMS_PRODUTO_DONO" p
            SET "PESO_KG" = $4::numeric,
                "DH_MAINTENANCE" = CURRENT_TIMESTAMP
          WHERE p."TENANT_ID" = $1
            AND p."CD_DONO" = $2::integer
            AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
            AND (
              LOWER(TRIM(p."CODIGO")) = LOWER(TRIM($3::text))
              OR regexp_replace(TRIM(p."CODIGO"), '[^0-9]', '', 'g')
                 = regexp_replace(TRIM($3::text), '[^0-9]', '', 'g')
            )
          RETURNING p."CD_PRODUTO"`,
        [args.tenant, r.cdDono, r.codigo, r.peso]
      );
      if (q.rowCount) atualizados += q.rowCount;
      else semMatch += 1;
    }
    await client.query('COMMIT');
    console.log('Produtos atualizados:', atualizados);
    console.log('Linhas sem match no cadastro:', semMatch);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
