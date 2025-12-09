// backend/controllers/usuariologacao.controller.js
const { registrarAcao, buscarLogs } = require('../models/usuariologacao.model');

/**
 * Registrar ação do usuário (endpoint)
 */
const registrarAcaoUsuario = async (req, res) => {
  try {
    const {
      tipoAcao,
      modulo,
      descricao,
      detalhes,
      idRegistro,
      tabela
    } = req.body;

    // Pegar usuário do token (se disponível) ou do header
    const sgUsuario = req.user?.login || req.headers['user-login'] || 'SISTEMA';
    
    // Pegar IP e User Agent
    const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || null;
    const userAgent = req.headers['user-agent'] || null;

    const idLog = await registrarAcao({
      sgUsuario,
      tipoAcao,
      modulo,
      descricao,
      detalhes,
      idRegistro,
      tabela,
      ip,
      userAgent
    });

    return res.json({
      success: true,
      idLog
    });
  } catch (err) {
    console.error('Erro ao registrar ação:', err);
    // Retornar sucesso mesmo em caso de erro para não quebrar o fluxo
    return res.json({
      success: true,
      message: 'Log registrado (com possível erro interno)'
    });
  }
};

/**
 * Buscar logs de um usuário
 */
const listarLogs = async (req, res) => {
  try {
    const { sgUsuario } = req.query;
    const { tipoAcao, modulo, dataInicio, dataFim, limit } = req.query;

    if (!sgUsuario) {
      return res.status(400).json({
        success: false,
        message: 'SGUSUARIO é obrigatório'
      });
    }

    const filtros = {
      tipoAcao: tipoAcao || null,
      modulo: modulo || null,
      dataInicio: dataInicio ? new Date(dataInicio) : null,
      dataFim: dataFim ? new Date(dataFim) : null,
      limit: limit ? parseInt(limit) : 1000
    };

    const logs = await buscarLogs(sgUsuario, filtros);

    return res.json({
      success: true,
      logs,
      total: logs.length
    });
  } catch (err) {
    console.error('Erro ao buscar logs:', err);
    return res.status(500).json({
      success: false,
      message: 'Erro ao buscar logs'
    });
  }
};

module.exports = {
  registrarAcaoUsuario,
  listarLogs
};

