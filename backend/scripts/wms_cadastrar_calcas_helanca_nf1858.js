'use strict';
/**
 * Cadastra calças helanca (AF 0001460768 / NF 1858) no dono Mana
 * e corrige de-para fornecedor (cProd) → código OL.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const { resolveCodigoProdutoDono } = require('../utils/wms-codigo-produto-mask');

const TENANT = process.env.DEFAULT_TENANT_ID || 'default';
const CD_DONO = 1;
const SG = 'script/calcas-helanca-nf1858';
const CD_CATEGORIA = 3671; // UNIFORME MANA ALIMENTACAO

/** Map: cProd NF → código OL (AF CMP05200) */
const ITENS = [
  {
    cProd: '4',
    codigo: '6.52.60.030.00',
    nome: 'CALCA ELANCA PRETA PP - 34 A 36',
    ncm: '61034200',
    qtd: 40,
  },
  {
    cProd: '69',
    codigo: '6.52.60.031.00',
    nome: 'CALCA ELANCA PRETA P - 38 A 40',
    ncm: '63022100',
    qtd: 150,
  },
  {
    cProd: '68',
    codigo: '6.52.60.033.00',
    nome: 'CALCA ELANCA PRETA M - 42',
    ncm: '63022100',
    qtd: 200,
  },
  {
    cProd: '67',
    codigo: '6.52.60.034.00',
    nome: 'CALCA ELANCA PRETA G - 44',
    ncm: '63022100',
    qtd: 200,
  },
  {
    cProd: '66',
    codigo: '6.52.60.035.00',
    nome: 'CALCA ELANCA PRETA EG - 48',
    ncm: '63022100',
    qtd: 50,
  },
  {
    cProd: '65',
    codigo: '6.52.60.036.00',
    nome: 'CALCA ELANCA PRETA GG - 46',
    ncm: '63022100',
    qtd: 150,
  },
  {
    cProd: '64',
    codigo: '6.52.60.037.00',
    nome: 'CALCA ELANCA PRETA XGG - 50',
    ncm: '62023000',
    qtd: 40,
  },
  {
    cProd: '63',
    codigo: '6.52.60.038.00',
    nome: 'CALCA ELANCA PRETA XGGG - 52',
    ncm: '62023000',
    qtd: 50,
  },
];

async function ensureProduto(client, item) {
  const codigo = await resolveCodigoProdutoDono(client, TENANT, CD_DONO, item.codigo);
  const chave = String(codigo).replace(/[^0-9A-Za-z]/g, '').toLowerCase();
  const ex = await client.query(
    `SELECT "CD_PRODUTO", "CODIGO", "NOME", "FGACTIVE"
       FROM "WMS_PRODUTO_DONO"
      WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2
        AND LOWER(regexp_replace(TRIM("CODIGO"), '[^0-9A-Za-z]', '', 'g')) = $3
      LIMIT 1`,
    [TENANT, CD_DONO, chave]
  );
  if (ex.rows[0]) {
    await client.query(
      `UPDATE "WMS_PRODUTO_DONO"
          SET "NOME" = $2,
              "UNIDADE" = 'UN',
              "NCM" = COALESCE($3, "NCM"),
              "TIPO_ARMAZENAGEM" = 'SECO',
              "CD_CATEGORIA" = COALESCE("CD_CATEGORIA", $4),
              "VALOR_REFERENCIA" = COALESCE("VALOR_REFERENCIA", 35),
              "FG_CONTROLA_LOTE" = 'N',
              "FG_CONTROLA_VALIDADE" = 'N',
              "FGACTIVE" = 'S',
              "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
              "SG_USER" = $5
        WHERE "CD_PRODUTO" = $1`,
      [ex.rows[0].CD_PRODUTO, item.nome, item.ncm, CD_CATEGORIA, SG]
    );
    console.log('ATUALIZADO', codigo, '→', item.nome, '(CD_PRODUTO', ex.rows[0].CD_PRODUTO + ')');
    return { cdProduto: ex.rows[0].CD_PRODUTO, codigo };
  }

  const ins = await client.query(
    `INSERT INTO "WMS_PRODUTO_DONO" (
       "TENANT_ID", "CD_DONO", "CODIGO", "NOME", "UNIDADE", "NCM",
       "TIPO_ARMAZENAGEM", "CD_CATEGORIA", "ORIGEM_CADASTRO", "FG_FORNECEDOR_REF",
       "FG_DESCARTAVEL", "FG_CONTROLA_LOTE", "FG_CONTROLA_VALIDADE",
       "VALOR_REFERENCIA", "FGACTIVE", "SG_USER"
     ) VALUES (
       $1, $2, $3, $4, 'UN', $5,
       'SECO', $6, 'MANUAL', 'N',
       'N', 'N', 'N',
       35, 'S', $7
     )
     RETURNING "CD_PRODUTO", "CODIGO"`,
    [TENANT, CD_DONO, codigo, item.nome, item.ncm, CD_CATEGORIA, SG]
  );
  console.log('CRIADO', ins.rows[0].CODIGO, '→', item.nome, '(CD_PRODUTO', ins.rows[0].CD_PRODUTO + ')');
  return { cdProduto: ins.rows[0].CD_PRODUTO, codigo: ins.rows[0].CODIGO };
}

