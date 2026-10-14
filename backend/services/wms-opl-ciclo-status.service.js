'use strict';

const { pool } = require('../config/db');

function schemaMissing(err) {
  const c = err && (err.code || '');
  return c === '42P01' || c === '42703';
}

/**
 * Situação do ciclo estoque ↔ picking ↔ expedição para um espelho OPL.
 * @returns {Promise<{ expedicaoSaidaConfirmada: boolean, dhSaidaExpedicao: string|null, cdCargaExpedicao: number|null, qtdMovimentosSaida: number }>}
 */
async function obterStatusCicloOpl(tenantId, cdOplArquivo, executor) {
  const db = executor || pool;
  try {
    const r = await db.query(
      `SELECT COUNT(*)::int AS n,
              MAX("DH_REGISTRO") AS dh_saida,
              MAX("REF_CD_CARGA")::integer AS cd_carga
         FROM "WMS_MOVIMENTO_ESTOQUE"
        WHERE "TENANT_ID" = $1
          AND "REF_CD_OPL_ARQUIVO" = $2::integer
          AND "TP_MOVIMENTO" = 'EXPEDICAO_SAIDA'`,
      [tenantId, cdOplArquivo]
    );
    const n = Number(r.rows[0]?.n) || 0;
    return {
      expedicaoSaidaConfirmada: n > 0,
      dhSaidaExpedicao: r.rows[0]?.dh_saida || null,
      cdCargaExpedicao: r.rows[0]?.cd_carga != null ? Number(r.rows[0].cd_carga) : null,
      qtdMovimentosSaida: n,
    };
  } catch (e) {
    if (schemaMissing(e)) {
      return {
        expedicaoSaidaConfirmada: false,
        dhSaidaExpedicao: null,
        cdCargaExpedicao: null,
        qtdMovimentosSaida: 0,
      };
    }
    throw e;
  }
}

module.exports = { obterStatusCicloOpl };
