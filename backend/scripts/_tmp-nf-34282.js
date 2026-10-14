'use strict';
require('dotenv').config();
const { pool } = require('../config/db');

(async () => {
  const nf = await pool.query(
    `SELECT "CD_NFE", "CD_DONO", "ST_RECEBIMENTO", "NUMERO_NF", "SERIE", "CHAVE_NFE",
            "DH_EMISSAO", "DT_RECEBIMENTO", "NM_CONFERENTE", "LINHAS_JSON", "CONFERENCIA_JSON"
       FROM "WMS_NFE_ENTRADA"
      WHERE "TENANT_ID"='default'
        AND ("CHAVE_NFE" LIKE '%342821611435352%' OR "NUMERO_NF" IN ('34282','000034282'))
      ORDER BY "CD_NFE" DESC LIMIT 3`
  );
  console.log(
    'NFs',
    nf.rows.map((r) => ({
      CD_NFE: r.CD_NFE,
      DONO: r.CD_DONO,
      ST: r.ST_RECEBIMENTO,
      NU: r.NUMERO_NF,
      chave: r.CHAVE_NFE,
      conf: r.NM_CONFERENTE,
      dtRec: r.DT_RECEBIMENTO,
    }))
  );

  if (!nf.rows[0]) {
    await pool.end();
    return;
  }
  const r = nf.rows[0];
  console.log('\n=== LINHAS_JSON ===');
  console.log(JSON.stringify(r.LINHAS_JSON, null, 2));
  console.log('\n=== CONFERENCIA_JSON ===');
  console.log(JSON.stringify(r.CONFERENCIA_JSON, null, 2));

  // Compare OL: fator 32 — does WMS expect PC/UN?
  for (const cod of ['6.21.09.345.01', '6.21.09.343.01']) {
    const p = await pool.query(
      `SELECT "CD_PRODUTO","CODIGO","NOME","UNIDADE","PESO_UNITARIO","FG_CONTROLA_VALIDADE"
         FROM "WMS_PRODUTO_DONO" WHERE "TENANT_ID"='default' AND "CD_DONO"=1 AND "CODIGO"=$1`,
      [cod]
    );
    console.log('\nPROD', p.rows[0]);
  }

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
