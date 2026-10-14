// backend/models/user.model.js - PostgreSQL
const { poolPromise } = require('../config/db');

async function findByEmail(email) {
  try {
    const pool = await poolPromise;
    try {
      const result = await pool.query(
        `SELECT 
          "SGUSUARIO",
          "CDCADASTRO",
          "NMUSUARIO",
          "ENDEMAIL",
          "SENHA",
          "FGACTIVE",
          "TENANT_ID"
        FROM "USUARIO" 
        WHERE "ENDEMAIL" = $1`,
        [email]
      );
      return result.rows[0] || null;
    } catch (err) {
      if (err.code !== '42703') throw err;
      const result = await pool.query(
        `SELECT 
          "SGUSUARIO",
          "CDCADASTRO",
          "NMUSUARIO",
          "ENDEMAIL",
          "SENHA",
          "FGACTIVE"
        FROM "USUARIO" 
        WHERE "ENDEMAIL" = $1`,
        [email]
      );
      return result.rows[0] || null;
    }
  } catch (err) {
    console.error('Erro em user.model.findByEmail:', err);
    throw err;
  }
}

async function findByLogin(login) {
  try {
    const pool = await poolPromise;
    try {
      const result = await pool.query(
        `SELECT 
          "SGUSUARIO",
          "CDCADASTRO",
          "NMUSUARIO",
          "ENDEMAIL",
          "SENHA",
          "FGACTIVE",
          "TENANT_ID"
        FROM "USUARIO" 
        WHERE "SGUSUARIO" = $1`,
        [login]
      );
      return result.rows[0] || null;
    } catch (err) {
      if (err.code !== '42703') throw err;
      const result = await pool.query(
        `SELECT 
          "SGUSUARIO",
          "CDCADASTRO",
          "NMUSUARIO",
          "ENDEMAIL",
          "SENHA",
          "FGACTIVE"
        FROM "USUARIO" 
        WHERE "SGUSUARIO" = $1`,
        [login]
      );
      return result.rows[0] || null;
    }
  } catch (err) {
    console.error('Erro em user.model.findByLogin:', err);
    throw err;
  }
}

module.exports = {
  findByEmail,
  findByLogin
};
