// backend/models/usuariologacesso.model.js - PostgreSQL
const { poolPromise } = require('../config/db');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');

async function registrarLogin(sgUsuario, tenantId) {
  try {
    const pool = await poolPromise;
    const tid =
      tenantId != null && String(tenantId).trim() !== ''
        ? String(tenantId).trim()
        : getDefaultTenantId();
    const result = await pool.query(
      `INSERT INTO "USUARIOLOGACESSO" ("SGUSUARIO", "DHLOGIN", "DHMAINTENANCE", "TENANT_ID")
       VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $2)
       RETURNING "ID"`,
      [sgUsuario, tid]
    );
    const row = result.rows[0];
    return row ? (row.ID ?? row.id) : null;
  } catch (err) {
    console.error('Erro em usuariologacesso.model.registrarLogin:', err);
    throw err;
  }
}

async function registrarLogout(idLogAcesso) {
  try {
    const pool = await poolPromise;
    const result = await pool.query(
      `UPDATE "USUARIOLOGACESSO"
       SET "DHLOGOUT" = CURRENT_TIMESTAMP,
           "TEMPOSESSAO" = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - "DHLOGIN")) / 60,
           "DHMAINTENANCE" = CURRENT_TIMESTAMP
       WHERE "ID" = $1 AND "DHLOGOUT" IS NULL`,
      [idLogAcesso]
    );
    return (result.rowCount || 0) > 0;
  } catch (err) {
    console.error('Erro em usuariologacesso.model.registrarLogout:', err);
    throw err;
  }
}

async function registrarLogoutPorUsuario(sgUsuario) {
  try {
    const pool = await poolPromise;
    const result = await pool.query(
      `UPDATE "USUARIOLOGACESSO"
       SET "DHLOGOUT" = CURRENT_TIMESTAMP,
           "TEMPOSESSAO" = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - "DHLOGIN")) / 60,
           "DHMAINTENANCE" = CURRENT_TIMESTAMP
       WHERE "SGUSUARIO" = $1 
         AND "DHLOGOUT" IS NULL
         AND "ID" = (
           SELECT "ID" FROM "USUARIOLOGACESSO" 
           WHERE "SGUSUARIO" = $1 AND "DHLOGOUT" IS NULL 
           ORDER BY "DHLOGIN" DESC 
           LIMIT 1
         )`,
      [sgUsuario, sgUsuario]
    );
    return (result.rowCount || 0) > 0;
  } catch (err) {
    console.error('Erro em usuariologacesso.model.registrarLogoutPorUsuario:', err);
    throw err;
  }
}

/**
 * Torre: sessão ainda válida se a linha de log existe e não tem logout.
 * Usado para invalidar JWT após "encerrar sessão mais antiga" ou logout explícito.
 */
async function isLogAcessoTorreAberto(logId) {
  if (logId == null || logId === '') return true;
  const n = typeof logId === 'number' ? logId : parseInt(String(logId), 10);
  if (!Number.isFinite(n) || n < 1) return true;
  try {
    const pool = await poolPromise;
    const r = await pool.query(
      `SELECT 1 FROM "USUARIOLOGACESSO" WHERE "ID" = $1 AND "DHLOGOUT" IS NULL LIMIT 1`,
      [n]
    );
    return !!(r.rows && r.rows.length > 0);
  } catch (e) {
    console.error('isLogAcessoTorreAberto:', e.message);
    return true;
  }
}

module.exports = {
  registrarLogin,
  registrarLogout,
  registrarLogoutPorUsuario,
  isLogAcessoTorreAberto,
};
