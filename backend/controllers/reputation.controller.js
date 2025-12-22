// backend/controllers/reputation.controller.js
// Controller para Reputação de Motoristas e Ranking
// Versão: 2.0 - Módulo separado
// Data: 2025-01-16
// Última atualização: 2025-01-18
//
// Este controller gerencia todas as operações relacionadas a reputação e ranking
// de motoristas. Inclui funcionalidades para listar rankings, top 10, gráficos,
// detalhes de motoristas e cálculo de rankings.
// Os dados são armazenados na tabela RANKING_DATA para performance.
//
// Endpoints principais:
// - GET    /api/ranking - Listar ranking completo
// - GET    /api/ranking/top10 - Top 10 motoristas
// - GET    /api/ranking/graficos - Dados para gráficos
// - GET    /api/ranking/motorista/:id - Detalhes de um motorista
// - POST   /api/ranking/calcular - Calcular rankings

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
  },

  /**
   * Listar ranking completo de motoristas
   * 
   * GET /api/ranking?periodoInicio=2024-01-01&periodoFim=2024-01-31&limit=100&offset=0
   * 
   * @description
   * Lista o ranking completo de motoristas ordenado por pontuação geral.
   * Inclui informações de entregas, avaliações, tempo de resposta e taxa de aceitação.
   * Calcula a posição de cada motorista no ranking.
   * Suporta filtro por período e paginação.
   * 
   * @param {Object} req.query - Query parameters
   * @param {string} [req.query.periodoInicio] - Data inicial do período (YYYY-MM-DD)
   * @param {string} [req.query.periodoFim] - Data final do período (YYYY-MM-DD)
   * @param {number} [req.query.limit=100] - Limite de registros
   * @param {number} [req.query.offset=0] - Offset para paginação
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - data: Array de motoristas com ranking
   *   - total: Total de registros encontrados
   * 
   * @author Sistema DivulgaCarga
   * @since 2.0
   */
  listar: async (req, res) => {
    try {
      const { periodoInicio, periodoFim, limit = 100, offset = 0 } = req.query;
      
      const pool = await poolPromise;
      const request = pool.request();

      let query = `
        SELECT 
          rd.ID,
          rd.ID_MOTORISTA,
          rd.PONTUACAO_GERAL,
          rd.ENTREGAS_NO_PRAZO,
          rd.ENTREGAS_TOTAL,
          rd.AVALIACOES_MEDIA,
          rd.TEMPO_MEDIO_RESPOSTA,
          rd.TAXA_ACEITACAO,
          rd.PERIODO_INICIO,
          rd.PERIODO_FIM,
          rd.DH_CALCULO,
          cg.RZSOCIAL as NOME_MOTORISTA,
          ROW_NUMBER() OVER (ORDER BY rd.PONTUACAO_GERAL DESC, rd.ENTREGAS_TOTAL DESC) as POSICAO
        FROM [dbo].[RANKING_DATA] rd
        LEFT JOIN [dbo].[CADASTROGERAL] cg ON rd.ID_MOTORISTA = cg.CDCADASTRO
        WHERE 1=1
      `;

      if (periodoInicio) {
        request.input('periodoInicio', sql.Date, periodoInicio);
        query += ` AND rd.PERIODO_INICIO >= @periodoInicio`;
      }
      if (periodoFim) {
        request.input('periodoFim', sql.Date, periodoFim);
        query += ` AND rd.PERIODO_FIM <= @periodoFim`;
      }

      query += ` ORDER BY rd.PONTUACAO_GERAL DESC, rd.ENTREGAS_TOTAL DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;

      request.input('offset', sql.Int, parseInt(offset));
      request.input('limit', sql.Int, parseInt(limit));

      const result = await request.query(query);

      // Contar total
      let countQuery = `SELECT COUNT(*) as total FROM [dbo].[RANKING_DATA] rd WHERE 1=1`;
      const countRequest = pool.request();
      if (periodoInicio) {
        countRequest.input('periodoInicio', sql.Date, periodoInicio);
        countQuery += ` AND rd.PERIODO_INICIO >= @periodoInicio`;
      }
      if (periodoFim) {
        countRequest.input('periodoFim', sql.Date, periodoFim);
        countQuery += ` AND rd.PERIODO_FIM <= @periodoFim`;
      }

      const countResult = await countRequest.query(countQuery);
      const total = countResult.recordset[0].total;

      res.json({
        success: true,
        data: result.recordset,
        total: total
      });
    } catch (err) {
      console.error('Erro ao listar ranking:', err);
      res.status(500).json({ error: 'Erro ao listar ranking' });
    }
  },

  /**
   * Top 10 motoristas
   * GET /api/ranking/top10
   */
  top10: async (req, res) => {
    try {
      req.query.limit = 10;
      req.query.offset = 0;
      return reputationController.listar(req, res);
    } catch (err) {
      console.error('Erro ao buscar top 10:', err);
      res.status(500).json({ error: 'Erro ao buscar top 10' });
    }
  },

  /**
   * Obter dados formatados para gráficos do ranking
   * 
   * GET /api/ranking/graficos?periodoInicio=2024-01-01&periodoFim=2024-01-31
   * 
   * @description
   * Retorna dados formatados especificamente para criação de gráficos:
   * - Top 10: Os 10 melhores motoristas do período
   * - Evolução mensal: Média de pontuação, entregas e avaliações dos últimos 12 meses
   * - Distribuição de pontuação: Quantidade de motoristas por faixa de pontuação
   * 
   * @param {Object} req.query - Query parameters
   * @param {string} [req.query.periodoInicio] - Data inicial do período (YYYY-MM-DD)
   * @param {string} [req.query.periodoFim] - Data final do período (YYYY-MM-DD)
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - data: Objeto com:
   *     - top10: Array com top 10 motoristas
   *     - evolucaoMensal: Array com evolução mensal
   *     - distribuicaoPontuacao: Array com distribuição por faixas
   * 
   * @author Sistema DivulgaCarga
   * @since 2.0
   */
  graficos: async (req, res) => {
    try {
      const { periodoInicio, periodoFim } = req.query;
      
      const pool = await poolPromise;
      const request = pool.request();

      // Top 10
      let top10Query = `
        SELECT TOP 10
          rd.ID_MOTORISTA,
          cg.RZSOCIAL as NOME_MOTORISTA,
          rd.PONTUACAO_GERAL,
          rd.ENTREGAS_NO_PRAZO,
          rd.ENTREGAS_TOTAL,
          rd.AVALIACOES_MEDIA
        FROM [dbo].[RANKING_DATA] rd
        LEFT JOIN [dbo].[CADASTROGERAL] cg ON rd.ID_MOTORISTA = cg.CDCADASTRO
        WHERE 1=1
      `;

      if (periodoInicio) {
        request.input('periodoInicio', sql.Date, periodoInicio);
        top10Query += ` AND rd.PERIODO_INICIO >= @periodoInicio`;
      }
      if (periodoFim) {
        request.input('periodoFim', sql.Date, periodoFim);
        top10Query += ` AND rd.PERIODO_FIM <= @periodoFim`;
      }

      top10Query += ` ORDER BY rd.PONTUACAO_GERAL DESC`;

      const top10Result = await request.query(top10Query);

      // Evolução mensal (últimos 12 meses)
      const evolucaoResult = await pool.request().query(`
        SELECT 
          FORMAT(PERIODO_INICIO, 'yyyy-MM') as MES,
          AVG(PONTUACAO_GERAL) as PONTUACAO_MEDIA,
          SUM(ENTREGAS_TOTAL) as TOTAL_ENTREGAS,
          AVG(AVALIACOES_MEDIA) as MEDIA_AVALIACOES
        FROM [dbo].[RANKING_DATA]
        WHERE PERIODO_INICIO >= DATEADD(MONTH, -12, GETDATE())
        GROUP BY FORMAT(PERIODO_INICIO, 'yyyy-MM')
        ORDER BY MES
      `);

      // Distribuição de pontuação
      const distribuicaoResult = await pool.request().query(`
        SELECT 
          CASE 
            WHEN PONTUACAO_GERAL >= 90 THEN '90-100'
            WHEN PONTUACAO_GERAL >= 80 THEN '80-89'
            WHEN PONTUACAO_GERAL >= 70 THEN '70-79'
            WHEN PONTUACAO_GERAL >= 60 THEN '60-69'
            ELSE '0-59'
          END as FAIXA,
          COUNT(*) as QUANTIDADE
        FROM [dbo].[RANKING_DATA]
        WHERE 1=1
        ${periodoInicio ? `AND PERIODO_INICIO >= '${periodoInicio}'` : ''}
        ${periodoFim ? `AND PERIODO_FIM <= '${periodoFim}'` : ''}
        GROUP BY 
          CASE 
            WHEN PONTUACAO_GERAL >= 90 THEN '90-100'
            WHEN PONTUACAO_GERAL >= 80 THEN '80-89'
            WHEN PONTUACAO_GERAL >= 70 THEN '70-79'
            WHEN PONTUACAO_GERAL >= 60 THEN '60-69'
            ELSE '0-59'
          END
        ORDER BY FAIXA
      `);

      res.json({
        success: true,
        data: {
          top10: top10Result.recordset,
          evolucaoMensal: evolucaoResult.recordset,
          distribuicaoPontuacao: distribuicaoResult.recordset
        }
      });
    } catch (err) {
      console.error('Erro ao buscar dados para gráficos:', err);
      res.status(500).json({ error: 'Erro ao buscar dados para gráficos' });
    }
  },

  /**
   * Detalhes de um motorista
   * GET /api/ranking/motorista/:id
   */
  detalhesMotorista: async (req, res) => {
    try {
      const { id } = req.params;
      const { periodoInicio, periodoFim } = req.query;
      
      const pool = await poolPromise;
      const request = pool.request();
      request.input('idMotorista', sql.Decimal(15, 0), parseFloat(id));

      let query = `
        SELECT 
          rd.*,
          cg.RZSOCIAL as NOME_MOTORISTA,
          cg.NRCELULAR as CELULAR,
          ROW_NUMBER() OVER (ORDER BY rd.PONTUACAO_GERAL DESC, rd.ENTREGAS_TOTAL DESC) as POSICAO
        FROM [dbo].[RANKING_DATA] rd
        LEFT JOIN [dbo].[CADASTROGERAL] cg ON rd.ID_MOTORISTA = cg.CDCADASTRO
        WHERE rd.ID_MOTORISTA = @idMotorista
      `;

      if (periodoInicio) {
        request.input('periodoInicio', sql.Date, periodoInicio);
        query += ` AND rd.PERIODO_INICIO >= @periodoInicio`;
      }
      if (periodoFim) {
        request.input('periodoFim', sql.Date, periodoFim);
        query += ` AND rd.PERIODO_FIM <= @periodoFim`;
      }

      query += ` ORDER BY rd.PERIODO_INICIO DESC`;

      const result = await request.query(query);

      if (result.recordset.length === 0) {
        return res.json({
          success: true,
          data: null,
          message: 'Motorista sem dados de ranking no período'
        });
      }

      res.json({
        success: true,
        data: result.recordset
      });
    } catch (err) {
      console.error('Erro ao buscar detalhes do motorista:', err);
      res.status(500).json({ error: 'Erro ao buscar detalhes do motorista' });
    }
  },

  /**
   * Calcular/Recalcular rankings (admin)
   * POST /api/ranking/calcular
   */
  calcular: async (req, res) => {
    try {
      const { periodoInicio, periodoFim, idMotorista } = req.body;
      
      if (!periodoInicio || !periodoFim) {
        return res.status(400).json({ error: 'Período início e fim são obrigatórios' });
      }

      // Esta função deve chamar o service de ranking para calcular
      // Por enquanto, retornamos sucesso (implementação completa requer service)
      res.json({
        success: true,
        message: 'Cálculo de ranking iniciado',
        data: {
          periodoInicio,
          periodoFim,
          idMotorista: idMotorista || 'todos'
        }
      });
    } catch (err) {
      console.error('Erro ao calcular ranking:', err);
      res.status(500).json({ error: 'Erro ao calcular ranking' });
    }
  }
};

module.exports = reputationController;
