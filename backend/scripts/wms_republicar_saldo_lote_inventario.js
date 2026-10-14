#!/usr/bin/env node
/**
 * Republica saldo lote/validade de inventário(s) já encerrado(s).
 *
 *   cd backend
 *   node scripts/wms_republicar_saldo_lote_inventario.js 90
 *   node scripts/wms_republicar_saldo_lote_inventario.js --todos-encerrados
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const { pool, poolPromise } = require('../config/db');
const { republicarSaldoLoteInventarioEncerrado } = require('../services/wms-inventario.service');

const tenantId = process.env.DEFAULT_TENANT_ID || 'default';
const SG_USER = 'SCRIPT_REPUBLICAR_SALDO_LOTE';

(async () => {
  await poolPromise;
  const args = process.argv.slice(2);
  let ids = args.filter((a) => /^\d+$/.test(a)).map((a) => parseInt(a, 10));
  if (args.includes('--todos-encerrados')) {
    const r = await pool.query(
      `SELECT "CD_INVENTARIO" FROM "WMS_INVENTARIO"
        WHERE "TENANT_ID" = $1 AND "ST_INVENTARIO" = 'ENCERRADO'
        ORDER BY "CD_INVENTARIO" DESC`,
      [tenantId]
    );
    ids = r.rows.map((x) => x.CD_INVENTARIO);
  }
  if (!ids.length) {
    console.error('Informe CD_INVENTARIO(s) ou --todos-encerrados');
    process.exit(1);
  }
  for (const cd of ids) {
    const out = await republicarSaldoLoteInventarioEncerrado(tenantId, cd, SG_USER);
    if (out.err) {
      console.log(`#${cd} ERRO: ${out.err}`);
    } else {
      console.log(`#${cd} OK — ${out.ok.linhas} linha(s) lote/validade`);
    }
  }
  await pool.end();
})().catch((e) => {
  console.error('FALHA:', e.message || e);
  process.exit(1);
});
