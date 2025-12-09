// backend/models/usuariologacao.model.js
const { poolPromise } = require('../config/db');

/**
 * Registrar ação do usuário
 * @param {Object} dados - Dados da ação
 * @param {string} dados.sgUsuario - Login do usuário
 * @param {string} dados.tipoAcao - Tipo da ação ('Abertura de Tela', 'Inclusão', 'Exclusão', etc.)
 * @param {string} dados.modulo - Nome do módulo
 * @param {string} dados.descricao - Descrição da ação
 * @param {Object} dados.detalhes - Detalhes adicionais (será convertido para JSON)
 * @param {string} dados.idRegistro - ID do registro afetado
 * @param {string} dados.tabela - Nome da tabela afetada
 * @param {string} dados.ip - IP do usuário
 * @param {string} dados.userAgent - User Agent do navegador
 * @returns {Promise<number>} ID do registro criado
 */
async function registrarAcao(dados) {
  try {
    const pool = await poolPromise;
    
    const detalhesJson = dados.detalhes ? JSON.stringify(dados.detalhes) : null;
    
    const result = await pool
      .request()
      .input('sgUsuario', dados.sgUsuario)
      .input('tipoAcao', dados.tipoAcao)
      .input('modulo', dados.modulo || null)
      .input('descricao', dados.descricao || null)
      .input('detalhes', detalhesJson)
      .input('idRegistro', dados.idRegistro || null)
      .input('tabela', dados.tabela || null)
      .input('ip', dados.ip || null)
      .input('userAgent', dados.userAgent || null)
      .query(`
        INSERT INTO USUARIOLOGACAO (
          SGUSUARIO, [DHAÇÃO], TIPOACAO, MODULO, DESCRICAO, DETALHES, 
          IDREGISTRO, TABELA, IP, USERAGENT, DHMAINTENANCE
        )
        OUTPUT INSERTED.ID
        VALUES (
          @sgUsuario, GETDATE(), @tipoAcao, @modulo, @descricao, @detalhes,
          @idRegistro, @tabela, @ip, @userAgent, GETDATE()
        )
      `);
    
    return result.recordset[0]?.ID;
  } catch (err) {
    console.error('Erro em usuariologacao.model.registrarAcao:', err);
    // Não lançar erro para não quebrar o fluxo principal
    return null;
  }
}

/**
 * Buscar logs de um usuário
 * @param {string} sgUsuario - Login do usuário
 * @param {Object} filtros - Filtros opcionais
 * @param {string} filtros.tipoAcao - Filtrar por tipo de ação
 * @param {string} filtros.modulo - Filtrar por módulo
 * @param {Date} filtros.dataInicio - Data inicial
 * @param {Date} filtros.dataFim - Data final
 * @param {number} filtros.limit - Limite de registros
 * @returns {Promise<Array>} Lista de logs
 */
async function buscarLogs(sgUsuario, filtros = {}) {
  try {
    const pool = await poolPromise;
    let query = `
      SELECT TOP ${filtros.limit || 1000}
        ID, SGUSUARIO, [DHAÇÃO], TIPOACAO, MODULO, DESCRICAO, 
        DETALHES, IDREGISTRO, TABELA, IP, USERAGENT
      FROM USUARIOLOGACAO
      WHERE SGUSUARIO = @sgUsuario
    `;
    
    const request = pool.request().input('sgUsuario', sgUsuario);
    
    if (filtros.tipoAcao) {
      query += ' AND TIPOACAO = @tipoAcao';
      request.input('tipoAcao', filtros.tipoAcao);
    }
    
    if (filtros.modulo) {
      query += ' AND MODULO = @modulo';
      request.input('modulo', filtros.modulo);
    }
    
    if (filtros.dataInicio) {
      query += ' AND [DHAÇÃO] >= @dataInicio';
      request.input('dataInicio', filtros.dataInicio);
    }
    
    if (filtros.dataFim) {
      query += ' AND [DHAÇÃO] <= @dataFim';
      request.input('dataFim', filtros.dataFim);
    }
    
    query += ' ORDER BY [DHAÇÃO] DESC';
    
    const result = await request.query(query);
    
    // Parsear JSON dos detalhes
    return result.recordset.map(log => ({
      ...log,
      detalhes: log.DETALHES ? JSON.parse(log.DETALHES) : null
    }));
  } catch (err) {
    console.error('Erro em usuariologacao.model.buscarLogs:', err);
    throw err;
  }
}

module.exports = {
  registrarAcao,
  buscarLogs
};

