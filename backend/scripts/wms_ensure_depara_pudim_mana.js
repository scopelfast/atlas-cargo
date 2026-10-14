'use strict';
/** Garante de-para OPL (mascarado + dígitos) → estoque para um código. */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const { resolveCodigoProdutoDono } = require('../utils/wms-codigo-produto-mask');

const tenantId = process.env.DEFAULT_TENANT_ID || 'default';
const cdDono = 1;
const pares = [
  { externo: '6031520542', interno: '6.03.15.205.40', fator: 8, nome: 'PUDIM PO CHOCOLATE C/ LEITE PRATIK CHEF-CX8x540G' },
  { externo: '6.03.15.205.42', interno: '6.03.15.205.40', fator: 8, nome: 'PUDIM (máscara OPL)' },
];

async function ensureDepara(client, ext, internoRaw, fator) {
  const interno = await resolveCodigoProdutoDono(client, tenantId, cdDono, internoRaw);
  const ex = await client.query(
    `SELECT "CD_DEPARA" FROM "WMS_DEPARA_PRODUTO"
      WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2
        AND LOWER(TRIM("CODIGO_EXTERNO"))=LOWER(TRIM($3::text))`,
    [tenantId, cdDono, ext]
  );
  if (ex.rows[0]) {
    console.log('OK de-para já existe:', ext, '→', interno);
    return;
  }
  await client.query(
    `INSERT INTO "WMS_DEPARA_PRODUTO"
       ("TENANT_ID","CD_DONO","CODIGO_EXTERNO","CODIGO_INTERNO","FATOR_CONVERSAO","OBSERVACAO","FGACTIVE","SG_USER")
     VALUES ($1,$2,$3,$4,$5,$6,'S','script/ensure-opl-pudim')`,
    [tenantId, cdDono, ext, interno, fator, 'De-para OPL → estoque (ensure script)']
  );
  console.log('CRIADO de-para:', ext, '→', interno, '×', fator);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of pares) await ensureDepara(client, p.externo, p.interno, p.fator);
    const prod = await client.query(
      `SELECT "CD_PRODUTO","CODIGO","NOME" FROM "WMS_PRODUTO_DONO"
        WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2 AND "CODIGO"='6.03.15.205.40'`,
      [tenantId, cdDono]
    );
    console.log('Produto estoque:', prod.rows[0]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
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
