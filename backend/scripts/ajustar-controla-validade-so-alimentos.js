'use strict';
/**
 * Ajusta opção "só alimentos":
 * - Mantém FG_CONTROLA_VALIDADE=S em famílias de alimento
 * - Reverte para N o que não é alimento (descartáveis, limpeza, escritório, uniforme, etc.)
 *
 * Alimento (prefixos): 6.01, 6.03, 6.04, 6.05, 6.06, 6.11, 6.12, 6.13, 6.14, 6.15, 6.16, 6.17
 * (demais com S ligados na massa de hoje → voltam para N se estiverem na lista aplicada)
 */
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

const TENANT = 'default';
const FOOD_PREFIXES = [
  '6.01.',
  '6.03.',
  '6.04.',
  '6.05.',
  '6.06.',
  '6.11.',
  '6.12.',
  '6.13.',
  '6.14.',
  '6.15.',
  '6.16.',
  '6.17.',
];

function isFood(codigo) {
  const c = String(codigo || '');
  return FOOD_PREFIXES.some((p) => c.startsWith(p));
}

(async () => {
  const csvPrev = path.join(__dirname, '../tmp/aplicado-ligar-controla-validade-mana-nutriville.csv');
  if (!fs.existsSync(csvPrev)) throw new Error('CSV da aplicação anterior não encontrado: ' + csvPrev);
  const lines = fs.readFileSync(csvPrev, 'utf8').trim().split(/\r?\n/).slice(1);
  const rows = lines.map((l) => {
    // DONO;CD_DONO;CODIGO;NOME;...
    const parts = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') q = !q;
      else if (ch === ';' && !q) {
        parts.push(cur);
        cur = '';
      } else cur += ch;
    }
    parts.push(cur);
    return {
      dono: parts[0],
      cdDono: parseInt(parts[1], 10),
      codigo: parts[2],
      nome: parts[3],
    };
  });

  const reverter = rows.filter((r) => !isFood(r.codigo));
  const manter = rows.filter((r) => isFood(r.codigo));

  const client = await pool.connect();
  let nRev = 0;
  try {
    await client.query('BEGIN');
    // Reverte por dono
    for (const cdDono of [1, 2]) {
      const codigos = reverter.filter((r) => r.cdDono === cdDono).map((r) => r.codigo);
      if (!codigos.length) continue;
      const upd = await client.query(
        `UPDATE "WMS_PRODUTO_DONO" p
            SET "FG_CONTROLA_VALIDADE" = 'N',
                "SG_USER" = 'admin'
          WHERE p."TENANT_ID" = $1
            AND p."CD_DONO" = $2::integer
            AND p."CODIGO" = ANY($3::text[])
            AND COALESCE(p."FG_CONTROLA_VALIDADE",'N') = 'S'
          RETURNING p."CODIGO"`,
        [TENANT, cdDono, codigos]
      );
      nRev += upd.rowCount;
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

  const out = path.join(__dirname, '../tmp/ajustado-so-alimentos-controla-validade.csv');
  const head = 'ACAO;DONO;CD_DONO;CODIGO;NOME';
  const body = [
    ...manter.map((r) => ['MANTER_S', r.dono, r.cdDono, r.codigo, r.nome].join(';')),
    ...reverter.map((r) => ['REVERTER_N', r.dono, r.cdDono, r.codigo, r.nome].join(';')),
  ].join('\n');
  fs.writeFileSync(out, head + '\n' + body, 'utf8');

  console.log(
    JSON.stringify(
      {
        mantidosS_alimentos: manter.length,
        revertidosN_naoAlimento: reverter.length,
        updateRowCount: nRev,
        porDonoManter: {
          Mana: manter.filter((r) => r.cdDono === 1).length,
          Nutriville: manter.filter((r) => r.cdDono === 2).length,
        },
        porDonoReverter: {
          Mana: reverter.filter((r) => r.cdDono === 1).length,
          Nutriville: reverter.filter((r) => r.cdDono === 2).length,
        },
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
