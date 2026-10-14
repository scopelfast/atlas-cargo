'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const DESDE = process.argv[2] || '2026-05-18';

(async () => {
  const q = async (sql, p) => (await pool.query(sql, p)).rows[0];
  const r = {
    desde: DESDE,
    cargas: await q(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE "DH_CRIACAO" >= $1::date)::int AS desde
         FROM "WMS_CARGA_PROGRAMADA" WHERE "TENANT_ID"='default'`,
      [DESDE]
    ),
    expedicao: await q(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE("ST_EXPEDICAO",'')))='EXPEDIDA')::int AS expedidas,
              COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE("ST_EXPEDICAO",'')))='EM_EXPEDICAO')::int AS em_exp
         FROM "WMS_EXPEDICAO_CARGA" WHERE "TENANT_ID"='default'`
    ),
    expedidas_desde: await q(
      `SELECT COUNT(*)::int AS n FROM "WMS_EXPEDICAO_CARGA" e
         JOIN "WMS_CARGA_PROGRAMADA" c ON c."CD_CARGA"=e."CD_CARGA" AND c."TENANT_ID"=e."TENANT_ID"
        WHERE e."TENANT_ID"='default' AND UPPER(TRIM(COALESCE(e."ST_EXPEDICAO",'')))='EXPEDIDA'
          AND c."DH_CRIACAO">=$1::date`,
      [DESDE]
    ),
    reservas: await q(`SELECT COUNT(*)::int AS linhas, COUNT(DISTINCT "CD_OPL_ARQUIVO")::int AS espelhos FROM "WMS_RESERVA_ESTOQUE_OPL" WHERE "TENANT_ID"='default'`),
    reservas_com_expedicao: await q(
      `SELECT COUNT(DISTINCT r."CD_OPL_ARQUIVO")::int AS espelhos_com_reserva
         FROM "WMS_RESERVA_ESTOQUE_OPL" r
         JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO"=r."CD_OPL_ARQUIVO"
        WHERE r."TENANT_ID"='default' AND a."DH_IMPORT">=$1::date`,
      [DESDE]
    ),
    espelhos_reserva: (
      await pool.query(
        `SELECT r."CD_OPL_ARQUIVO", a."NM_ARQUIVO", COUNT(*)::int AS skus
           FROM "WMS_RESERVA_ESTOQUE_OPL" r
           JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO"=r."CD_OPL_ARQUIVO"
          WHERE r."TENANT_ID"='default' AND a."DH_IMPORT">=$1::date
          GROUP BY 1,2 ORDER BY skus DESC`,
        [DESDE]
      )
    ).rows,
  };
  console.log(JSON.stringify(r, null, 2));
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
