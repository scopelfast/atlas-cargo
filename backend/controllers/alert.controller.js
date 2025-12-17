// backend/controllers/alert.controller.js
// Controller para gerenciar alertas inteligentes
// Versão: 1.0
// Data: 2025-01-16

const alertService = require('../services/alert-service');

const alertController = {
  /**
   * Buscar alertas de uma viagem
   * GET /api/alerts/viagem/:idviagem
   */
  buscarPorViagem: async (req, res) => {
    try {
      const { idviagem } = req.params;
      
      if (!idviagem) {
        return res.status(400).json({ error: 'ID da viagem é obrigatório' });
      }

      const alertas = await alertService.buscarAlertasAtivos(parseInt(idviagem));
      
      res.json({
        success: true,
        alertas: alertas,
        total: alertas.length
      });
    } catch (err) {
      console.error('Erro ao buscar alertas:', err);
      res.status(500).json({ error: 'Erro ao buscar alertas' });
    }
  },

  /**
   * Verificar alertas de uma viagem (força nova verificação)
   * POST /api/alerts/verificar/:idviagem
   */
  verificar: async (req, res) => {
    try {
      const { idviagem } = req.params;
      
      if (!idviagem) {
        return res.status(400).json({ error: 'ID da viagem é obrigatório' });
      }

      const alertas = await alertService.verificarAlertas(parseInt(idviagem));
      
      res.json({
        success: true,
        alertasEncontrados: alertas.length,
        alertas: alertas
      });
    } catch (err) {
      console.error('Erro ao verificar alertas:', err);
      res.status(500).json({ error: 'Erro ao verificar alertas' });
    }
  },

  /**
   * Resolver alerta
   * PUT /api/alerts/:id/resolver
   */
  resolver: async (req, res) => {
    try {
      const { id } = req.params;
      const { idusuario } = req.body || req.user; // Via body ou token JWT
      
      if (!id) {
        return res.status(400).json({ error: 'ID do alerta é obrigatório' });
      }

      const sucesso = await alertService.resolverAlerta(parseInt(id), idusuario);
      
      if (sucesso) {
        // Emitir evento WebSocket para Torre de Controle
        if (req.io) {
          const websocketTorre = req.app.get('websocketTorre');
          if (websocketTorre) {
            const alertaInfo = await alertService.buscarAlertaPorId(parseInt(id));
            if (alertaInfo && alertaInfo.IDVIAGEM) {
              websocketTorre.emitirAlertaResolvido(parseInt(id), alertaInfo.IDVIAGEM);
            } else {
              websocketTorre.emitirAlertaResolvido(parseInt(id));
            }
          }
        }
        
        res.json({ success: true, message: 'Alerta resolvido com sucesso' });
      } else {
        res.status(500).json({ error: 'Erro ao resolver alerta' });
      }
    } catch (err) {
      console.error('Erro ao resolver alerta:', err);
      res.status(500).json({ error: 'Erro ao resolver alerta' });
    }
  },

  /**
   * Buscar todos os alertas ativos (para dashboard)
   * GET /api/alerts/ativos
   */
  buscarAtivos: async (req, res) => {
    try {
      const sql = require('mssql');
      const { poolPromise } = require('../config/db');
      
      const pool = await poolPromise;
      const result = await pool.request().query(`
        SELECT TOP 50
          a.ID,
          a.IDVIAGEM,
          a.CDMOTORISTA,
          a.TYPE,
          a.MESSAGE,
          a.SEVERITY,
          a.DETAILS,
          a.CREATED_AT,
          v.IDVIAGEM as viagem_codigo,
          cg.RZSOCIAL as motorista_nome
        FROM [dbo].[ALERTS] a
        LEFT JOIN [dbo].[VIAGEMMESTRE] v ON a.IDVIAGEM = v.IDVIAGEM
        LEFT JOIN [dbo].[CADASTROGERAL] cg ON a.CDMOTORISTA = cg.CDCADASTRO
        WHERE a.RESOLVED = 0
        ORDER BY 
          CASE a.SEVERITY
            WHEN 'high' THEN 1
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 3
          END,
          a.CREATED_AT DESC
      `);

      res.json({
        success: true,
        alertas: result.recordset,
        total: result.recordset.length
      });
    } catch (err) {
      console.error('Erro ao buscar alertas ativos:', err);
      res.status(500).json({ error: 'Erro ao buscar alertas ativos' });
    }
  }
};

module.exports = alertController;
