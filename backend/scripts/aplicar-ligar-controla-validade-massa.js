'use strict';
/**
 * Opção A: liga FG_CONTROLA_VALIDADE = 'S' em massa.
 * Critério: tenant default, FGACTIVE=S, FG_CONTROLA_VALIDADE=N, saldo SKU > 0.
 * Exclui família 6.31.* (limpeza/higiene).
 * Donos: 1 Mana + 2 Nutriville.
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const TENANT = 'default';
const DONOS = [
  { cd: 1, nome: 'Mana' },
  { cd: 2, nome: 'Nutriville' },
];

async function listarCandidatos(client, cdDono) {
  const r = await client.query(
    `
WITH linhas_nf AS (
  SELECT (elem->>'cdProduto')::integer AS cd_produto,
         COALESCE(NULLIF(TRIM(elem->>'qtdConvertida'),''),'0')::numeric AS qtd
    FROM "WMS_NFE_ENTRADA" e
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON",'[]'::jsonb)) elem
   WHERE e."TENANT_ID"=$1 AND e."CD_DONO"=$2
     AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO",'')))='ENCERRADA'
     AND (elem->>'cdProduto') ~ '^[0-9]+$'
),
ent AS (
  SELECT cd_produto, SUM(qtd) AS qtd_nf FROM linhas_nf WHERE qtd<>0 GROUP BY 1
),
mov AS (
  SELECT "CD_PRODUTO" AS cd_produto, SUM("QTD")::numeric AS qtd_mov
    FROM "WMS_MOVIMENTO_ESTOQUE"
   WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2
   GROUP BY 1
),
saldo AS (
  SELECT COALESCE(e.cd_produto, m.cd_produto) AS cd_produto,
         COALESCE(e.qtd_nf,0) + COALESCE(m.qtd_mov,0) AS qtd_saldo
    FROM ent e
    FULL OUTER JOIN mov m ON m.cd_produto = e.cd_produto
)
SELECT p."CD_PRODUTO", p."CODIGO", p."NOME", p."TIPO_ARMAZENAGEM", s.qtd_saldo
  FROM "WMS_PRODUTO_DONO" p
  JOIN saldo s ON s.cd_produto = p."CD_PRODUTO"
 WHERE p."TENANT_ID"=$1 AND p."CD_DONO"=$2
   AND COALESCE(p."FGACTIVE",'S')='S'
   AND COALESCE(p."FG_CONTROLA_VALIDADE",'N')='N'
   AND s.qtd_saldo > 1e-6
   AND p."CODIGO" NOT LIKE '6.31.%'
 ORDER BY p."CODIGO"
    `,
    [TENANT, cdDono]
  );
  return r.rows;
}

(async () => {
  const client = await pool.connect();
  const resumo = [];
  const todos = [];
  try {
    await client.query('BEGIN');
    for (const d of DONOS) {
      const rows = await listarCandidatos(client, d.cd);
      if (!rows.length) {
        resumo.push({ dono: d.nome, atualizados: 0 });
        continue;
      }
      const ids = rows.map((x) => x.CD_PRODUTO);
      const upd = await client.query(
        `UPDATE "WMS_PRODUTO_DONO"
            SET "FG_CONTROLA_VALIDADE" = 'S',
                "SG_USER" = 'admin',
                "DH_MAINTENANCE" = CURRENT_TIMESTAMP
          WHERE "TENANT_ID" = $1
            AND "CD_DONO" = $2::integer
            AND "CD_PRODUTO" = ANY($3::integer[])
            AND COALESCE("FG_CONTROLA_VALIDADE",'N') = 'N'
          RETURNING "CD_PRODUTO", "CODIGO"`,
        [TENANT, d.cd, ids]
      );
      for (const row of rows) {
        todos.push({
          dono: d.nome,
          cdDono: d.cd,
          codigo: row.CODIGO,
          nome: row.NOME,
          tipo: row.TIPO_ARMAZENAGEM || '',
          saldo: row.qtd_saldo,
        });
      }
      resumo.push({ dono: d.nome, cdDono: d.cd, atualizados: upd.rowCount, candidatos: rows.length });
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

  const outDir = path.join(__dirname, '../tmp');
  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, 'aplicado-ligar-controla-validade-mana-nutriville.csv');
  const head = 'DONO;CD_DONO;CODIGO;NOME;TIPO_ARMAZENAGEM;QTD_SALDO;FG_CONTROLA_VALIDADE';
  const body = todos
    .map((r) =>
      [r.dono, r.cdDono, r.codigo, r.nome, r.tipo, r.saldo, 'S']
        .map((v) => {
          const s = String(v == null ? '' : v);
          return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(';')
    )
    .join('\n');
  fs.writeFileSync(csvPath, head + '\n' + body, 'utf8');

  console.log(JSON.stringify({ resumo, total: todos.length, csvPath }, null, 2));
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
