// backend/controllers/reputation.controller.js
// Controller para Reputação de Motoristas
// Versão: 1.0
// Data: 2025-01-16

const sql = require('mssql');
const { poolPromise } = require('../config/db');
const reputationService = require('../services/reputation-service');

const reputationController = {
  /**
   * Buscar reputação de um motorista
   * GET /api/reputation/motorista/:cdmotorista
   */
  buscarPorMotorista: async (req, res) => {
    try {
      const { cdmotorista } = req.params;

      const pool = await poolPromise;
      const request = pool.request();
      request.input('cdmotorista', sql.Decimal(15, 0), cdmotorista);

      const result = await request.query(`
        SELECT 
          dr.CDMOTORISTA,
          dr.SCORE,
          dr.TOTAL_DELIVERIES,
          dr.ON_TIME_DELIVERIES,
          dr.LATE_DELIVERIES,
          dr.CANCELED_DELIVERIES,
          dr.AVERAGE_DELAY_MINUTES,
          dr.LAST_DELIVERY_DATE,
          dr.LAST_UPDATED,
          cg.RZSOCIAL AS NOME_MOTORISTA
        FROM DRIVER_REPUTATION dr
        LEFT JOIN CADASTROGERAL cg ON dr.CDMOTORISTA = cg.CDCADASTRO
        WHERE dr.CDMOTORISTA = @cdmotorista
      `);

      if (result.recordset.length === 0) {
        return res.json({
          success: true,
          reputacao: null,
          message: 'Motorista sem histórico de entregas'
        });
      }

      res.json({
        success: true,
        reputacao: result.recordset[0]
      });

    } catch (error) {
      console.error('Erro ao buscar reputação:', error);
      res.status(500).json({ 
        error: 'Erro ao buscar reputação',
        details: error.message 
      });
    }
  },

  /**
   * Buscar ranking de motoristas
   * GET /api/reputation/ranking
   */
  buscarRanking: async (req, res) => {
    try {
      const { limit = 50 } = req.query;

      const pool = await poolPromise;
      const request = pool.request();
      request.input('limit', sql.Int, parseInt(limit));

      const result = await request.query(`
        SELECT TOP (@limit)
          dr.CDMOTORISTA,
          dr.SCORE,
          dr.TOTAL_DELIVERIES,
          dr.ON_TIME_DELIVERIES,
          dr.LATE_DELIVERIES,
          dr.CANCELED_DELIVERIES,
          dr.AVERAGE_DELAY_MINUTES,
          dr.LAST_DELIVERY_DATE,
          dr.LAST_UPDATED,
          cg.RZSOCIAL AS NOME_MOTORISTA,
          CASE 
            WHEN dr.TOTAL_DELIVERIES > 0 THEN 
              CAST((dr.ON_TIME_DELIVERIES * 100.0 / dr.TOTAL_DELIVERIES) AS DECIMAL(5, 2))
            ELSE 0
          END AS TAXA_PONTUALIDADE
        FROM DRIVER_REPUTATION dr
        LEFT JOIN CADASTROGERAL cg ON dr.CDMOTORISTA = cg.CDCADASTRO
        WHERE dr.TOTAL_DELIVERIES > 0
        ORDER BY dr.SCORE DESC, dr.TOTAL_DELIVERIES DESC
      `);

      res.json({
        success: true,
        ranking: result.recordset,
        total: result.recordset.length
      });

    } catch (error) {
      console.error('Erro ao buscar ranking:', error);
      res.status(500).json({ 
        error: 'Erro ao buscar ranking',
        details: error.message 
      });
    }
  },

  /**
   * Recalcular reputação de um motorista
   * POST /api/reputation/recalcular/:cdmotorista
   */
  recalcular: async (req, res) => {
    try {
      const { cdmotorista } = req.params;

      const resultado = await reputationService.calcularReputacao(cdmotorista);

      // Emitir evento WebSocket para Torre de Controle
      try {
        const websocketTorre = req.app ? req.app.get('websocketTorre') : null;
        if (websocketTorre && resultado) {
          websocketTorre.emitirAtualizacaoReputacao(cdmotorista, resultado);
        }
      } catch (err) {
        console.warn('⚠️ Erro ao emitir evento WebSocket de reputação:', err.message);
      }

      res.json({
        success: true,
        message: 'Reputação recalculada com sucesso',
        resultado
      });

    } catch (error) {
      console.error('Erro ao recalcular reputação:', error);
      res.status(500).json({ 
        error: 'Erro ao recalcular reputação',
        details: error.message 
      });
    }
  },

  /**
   * Recalcular todas as reputações
   * POST /api/reputation/recalcular-todos
   */
  recalcularTodos: async (req, res) => {
    try {
      const resultado = await reputationService.recalcularTodasReputacoes();
      
      // Emitir eventos WebSocket para atualizações de reputação
      try {
        const websocketTorre = req.app ? req.app.get('websocketTorre') : null;
        if (websocketTorre && resultado && resultado.sucesso > 0) {
          // Buscar motoristas recalculados e emitir eventos
          // (seria ideal retornar lista de motoristas do service, mas por ora emitimos evento genérico)
          // Emitir evento indicando que ranking foi atualizado
          websocketTorre.emitirAtualizacaoListaViagens([]); // Trigger de atualização
        }
      } catch (err) {
        console.warn('⚠️ Erro ao emitir eventos WebSocket de reputação:', err.message);
      }

      let mensagem = `Reputações recalculadas: ${resultado.sucesso} sucesso(s)`;
      if (resultado.erro > 0) {
        mensagem += `, ${resultado.erro} erro(s)`;
      }
      if (resultado.message) {
        mensagem = resultado.message;
      }

      res.json({
        success: true,
        message: mensagem,
        resultado
      });

    } catch (error) {
      console.error('Erro ao recalcular todas as reputações:', error);
      
      // Verificar se é erro de tabela não existente
      const errorMessage = error.message || 'Erro desconhecido';
      const isTableError = errorMessage.includes('não existe') || errorMessage.includes('does not exist');
      
      res.status(500).json({ 
        error: 'Erro ao recalcular reputações',
        details: errorMessage,
        solucao: isTableError ? 'Execute o script: backend/scripts/criar_tabela_driver_reputation.sql' : undefined
      });
    }
  }
};

module.exports = reputationController;
