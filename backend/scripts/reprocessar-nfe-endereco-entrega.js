'use strict';

/**
 * Reprocessa vínculo de endereço de entrega em NF-e de saída sem CD_ENDERECO_ENTREGA.
 * Uso: node scripts/reprocessar-nfe-endereco-entrega.js [tenantId] [cdDono?]
 */
const { pool } = require('../config/db');
const {
  provisionarEnderecoEntregaDaNf,
  vincularEnderecoEntregaNf,
} = require('../services/cadastro-endereco-entrega-provision.service');

async function main() {
  const tid = process.argv[2] || 'default';
  const cdDonoFilter = process.argv[3] != null ? parseInt(process.argv[3], 10) : null;
  const params = [tid];
  let sql = `
    SELECT *
      FROM "WMS_NFE_SAIDA"
     WHERE "TENANT_ID" = $1
       AND "CD_ENDERECO_ENTREGA" IS NULL
       AND coalesce("CNPJ_ENTREGA", "CNPJ_DEST", '') <> ''
       AND coalesce("XLGR_DEST", '') <> ''
       AND coalesce("UF_DEST", '') <> ''`;
  if (cdDonoFilter != null && Number.isFinite(cdDonoFilter)) {
    params.push(cdDonoFilter);
    sql += ` AND "CD_DONO" = $2::integer`;
  }
  sql += ` ORDER BY "CD_NFE_SAIDA" DESC LIMIT 5000`;

  const r = await pool.query(sql, params);
  let ok = 0;
  let skip = 0;
  const byStatus = {};
  for (const nf of r.rows) {
    const prov = await provisionarEnderecoEntregaDaNf(pool, tid, nf, 'reprocess-ee');
    byStatus[prov.status] = (byStatus[prov.status] || 0) + 1;
    if (prov.cdEndereco != null && (!prov.pendencias || !prov.pendencias.length)) {
      await vincularEnderecoEntregaNf(pool, tid, nf.CD_NFE_SAIDA, prov.cdEndereco);
      ok++;
    } else if (prov.cdEndereco != null) {
      await vincularEnderecoEntregaNf(pool, tid, nf.CD_NFE_SAIDA, prov.cdEndereco);
      skip++;
    } else {
      skip++;
    }
  }
  console.log(JSON.stringify({ total: r.rows.length, vinculadosCompletos: ok, outros: skip, byStatus }, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
