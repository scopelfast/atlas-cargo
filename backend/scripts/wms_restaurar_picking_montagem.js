'use strict';
/**
 * Restaura QT_COLETADA = QT_PEDIDA (picking «em branco = conferido») nos espelhos das cargas em montagem.
 *
 *   node scripts/wms_restaurar_picking_montagem.js [tenantId]           # dry-run
 *   node scripts/wms_restaurar_picking_montagem.js [tenantId] --apply # aplica
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { restaurarPickingMontagem } = require('../services/wms-opl-restaurar-picking-montagem.service');
const { pool } = require('../config/db');

const tenantId = process.argv[2] || 'default';
const apply = process.argv.includes('--apply');

(async () => {
  const resumo = await restaurarPickingMontagem(tenantId, { dryRun: !apply });
  console.log(JSON.stringify(resumo, null, 2));
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
