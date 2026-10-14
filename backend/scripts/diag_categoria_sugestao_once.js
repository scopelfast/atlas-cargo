'use strict';
require('dotenv').config();
const { pool } = require('../config/db');

async function main() {
  const tid = process.env.DEFAULT_TENANT_ID || 'default';
  const cdDono = parseInt(process.env.WMS_CATEGORIA_JOB_CD_DONOS || '1', 10);
  const r = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE "CD_CATEGORIA" IS NULL AND COALESCE("FG_FORNECEDOR_REF", 'N') = 'N') AS sem_cat,
      COUNT(*) FILTER (WHERE "CD_CATEGORIA" IS NOT NULL AND COALESCE("FG_FORNECEDOR_REF", 'N') = 'N') AS com_cat,
      COUNT(*) FILTER (WHERE "CD_CATEGORIA" IS NULL AND COALESCE("FG_FORNECEDOR_REF", 'N') = 'N' AND COALESCE(TRIM("TIPO_ARMAZENAGEM"), '') = '') AS sem_cat_sem_tipo,
      COUNT(*) FILTER (WHERE "CD_CATEGORIA" IS NOT NULL AND COALESCE("FG_FORNECEDOR_REF", 'N') = 'N' AND COALESCE(TRIM("TIPO_ARMAZENAGEM"), '') = '') AS com_cat_sem_tipo,
      COUNT(*) FILTER (WHERE "CD_CATEGORIA" IS NOT NULL AND COALESCE("FG_FORNECEDOR_REF", 'N') = 'N' AND "TIPO_ARMAZENAGEM" = 'SECO') AS com_cat_seco
     FROM "WMS_PRODUTO_DONO"
    WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer`,
    [tid, cdDono]
  );
  console.log('tenant', tid, 'cdDono', cdDono);
  console.log('stats', r.rows[0]);

  const svc = require('../services/wms-categoria-sugestao.service');
  for (const modo of ['todos', 'medio', 'alto']) {
    const out = await svc.listarSugestoesCategoria(pool, { tenantId: tid, cdDono, modo, limit: 20 });
    console.log('modo', modo, 'rows', out.rows.length, out.rows[0] ? { id: out.rows[0].CD_PRODUTO, conf: out.rows[0].CONFIANCA, score: out.rows[0].SCORE } : null);
  }

  const bulk = await svc.aplicarCategoriaAltaConfiancaEmLote(pool, { tenantId: tid, cdDono, dryRun: true });
  console.log('bulk dry', bulk);

  const r2 = await pool.query(
    `SELECT COUNT(*)::int AS pares_mesmo_codigo
       FROM "WMS_PRODUTO_DONO" f
       JOIN "WMS_PRODUTO_DONO" b
         ON b."TENANT_ID" = f."TENANT_ID" AND b."CD_DONO" = f."CD_DONO"
        AND regexp_replace(COALESCE(f."CODIGO",''), '[^0-9A-Za-z]', '', 'g')
          = regexp_replace(COALESCE(b."CODIGO",''), '[^0-9A-Za-z]', '', 'g')
        AND b."CD_CATEGORIA" IS NOT NULL
      WHERE f."TENANT_ID" = $1 AND f."CD_DONO" = $2::integer
        AND f."CD_CATEGORIA" IS NULL
        AND COALESCE(f."FG_FORNECEDOR_REF", 'N') = 'N'`,
    [tid, cdDono]
  );
  console.log('pares mesmo codigo dig', r2.rows[0]);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
