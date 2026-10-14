#!/usr/bin/env node
'use strict';
/**
 * Alinha WMS_CATEGORIA_PRODUTO à regra OL: categoria = nv3 (subgrupo).
 * 1) Reimporta grupos/categorias nv2/nv3 e revincula produtos da planilha
 * 2) Remapeia produtos ainda em categorias nv4/legado → nv3 correspondente
 * 3) Desativa categorias fora da whitelist nv3
 *
 * Uso:
 *   node scripts/wms_reparar_categorias_nv3.js --arquivo "C:\...\exportar_.xlsx" --tenant default
 *   node scripts/wms_reparar_categorias_nv3.js --arquivo "..." --dry-run
 */

require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../config/db');
const { indexarPlanilhaOl } = require('../utils/wms-ol-arvore');
const { importarClassificacaoOl } = require('../services/wms-import-ol-classificacao.service');

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

function lerPlanilha(arquivo) {
  const abs = path.resolve(arquivo);
  const wb = XLSX.readFile(abs);
  const sheet = wb.SheetNames.includes('Exportar Planilha') ? 'Exportar Planilha' : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' });
  return { rows, abs, sheet };
}

function nv3Whitelist(index) {
  const codes = new Set();
  for (const node of index.byLevel[3] || []) {
    codes.add(String(node.cod).trim());
  }
  return codes;
}

function melhorNv3ParaCodigo(cod, nv3List) {
  const c = String(cod || '').trim();
  if (!c) return null;
  let best = null;
  for (const nv3 of nv3List) {
    if (c.startsWith(nv3) && nv3.length < c.length) {
      if (!best || nv3.length > best.length) best = nv3;
    }
  }
  return best;
}

async function remapearProdutosForaNv3(client, tenantId, nv3Codes, nv3List, dryRun) {
  const r = await client.query(
    `SELECT c."CD_CATEGORIA", c."CODIGO" AS c_cod, c."NOME" AS c_nome, c."FGACTIVE"
       FROM "WMS_CATEGORIA_PRODUTO" c
      WHERE c."TENANT_ID" = $1`,
    [tenantId]
  );

  const mapCatNv3 = new Map();
  const rNv3 = await client.query(
    `SELECT "CD_CATEGORIA", "CODIGO" FROM "WMS_CATEGORIA_PRODUTO"
      WHERE "TENANT_ID" = $1 AND "CODIGO" = ANY($2::text[])`,
    [tenantId, [...nv3Codes]]
  );
  for (const row of rNv3.rows) {
    mapCatNv3.set(String(row.CODIGO).trim(), parseInt(row.CD_CATEGORIA, 10));
  }

  let remapeados = 0;
  let semDestino = 0;
  const foraNv3 = r.rows.filter((row) => !nv3Codes.has(String(row.c_cod).trim()));

  for (const cat of foraNv3) {
    const nv3 = melhorNv3ParaCodigo(cat.c_cod, nv3List);
    const cdDestino = nv3 ? mapCatNv3.get(nv3) : null;
    if (!cdDestino) {
      semDestino++;
      continue;
    }
    const cnt = await client.query(
      `SELECT COUNT(*)::integer AS n FROM "WMS_PRODUTO_DONO"
        WHERE "TENANT_ID" = $1 AND "CD_CATEGORIA" = $2::integer`,
      [tenantId, cat.CD_CATEGORIA]
    );
    const n = cnt.rows[0]?.n || 0;
    if (n === 0) continue;
    if (!dryRun) {
      await client.query(
        `UPDATE "WMS_PRODUTO_DONO"
            SET "CD_CATEGORIA" = $3::integer,
                "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
                "SG_USER" = 'reparo_nv3'
          WHERE "TENANT_ID" = $1 AND "CD_CATEGORIA" = $2::integer`,
        [tenantId, cat.CD_CATEGORIA, cdDestino]
      );
    }
    remapeados += n;
  }

  return { remapeados, semDestino, categoriasForaNv3: foraNv3.length };
}

async function desativarCategoriasForaNv3(client, tenantId, nv3Codes, dryRun) {
  const r = await client.query(
    `SELECT "CD_CATEGORIA", "CODIGO", "NOME", "FGACTIVE"
       FROM "WMS_CATEGORIA_PRODUTO"
      WHERE "TENANT_ID" = $1`,
    [tenantId]
  );
  const desativar = r.rows.filter((row) => {
    const cod = String(row.CODIGO).trim();
    return !nv3Codes.has(cod) && String(row.FGACTIVE || 'S').toUpperCase() !== 'N';
  });
  if (!dryRun && desativar.length) {
    const ids = desativar.map((x) => parseInt(x.CD_CATEGORIA, 10));
    await client.query(
      `UPDATE "WMS_CATEGORIA_PRODUTO"
          SET "FGACTIVE" = 'N',
              "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
              "SG_USER" = 'reparo_nv3'
        WHERE "TENANT_ID" = $1 AND "CD_CATEGORIA" = ANY($2::integer[])`,
      [tenantId, ids]
    );
  }
  return desativar.length;
}

async function main() {
  const args = parseArgs();
  if (!args.arquivo) {
    console.error('Informe --arquivo');
    process.exit(1);
  }

  const { rows, abs, sheet } = lerPlanilha(args.arquivo);
  const index = indexarPlanilhaOl(rows);
  const nv3Codes = nv3Whitelist(index);
  const nv3List = [...nv3Codes].sort((a, b) => b.length - a.length);

  console.log('Arquivo:', abs, '| Aba:', sheet);
  console.log('Tenant:', args.tenant, '| nv3 na planilha:', nv3Codes.size, args.dryRun ? '| DRY-RUN' : '');

  const client = await pool.connect();
  try {
    if (!args.dryRun) await client.query('BEGIN');

    console.log('\n--- Fase 1: importar classificação OL (nv2/nv3) ---');
    const classOut = await importarClassificacaoOl(client, {
      tenantId: args.tenant,
      rows,
      dryRun: args.dryRun,
      sgUser: 'reparo_nv3',
    });
    console.log(classOut.stats);

    console.log('\n--- Fase 2: remapear produtos em categorias nv4/legado ---');
    const remap = await remapearProdutosForaNv3(client, args.tenant, nv3Codes, nv3List, args.dryRun);
    console.log(remap);

    console.log('\n--- Fase 3: desativar categorias fora nv3 ---');
    const desativadas = await desativarCategoriasForaNv3(client, args.tenant, nv3Codes, args.dryRun);
    console.log('Categorias desativadas:', desativadas);

    if (!args.dryRun) await client.query('COMMIT');

    const rAtivas = await client.query(
      `SELECT COUNT(*)::integer AS n
         FROM "WMS_CATEGORIA_PRODUTO"
        WHERE "TENANT_ID" = $1 AND COALESCE(TRIM(UPPER("FGACTIVE")), 'S') = 'S'`,
      [args.tenant]
    );
    console.log('\nCategorias ativas após reparo:', rAtivas.rows[0]?.n);
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
