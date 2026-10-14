'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
(async () => {
  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'WMS_NFE_SAIDA' ORDER BY 1`
  );
  console.log(cols.rows.map((r) => r.column_name).join(','));
  const one = await pool.query(
    `SELECT "LINHAS_JSON"->0 AS item
       FROM "WMS_NFE_SAIDA"
      WHERE "TENANT_ID" = 'default'
        AND jsonb_typeof("LINHAS_JSON") = 'array'
        AND jsonb_array_length("LINHAS_JSON") > 0
      LIMIT 1`
  );
  console.log(JSON.stringify(one.rows[0], null, 2));
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
