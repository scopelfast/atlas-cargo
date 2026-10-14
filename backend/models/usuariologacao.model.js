// backend/models/usuariologacao.model.js
const { poolPromise } = require('../config/db');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');

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
    const tid =
      dados.tenantId != null && String(dados.tenantId).trim() !== ''
        ? String(dados.tenantId).trim()
        : getDefaultTenantId();
    const result = await pool.query(
      `INSERT INTO "USUARIOLOGACAO" (
        "SGUSUARIO", "DHAÇÃO", "TIPOACAO", "MODULO", "DESCRICAO", "DETALHES",
        "IDREGISTRO", "TABELA", "IP", "USERAGENT", "DHMAINTENANCE", "TENANT_ID"
      ) VALUES ($1, CURRENT_TIMESTAMP, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP, $10)
      RETURNING "ID"`,
      [
        dados.sgUsuario,
        dados.tipoAcao || null,
        dados.modulo || null,
        dados.descricao || null,
        detalhesJson,
        dados.idRegistro || null,
        dados.tabela || null,
        dados.ip || null,
        dados.userAgent || null,
        tid
      ]
    );
    return result.rows[0]?.ID ?? null;
  } catch (err) {
    console.error('Erro em usuariologacao.model.registrarAcao:', err);
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
    const limit = Math.min(Number(filtros.limit) || 1000, 5000);
    const params = [sgUsuario];
    let paramIdx = 2;
    let where = ' WHERE "SGUSUARIO" = $1';
    if (filtros.tipoAcao) {
      where += ` AND "TIPOACAO" = $${paramIdx}`;
      params.push(filtros.tipoAcao);
      paramIdx++;
    }
    if (filtros.modulo) {
      where += ` AND "MODULO" = $${paramIdx}`;
      params.push(filtros.modulo);
      paramIdx++;
    }
    if (filtros.dataInicio) {
      where += ` AND "DHAÇÃO" >= $${paramIdx}`;
      params.push(filtros.dataInicio);
      paramIdx++;
    }
    if (filtros.dataFim) {
      where += ` AND "DHAÇÃO" <= $${paramIdx}`;
      params.push(filtros.dataFim);
      paramIdx++;
    }
    params.push(limit);
    const result = await pool.query(
      `SELECT "ID", "SGUSUARIO", "DHAÇÃO", "TIPOACAO", "MODULO", "DESCRICAO",
        "DETALHES", "IDREGISTRO", "TABELA", "IP", "USERAGENT"
       FROM "USUARIOLOGACAO" ${where}
       ORDER BY "DHAÇÃO" DESC
       LIMIT $${params.length}`,
      params
    );
    return (result.rows || []).map(log => ({
      ...log,
      detalhes: log.DETALHES || log.detalhes ? JSON.parse(log.DETALHES || log.detalhes) : null
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

