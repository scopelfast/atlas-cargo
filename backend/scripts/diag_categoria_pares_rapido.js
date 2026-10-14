'use strict';
require('dotenv').config();
const { pool } = require('../config/db');

async function main() {
  const tid = process.env.DEFAULT_TENANT_ID || 'default';
  const cdDono = parseInt(process.env.WMS_CATEGORIA_JOB_CD_DONOS || '1', 10);
  const r = await pool.query(
    `WITH f AS (
       SELECT p."CD_PRODUTO",
         UPPER(regexp_replace(translate(COALESCE(p."NOME", ''), 'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇ', 'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcC'), '[^A-Z0-9 ]', '', 'g')) AS nm_norm,
         regexp_replace(COALESCE(p."CODIGO", ''), '[^0-9A-Za-z]', '', 'g') AS cod_norm
       FROM "WMS_PRODUTO_DONO" p
       WHERE p."TENANT_ID" = $1 AND p."CD_DONO" = $2::integer
         AND p."CD_CATEGORIA" IS NULL AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
     ),
     b AS (
       SELECT c."CD_CATEGORIA",
         UPPER(regexp_replace(translate(COALESCE(c."NOME", ''), 'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇ', 'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcC'), '[^A-Z0-9 ]', '', 'g')) AS nm_norm,
         regexp_replace(COALESCE(c."CODIGO", ''), '[^0-9A-Za-z]', '', 'g') AS cod_norm
       FROM "WMS_PRODUTO_DONO" c
       WHERE c."TENANT_ID" = $1 AND c."CD_DONO" = $2::integer
         AND c."CD_CATEGORIA" IS NOT NULL AND COALESCE(c."FG_FORNECEDOR_REF", 'N') = 'N'
     )
     SELECT
       COUNT(*) FILTER (WHERE f.nm_norm = b.nm_norm AND f.nm_norm <> '')::integer AS pares_nome_igual,
       COUNT(*) FILTER (WHERE left(f.cod_norm, 6) = left(b.cod_norm, 6) AND length(f.cod_norm) >= 6)::integer AS pares_cod6,
       COUNT(*) FILTER (WHERE f.cod_norm = b.cod_norm AND f.cod_norm <> '')::integer AS pares_cod_exato
     FROM f
     JOIN b ON (
       (f.nm_norm <> '' AND f.nm_norm = b.nm_norm)
       OR (f.cod_norm <> '' AND f.cod_norm = b.cod_norm)
       OR (length(f.cod_norm) >= 6 AND length(b.cod_norm) >= 6 AND left(f.cod_norm, 6) = left(b.cod_norm, 6))
     )`,
    [tid, cdDono]
  );
  console.log(r.rows[0]);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
