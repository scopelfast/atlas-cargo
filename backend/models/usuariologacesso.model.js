// backend/models/usuariologacesso.model.js
const { poolPromise } = require('../config/db');

/**
 * Registrar login do usuário
 * @param {string} sgUsuario - Login do usuário
 * @returns {Promise<number>} ID do registro criado
 */
async function registrarLogin(sgUsuario) {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('sgUsuario', sgUsuario)
      .query(`
        INSERT INTO USUARIOLOGACESSO (SGUSUARIO, DHLOGIN, DHMAINTENANCE)
        OUTPUT INSERTED.ID
        VALUES (@sgUsuario, GETDATE(), GETDATE())
      `);
    
    return result.recordset[0].ID;
  } catch (err) {
    console.error('Erro em usuariologacesso.model.registrarLogin:', err);
    throw err;
  }
}

/**
 * Registrar logout do usuário
 * @param {number} idLogAcesso - ID do registro de acesso
 * @returns {Promise<boolean>}
 */
async function registrarLogout(idLogAcesso) {
  try {
    const pool = await poolPromise;
    
    // Calcular tempo de sessão em minutos
    const result = await pool
      .request()
      .input('idLogAcesso', idLogAcesso)
      .query(`
        UPDATE USUARIOLOGACESSO
        SET DHLOGOUT = GETDATE(),
            TEMPOSESSAO = DATEDIFF(MINUTE, DHLOGIN, GETDATE()),
            DHMAINTENANCE = GETDATE()
        WHERE ID = @idLogAcesso AND DHLOGOUT IS NULL
      `);
    
    return result.rowsAffected[0] > 0;
  } catch (err) {
    console.error('Erro em usuariologacesso.model.registrarLogout:', err);
    throw err;
  }
}

/**
 * Registrar logout por SGUSUARIO (para casos onde não temos o ID)
 * @param {string} sgUsuario - Login do usuário
 * @returns {Promise<boolean>}
 */
async function registrarLogoutPorUsuario(sgUsuario) {
  try {
    const pool = await poolPromise;
    
    const result = await pool
      .request()
      .input('sgUsuario', sgUsuario)
      .query(`
        UPDATE USUARIOLOGACESSO
        SET DHLOGOUT = GETDATE(),
            TEMPOSESSAO = DATEDIFF(MINUTE, DHLOGIN, GETDATE()),
            DHMAINTENANCE = GETDATE()
        WHERE SGUSUARIO = @sgUsuario 
          AND DHLOGOUT IS NULL
          AND ID = (SELECT TOP 1 ID FROM USUARIOLOGACESSO 
                    WHERE SGUSUARIO = @sgUsuario AND DHLOGOUT IS NULL 
                    ORDER BY DHLOGIN DESC)
      `);
    
    return result.rowsAffected[0] > 0;
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

