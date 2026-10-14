'use strict';
/**
 * Minaplast NF 193359 (Mana) + NF 193403 (Nutriville) × AFs CMP05200.
 *
 * Mana AF 0001488786:
 *   11802 → 6.21.11.133.20 ×1  (AF .133.01 embalagem = estoque CX 2500)
 *   10039 → 6.21.11.171.40 ×1  (AF .171.01)
 *   2035  → 6.21.11.631.60 ×1  (AF .631.01 PC 25×100 = CX 2500)
 *   30155 → 6.21.11.659.00 ×50 (AF 50 PC ×10 = 1 CX 500 UN)
 *
 * Nutriville AF 0001489199/9200:
 *   11822 → 6.21.11.155.00 ×1  (17 CX copo 300ml — ok)
 *   4028  → 6.21.11.901.40 ×1  (tampa CX 2000 na NF; AF pedia pote .631.40 @101,50 — preço/desc. divergem)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');

const TENANT = 'default';
const SG = 'script/minaplast-nf193359-193403';

const FIXES = [
  {
    cdDono: 1,
    cdNfe: 468,
    numero: '193359',
    itens: [
      {
        cProd: '11802',
        codigo: '6.21.11.133.20',
        fator: 1,
        obs: 'Minaplast CP180 AF 6.21.11.133.01 → estoque .133.20 CX2500',
      },
      {
        cProd: '10039',
        codigo: '6.21.11.171.40',
        fator: 1,
        obs: 'Minaplast CP50 AF 6.21.11.171.01 → estoque .171.40 CX5000',
      },
      {
        cProd: '2035',
        codigo: '6.21.11.631.60',
        fator: 1,
        obs: 'Minaplast PT-100 AF 6.21.11.631.01 → estoque .631.60 CX2500',
      },
      {
        cProd: '30155',
        codigo: '6.21.11.659.00',
        fator: 50,
        obs: 'Minaplast PR-26 CX500 = 50× PCT10 (AF 6.21.11.659.00)',
      },
    ],
    inativarLixo: ['11802', '10039', '2035', '30155'],
  },
  {
    cdDono: 2,
    cdNfe: 467,
    numero: '193403',
    itens: [
      {
        cProd: '11822',
        codigo: '6.21.11.155.00',
        fator: 1,
        obs: 'Minaplast CP-300 AF 6.21.11.155.00 CX2000',
      },
      {
        cProd: '4028',
        codigo: '6.21.11.901.40',
        fator: 1,
        obs:
          'Minaplast TP-3000 tampa CX2000 → 6.21.11.901.40. AF Nutriville listava pote .631.40 (preço diferente).',
      },
    ],
    inativarLixo: ['11822', '4028'],
  },
];

async function upsertDepara(client, cdDono, externo, interno, fator, obs) {
  const ex = await client.query(
    `SELECT "CD_DEPARA", "CODIGO_INTERNO", "FATOR_CONVERSAO"
       FROM "WMS_DEPARA_PRODUTO"
      WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2
        AND LOWER(TRIM("CODIGO_EXTERNO"))=LOWER(TRIM($3::text))
      LIMIT 1`,
    [TENANT, cdDono, externo]
  );
  if (ex.rows[0]) {
    await client.query(
      `UPDATE "WMS_DEPARA_PRODUTO"
          SET "CODIGO_INTERNO"=$2, "FATOR_CONVERSAO"=$3, "FGACTIVE"='S',
              "OBSERVACAO"=$4, "DH_MAINTENANCE"=CURRENT_TIMESTAMP, "SG_USER"=$5
        WHERE "CD_DEPARA"=$1`,
      [ex.rows[0].CD_DEPARA, interno, fator, obs, SG]
    );
    console.log(
      `  DE-PARA dono ${cdDono} ${externo}: ${ex.rows[0].CODIGO_INTERNO}×${ex.rows[0].FATOR_CONVERSAO} → ${interno}×${fator}`
    );
    return;
  }
  await client.query(
    `INSERT INTO "WMS_DEPARA_PRODUTO"
       ("TENANT_ID","CD_DONO","CODIGO_EXTERNO","CODIGO_INTERNO","FATOR_CONVERSAO","OBSERVACAO","FGACTIVE","SG_USER")
     VALUES ($1,$2,$3,$4,$5,$6,'S',$7)`,
    [TENANT, cdDono, externo, interno, fator, obs, SG]
  );
  console.log(`  DE-PARA CRIADO dono ${cdDono} ${externo} → ${interno}×${fator}`);
}

async function resolveProduto(client, cdDono, codigo) {
  const p = await client.query(
    `SELECT "CD_PRODUTO","CODIGO","NOME" FROM "WMS_PRODUTO_DONO"
      WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2
        AND LOWER(regexp_replace(TRIM("CODIGO"),'[^0-9A-Za-z]','','g'))
          = LOWER(regexp_replace($3,'[^0-9A-Za-z]','','g'))
      LIMIT 1`,
    [TENANT, cdDono, codigo]
  );
  if (!p.rows[0]) throw new Error(`Produto ausente dono ${cdDono}: ${codigo}`);
  return p.rows[0];
}

async function patchConferencia(client, cdNfe, mapa) {
  const doc = await client.query(
    `SELECT "CD_NFE", "CONFERENCIA_JSON", "ST_RECEBIMENTO"
       FROM "WMS_NFE_ENTRADA" WHERE "CD_NFE"=$1`,
    [cdNfe]
  );
  if (!doc.rows[0]) {
    console.log('  NF', cdNfe, 'não encontrada');
    return;
  }
  let conf = doc.rows[0].CONFERENCIA_JSON;
  if (typeof conf === 'string') conf = JSON.parse(conf);
  const linhas = (conf && (conf.linhas || conf.itens)) || (Array.isArray(conf) ? conf : null);
  if (!linhas || !linhas.length) {
    console.log('  Conferência sem linhas — de-para basta ao recarregar a tela');
    return;
  }
  let n = 0;
  for (const l of linhas) {
    const cProd = String(l.cProd || l.CPROD || '').trim();
    const hit = mapa[cProd];
    if (!hit) continue;
    l.cdProduto = hit.CD_PRODUTO;
    l.codigoProduto = hit.CODIGO;
    l.nmProduto = hit.NOME;
    l.fatorConversao = hit.fator;
    n++;
  }
  const novo = Array.isArray(conf)
    ? linhas
    : conf.linhas
      ? { ...conf, linhas }
      : { ...conf, itens: linhas };
  await client.query(`UPDATE "WMS_NFE_ENTRADA" SET "CONFERENCIA_JSON"=$2::jsonb WHERE "CD_NFE"=$1`, [
    cdNfe,
    JSON.stringify(novo),
  ]);
  console.log(`  Conferência NF ${cdNfe} (${doc.rows[0].ST_RECEBIMENTO}): ${n} linha(s) apontadas`);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const bloco of FIXES) {
      console.log(`\n=== NF ${bloco.numero} dono ${bloco.cdDono} ===`);
      const mapa = {};
      for (const it of bloco.itens) {
        const prod = await resolveProduto(client, bloco.cdDono, it.codigo);
        await upsertDepara(client, bloco.cdDono, it.cProd, it.codigo, it.fator, it.obs);
        mapa[it.cProd] = { ...prod, fator: it.fator };
      }

      if (bloco.inativarLixo && bloco.inativarLixo.length) {
        const r = await client.query(
          `UPDATE "WMS_PRODUTO_DONO"
              SET "FGACTIVE"='N', "DH_MAINTENANCE"=CURRENT_TIMESTAMP, "SG_USER"=$3
            WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2
              AND TRIM("CODIGO") = ANY($4::text[])
            RETURNING "CODIGO"`,
          [TENANT, bloco.cdDono, SG, bloco.inativarLixo]
        );
        r.rows.forEach((x) => console.log('  INATIVADO lixo NF', x.CODIGO));
      }

      await patchConferencia(client, bloco.cdNfe, mapa);
    }

    await client.query('COMMIT');
    console.log('\nOK — recarregue as NFs no Recebimento.');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