async function upsertDepara(client, cProd, codigoInterno) {
  const interno = await resolveCodigoProdutoDono(client, TENANT, CD_DONO, codigoInterno);
  const ex = await client.query(
    `SELECT "CD_DEPARA", "CODIGO_INTERNO", "FATOR_CONVERSAO"
       FROM "WMS_DEPARA_PRODUTO"
      WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2
        AND LOWER(TRIM("CODIGO_EXTERNO")) = LOWER(TRIM($3::text))
      LIMIT 1`,
    [TENANT, CD_DONO, cProd]
  );
  if (ex.rows[0]) {
    await client.query(
      `UPDATE "WMS_DEPARA_PRODUTO"
          SET "CODIGO_INTERNO" = $2,
              "FATOR_CONVERSAO" = 1,
              "OBSERVACAO" = $3,
              "FGACTIVE" = 'S',
              "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
              "SG_USER" = $4
        WHERE "CD_DEPARA" = $1`,
      [
        ex.rows[0].CD_DEPARA,
        interno,
        `NF Susane Kurten / AF 0001460768 → ${interno}`,
        SG,
      ]
    );
    console.log(
      'DE-PARA CORRIGIDO',
      cProd,
      ex.rows[0].CODIGO_INTERNO,
      '→',
      interno,
      '(era ×' + ex.rows[0].FATOR_CONVERSAO + ')'
    );
    return;
  }
  await client.query(
    `INSERT INTO "WMS_DEPARA_PRODUTO"
       ("TENANT_ID","CD_DONO","CODIGO_EXTERNO","CODIGO_INTERNO","FATOR_CONVERSAO","OBSERVACAO","FGACTIVE","SG_USER")
     VALUES ($1,$2,$3,$4,1,$5,'S',$6)`,
    [TENANT, CD_DONO, cProd, interno, `NF Susane Kurten / AF 0001460768 → ${interno}`, SG]
  );
  console.log('DE-PARA CRIADO', cProd, '→', interno, '×1');
}

async function inativarCadastrosLixoFornecedor(client) {
  const lixo = ITENS.map((i) => i.cProd);
  const r = await client.query(
    `UPDATE "WMS_PRODUTO_DONO"
        SET "FGACTIVE" = 'N',
            "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
            "SG_USER" = $3
      WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2
        AND TRIM("CODIGO") = ANY($4::text[])
        AND UPPER("NOME") LIKE '%CALCA%HELANCA%'
      RETURNING "CD_PRODUTO", "CODIGO", "NOME"`,
    [TENANT, CD_DONO, SG, lixo]
  );
  for (const row of r.rows) {
    console.log('INATIVADO cadastro lixo (cód. fornecedor):', row.CODIGO, row.NOME);
  }
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const item of ITENS) {
      await ensureProduto(client, item);
      await upsertDepara(client, item.cProd, item.codigo);
    }
    await inativarCadastrosLixoFornecedor(client);
    await client.query('COMMIT');

    const check = await pool.query(
      `SELECT p."CODIGO", p."NOME", d."CODIGO_EXTERNO", d."FATOR_CONVERSAO"
         FROM "WMS_PRODUTO_DONO" p
         LEFT JOIN "WMS_DEPARA_PRODUTO" d
           ON d."TENANT_ID" = p."TENANT_ID" AND d."CD_DONO" = p."CD_DONO"
          AND LOWER(TRIM(d."CODIGO_INTERNO")) = LOWER(TRIM(p."CODIGO"))
          AND d."FGACTIVE" = 'S'
        WHERE p."TENANT_ID" = $1 AND p."CD_DONO" = $2
          AND p."CODIGO" LIKE '6.52.60.03%'
        ORDER BY p."CODIGO", d."CODIGO_EXTERNO"`,
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
