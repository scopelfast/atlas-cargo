'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');

const APLICAR = process.argv.includes('--aplicar');

(async () => {
  // Pares duplicados: mesmo dono + mesmos dígitos. Mantém o de menor CD_PRODUTO (original com máscara).
  const dup = await pool.query(
    `SELECT "CD_DONO",
            regexp_replace("CODIGO", '[^0-9A-Za-z]', '', 'g') AS chave,
            array_agg("CD_PRODUTO" ORDER BY "CD_PRODUTO") AS ids
       FROM "WMS_PRODUTO_DONO"
      WHERE "TENANT_ID" = 'default'
      GROUP BY 1, 2
     HAVING COUNT(*) > 1`
  );
  const idsRemover = [];
  for (const r of dup.rows) idsRemover.push(...r.ids.slice(1).map(Number));
  console.log(`Pares duplicados: ${dup.rows.length} | candidatos a remover: ${idsRemover.length}`);

  // Tabelas que referenciam CD_PRODUTO
  const tabelas = await pool.query(
    `SELECT DISTINCT c.table_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_name = c.table_name AND t.table_schema = c.table_schema
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND c.column_name = 'CD_PRODUTO' AND c.table_name <> 'WMS_PRODUTO_DONO'`
  );
  const referenciados = new Set();
  for (const t of tabelas.rows) {
    const r = await pool.query(
      `SELECT DISTINCT "CD_PRODUTO" FROM "${t.table_name}" WHERE "CD_PRODUTO" = ANY($1::int[])`,
      [idsRemover]
    );
    for (const x of r.rows) referenciados.add(Number(x.CD_PRODUTO));
    if (r.rows.length) console.log(`  referências em ${t.table_name}: ${r.rows.length} produto(s)`);
  }

  const orfaos = idsRemover.filter((id) => !referenciados.has(id));
  const bloqueados = idsRemover.filter((id) => referenciados.has(id));
  console.log(`Órfãos (podem ser removidos): ${orfaos.length}`);
  console.log(`Com referência (NÃO remover automático): ${bloqueados.length}${bloqueados.length ? ' -> ' + bloqueados.join(',') : ''}`);

  if (!APLICAR) {
    console.log('\nSimulação. Rode com --aplicar para deletar os órfãos.');
  } else if (orfaos.length) {
    const del = await pool.query(
      `DELETE FROM "WMS_PRODUTO_DONO"
        WHERE "TENANT_ID" = 'default' AND "CD_PRODUTO" = ANY($1::int[])
        RETURNING "CD_PRODUTO", "CD_DONO", "CODIGO"`,
      [orfaos]
    );
    console.log(`\nDELETADOS: ${del.rowCount}`);
  }
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
