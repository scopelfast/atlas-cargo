'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const { resolveCodigoProdutoDono } = require('../utils/wms-codigo-produto-mask');

const TENANT = 'default';
const CD_DONO = 1;
const SG = 'script/plasfort-nf27047';

const FIXES = [
  {
    cProd: '254',
    codigo: '6.21.11.775.00',
    nome: 'SACO LIXO 150L 90X100 MARROM 0,08 MICRAS - 100 UN',
    ncm: '39232190',
    valorRef: 59.9,
    createIfMissing: false, // já existe
  },
  {
    cProd: '164',
    codigo: '6.21.11.699.00',
    nome: 'SACO LIXO 200L 90X115 VERME 0,08 MICRAS -PCT 100UN',
    ncm: '39232910',
    valorRef: 69,
    createIfMissing: true,
  },
];

async function ensureProduto(client, item) {
  const codigo = await resolveCodigoProdutoDono(client, TENANT, CD_DONO, item.codigo);
  const chave = String(codigo).replace(/[^0-9A-Za-z]/g, '').toLowerCase();
  const ex = await client.query(
    `SELECT "CD_PRODUTO", "CODIGO", "NOME"
       FROM "WMS_PRODUTO_DONO"
      WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2
        AND LOWER(regexp_replace(TRIM("CODIGO"), '[^0-9A-Za-z]', '', 'g'))=$3
      LIMIT 1`,
    [TENANT, CD_DONO, chave]
  );
  if (ex.rows[0]) {
    console.log('OK produto', ex.rows[0].CODIGO, ex.rows[0].NOME);
    return ex.rows[0].CODIGO;
  }
  if (!item.createIfMissing) {
    throw new Error('Produto não encontrado: ' + item.codigo);
  }

  // categoria dos sacos vizinhos (775)
  const cat = await client.query(
    `SELECT "CD_CATEGORIA" FROM "WMS_PRODUTO_DONO"
      WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2 AND "CODIGO"='6.21.11.775.00' LIMIT 1`,
    [TENANT, CD_DONO]
  );
  const cdCat = cat.rows[0] ? cat.rows[0].CD_CATEGORIA : null;

  const ins = await client.query(
    `INSERT INTO "WMS_PRODUTO_DONO" (
       "TENANT_ID","CD_DONO","CODIGO","NOME","UNIDADE","NCM",
       "TIPO_ARMAZENAGEM","CD_CATEGORIA","ORIGEM_CADASTRO","FG_FORNECEDOR_REF",
       "FG_DESCARTAVEL","FG_CONTROLA_LOTE","FG_CONTROLA_VALIDADE",
       "VALOR_REFERENCIA","FGACTIVE","SG_USER"
     ) VALUES (
       $1,$2,$3,$4,'PC',$5,
       'SECO',$6,'MANUAL','N',
       'N','N','N',
       $7,'S',$8
     ) RETURNING "CD_PRODUTO","CODIGO","NOME"`,
    [TENANT, CD_DONO, codigo, item.nome, item.ncm, cdCat, item.valorRef, SG]
  );
  console.log('CRIADO', ins.rows[0].CODIGO, ins.rows[0].NOME);
  return ins.rows[0].CODIGO;
}

async function upsertDepara(client, cProd, interno) {
  const codigo = await resolveCodigoProdutoDono(client, TENANT, CD_DONO, interno);
  const ex = await client.query(
    `SELECT "CD_DEPARA","CODIGO_INTERNO" FROM "WMS_DEPARA_PRODUTO"
      WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2
        AND LOWER(TRIM("CODIGO_EXTERNO"))=LOWER(TRIM($3::text)) LIMIT 1`,
    [TENANT, CD_DONO, cProd]
  );
  if (ex.rows[0]) {
    await client.query(
      `UPDATE "WMS_DEPARA_PRODUTO"
          SET "CODIGO_INTERNO"=$2, "FATOR_CONVERSAO"=1, "FGACTIVE"='S',
              "OBSERVACAO"=$3, "DH_MAINTENANCE"=CURRENT_TIMESTAMP, "SG_USER"=$4
        WHERE "CD_DEPARA"=$1`,
      [ex.rows[0].CD_DEPARA, codigo, `Plasfort NF 27047 / OL Mana → ${codigo}`, SG]
    );
    console.log('DE-PARA CORRIGIDO', cProd, ex.rows[0].CODIGO_INTERNO, '→', codigo);
    return;
  }
  await client.query(
    `INSERT INTO "WMS_DEPARA_PRODUTO"
       ("TENANT_ID","CD_DONO","CODIGO_EXTERNO","CODIGO_INTERNO","FATOR_CONVERSAO","OBSERVACAO","FGACTIVE","SG_USER")
     VALUES ($1,$2,$3,$4,1,$5,'S',$6)`,
    [TENANT, CD_DONO, cProd, codigo, `Plasfort NF 27047 / OL Mana → ${codigo}`, SG]
  );
  console.log('DE-PARA CRIADO', cProd, '→', codigo);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of FIXES) {
      await ensureProduto(client, item);
      await upsertDepara(client, item.cProd, item.codigo);
    }
    // inativar cadastros lixo com código do fornecedor
    const inat = await client.query(
      `UPDATE "WMS_PRODUTO_DONO"
          SET "FGACTIVE"='N', "DH_MAINTENANCE"=CURRENT_TIMESTAMP, "SG_USER"=$3
        WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2
          AND TRIM("CODIGO") IN ('254','164')
          AND UPPER("NOME") LIKE '%SACO%LIXO%'
        RETURNING "CODIGO","NOME"`,
      [TENANT, CD_DONO, SG]
    );
    for (const r of inat.rows) console.log('INATIVADO lixo', r.CODIGO, r.NOME);

    // também checar se 699 existe no operacional espelho
    await client.query('COMMIT');

    const check = await pool.query(
      `SELECT d."CODIGO_EXTERNO", d."CODIGO_INTERNO", d."FATOR_CONVERSAO", p."NOME"
         FROM "WMS_DEPARA_PRODUTO" d
         JOIN "WMS_PRODUTO_DONO" p
           ON p."TENANT_ID"=d."TENANT_ID" AND p."CD_DONO"=d."CD_DONO"
          AND LOWER(TRIM(p."CODIGO"))=LOWER(TRIM(d."CODIGO_INTERNO"))
        WHERE d."TENANT_ID"=$1 AND d."CD_DONO"=$2
          AND d."CODIGO_EXTERNO" IN ('254','164')
        ORDER BY d."CODIGO_EXTERNO"`,
      [TENANT, CD_DONO]
    );
    console.log('\nRESULTADO:');
    console.table(check.rows);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

main();
