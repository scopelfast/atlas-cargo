'use strict';
/** Leitura rápida do ambiente WMS (somente SELECT). Uso: node scripts/wms-qa-snapshot-readonly.js */
const { pool } = require('../config/db');

const TABLES = [
  'WMS_DONO_ESTOQUE',
  'WMS_PRODUTO_DONO',
  'WMS_DEPARA_PRODUTO',
  'WMS_NFE_ENTRADA',
  'WMS_NFE_SAIDA',
  'WMS_OPL_ARQUIVO',
  'WMS_OPL_PEDIDO',
  'WMS_OPL_ITEM',
  'WMS_RESERVA_ESTOQUE_OPL',
  'WMS_CARGA_PROGRAMADA',
  'WMS_EXPEDICAO_CARGA',
  'WMS_MOVIMENTO_ESTOQUE',
];

async function main() {
  for (const t of TABLES) {
    try {
      const r = await pool.query(`SELECT COUNT(*)::int AS c FROM "${t}"`);
      console.log(`${t}\t${r.rows[0].c}`);
    } catch (e) {
      console.log(`${t}\t[${e.code || 'ERR'}] ${e.message.split('\n')[0]}`);
    }
  }
}

main()
  .then(() => pool.end())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
