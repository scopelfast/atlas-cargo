'use strict';

const { pool } = require('../config/db');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function executorOuPool(executor) {
  return executor && typeof executor.query === 'function' ? executor : pool;
}

/**
 * Donos distintos das NF-e vinculadas à carga.
 * @returns {Promise<number[]>}
 */
async function listarDonosDistintosDasNfesCarga(tenantId, cdCarga, executor) {
  const q = executorOuPool(executor);
  try {
    const r = await q.query(
      `SELECT DISTINCT n."CD_DONO"
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
        WHERE j."CD_CARGA" = $1::integer
          AND n."TENANT_ID" = $2
          AND n."CD_DONO" IS NOT NULL`,
      [cdCarga, tenantId]
    );
    return (r.rows || [])
      .map((row) => parseInt(row.CD_DONO, 10))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch (e) {
    if (schemaMissing(e)) return [];
    throw e;
  }
}

/**
 * Se a carga ainda não tem CD_DONO e todas as NF têm o mesmo dono, grava no cabeçalho (expedição/baixa).
 * @returns {Promise<{ updated: boolean, cdDono: number|null, qtdDonos: number }>}
 */
async function sincronizarDonoUnicoNaCargaSeAplicavel(tenantId, cdCarga, executor) {
  const q = executorOuPool(executor);
  let cdDonoCarga = null;
  try {
    const rC = await q.query(
      `SELECT "CD_DONO" FROM "WMS_CARGA_PROGRAMADA"
        WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
      [cdCarga, tenantId]
    );
    if (!rC.rowCount) return { updated: false, cdDono: null, qtdDonos: 0 };
    const raw = rC.rows[0].CD_DONO;
    if (raw != null && Number.isFinite(parseInt(String(raw), 10))) {
      return { updated: false, cdDono: parseInt(String(raw), 10), qtdDonos: 1 };
    }
  } catch (e) {
    if (schemaMissing(e)) return { updated: false, cdDono: null, qtdDonos: 0 };
    throw e;
  }

  const donos = await listarDonosDistintosDasNfesCarga(tenantId, cdCarga, q);
  const uniq = [...new Set(donos)];
  if (uniq.length !== 1) {
    return { updated: false, cdDono: null, qtdDonos: uniq.length };
  }
  cdDonoCarga = uniq[0];
  await q.query(
    `UPDATE "WMS_CARGA_PROGRAMADA"
        SET "CD_DONO" = $3::integer
      WHERE "CD_CARGA" = $1::integer
        AND "TENANT_ID" = $2
        AND "CD_DONO" IS NULL`,
    [cdCarga, tenantId, cdDonoCarga]
  );
  return { updated: true, cdDono: cdDonoCarga, qtdDonos: 1 };
}

module.exports = {
  listarDonosDistintosDasNfesCarga,
  sincronizarDonoUnicoNaCargaSeAplicavel,
};
