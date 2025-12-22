// backend/controllers/logs-acesso.controller.js
// Logs de Acesso - Controller
// Versão: 1.0
// Autor: Sistema DivulgaCarga

const sql = require('mssql');
const { poolPromise } = require('../config/db');

/**
 * Listar logs de acesso (USUARIOLOGACESSO)
 */
const listarLogsAcesso = async (req, res) => {
  try {
    const { dataInicio, dataFim, operador } = req.query;
    
    const pool = await poolPromise;
    let query = `
      SELECT 
        ID,
        SGUSUARIO,
        DHLOGIN,
        DHLOGOUT,
        TEMPOSESSAO,
        DHMAINTENANCE,
        SGUSER,
        SERVERORIG
      FROM USUARIOLOGACESSO
      WHERE 1=1
    `;

    const request = pool.request();

    if (dataInicio) {
      query += ` AND CAST(DHLOGIN AS DATE) >= CAST(@dataInicio AS DATE)`;
      request.input('dataInicio', sql.DateTime, new Date(dataInicio));
    }

    if (dataFim) {
      query += ` AND CAST(DHLOGIN AS DATE) <= CAST(@dataFim AS DATE)`;
      request.input('dataFim', sql.DateTime, new Date(dataFim));
    }

    if (operador) {
      query += ` AND UPPER(SGUSUARIO) = UPPER(@operador)`;
      request.input('operador', sql.VarChar(50), operador);
    }

    query += ` ORDER BY DHLOGIN DESC`;

    const result = await request.query(query);

    res.json({
      success: true,
      logs: result.recordset,
      total: result.recordset.length
    });
  } catch (err) {
    console.error('Erro ao listar logs de acesso:', err);
    res.status(500).json({
      success: false,
      error: 'Erro ao listar logs de acesso.',
      logs: [],
      total: 0
    });
  }
};

/**
 * Listar logs de ações (USUARIOLOGACAO)
 */
const listarLogsAcoes = async (req, res) => {
  try {
    const { dataInicio, dataFim, operador } = req.query;
    
    const pool = await poolPromise;
    let query = `
      SELECT 
        ID,
        SGUSUARIO,
        [DHAÇÃO] AS DHACAO,
        TIPOACAO,
        MODULO,
        DESCRICAO,
        DETALHES,
        IDREGISTRO,
        TABELA,
        IP,
        USERAGENT,
        DHMAINTENANCE,
        SGUSER,
        SERVERORIG
      FROM USUARIOLOGACAO
      WHERE 1=1
    `;

    const request = pool.request();

    if (dataInicio) {
      query += ` AND CAST([DHAÇÃO] AS DATE) >= CAST(@dataInicio AS DATE)`;
      request.input('dataInicio', sql.DateTime, new Date(dataInicio));
    }

    if (dataFim) {
      query += ` AND CAST([DHAÇÃO] AS DATE) <= CAST(@dataFim AS DATE)`;
      request.input('dataFim', sql.DateTime, new Date(dataFim));
    }

    if (operador) {
      query += ` AND UPPER(SGUSUARIO) = UPPER(@operador)`;
      request.input('operador', sql.VarChar(50), operador);
    }

    query += ` ORDER BY [DHAÇÃO] DESC`;

    const result = await request.query(query);

    res.json({
      success: true,
      logs: result.recordset,
      total: result.recordset.length
    });
  } catch (err) {
    console.error('Erro ao listar logs de ações:', err);
    res.status(500).json({
      success: false,
      error: 'Erro ao listar logs de ações.',
      logs: [],
      total: 0
    });
  }
};

/**
 * Listar operadores (para combo)
 */
const listarOperadores = async (req, res) => {
  try {
    const pool = await poolPromise;
    
    // Buscar operadores únicos das tabelas de log
    const result = await pool.request().query(`
      SELECT DISTINCT UPPER(SGUSUARIO) AS SGUSUARIO
      FROM (
        SELECT SGUSUARIO FROM USUARIOLOGACESSO
        UNION
        SELECT SGUSUARIO FROM USUARIOLOGACAO
      ) AS OPERADORES
      WHERE SGUSUARIO IS NOT NULL AND SGUSUARIO <> ''
      ORDER BY SGUSUARIO
    `);

    res.json({
      success: true,
      operadores: result.recordset.map(r => r.SGUSUARIO)
    });
  } catch (err) {
    console.error('Erro ao listar operadores:', err);
    res.status(500).json({
      success: false,
      error: 'Erro ao listar operadores.',
      operadores: []
    });
  }
};

/**
 * Executar init.sql
 */
const executarInitSQL = async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    
    const sqlFilePath = path.join(__dirname, '../../public/modulos/gerenciar-logs-acesso/sql/init.sql');
    
    if (!fs.existsSync(sqlFilePath)) {
      return res.json({
        success: true,
        message: 'Arquivo init.sql não encontrado. Continuando...',
        executed: false
      });
    }

    const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');
    
    if (!sqlContent || !sqlContent.trim()) {
      return res.json({
        success: true,
        message: 'Arquivo init.sql está vazio. Continuando...',
        executed: false
      });
    }

    const pool = await poolPromise;
    
    // Executar SQL (dividir por GO se necessário)
    const sqlStatements = sqlContent.split(/^\s*GO\s*$/gim).filter(s => s.trim());
    
    for (const statement of sqlStatements) {
      if (statement.trim()) {
        try {
          await pool.request().query(statement);
        } catch (err) {
          // Filtrar erros esperados (duplicate key, etc)
          const errorMessage = err.message || '';
          if (!errorMessage.includes('duplicate key') && 
              !errorMessage.includes('Violation of PRIMARY KEY') &&
              !errorMessage.includes('already exists')) {
            console.error('Erro ao executar init.sql:', err);
          }
        }
      }
    }

    res.json({
      success: true,
      message: 'init.sql executado com sucesso.',
      executed: true
    });
  } catch (err) {
    console.error('Erro ao executar init.sql:', err);
    // Retornar sucesso mesmo em caso de erro para não bloquear o carregamento
    res.json({
      success: true,
      message: 'init.sql executado (com possíveis avisos).',
      executed: false,
      error: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

module.exports = {
  listarLogsAcesso,
  listarLogsAcoes,
  listarOperadores,
  executarInitSQL
};

