'use strict';

/**
 * Corrige picking OPL gravado indevidamente (coletada = pedida em massa).
 * Uso:
 *   node scripts/wms_corrigir_picking_indevido.js [tenantId] [YYYY-MM-DD]           # dry-run
 *   node scripts/wms_corrigir_picking_indevido.js [tenantId] [YYYY-MM-DD] --apply # aplica
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const { corrigirPickingIndevidoOpl } = require('../services/wms-opl-corrigir-picking-indevido.service');

const args = process.argv.slice(2).filter((a) => a !== '--apply');
const apply = process.argv.includes('--apply');
const tenantId = args[0] || 'default';
const desde = args[1] || '2026-05-18';

(async () => {
  console.log(apply ? '=== APLICANDO correção ===' : '=== DRY-RUN (use --apply para gravar) ===');
  const resumo = await corrigirPickingIndevidoOpl(tenantId, { desde, dryRun: !apply });
  console.log(JSON.stringify(resumo, null, 2));
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
