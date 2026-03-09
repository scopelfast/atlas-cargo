// backend/models/usuariologacesso.model.js - PostgreSQL
const { poolPromise } = require('../config/db');

async function registrarLogin(sgUsuario) {
  try {
    const pool = await poolPromise;
    const result = await pool.query(
      `INSERT INTO "USUARIOLOGACESSO" ("SGUSUARIO", "DHLOGIN", "DHMAINTENANCE")
       VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING "ID"`,
      [sgUsuario]
    );
    return result.rows[0].ID;
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

module.exports = {
  registrarLogin,
  registrarLogout,
  registrarLogoutPorUsuario
};
