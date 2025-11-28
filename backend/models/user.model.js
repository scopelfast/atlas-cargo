// backend/models/user.model.js
const { poolPromise } = require('../config/db');

async function findByEmail(email) {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('email', email)
      .query(`
        SELECT 
          SGUSUARIO,
          CDCADASTRO,
          NMUSUARIO,
          ENDEMAIL,
          SENHA,
          FGACTIVE
        FROM USUARIO 
        WHERE ENDEMAIL = @email
      `);
    return result.recordset[0] || null;
  } catch (err) {
    console.error('Erro em user.model.findByEmail:', err);
    throw err;
  }
}

async function findByLogin(login) {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('login', login)
      .query(`
        SELECT 
          SGUSUARIO,
          CDCADASTRO,
          NMUSUARIO,
          ENDEMAIL,
          SENHA,
          FGACTIVE
        FROM USUARIO 
        WHERE SGUSUARIO = @login
      `);
    return result.recordset[0] || null;
  } catch (err) {
    console.error('Erro em user.model.findByLogin:', err);
    throw err;
  }
}

module.exports = {
  findByEmail,
  findByLogin
};