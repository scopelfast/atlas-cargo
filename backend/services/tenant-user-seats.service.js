'use strict';

const { getDefaultTenantId } = require('../middleware/tenant.middleware');

function normalizeTenantKey(tenantId) {
  const def = getDefaultTenantId();
  if (tenantId == null || String(tenantId).trim() === '') return def;
  return String(tenantId).trim();
}

/**
 * Limite efetivo de usuários ativos (assentos). NULL = ilimitado.
 * Exige linha em SAAS_CLIENTE_CONTRATANTE; sem linha → ilimitado.
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 * @returns {Promise<number|null>}
 */
async function getEffectiveMaxUserSeats(pool, tenantId) {
  const tid = normalizeTenantKey(tenantId);
  try {
    const r = await pool.query(
      `SELECT c."MAX_ASSENTOS_USUARIOS_OVR" AS ovr, p."MAX_ASSENTOS_USUARIOS" AS plan_max
       FROM "SAAS_CLIENTE_CONTRATANTE" c
       INNER JOIN "SAAS_PLANO" p ON p."CD_PLANO" = c."CD_PLANO"
       WHERE c."TENANT_ID" = $1
         AND COALESCE(c."FGACTIVE", 'S') = 'S'
       LIMIT 1`,
      [tid]
    );
    if (!r.rows.length) return null;
    const row = r.rows[0];
    const ovr = row.ovr ?? row.MAX_ASSENTOS_USUARIOS_OVR;
    const pm = row.plan_max ?? row.MAX_ASSENTOS_USUARIOS;
    const raw = ovr != null && ovr !== '' ? ovr : pm;
    if (raw == null || raw === '') return null;
    const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.floor(n);
  } catch (e) {
    if (e.code === '42703' || e.code === '42P01') return null;
    throw e;
  }
}

/**
 * Conta usuários com FGACTIVE = S no tenant (TENANT_ID vazio → tenant default).
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 * @param {{ excludeLogin?: string }} [opts]
 */
async function countActiveUsersInTenant(pool, tenantId, opts = {}) {
  const def = getDefaultTenantId();
  const tid = normalizeTenantKey(tenantId);
  const ex = opts.excludeLogin != null ? String(opts.excludeLogin).trim() : '';
  if (ex) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM "USUARIO"
       WHERE "FGACTIVE" = 'S'
         AND COALESCE(NULLIF(TRIM("TENANT_ID"), ''), $1) = $2
         AND UPPER("SGUSUARIO") <> UPPER($3)`,
      [def, tid, ex]
    );
    return r.rows[0]?.c ?? r.rows[0]?.C ?? 0;
  }
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM "USUARIO"
     WHERE "FGACTIVE" = 'S'
       AND COALESCE(NULLIF(TRIM("TENANT_ID"), ''), $1) = $2`,
    [def, tid]
  );
  return r.rows[0]?.c ?? r.rows[0]?.C ?? 0;
}

/**
 * @returns {Promise<{ ok: boolean, max: number|null, current?: number, message?: string }>}
 */
async function assertTenantUserSeatAvailable(pool, tenantId, opts = {}) {
  const max = await getEffectiveMaxUserSeats(pool, tenantId);
  if (max == null) return { ok: true, max: null };
  const current = await countActiveUsersInTenant(pool, tenantId, {
    excludeLogin: opts.excludeLogin,
  });
  if (current >= max) {
    return {
      ok: false,
      max,
      current,
      message: `Limite de usuários ativos atingido para este tenant (${current}/${max}). Desative outro usuário ou aumente o limite no plano/cliente SaaS.`,
    };
  }
  return { ok: true, max, current };
}

module.exports = {
  normalizeTenantKey,
  getEffectiveMaxUserSeats,
  countActiveUsersInTenant,
  assertTenantUserSeatAvailable,
};
