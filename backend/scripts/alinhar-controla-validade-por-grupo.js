'use strict';
/**
 * Alinha FG_CONTROLA_VALIDADE de produtos ativos Mana/Nutriville
 * conforme regra por Grupo (601–607 = S; 621/631/632/651/652 = N).
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const {
  aplicarFgControlaValidade,
  fgValidadePorGrupoOuSku,
  grupoCodigoFromSku,
} = require('../services/wms-controla-validade-grupo.service');

const TENANT = 'default';
const DONOS = [1, 2];

(async () => {
  const client = await pool.connect();
  const mudancas = [];
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `
SELECT p."CD_PRODUTO", p."CD_DONO", p."CODIGO", p."NOME",
       COALESCE(p."FG_CONTROLA_VALIDADE",'N') AS fg_atual,
       g."CODIGO" AS grupo_codigo,
       d."NOME" AS nm_dono
  FROM "WMS_PRODUTO_DONO" p
  LEFT JOIN "WMS_DONO_ESTOQUE" d
    ON d."TENANT_ID" = p."TENANT_ID" AND d."CD_DONO" = p."CD_DONO"
  LEFT JOIN "WMS_CATEGORIA_PRODUTO" c
    ON c."CD_CATEGORIA" = p."CD_CATEGORIA" AND c."TENANT_ID" = p."TENANT_ID"
  LEFT JOIN "WMS_GRUPO_PRODUTO" g
    ON g."CD_GRUPO" = c."CD_GRUPO" AND g."TENANT_ID" = c."TENANT_ID"
 WHERE p."TENANT_ID" = $1
   AND p."CD_DONO" = ANY($2::integer[])
   AND COALESCE(p."FGACTIVE",'S') = 'S'
`,
      [TENANT, DONOS]
    );

    for (const row of r.rows) {
      const codigoGrupo = row.grupo_codigo || grupoCodigoFromSku(row.CODIGO);
      const regra = fgValidadePorGrupoOuSku({
        codigoGrupo,
        codigoProduto: row.CODIGO,
      });
      if (regra !== 'S' && regra !== 'N') continue;
      const desejado = aplicarFgControlaValidade(row.fg_atual, {
        codigoGrupo,
        codigoProduto: row.CODIGO,
      });
      if (row.fg_atual === desejado) continue;
      await client.query(
        `UPDATE "WMS_PRODUTO_DONO"
            SET "FG_CONTROLA_VALIDADE" = $3,
                "SG_USER" = 'admin',
                "DH_MAINTENANCE" = CURRENT_TIMESTAMP
          WHERE "CD_PRODUTO" = $1::integer AND "TENANT_ID" = $2`,
        [row.CD_PRODUTO, TENANT, desejado]
      );
      mudancas.push({
        dono: row.nm_dono,
        cdDono: row.CD_DONO,
        codigo: row.CODIGO,
        nome: row.NOME,
        grupo: codigoGrupo || '',
        de: row.fg_atual,
        para: desejado,
      });
    }
    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw e;
  } finally {
    client.release();
  }

  const out = path.join(__dirname, '../tmp/alinhado-controla-validade-por-grupo.csv');
  const head = 'DONO;CD_DONO;CODIGO;NOME;GRUPO;DE;PARA';
  const body = mudancas
    .map((m) =>
      [m.dono, m.cdDono, m.codigo, `"${String(m.nome || '').replace(/"/g, '""')}"`, m.grupo, m.de, m.para].join(';')
    )
    .join('\n');
  fs.writeFileSync(out, head + '\n' + body, 'utf8');

  console.log(
    JSON.stringify(
      {
        alterados: mudancas.length,
        ligarS: mudancas.filter((m) => m.para === 'S').length,
        desligarN: mudancas.filter((m) => m.para === 'N').length,
        csv: out,
      },
      null,
      2
    )
  );
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
