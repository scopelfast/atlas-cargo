'use strict';
/**
 * Reprocessa saídas batata 051: de-para certo + estorno .40 + sync no .AA
 *
 * Contexto: NFs 29543…29577 (cProd 60306051AA) baixaram em 6.03.06.051.40
 * por de-para errado; inv. 245 zerou o .40. ERP Mana já está no .AA (3025).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const {
  sincronizarMovimentosExpedicaoSaidaCarga,
} = require('../services/wms-movimento-estoque.service');
const { listarPosicaoEstoque } = require('../services/wms-relatorio-posicao-estoque.service');

const TID = 'default';
const CD_DONO = 1;
const SG = 'cursor/reprocess-batata-aa';
const COD_AA = '6.03.06.051.AA';
const COD_40 = '6.03.06.051.40';
const OP_AA = '60306051AA';
const CARGAS = [698, 701, 702, 703, 704, 705, 706];
const NFS = [
  '29543', '29544', '29545', '29547', '29551', '29555',
  '29560', '29561', '29566', '29568', '29574', '29577',
];

async function saldoProduto(client, cdProduto) {
  const r = await client.query(
    `SELECT COALESCE(SUM("QTD"),0)::numeric AS s
       FROM "WMS_MOVIMENTO_ESTOQUE"
      WHERE "TENANT_ID"=$1 AND "CD_PRODUTO"=$2`,
    [TID, cdProduto]
  );
  return Number(r.rows[0].s) || 0;
}

async function entradaConf(client, cdProduto) {
  const r = await client.query(
    `SELECT COALESCE(SUM((elem->>'qtdConvertida')::numeric),0)::numeric AS s
       FROM "WMS_NFE_ENTRADA" e
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON",'[]'::jsonb)) elem
      WHERE e."TENANT_ID"=$1 AND e."CD_DONO"=$2::integer
        AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO",''))) = 'ENCERRADA'
        AND (elem->>'cdProduto') ~ '^[0-9]+$'
        AND (elem->>'cdProduto')::int = $3`,
    [TID, CD_DONO, cdProduto]
  );
  return Number(r.rows[0].s) || 0;
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) De-para OPL → AA
    const dep = await client.query(
      `UPDATE "WMS_DEPARA_PRODUTO"
          SET "CODIGO_INTERNO" = $4,
              "FATOR_CONVERSAO" = 1,
              "OBSERVACAO" = $5,
              "FGACTIVE" = 'S',
              "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
              "SG_USER" = $6
        WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer
          AND LOWER(TRIM("CODIGO_EXTERNO")) = LOWER(TRIM($3::text))
        RETURNING "CD_DEPARA","CODIGO_EXTERNO","CODIGO_INTERNO","FATOR_CONVERSAO"`,
      [
        TID,
        CD_DONO,
        OP_AA,
        COD_AA,
        'Reprocesso: OPL PCT → estoque principal .AA (não .40)',
        SG,
      ]
    );
    if (!dep.rowCount) {
      await client.query(
        `INSERT INTO "WMS_DEPARA_PRODUTO"
           ("TENANT_ID","CD_DONO","CODIGO_EXTERNO","CODIGO_INTERNO","FATOR_CONVERSAO","OBSERVACAO","FGACTIVE","SG_USER")
         VALUES ($1,$2::integer,$3,$4,1,$5,'S',$6)`,
        [TID, CD_DONO, OP_AA, COD_AA, 'Reprocesso: OPL PCT → .AA', SG]
      );
      console.log('DEPARA criado', OP_AA, '→', COD_AA);
    } else {
      console.log('DEPARA', dep.rows[0]);
    }

    const pAa = await client.query(
      `SELECT "CD_PRODUTO" FROM "WMS_PRODUTO_DONO"
        WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2::integer AND "CODIGO"=$3 AND "FGACTIVE"='S'`,
      [TID, CD_DONO, COD_AA]
    );
    const p40 = await client.query(
      `SELECT "CD_PRODUTO" FROM "WMS_PRODUTO_DONO"
        WHERE "TENANT_ID"=$1 AND "CD_DONO"=$2::integer AND "CODIGO"=$3`,
      [TID, CD_DONO, COD_40]
    );
    const cdAa = Number(pAa.rows[0] && pAa.rows[0].CD_PRODUTO);
    const cd40 = Number(p40.rows[0] && p40.rows[0].CD_PRODUTO);
    if (!Number.isFinite(cdAa) || !Number.isFinite(cd40)) {
      throw new Error('CD_PRODUTO AA/40 não encontrados');
    }
    console.log({ cdAa, cd40 });
    console.log('ANTES ledger AA', await saldoProduto(client, cdAa), 'ledger .40', await saldoProduto(client, cd40));
    console.log('ANTES entrada conf AA (só ENCERRADA)', await entradaConf(client, cdAa));

    // 2) Estornar SOMENTE o net de expedição do .40 por carga (não mexe em outros SKUs)
    for (const cdCarga of CARGAS) {
      const before = await client.query(
        `SELECT COALESCE(SUM("QTD"),0)::numeric AS net
           FROM "WMS_MOVIMENTO_ESTOQUE"
          WHERE "TENANT_ID"=$1 AND "REF_CD_CARGA"=$2::integer AND "CD_DONO"=$3::integer
            AND "CD_PRODUTO"=$4::integer
            AND "TP_MOVIMENTO" IN ('EXPEDICAO_SAIDA','EXPEDICAO_ESTORNO')`,
        [TID, cdCarga, CD_DONO, cd40]
      );
      const net = Number(before.rows[0].net) || 0;
      if (net >= -1e-9) {
        console.log('carga', cdCarga, 'net .40 já ok', net);
        continue;
      }
      const estornoQtd = Math.abs(net);
      const seqR = await client.query(
        `SELECT COUNT(*)::int AS c FROM "WMS_MOVIMENTO_ESTOQUE"
          WHERE "TENANT_ID"=$1 AND "REF_CD_CARGA"=$2::integer AND "CD_DONO"=$3::integer
            AND "CD_PRODUTO"=$4::integer AND "TP_MOVIMENTO"='EXPEDICAO_ESTORNO'`,
        [TID, cdCarga, CD_DONO, cd40]
      );
      const seq = (Number(seqR.rows[0].c) || 0) + 1;
      const key = `EXP_ESTORNO|CA${cdCarga}|D${CD_DONO}|P${cd40}|N${seq}|FIX_AA`;
      const ins = await client.query(
        `INSERT INTO "WMS_MOVIMENTO_ESTOQUE"
           ("TENANT_ID","CD_DONO","CD_PRODUTO","QTD","TP_MOVIMENTO","REF_CD_CARGA","IDEMPOTENCY_KEY","SG_USER")
         VALUES ($1,$2::integer,$3::integer,$4::numeric,'EXPEDICAO_ESTORNO',$5::integer,$6,$7)
         ON CONFLICT ("TENANT_ID","IDEMPOTENCY_KEY") DO NOTHING
         RETURNING "CD_MOVIMENTO","QTD"`,
        [TID, CD_DONO, cd40, estornoQtd, cdCarga, key.slice(0, 128), SG]
      );
      console.log('carga', cdCarga, 'net .40 era', net, 'estorno', ins.rows[0] || 'já existia');
    }

    // 3) Reverter inventário #245 no .40 (+335 → -335 compensatório)
    const inv = await client.query(
      `SELECT "CD_MOVIMENTO","QTD","IDEMPOTENCY_KEY"
         FROM "WMS_MOVIMENTO_ESTOQUE"
        WHERE "TENANT_ID"=$1 AND "CD_PRODUTO"=$2::integer
          AND "IDEMPOTENCY_KEY" = 'INV_AJUSTE|I245|P7109'`,
      [TID, cd40]
    );
    if (inv.rows[0] && Number(inv.rows[0].QTD) > 0) {
      const q = Number(inv.rows[0].QTD);
      const key = 'INV_AJUSTE|I245|P7109|REVERT_PARA_AA';
      const ins = await client.query(
        `INSERT INTO "WMS_MOVIMENTO_ESTOQUE"
           ("TENANT_ID","CD_DONO","CD_PRODUTO","QTD","TP_MOVIMENTO","IDEMPOTENCY_KEY","SG_USER")
         VALUES ($1,$2::integer,$3::integer,$4::numeric,'INVENTARIO_AJUSTE',$5,$6)
         ON CONFLICT ("TENANT_ID","IDEMPOTENCY_KEY") DO NOTHING
         RETURNING "CD_MOVIMENTO","QTD"`,
        [TID, CD_DONO, cd40, -q, key, SG]
      );
      console.log('Revert inv 245 .40:', ins.rows[0] || 'já existia');
    } else {
      console.log('Inv 245 não encontrado ou já tratado', inv.rows[0]);
    }

    // 4) Reencerrar NF 93084 (entrada AA) se REABERTA
    const nfe = await client.query(
      `UPDATE "WMS_NFE_ENTRADA"
          SET "ST_RECEBIMENTO" = 'ENCERRADA',
              "DH_ENCERRAMENTO" = COALESCE("DH_ENCERRAMENTO", CURRENT_TIMESTAMP),
              "SG_USER_ENCERRAMENTO" = COALESCE("SG_USER_ENCERRAMENTO", $2)
        WHERE "TENANT_ID" = $1 AND "NUMERO_NF" = '93084' AND "CD_DONO" = $3::integer
          AND UPPER(TRIM(COALESCE("ST_RECEBIMENTO",''))) = 'REABERTA'
        RETURNING "CD_NFE","ST_RECEBIMENTO","CONFERENCIA_JSON"`,
      [TID, SG, CD_DONO]
    );
    if (nfe.rowCount) {
      console.log('NF 93084 reencerrada', {
        conf: nfe.rows[0].CONFERENCIA_JSON,
      });
    } else {
      const cur = await client.query(
        `SELECT "ST_RECEBIMENTO", "CONFERENCIA_JSON" FROM "WMS_NFE_ENTRADA"
          WHERE "TENANT_ID"=$1 AND "NUMERO_NF"='93084'`,
        [TID]
      );
      console.log('NF 93084 status atual', cur.rows[0] && cur.rows[0].ST_RECEBIMENTO);
    }

    // 5) Sync expedição → deve gravar saídas no AA
    for (const cdCarga of CARGAS) {
      const sync = await sincronizarMovimentosExpedicaoSaidaCarga(client, TID, cdCarga, SG, {});
      console.log('sync carga', cdCarga, sync);
    }

    await client.query('COMMIT');
    console.log('COMMIT OK');

    // 6) Validação
    const ledgerAa = await saldoProduto(pool, cdAa);
    const ledger40 = await saldoProduto(pool, cd40);
    const entAa = await entradaConf(pool, cdAa);
    const posAa = entAa + ledgerAa;
    console.log('\n=== VALIDAÇÃO ===');
    console.log({
      entradaConfAA: entAa,
      ledgerAA: ledgerAa,
      posicaoAA: posAa,
      esperadoERP: 3025,
      ledger40: ledger40,
      nfs: NFS.length,
    });

    const movAa = await pool.query(
      `SELECT m."TP_MOVIMENTO", m."QTD", m."REF_CD_CARGA", m."IDEMPOTENCY_KEY", m."DH_REGISTRO"
         FROM "WMS_MOVIMENTO_ESTOQUE" m
        WHERE m."TENANT_ID"=$1 AND m."CD_PRODUTO"=$2
        ORDER BY m."DH_REGISTRO", m."CD_MOVIMENTO"`,
      [TID, cdAa]
    );
    console.log('movimentos AA:', JSON.stringify(movAa.rows, null, 2));

    const mov40hoje = await pool.query(
      `SELECT m."TP_MOVIMENTO", m."QTD", m."REF_CD_CARGA", m."IDEMPOTENCY_KEY"
         FROM "WMS_MOVIMENTO_ESTOQUE" m
        WHERE m."TENANT_ID"=$1 AND m."CD_PRODUTO"=$2
          AND m."DH_REGISTRO" >= '2026-11-05'
        ORDER BY m."DH_REGISTRO", m."CD_MOVIMENTO"`,
      [TID, cd40]
    );
    console.log('movimentos .40 hoje:', JSON.stringify(mov40hoje.rows, null, 2));

    const pos = await listarPosicaoEstoque(TID, CD_DONO);
    const hits = (pos.linhas || []).filter((l) => {
      const c = String(l.CODIGO || l.codigo || '');
      return c.includes('6.03.06.051.AA') || c.includes('6.03.06.051.40');
    });
    console.log(
      'posição relatório:',
      hits.map((h) => ({
        codigo: h.CODIGO || h.codigo,
        saldo: h.saldo ?? h.SALDO ?? h.saldoSku ?? h.qtdSaldo,
        entrada: h.entrada ?? h.qtdEntrada,
        saidas: h.saidas,
      }))
    );

    if (Math.abs(posAa - 3025) > 0.01) {
      console.error('ALERTA: posição AA != 3025 (ERP). Diferença:', posAa - 3025);
      process.exitCode = 2;
    } else {
      console.log('OK: posição AA alinhada ao ERP (3025).');
    }
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
