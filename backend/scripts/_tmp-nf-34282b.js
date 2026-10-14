'use strict';
require('dotenv').config();
const { pool } = require('../config/db');

(async () => {
  const r = await pool.query(
    `SELECT "CODIGO","NOME","UNIDADE","FG_CONTROLA_VALIDADE"
       FROM "WMS_PRODUTO_DONO"
      WHERE "TENANT_ID"='default' AND "CD_DONO"=1
        AND ("CODIGO" LIKE '6.21.09.34%' OR "NOME" ILIKE '%GUARD%')
      ORDER BY "CODIGO"
      LIMIT 40`
  );
  console.log(r.rows.map((x) => `${x.CODIGO} | ${x.UNIDADE} | val=${x.FG_CONTROLA_VALIDADE} | ${x.NOME}`).join('\n'));

  const dep = await pool.query(
    `SELECT "CODIGO_EXTERNO","CODIGO_INTERNO","FATOR_CONVERSAO"
       FROM "WMS_DEPARA_PRODUTO"
      WHERE "TENANT_ID"='default' AND "CD_DONO"=1
        AND "CODIGO_INTERNO" LIKE '6.21.09.%'
      ORDER BY "DH_MAINTENANCE" DESC LIMIT 15`
  );
  console.log('\nDEPARA recentes guard/papel', dep.rows);

  // saldo atual desses SKUs
  const mov = await pool.query(
    `SELECT m."CD_PRODUTO", p."CODIGO", SUM(m."QTD") AS q
       FROM "WMS_MOVIMENTO_ESTOQUE" m
       JOIN "WMS_PRODUTO_DONO" p ON p."CD_PRODUTO"=m."CD_PRODUTO" AND p."TENANT_ID"=m."TENANT_ID" AND p."CD_DONO"=m."CD_DONO"
      WHERE m."TENANT_ID"='default' AND m."CD_DONO"=1
        AND p."CODIGO" IN ('6.21.09.345.01','6.21.09.343.01')
      GROUP BY 1,2`
  );
  console.log('\nMOV', mov.rows);

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
