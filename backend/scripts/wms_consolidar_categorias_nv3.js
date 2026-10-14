#!/usr/bin/env node
'use strict';
/**
 * Consolida cadastro WMS em categorias OL nv3 (grupo) e desativa nv4 órfãs.
 *
 * 1) Reimporta classificação da planilha exportar.xlsx (grupos nv2 + categorias nv3 + vínculo produtos).
 * 2) Desativa WMS_CATEGORIA_PRODUTO sem nenhum produto ativo (famílias nv4 antigas).
 *
 * Uso (pasta backend):
 *   node scripts/wms_consolidar_categorias_nv3.js --arquivo "C:\...\exportar.xlsx" --tenant default
 *   node scripts/wms_consolidar_categorias_nv3.js --arquivo "..." --tenant default --dry-run
 *   node scripts/wms_consolidar_categorias_nv3.js --tenant default --somente-desativar
 *     (só desativa categorias sem produto; não remapeia)
 */

require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../config/db');
const { importarClassificacaoOl } = require('../services/wms-import-ol-classificacao.service');

function parseArgs() {
  const out = {
    arquivo: '',
    tenant: process.env.DEFAULT_TENANT_ID || 'default',
    dryRun: false,
    somenteDesativar: false,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--arquivo' && argv[i + 1]) out.arquivo = argv[++i];
    else if (argv[i] === '--tenant' && argv[i + 1]) out.tenant = argv[++i];
    else if (argv[i] === '--dry-run') out.dryRun = true;
    else if (argv[i] === '--somente-desativar') out.somenteDesativar = true;
  }
  return out;
}

function lerPlanilhaOl(arquivo) {
  const abs = path.resolve(arquivo);
  const wb = XLSX.readFile(abs);
  const sheet = wb.SheetNames.includes('Exportar Planilha') ? 'Exportar Planilha' : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' });
  return { rows, sheet, abs };
}

async function contarCategorias(client, tenantId) {
  const r = await client.query(
    `SELECT
       COUNT(*)::integer AS total,
       COUNT(*) FILTER (WHERE "FGACTIVE" = 'S')::integer AS ativas,
       COUNT(*) FILTER (WHERE "FGACTIVE" = 'S' AND POSITION(' › ' IN "NOME") > 0)::integer AS ativas_nv4_nome,
       COUNT(*) FILTER (
         WHERE "FGACTIVE" = 'S'
           AND NOT EXISTS (
             SELECT 1 FROM "WMS_PRODUTO_DONO" p
              WHERE p."CD_CATEGORIA" = c."CD_CATEGORIA"
                AND p."TENANT_ID" = c."TENANT_ID"
                AND p."FGACTIVE" = 'S'
           )
       )::integer AS ativas_sem_produto
     FROM "WMS_CATEGORIA_PRODUTO" c
     WHERE c."TENANT_ID" = $1`,
    [tenantId]
  );
  return r.rows[0] || {};
}

async function desativarCategoriasOrfas(client, tenantId, dryRun) {
  if (dryRun) {
    const r = await client.query(
      `SELECT COUNT(*)::integer AS n
         FROM "WMS_CATEGORIA_PRODUTO" c
        WHERE c."TENANT_ID" = $1
          AND c."FGACTIVE" = 'S'
          AND NOT EXISTS (
            SELECT 1 FROM "WMS_PRODUTO_DONO" p
             WHERE p."CD_CATEGORIA" = c."CD_CATEGORIA"
               AND p."TENANT_ID" = c."TENANT_ID"
               AND p."FGACTIVE" = 'S'
          )`,
      [tenantId]
    );
    return { desativadas: r.rows[0].n || 0, dryRun: true };
  }
  const r = await client.query(
    `UPDATE "WMS_CATEGORIA_PRODUTO" c
        SET "FGACTIVE" = 'N',
            "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
            "SG_USER" = 'consolidar_nv3'
      WHERE c."TENANT_ID" = $1
        AND c."FGACTIVE" = 'S'
        AND NOT EXISTS (
          SELECT 1 FROM "WMS_PRODUTO_DONO" p
           WHERE p."CD_CATEGORIA" = c."CD_CATEGORIA"
             AND p."TENANT_ID" = c."TENANT_ID"
             AND p."FGACTIVE" = 'S'
        )
      RETURNING c."CD_CATEGORIA"`,
    [tenantId]
  );
  return { desativadas: r.rowCount || 0, dryRun: false };
}

async function main() {
  const args = parseArgs();
  if (!args.somenteDesativar && !args.arquivo) {
    console.error('Informe --arquivo exportar.xlsx ou use --somente-desativar');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    console.log('Tenant:', args.tenant, args.dryRun ? '(dry-run)' : '');

    const antes = await contarCategorias(client, args.tenant);
    console.log('\n--- Antes ---');
    console.log(antes);

    if (!args.somenteDesativar) {
      const { rows, sheet, abs } = lerPlanilhaOl(args.arquivo);
      console.log('\n--- Reclassificação OL → categorias nv3 ---');
      console.log('Arquivo:', abs);
      console.log('Aba:', sheet, '| Linhas:', rows.length);

      if (!args.dryRun) await client.query('BEGIN');
      const classOut = await importarClassificacaoOl(client, {
        tenantId: args.tenant,
        rows,
        dryRun: args.dryRun,
        sgUser: 'consolidar_nv3',
      });
      console.log('Classificação:', classOut.stats, args.dryRun ? '(dry-run)' : '');
      if (!args.dryRun) await client.query('COMMIT');
    }

    if (!args.dryRun) await client.query('BEGIN');
    const des = await desativarCategoriasOrfas(client, args.tenant, args.dryRun);
    if (!args.dryRun) await client.query('COMMIT');
    console.log('\n--- Categorias órfãs desativadas ---');
    console.log(des);

    const depois = await contarCategorias(client, args.tenant);
    console.log('\n--- Depois ---');
    console.log(depois);

    console.log(
      '\nPróximo passo: reinicie o Node do backend e reimprima o romaneio (Separadores: Só conservação ou Automático).'
    );
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
