'use strict';
/**
 * Restaura QT_COLETADA = QT_PEDIDA nos espelhos com picking incompleto (efeito da migração indevida).
 *
 *   node scripts/wms_restaurar_picking_pos_migracao.js [tenantId] [YYYY-MM-DD]           # dry-run
 *   node scripts/wms_restaurar_picking_pos_migracao.js [tenantId] [YYYY-MM-DD] --apply   # aplica
 *   node scripts/wms_restaurar_picking_pos_migracao.js default 2026-05-18 --apply --excluir=142,141
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { restaurarPickingPosMigracao } = require('../services/wms-opl-restaurar-picking-montagem.service');
const { pool } = require('../config/db');

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
const excluirArg = process.argv.find((a) => a.startsWith('--excluir='));
const excluirCd = excluirArg
  ? excluirArg
      .slice('--excluir='.length)
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter(Number.isFinite)
  : [];

const tenantId = args[0] || 'default';
const desde = args[1] || '2026-05-18';

(async () => {
  console.log(apply ? '=== APLICANDO restauração ===' : '=== DRY-RUN (use --apply) ===');
  const resumo = await restaurarPickingPosMigracao(tenantId, { dryRun: !apply, desde, excluirCd });
  console.log(
    JSON.stringify(
      {
        ...resumo,
        espelhos: resumo.espelhos.length > 20 ? resumo.espelhos.slice(0, 20).concat([{ _truncado: resumo.espelhos.length - 20 }]) : resumo.espelhos,
      },
      null,
      2
    )
  );
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
