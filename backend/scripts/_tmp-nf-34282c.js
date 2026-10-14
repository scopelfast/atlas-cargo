'use strict';
require('dotenv').config();
const { pool } = require('../config/db');

(async () => {
  const r = await pool.query(
    `SELECT "CD_PRODUTO","CODIGO","NOME","UNIDADE","FGACTIVE"
       FROM "WMS_PRODUTO_DONO"
      WHERE "TENANT_ID"='default' AND "CD_DONO"=1
        AND (
          "CODIGO" LIKE '6.21.09.343%'
          OR "CODIGO" LIKE '6.21.09.345%'
          OR "CODIGO" IN ('7898383300502','17344901')
        )
      ORDER BY "CODIGO"`
  );
  console.log(r.rows);

  // operacional
  const op = await pool.query(
    `SELECT o."CODIGO_OPERACIONAL", o."CD_PRODUTO", p."CODIGO", p."NOME"
       FROM "WMS_PRODUTO_OPERACIONAL" o
       JOIN "WMS_PRODUTO_DONO" p
         ON p."CD_PRODUTO"=o."CD_PRODUTO" AND p."TENANT_ID"=o."TENANT_ID" AND p."CD_DONO"=o."CD_DONO"
      WHERE o."TENANT_ID"='default' AND o."CD_DONO"=1
        AND (
          p."CODIGO" IN ('6.21.09.343.01','6.21.09.345.01')
          OR regexp_replace(o."CODIGO_OPERACIONAL",'[^0-9A-Za-z]','','g')
             IN ('6210934301','6210934501','7898383300502','17344901')
        )`
  );
  console.log('OP', op.rows);

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
