'use strict';

const { pool } = require('../config/db');
const { obterStatusCicloOpl } = require('./wms-opl-ciclo-status.service');

function schemaMissing(err) {
  const c = err && (err.code || '');
  return c === '42P01' || c === '42703';
}

/**
 * Corrige picking gravado sem passar por «Salvar picking» na UI (import/bug antigo).
 * NÃO use se o operador grava com campo em branco = conferido igual — isso é fluxo legítimo.
 * Prefira restaurar com wms_restaurar_picking_pos_migracao.js após execução indevida.
 *
 * @param {string} tenantId
 * @param {object} opts
 * @param {string} [opts.desde='2026-05-18'] — só espelhos importados a partir desta data
 * @param {boolean} [opts.dryRun=true]
 * @param {boolean} [opts.removerReservas=true]
 * @param {import('pg').PoolClient} [opts.db]
 */
async function corrigirPickingIndevidoOpl(tenantId, opts = {}) {
  const desde = opts.desde || '2026-05-18';
  const dryRun = opts.dryRun !== false;
  const removerReservas = opts.removerReservas !== false;
  const external = opts.db || null;
  const client = external || (await pool.connect());
  const ownClient = !external;

  const resumo = {
    dryRun,
    desde,
    tenantId,
    espelhosAfetados: 0,
    itensZerados: 0,
    itensPreservadosDivergencia: 0,
    reservasRemovidas: 0,
    espelhosComSaidaExpedicao: 0,
    detalheEspelhos: [],
  };

  try {
    if (ownClient) await client.query('BEGIN');

    const rPrev = await client.query(
      `SELECT a."CD_OPL_ARQUIVO", a."NM_ARQUIVO", a."DH_IMPORT",
              COUNT(i."CD_OPL_ITEM") FILTER (
                WHERE i."QT_COLETADA" IS NOT NULL AND i."QT_COLETADA" = i."QT_PEDIDA"
              )::int AS zerar,
              COUNT(i."CD_OPL_ITEM") FILTER (
                WHERE i."QT_COLETADA" IS NOT NULL AND i."QT_COLETADA" IS DISTINCT FROM i."QT_PEDIDA"
              )::int AS preservar
         FROM "WMS_OPL_ARQUIVO" a
         JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
         JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
        WHERE a."TENANT_ID" = $1
          AND a."DH_IMPORT" >= $2::date
        GROUP BY a."CD_OPL_ARQUIVO", a."NM_ARQUIVO", a."DH_IMPORT"
       HAVING COUNT(i."CD_OPL_ITEM") FILTER (
                WHERE i."QT_COLETADA" IS NOT NULL AND i."QT_COLETADA" = i."QT_PEDIDA"
              ) > 0
        ORDER BY a."CD_OPL_ARQUIVO"`,
      [tenantId, desde]
    );

    for (const row of rPrev.rows) {
      const cdArq = row.CD_OPL_ARQUIVO;
      let ciclo = { expedicaoSaidaConfirmada: false };
      try {
        ciclo = await obterStatusCicloOpl(tenantId, cdArq, client);
      } catch (e) {
        if (!schemaMissing(e)) throw e;
      }
      if (ciclo.expedicaoSaidaConfirmada) resumo.espelhosComSaidaExpedicao += 1;

      resumo.espelhosAfetados += 1;
      resumo.itensZerados += Number(row.zerar) || 0;
      resumo.itensPreservadosDivergencia += Number(row.preservar) || 0;

      let reservasEsp = 0;
      if (removerReservas) {
        const rRes = await client.query(
          `SELECT COUNT(*)::int AS n FROM "WMS_RESERVA_ESTOQUE_OPL"
            WHERE "TENANT_ID" = $1 AND "CD_OPL_ARQUIVO" = $2::integer`,
          [tenantId, cdArq]
        );
        reservasEsp = Number(rRes.rows[0]?.n) || 0;
        resumo.reservasRemovidas += reservasEsp;
        if (!dryRun && reservasEsp > 0) {
          await client.query(
            `DELETE FROM "WMS_RESERVA_ESTOQUE_OPL"
              WHERE "TENANT_ID" = $1 AND "CD_OPL_ARQUIVO" = $2::integer`,
            [tenantId, cdArq]
          );
        }
      }

      if (!dryRun) {
        await client.query(
          `UPDATE "WMS_OPL_ITEM" i
              SET "QT_COLETADA" = NULL
             FROM "WMS_OPL_PEDIDO" p
             JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO" = p."CD_OPL_ARQUIVO"
            WHERE i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
              AND a."TENANT_ID" = $1
              AND a."CD_OPL_ARQUIVO" = $2::integer
              AND i."QT_COLETADA" IS NOT NULL
              AND i."QT_COLETADA" = i."QT_PEDIDA"`,
          [tenantId, cdArq]
        );
      }

      resumo.detalheEspelhos.push({
        CD_OPL_ARQUIVO: cdArq,
        NM_ARQUIVO: row.NM_ARQUIVO,
        DH_IMPORT: row.DH_IMPORT,
        itensZerados: Number(row.zerar) || 0,
        itensDivergenciaPreservados: Number(row.preservar) || 0,
        reservasRemovidas: reservasEsp,
        expedicaoSaidaConfirmada: !!ciclo.expedicaoSaidaConfirmada,
      });
    }

    if (ownClient) {
      if (dryRun) await client.query('ROLLBACK');
      else await client.query('COMMIT');
    }

    return resumo;
  } catch (e) {
    if (ownClient) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
    }
    throw e;
  } finally {
    if (ownClient) client.release();
  }
}

module.exports = { corrigirPickingIndevidoOpl };
