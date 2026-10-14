#!/usr/bin/env node
'use strict';
/**
 * Garante TIPO_ARMAZENAGEM em todos os produtos do tenant (nunca vazio).
 * Usa nome do produto + regras OL; padrão SECO.
 *
 *   node scripts/wms_preencher_conservacao_ol.js --tenant default
 *   node scripts/wms_preencher_conservacao_ol.js --tenant default --dry-run
 */

require('dotenv').config();
const { pool } = require('../config/db');
const { inferirConservacaoPorNome } = require('../utils/wms-conservacao-ol');

async function main() {
  const tenant = process.env.DEFAULT_TENANT_ID || 'default';
  const dryRun = process.argv.includes('--dry-run');
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT "CD_PRODUTO", "NOME", "TIPO_ARMAZENAGEM"
         FROM "WMS_PRODUTO_DONO"
        WHERE "TENANT_ID" = $1
          AND COALESCE("FG_FORNECEDOR_REF", 'N') = 'N'
          AND COALESCE(TRIM("TIPO_ARMAZENAGEM"), '') = ''`,
      [tenant]
    );
    console.log('Sem conservação:', r.rowCount);
    let upd = 0;
    if (!dryRun) await client.query('BEGIN');
    for (const row of r.rows) {
      const inf = inferirConservacaoPorNome(row.NOME) || 'SECO';
      if (!dryRun) {
        await client.query(
          `UPDATE "WMS_PRODUTO_DONO"
              SET "TIPO_ARMAZENAGEM" = $2, "DH_MAINTENANCE" = CURRENT_TIMESTAMP, "SG_USER" = 'fill_conserv_ol'
            WHERE "CD_PRODUTO" = $1::integer`,
          [row.CD_PRODUTO, inf]
        );
      }
      upd++;
    }
    if (!dryRun) await client.query('COMMIT');
    console.log(dryRun ? 'Simularia preencher:' : 'Atualizados:', upd);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
