'use strict';
/**
 * Corrige de-para errado café 40g e re-sincroniza ledger da carga 199.
 *
 * Antes: 6030303080 → 6.03.03.030.40 (PCT 500G)  ← ERRADO
 * Depois: 6030303080 → 6.03.03.030.80 (SACHE 40G) ← CORRETO
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const {
  sincronizarMovimentosExpedicaoSaidaCarga,
} = require('../services/wms-movimento-estoque.service');

const TID = 'default';
const CD_DONO = 2;
const EXTERNO = '6030303080';
const INTERNO_OK = '6.03.03.030.80';
const INTERNO_ERRADO = '6.03.03.030.40';
const CD_CARGA = 199;

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const rDep = await client.query(
      `SELECT "CD_DEPARA", "CODIGO_EXTERNO", "CODIGO_INTERNO", "FGACTIVE"
         FROM "WMS_DEPARA_PRODUTO"
        WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer
          AND LOWER(TRIM("CODIGO_EXTERNO")) = LOWER(TRIM($3::text))`,
      [TID, CD_DONO, EXTERNO]
    );
    console.log('De-para atual:', rDep.rows);

    if (rDep.rowCount) {
      const upd = await client.query(
        `UPDATE "WMS_DEPARA_PRODUTO"
            SET "CODIGO_INTERNO" = $4,
                "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
                "FGACTIVE" = 'S'
          WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer
            AND LOWER(TRIM("CODIGO_EXTERNO")) = LOWER(TRIM($3::text))
            AND LOWER(TRIM("CODIGO_INTERNO")) = LOWER(TRIM($5::text))
        RETURNING "CD_DEPARA", "CODIGO_EXTERNO", "CODIGO_INTERNO"`,
        [TID, CD_DONO, EXTERNO, INTERNO_OK, INTERNO_ERRADO]
      );
      console.log('De-para corrigido:', upd.rows);
      if (!upd.rowCount) {
        await client.query(
          `UPDATE "WMS_DEPARA_PRODUTO"
              SET "CODIGO_INTERNO" = $4,
                  "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
                  "FGACTIVE" = 'S'
            WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer
              AND LOWER(TRIM("CODIGO_EXTERNO")) = LOWER(TRIM($3::text))`,
          [TID, CD_DONO, EXTERNO, INTERNO_OK]
        );
        console.log('De-para forçado para', INTERNO_OK);
      }
    } else {
      await client.query(
        `INSERT INTO "WMS_DEPARA_PRODUTO"
          ("TENANT_ID", "CD_DONO", "CODIGO_EXTERNO", "CODIGO_INTERNO", "FATOR_CONVERSAO", "FGACTIVE")
         VALUES ($1, $2::integer, $3, $4, 1, 'S')`,
        [TID, CD_DONO, EXTERNO, INTERNO_OK]
      );
      console.log('De-para inserido');
    }

    const prod80 = await client.query(
      `SELECT "CD_PRODUTO" FROM "WMS_PRODUTO_DONO"
        WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer
          AND LOWER(TRIM("CODIGO")) = LOWER(TRIM($3::text))
        LIMIT 1`,
      [TID, CD_DONO, INTERNO_OK]
    );
    const cd80 = prod80.rows[0] && parseInt(prod80.rows[0].CD_PRODUTO, 10);
    if (Number.isFinite(cd80)) {
      const op = await client.query(
        `SELECT 1 FROM "WMS_PRODUTO_OPERACIONAL"
          WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer
            AND regexp_replace(LOWER(TRIM("CODIGO_OPERACIONAL")), '[^0-9a-z]', '', 'g') = $3
          LIMIT 1`,
        [TID, CD_DONO, '6030303080']
      );
      if (!op.rowCount) {
        await client.query(
          `INSERT INTO "WMS_PRODUTO_OPERACIONAL"
            ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "CODIGO_OPERACIONAL", "CODIGO_ESTOQUE",
             "UNIDADE", "FATOR_CONVERSAO", "FGACTIVE")
           VALUES ($1, $2::integer, $3::integer, $4, $5, 'UN', 1, 'S')`,
          [TID, CD_DONO, cd80, EXTERNO, INTERNO_OK]
        );
        console.log('Operacional 6030303080 → .80 criado (cdProduto', cd80, ')');
      } else {
        console.log('Operacional 6030303080 já existe');
      }
    }

    /** Estorna saída indevida no .40 (PCT 500G) na carga 199 */
    const prod40 = await client.query(
      `SELECT "CD_PRODUTO" FROM "WMS_PRODUTO_DONO"
        WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer
          AND LOWER(TRIM("CODIGO")) = LOWER(TRIM($3::text))
        LIMIT 1`,
      [TID, CD_DONO, INTERNO_ERRADO]
    );
    const cd40 = prod40.rows[0] && parseInt(prod40.rows[0].CD_PRODUTO, 10);
    if (Number.isFinite(cd40)) {
      const net = await client.query(
        `SELECT COALESCE(SUM("QTD"),0)::numeric AS net
           FROM "WMS_MOVIMENTO_ESTOQUE"
          WHERE "TENANT_ID" = $1 AND "REF_CD_CARGA" = $2::integer
            AND "CD_DONO" = $3::integer AND "CD_PRODUTO" = $4::integer
            AND "TP_MOVIMENTO" IN ('EXPEDICAO_SAIDA','EXPEDICAO_ESTORNO')`,
        [TID, CD_CARGA, CD_DONO, cd40]
      );
      const netVal = Number(net.rows[0].net) || 0;
      console.log('Net ledger .40 na carga', CD_CARGA, '=', netVal);
      if (netVal < -1e-9) {
        const estorno = Math.abs(netVal);
        await client.query(
          `INSERT INTO "WMS_MOVIMENTO_ESTOQUE"
            ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "QTD", "TP_MOVIMENTO",
             "REF_CD_CARGA", "IDEMPOTENCY_KEY", "SG_USER")
           VALUES ($1, $2::integer, $3::integer, $4::numeric, 'EXPEDICAO_ESTORNO',
                   $5::integer, $6, 'admin')
           ON CONFLICT ("TENANT_ID", "IDEMPOTENCY_KEY") DO NOTHING`,
          [
            TID,
            CD_DONO,
            cd40,
            estorno,
            CD_CARGA,
            `EXP_ESTORNO|CA${CD_CARGA}|D${CD_DONO}|P${cd40}|FIX_CAFE80`,
          ]
        );
        console.log('Estorno .40 aplicado:', estorno);
      }
    }

    await client.query('COMMIT');

    const sync = await sincronizarMovimentosExpedicaoSaidaCarga(pool, TID, CD_CARGA, 'admin', {});
    console.log('Sync ledger carga', CD_CARGA, sync);

    const check = await pool.query(
      `SELECT m."TP_MOVIMENTO", p."CODIGO", p."NOME", m."QTD", m."IDEMPOTENCY_KEY"
         FROM "WMS_MOVIMENTO_ESTOQUE" m
         JOIN "WMS_PRODUTO_DONO" p
           ON p."CD_PRODUTO" = m."CD_PRODUTO" AND p."TENANT_ID" = m."TENANT_ID"
        WHERE m."TENANT_ID" = $1 AND m."REF_CD_CARGA" = $2::integer
          AND (p."CODIGO" ILIKE '%03.03.030%')
        ORDER BY m."CD_MOVIMENTO"`,
      [TID, CD_CARGA]
    );
    console.log('=== Movimentos café após correção ===');
    check.rows.forEach((r) => console.log(JSON.stringify(r)));
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
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
