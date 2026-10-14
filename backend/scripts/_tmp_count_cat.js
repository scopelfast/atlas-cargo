#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');

(async () => {
  const total = await pool.query(
    `SELECT "FGACTIVE", COUNT(*)::int c FROM "WMS_CATEGORIA_PRODUTO" WHERE "TENANT_ID"='default' GROUP BY "FGACTIVE" ORDER BY "FGACTIVE"`
  );
  const ativas = await pool.query(
    `SELECT c."CODIGO", c."NOME", g."CODIGO" AS g_cod, g."NOME" AS g_nome
       FROM "WMS_CATEGORIA_PRODUTO" c
       JOIN "WMS_GRUPO_PRODUTO" g ON g."CD_GRUPO"=c."CD_GRUPO" AND g."TENANT_ID"=c."TENANT_ID"
      WHERE c."TENANT_ID"='default' AND c."FGACTIVE"='S'
      ORDER BY c."CODIGO"
      LIMIT 20`
  );
  const nv3 = await pool.query(
    `SELECT COUNT(*)::int c FROM "WMS_CATEGORIA_PRODUTO"
      WHERE "TENANT_ID"='default' AND "FGACTIVE"='S' AND LENGTH(TRIM("CODIGO"))=5`
  );
  const nv4 = await pool.query(
    `SELECT COUNT(*)::int c FROM "WMS_CATEGORIA_PRODUTO"
      WHERE "TENANT_ID"='default' AND "FGACTIVE"='S' AND LENGTH(TRIM("CODIGO"))>5`
  );
  console.log('Por FGACTIVE:', total.rows);
  console.log('Ativas cod len=5 (nv3):', nv3.rows[0].c);
  console.log('Ativas cod len>5 (nv4):', nv4.rows[0].c);
  console.log('Amostra ativas:', ativas.rows);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
