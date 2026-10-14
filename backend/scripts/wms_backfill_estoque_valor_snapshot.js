#!/usr/bin/env node
'use strict';
/**
 * Backfill de WMS_ESTOQUE_SNAPSHOT_DIARIO — um snapshot por dia (saldo/preço as-of).
 *
 * Uso (pasta backend):
 *   node scripts/wms_backfill_estoque_valor_snapshot.js --data-ref 2026-05-28
 *   node scripts/wms_backfill_estoque_valor_snapshot.js --data-ref 2026-05-28 --cd-dono 1
 *   node scripts/wms_backfill_estoque_valor_snapshot.js --dt-ini 2026-05-18 --dt-fim 2026-05-28
 */

require('dotenv').config();
const {
  executarBackfillSnapshots,
  resolverPeriodoBackfill,
  WMS_VALOR_DT_INICIO,
} = require('../services/wms-estoque-valor.service');
const { pool } = require('../config/db');

function parseArgs() {
  const out = {
    tenant: process.env.DEFAULT_TENANT_ID || 'default',
    dataRef: '',
    dtIni: '',
    dtFim: '',
    cdDono: null,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tenant' && argv[i + 1]) out.tenant = argv[++i];
    else if (argv[i] === '--data-ref' && argv[i + 1]) out.dataRef = argv[++i];
    else if (argv[i] === '--dt-ini' && argv[i + 1]) out.dtIni = argv[++i];
    else if (argv[i] === '--dt-fim' && argv[i + 1]) out.dtFim = argv[++i];
    else if (argv[i] === '--cd-dono' && argv[i + 1]) out.cdDono = parseInt(argv[++i], 10);
  }
  return out;
}

async function main() {
  const args = parseArgs();
  let dtIni = args.dtIni;
  let dtFim = args.dtFim;
  if (!dtIni || !dtFim) {
    if (!args.dataRef) {
      console.error(
        'Uso: node scripts/wms_backfill_estoque_valor_snapshot.js --data-ref 2026-05-28 [--cd-dono 1]\n' +
          '  ou: --dt-ini 2026-05-18 --dt-fim 2026-05-28'
      );
      process.exit(1);
    }
    const p = resolverPeriodoBackfill(args.dataRef);
    if (!p) {
      console.error('Período inválido para data-ref', args.dataRef, '(início fixo', WMS_VALOR_DT_INICIO + ')');
      process.exit(1);
    }
    dtIni = p.dtIni;
    dtFim = p.dtFim;
  }

  console.log('Tenant:', args.tenant);
  console.log('Período:', dtIni, '→', dtFim);
  if (args.cdDono) console.log('Dono:', args.cdDono);

  const r = await executarBackfillSnapshots(args.tenant, dtIni, dtFim, args.cdDono);
  await pool.end();

  console.log('Dias processados:', r.diasProcessados);
  console.log('Snapshots gravados:', r.snapshotsGravados);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
