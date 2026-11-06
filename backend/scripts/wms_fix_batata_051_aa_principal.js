'use strict';
/**
 * Mana — Batata palito 9mm 1,5kg: estrutura pela árvore OL
 *
 * Principal (estoque): 6.03.06.051.AA  (PCT 1,5 KG)
 * Derivado (entrada):  60306051AB / CX → AA × 8
 * Saída OPL:           60306051AA → AA × 1
 *
 * Antes: estoque indevido em .AB; OPL AA apontava .AB/.40; NF 93084 conferida no .AB.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const { resolverProdutoEstoque } = require('../services/wms-resolver-codigo-estoque.service');

const TID = 'default';
const CD_DONO = 1;
const SG = 'cursor/fix-batata-051-aa';
const COD_AA = '6.03.06.051.AA';
const COD_AB = '6.03.06.051.AB';
const OP_AA = '60306051AA';
const OP_AB = '60306051AB';
const CPROD_NF = '4170195';
const FATOR_CX_PCT = 8;

async function upsertDepara(client, externo, interno, fator, obs) {
  const ex = await client.query(
    `SELECT "CD_DEPARA", "CODIGO_INTERNO", "FATOR_CONVERSAO"
       FROM "WMS_DEPARA_PRODUTO"
      WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2::integer
        AND LOWER(TRIM("CODIGO_EXTERNO")) = LOWER(TRIM($3::text))
      LIMIT 1`,
    [TID, CD_DONO, externo]
  );
  if (ex.rows[0]) {
    const u = await client.query(
      `UPDATE "WMS_DEPARA_PRODUTO"
          SET "CODIGO_INTERNO"=$3, "FATOR_CONVERSAO"=$4, "OBSERVACAO"=$5,
              "FGACTIVE"='S', "DH_MAINTENANCE"=CURRENT_TIMESTAMP, "SG_USER"=$6
        WHERE "CD_DEPARA"=$1 AND "TENANT_ID"=$2
        RETURNING "CD_DEPARA","CODIGO_EXTERNO","CODIGO_INTERNO","FATOR_CONVERSAO"`,
      [ex.rows[0].CD_DEPARA, TID, interno, fator, obs, SG]
    );
    console.log('DEPARA upd', u.rows[0]);
    return;
  }
  const ins = await client.query(
    `INSERT INTO "WMS_DEPARA_PRODUTO"
       ("TENANT_ID","CD_DONO","CODIGO_EXTERNO","CODIGO_INTERNO","FATOR_CONVERSAO","OBSERVACAO","FGACTIVE","SG_USER")
     VALUES ($1,$2::integer,$3,$4,$5,$6,'S',$7)
     RETURNING "CD_DEPARA","CODIGO_EXTERNO","CODIGO_INTERNO","FATOR_CONVERSAO"`,
    [TID, CD_DONO, externo, interno, fator, obs, SG]
  );
  console.log('DEPARA ins', ins.rows[0]);
}

async function upsertOperacional(client, cdProduto, codOp, codEstoque, unidade, fator) {
  const ex = await client.query(
    `SELECT "CD_OPERACIONAL" FROM "WMS_PRODUTO_OPERACIONAL"
      WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2::integer
        AND upper(regexp_replace(trim("CODIGO_OPERACIONAL"), '[^0-9A-Za-z]', '', 'g'))
          = upper(regexp_replace(trim($3::text), '[^0-9A-Za-z]', '', 'g'))
      LIMIT 1`,
    [TID, CD_DONO, codOp]
  );
  if (ex.rows[0]) {
    const u = await client.query(
      `UPDATE "WMS_PRODUTO_OPERACIONAL"
          SET "CD_PRODUTO"=$3::integer, "CODIGO_OPERACIONAL"=$4, "CODIGO_ESTOQUE"=$5,
              "UNIDADE"=$6, "FATOR_CONVERSAO"=$7, "NIVEL_OL"=5, "FGACTIVE"='S',
              "DH_MAINTENANCE"=CURRENT_TIMESTAMP, "SG_USER"=$8
        WHERE "CD_OPERACIONAL"=$1 AND "TENANT_ID"=$2
        RETURNING "CD_OPERACIONAL","CODIGO_OPERACIONAL","CODIGO_ESTOQUE","UNIDADE","FATOR_CONVERSAO"`,
      [ex.rows[0].CD_OPERACIONAL, TID, cdProduto, codOp, codEstoque, unidade, fator, SG]
    );
    console.log('OPERACIONAL upd', u.rows[0]);
    return;
  }
  const ins = await client.query(
    `INSERT INTO "WMS_PRODUTO_OPERACIONAL"
       ("TENANT_ID","CD_DONO","CD_PRODUTO","CODIGO_OPERACIONAL","CODIGO_ESTOQUE",
        "UNIDADE","FATOR_CONVERSAO","NIVEL_OL","FGACTIVE","SG_USER")
     VALUES ($1,$2::integer,$3::integer,$4,$5,$6,$7,5,'S',$8)
     RETURNING "CD_OPERACIONAL","CODIGO_OPERACIONAL","CODIGO_ESTOQUE","UNIDADE","FATOR_CONVERSAO"`,
    [TID, CD_DONO, cdProduto, codOp, codEstoque, unidade, fator, SG]
  );
  console.log('OPERACIONAL ins', ins.rows[0]);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const ab = await client.query(
      `SELECT * FROM "WMS_PRODUTO_DONO"
        WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2::integer AND "CODIGO"=$3
        LIMIT 1`,
      [TID, CD_DONO, COD_AB]
    );
    if (!ab.rows[0]) throw new Error('Produto .AB não encontrado — abortado');
    const abRow = ab.rows[0];
    console.log('AB atual CD_PRODUTO=', abRow.CD_PRODUTO);

    let aa = await client.query(
      `SELECT * FROM "WMS_PRODUTO_DONO"
        WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2::integer AND "CODIGO"=$3
        LIMIT 1`,
      [TID, CD_DONO, COD_AA]
    );

    let cdAa;
    if (aa.rows[0]) {
      cdAa = Number(aa.rows[0].CD_PRODUTO);
      await client.query(
        `UPDATE "WMS_PRODUTO_DONO"
            SET "NOME" = $3,
                "UNIDADE" = 'PC',
                "PESO_KG" = 1.5,
                "TIPO_ARMAZENAGEM" = 'CONGELADO',
                "CD_CATEGORIA" = COALESCE("CD_CATEGORIA", $4),
                "FG_CONTROLA_LOTE" = COALESCE("FG_CONTROLA_LOTE", $5),
                "FG_CONTROLA_VALIDADE" = 'S',
                "FG_FORNECEDOR_REF" = 'N',
                "FGACTIVE" = 'S',
                "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
                "SG_USER" = $6
          WHERE "CD_PRODUTO" = $1 AND "TENANT_ID" = $2`,
        [
          cdAa,
          TID,
          'BATATA CONG PRE FRITA PALITO 9MM - PCT 1,5 KG',
          abRow.CD_CATEGORIA,
          abRow.FG_CONTROLA_LOTE || 'N',
          SG,
        ]
      );
      console.log('AA já existia — atualizado CD_PRODUTO=', cdAa);
    } else {
      const ins = await client.query(
        `INSERT INTO "WMS_PRODUTO_DONO" (
           "TENANT_ID","CD_DONO","CODIGO","NOME","UNIDADE","CODIGO_BARRAS","NCM",
           "TIPO_ARMAZENAGEM","FG_DESCARTAVEL","FG_CONTROLA_LOTE","FG_CONTROLA_VALIDADE",
           "CD_CATEGORIA","ORIGEM_CADASTRO","FG_FORNECEDOR_REF","PESO_KG","VALOR_REFERENCIA",
           "FGACTIVE","SG_USER"
         ) VALUES (
           $1,$2::integer,$3,$4,'PC',$5,$6,
           'CONGELADO', COALESCE($7,'N'), COALESCE($8,'N'), 'S',
           $9, 'MANUAL', 'N', 1.5, $10,
           'S', $11
         )
         RETURNING "CD_PRODUTO","CODIGO","NOME"`,
        [
          TID,
          CD_DONO,
          COD_AA,
          'BATATA CONG PRE FRITA PALITO 9MM - PCT 1,5 KG',
          abRow.CODIGO_BARRAS || null,
          abRow.NCM || null,
          abRow.FG_DESCARTAVEL,
          abRow.FG_CONTROLA_LOTE,
          abRow.CD_CATEGORIA,
          abRow.VALOR_REFERENCIA,
          SG,
        ]
      );
      cdAa = Number(ins.rows[0].CD_PRODUTO);
      console.log('AA criado', ins.rows[0]);
    }

    // Árvore OL: AA principal ×1, AB derivado ×8
    await upsertOperacional(client, cdAa, OP_AA, COD_AA, 'PC', 1);
    await upsertOperacional(client, cdAa, OP_AB, COD_AA, 'CX', FATOR_CX_PCT);
    await upsertOperacional(client, cdAa, CPROD_NF, COD_AA, 'CX', FATOR_CX_PCT);

    // De-paras
    await upsertDepara(
      client,
      OP_AA,
      COD_AA,
      1,
      'OPL saída PCT → estoque principal .AA'
    );
    await upsertDepara(
      client,
      OP_AB,
      COD_AA,
      FATOR_CX_PCT,
      'Árvore OL: CX .AB → PCT .AA ×8'
    );
    await upsertDepara(
      client,
      COD_AA,
      COD_AA,
      1,
      'Identidade estoque principal .AA'
    );
    await upsertDepara(
      client,
      CPROD_NF,
      COD_AA,
      FATOR_CX_PCT,
      'NF fornecedor CX 8x1,5kg → estoque .AA ×8'
    );
    await upsertDepara(
      client,
      COD_AB,
      COD_AA,
      FATOR_CX_PCT,
      'Código .AB (caixa) → estoque principal .AA ×8'
    );

    // Migrar conferência NF 93084: AB → AA (mantém 3360 PCT)
    const nfe = await client.query(
      `SELECT "CD_NFE", "CONFERENCIA_JSON"
         FROM "WMS_NFE_ENTRADA"
        WHERE "TENANT_ID"=$1 AND "NUMERO_NF"='93084' AND "CD_DONO"=$2::integer
        FOR UPDATE`,
      [TID, CD_DONO]
    );
    if (!nfe.rows[0]) throw new Error('NF 93084 não encontrada');
    const conf = Array.isArray(nfe.rows[0].CONFERENCIA_JSON)
      ? nfe.rows[0].CONFERENCIA_JSON
      : JSON.parse(nfe.rows[0].CONFERENCIA_JSON || '[]');
    let migrated = 0;
    const confNovo = conf.map((el) => {
      if (
        Number(el.cdProduto) === Number(abRow.CD_PRODUTO) ||
        String(el.codigoProduto || '').trim() === COD_AB
      ) {
        migrated += 1;
        return {
          ...el,
          cdProduto: cdAa,
          codigoProduto: COD_AA,
          fatorConversao: FATOR_CX_PCT,
          // qtdConvertida já em PCT (420×8=3360)
        };
      }
      return el;
    });
    if (!migrated) throw new Error('Conferência NF 93084 sem linha .AB — abortado');
    await client.query(
      `UPDATE "WMS_NFE_ENTRADA"
          SET "CONFERENCIA_JSON" = $2::jsonb
        WHERE "CD_NFE" = $1`,
      [nfe.rows[0].CD_NFE, JSON.stringify(confNovo)]
    );
    console.log('NF 93084 conferência migrada', migrated, 'linha(s) → AA', cdAa);

    // Inativar .AB como produto de estoque (padrão árvore: só .AA no dono)
    await client.query(
      `UPDATE "WMS_PRODUTO_DONO"
          SET "FGACTIVE"='N',
              "DH_MAINTENANCE"=CURRENT_TIMESTAMP,
              "SG_USER"=$3
        WHERE "CD_PRODUTO"=$1 AND "TENANT_ID"=$2`,
      [abRow.CD_PRODUTO, TID, SG]
    );
    console.log('AB inativado como estoque CD_PRODUTO=', abRow.CD_PRODUTO);

    // Inativar cadastro lixo do cProd fornecedor (resolve via de-para → AA)
    await client.query(
      `UPDATE "WMS_PRODUTO_DONO"
          SET "FGACTIVE"='N',
              "DH_MAINTENANCE"=CURRENT_TIMESTAMP,
              "SG_USER"=$3
        WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2::integer
          AND TRIM("CODIGO")=$4
          AND COALESCE("FG_FORNECEDOR_REF",'N')='S'`,
      [TID, CD_DONO, SG, CPROD_NF]
    );
    console.log('Fornecedor ref', CPROD_NF, 'inativado (se existia)');

    await client.query('COMMIT');
    console.log('COMMIT OK');

    // Validação pós-commit
    for (const c of [OP_AA, OP_AB, COD_AA, COD_AB, CPROD_NF]) {
      const hit = await resolverProdutoEstoque(pool, TID, CD_DONO, c);
      console.log(
        'resolve',
        c,
        '→',
        hit && {
          codigoEstoque: hit.codigoEstoque,
          fator: hit.fatorConversao,
          origem: hit.origem,
          cdProduto: hit.cdProduto,
        }
      );
    }

    const pos = await pool.query(
      `SELECT elem->>'codigoProduto' AS cod, elem->>'cdProduto' AS cd,
              elem->>'qtdConvertida' AS qtd, elem->>'fatorConversao' AS fat,
              elem->>'lote' AS lote, elem->>'validade' AS val
         FROM "WMS_NFE_ENTRADA" e
         CROSS JOIN LATERAL jsonb_array_elements(e."CONFERENCIA_JSON") elem
        WHERE e."NUMERO_NF"='93084' AND e."TENANT_ID"=$1`,
      [TID]
    );
    console.log('posição via NF:', pos.rows);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
