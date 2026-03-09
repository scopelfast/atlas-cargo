// backend/controllers/alert.controller.js
// Controller para gerenciar alertas inteligentes
// Versão: 2.0 - Módulo separado
// Data: 2026-01-16
// Última atualização: 2026-01-18
//
// Este controller gerencia todas as operações relacionadas a alertas do sistema.
// Inclui funcionalidades para listar, filtrar, tratar, marcar como lido, cancelar
// e consultar histórico de alertas. Todas as ações são registradas no histórico
// para auditoria e rastreabilidade.
//
// Endpoints principais:
// - GET    /api/alertas - Listar alertas com filtros
// - GET    /api/alertas/pendentes - Apenas pendentes
// - GET    /api/alertas/:id - Detalhes de um alerta
// - GET    /api/alertas/:id/historico - Histórico de ações
// - POST   /api/alertas/:id/ler - Marcar como lido
// - POST   /api/alertas/:id/tratar - Tratar alerta
// - PUT    /api/alertas/:id - Atualizar alerta
// - DELETE /api/alertas/:id - Cancelar alerta
// - GET    /api/alertas/contador - Contador de pendentes

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

      const idViagemNum = parseInt(idviagem, 10);
      const alertas = await alertService.buscarAlertasAtivos(idViagemNum);

      // Incluir alertas SOS da viagem (mesma fonte das "Notificações Recentes" do dashboard)
      let sosAlertas = [];
      try {
        const { poolPromise } = require('../config/db');
        const pool = await poolPromise;
        const sosResult = await pool.query(
          `SELECT sa."ID", sa."CDVIAGEM", sa."CREATED_AT", sa."STATUS", sa."LOCATION",
                  cg."RZSOCIAL" AS nome_motorista
           FROM public."SOS_ALERTS" sa
           LEFT JOIN public."CADASTROGERAL" cg ON sa."CDMOTORISTA" = cg."CDCADASTRO"
           WHERE sa."CDVIAGEM" = $1
           ORDER BY sa."CREATED_AT" DESC`,
          [idViagemNum]
        );
        const rows = sosResult.rows || [];
        sosAlertas = rows.map(r => ({
          ID: r.ID ?? r.id,
          IDVIAGEM: r.CDVIAGEM ?? r.cdviagem ?? idViagemNum,
          TYPE: 'SOS',
          TIPO: 'SOS',
          SEVERITY: 'high',
          MESSAGE: 'Alerta de emergência',
          MENSAGEM: 'Alerta de emergência',
          STATUS: r.STATUS ?? r.status ?? 'ATIVO',
          CREATED_AT: r.CREATED_AT ?? r.created_at,
          DHREGISTRO: r.CREATED_AT ?? r.created_at,
          origem: 'SOS_ALERTS'
        }));
      } catch (errSos) {
        if (errSos.code !== '42P01') {
          console.warn('Erro ao buscar SOS para viagem:', errSos.message);
        }
      }

      const todos = [...sosAlertas, ...alertas].sort((a, b) => {
        const da = new Date(a.CREATED_AT || a.DHREGISTRO || 0);
        const db = new Date(b.CREATED_AT || b.DHREGISTRO || 0);
        return db - da;
      });

      res.json({
        success: true,
        alertas: todos,
        total: todos.length
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
      const sql = require('../config/mssql-compat');
      const { poolPromise } = require('../config/db');
      
      const pool = await poolPromise;
      const result = await pool.request().query(`
        SELECT 
          [alrt].[ID],
          [alrt].[IDVIAGEM],
          [alrt].[CDMOTORISTA],
          [alrt].[TYPE],
          [alrt].[MESSAGE],
          [alrt].[SEVERITY],
          [alrt].[DETAILS],
          [alrt].[CREATED_AT],
          [v].[IDVIAGEM] AS [viagem_codigo],
          [cg].[RZSOCIAL] AS [motorista_nome]
        FROM [dbo].[ALERTS] [alrt]
        LEFT JOIN [dbo].[VIAGEMMESTRE] [v] ON [alrt].[IDVIAGEM] = [v].[IDVIAGEM]
        LEFT JOIN [dbo].[CADASTROGERAL] [cg] ON [alrt].[CDMOTORISTA] = [cg].[CDCADASTRO]
        WHERE [alrt].[RESOLVED] = false
        ORDER BY 
          CASE [alrt].[SEVERITY]
            WHEN 'high' THEN 1
            WHEN 'medium' THEN 2
            WHEN 'low' THEN 3
          END,
          [alrt].[CREATED_AT] DESC
        LIMIT 50
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
  },

  /**
   * Listar alertas com filtros avançados
   * 
   * GET /api/alertas?status=Pendente&tipo=Entrega&prioridade=Alta&dataInicio=2024-01-01&dataFim=2024-01-31&idViagem=123&idMotorista=456&limit=50&offset=0
   * 
   * @description
   * Lista alertas do sistema com suporte a múltiplos filtros:
   * - status: Filtra por status (Pendente, Em Análise, Tratado, Cancelado)
   * - tipo: Filtra por tipo de alerta (parada, atraso, offline, desvio, etc)
   * - prioridade: Filtra por prioridade (Baixa, Normal, Alta, Urgente)
   * - dataInicio/dataFim: Filtra por período de criação
   * - idViagem: Filtra por viagem específica
   * - idMotorista: Filtra por motorista específico
   * - limit/offset: Paginação
   * 
   * @param {Object} req.query - Query parameters com filtros
   * @param {string} [req.query.status] - Status do alerta
   * @param {string} [req.query.tipo] - Tipo do alerta
   * @param {string} [req.query.prioridade] - Prioridade do alerta
   * @param {string} [req.query.dataInicio] - Data inicial (YYYY-MM-DD)
   * @param {string} [req.query.dataFim] - Data final (YYYY-MM-DD)
   * @param {number} [req.query.idViagem] - ID da viagem
   * @param {number} [req.query.idMotorista] - ID do motorista
   * @param {number} [req.query.limit=50] - Limite de registros
   * @param {number} [req.query.offset=0] - Offset para paginação
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - data: Array de alertas
   *   - total: Total de registros encontrados
   *   - pendentes: Total de alertas pendentes (para badge)
   * 
   * @example
   * // Buscar alertas pendentes de alta prioridade
   * GET /api/alertas?status=Pendente&prioridade=Alta
   * 
   * @author Atlas Cargo
   * @since 2.0
   */
  listar: async (req, res) => {
    try {
      const sql = require('../config/mssql-compat');
      const { poolPromise } = require('../config/db');
      const { status, tipo, prioridade, dataInicio, dataFim, idViagem, idMotorista, limit = 50, offset = 0 } = req.query;
      
      const pool = await poolPromise;
      const request = pool.request();
      
      let query = `
        SELECT 
          [alrt].[ID],
          [alrt].[IDVIAGEM],
          [alrt].[CDMOTORISTA],
          [alrt].[TYPE],
          [alrt].[MESSAGE],
          [alrt].[SEVERITY],
          [alrt].[PRIORIDADE],
          [alrt].[STATUS],
          [alrt].[DETAILS],
          [alrt].[CREATED_AT],
          [alrt].[ID_USUARIO_LEU],
          [alrt].[DH_LEITURA],
          [alrt].[ID_USUARIO_TRATOU],
          [alrt].[DH_TRATAMENTO],
          [alrt].[OBSERVACOES],
          [v].[IDVIAGEM] AS [viagem_codigo],
          [cg].[RZSOCIAL] AS [motorista_nome],
          [u1].[RZSOCIAL] AS [usuario_leu_nome],
          [u2].[RZSOCIAL] AS [usuario_tratou_nome]
        FROM [dbo].[ALERTS] [alrt]
        LEFT JOIN [dbo].[VIAGEMMESTRE] [v] ON [alrt].[IDVIAGEM] = [v].[IDVIAGEM]
        LEFT JOIN [dbo].[CADASTROGERAL] [cg] ON [alrt].[CDMOTORISTA] = [cg].[CDCADASTRO]
        LEFT JOIN [dbo].[CADASTROGERAL] [u1] ON [alrt].[ID_USUARIO_LEU] = [u1].[CDCADASTRO]
        LEFT JOIN [dbo].[CADASTROGERAL] [u2] ON [alrt].[ID_USUARIO_TRATOU] = [u2].[CDCADASTRO]
        WHERE 1=1
      `;

      if (status) {
        request.input('status', sql.NVarChar(50), status);
        query += ` AND [alrt].[STATUS] = @status`;
      }
      if (tipo) {
        request.input('tipo', sql.NVarChar(50), tipo);
        query += ` AND [alrt].[TYPE] = @tipo`;
      }
      if (prioridade) {
        request.input('prioridade', sql.NVarChar(20), prioridade);
        query += ` AND [alrt].[PRIORIDADE] = @prioridade`;
      }
      if (dataInicio) {
        request.input('dataInicio', sql.DateTime2, dataInicio);
        query += ` AND CAST([alrt].[CREATED_AT] AS DATE) >= CAST(@dataInicio AS DATE)`;
      }
      if (dataFim) {
        request.input('dataFim', sql.DateTime2, dataFim);
        query += ` AND CAST([alrt].[CREATED_AT] AS DATE) <= CAST(@dataFim AS DATE)`;
      }
      if (idViagem) {
        request.input('idViagem', sql.Decimal(15, 0), parseFloat(idViagem));
        query += ` AND [alrt].[IDVIAGEM] = @idViagem`;
      }
      if (idMotorista) {
        request.input('idMotorista', sql.Decimal(15, 0), parseFloat(idMotorista));
        query += ` AND [alrt].[CDMOTORISTA] = @idMotorista`;
      }

      query += ` ORDER BY 
        CASE [alrt].[PRIORIDADE]
          WHEN 'Urgente' THEN 1
          WHEN 'Alta' THEN 2
          WHEN 'Normal' THEN 3
          WHEN 'Baixa' THEN 4
          ELSE 5
        END,
        [alrt].[CREATED_AT] DESC
        LIMIT @limit OFFSET @offset
      `;

      request.input('offset', sql.Int, parseInt(offset));
      request.input('limit', sql.Int, parseInt(limit));

      const result = await request.query(query);

      // Contar total (alias alrt para compatibilidade PostgreSQL)
      let countQuery = `SELECT COUNT(*) AS [total] FROM [dbo].[ALERTS] [alrt] WHERE 1=1`;
      const countRequest = pool.request();
      if (status) {
        countRequest.input('status', sql.NVarChar(50), status);
        countQuery += ` AND [alrt].[STATUS] = @status`;
      }
      if (tipo) {
        countRequest.input('tipo', sql.NVarChar(50), tipo);
        countQuery += ` AND [alrt].[TYPE] = @tipo`;
      }
      if (prioridade) {
        countRequest.input('prioridade', sql.NVarChar(20), prioridade);
        countQuery += ` AND [alrt].[PRIORIDADE] = @prioridade`;
      }
      if (dataInicio) {
        countRequest.input('dataInicio', sql.DateTime2, dataInicio);
        countQuery += ` AND CAST([alrt].[CREATED_AT] AS DATE) >= CAST(@dataInicio AS DATE)`;
      }
      if (dataFim) {
        countRequest.input('dataFim', sql.DateTime2, dataFim);
        countQuery += ` AND CAST([alrt].[CREATED_AT] AS DATE) <= CAST(@dataFim AS DATE)`;
      }
      if (idViagem) {
        countRequest.input('idViagem', sql.Decimal(15, 0), parseFloat(idViagem));
        countQuery += ` AND [alrt].[IDVIAGEM] = @idViagem`;
      }
      if (idMotorista) {
        countRequest.input('idMotorista', sql.Decimal(15, 0), parseFloat(idMotorista));
        countQuery += ` AND [alrt].[CDMOTORISTA] = @idMotorista`;
      }

      const countResult = await countRequest.query(countQuery);
      const row0 = countResult.recordset[0];
      const total = row0?.total ?? row0?.TOTAL ?? 0;

      // Contar pendentes
      const pendentesResult = await pool.request().query(`
        SELECT COUNT(*) AS [total] FROM [dbo].[ALERTS]
        WHERE [STATUS] = 'Pendente' OR [STATUS] IS NULL
      `);
      const pendRow = pendentesResult.recordset[0];
      const pendentes = pendRow?.total ?? pendRow?.TOTAL ?? 0;

      res.json({
        success: true,
        data: result.recordset,
        total: total,
        pendentes: pendentes
      });
    } catch (err) {
      console.error('Erro ao listar alertas:', err);
      res.status(500).json({ error: 'Erro ao listar alertas' });
    }
  },

  /**
   * Listar apenas alertas pendentes
   * 
   * GET /api/alertas/pendentes
   * 
   * @description
   * Atalho para listar apenas alertas com status "Pendente".
   * Reutiliza a função listar() com filtro de status pré-definido.
   * Útil para dashboards e painéis que precisam focar em alertas não tratados.
   * 
   * @returns {Object} JSON com lista de alertas pendentes
   * 
   * @example
   * GET /api/alertas/pendentes
   * 
   * @author Atlas Cargo
   * @since 2.0
   */
  listarPendentes: async (req, res) => {
    try {
      req.query.status = 'Pendente';
      return alertController.listar(req, res);
    } catch (err) {
      console.error('Erro ao listar alertas pendentes:', err);
      res.status(500).json({ error: 'Erro ao listar alertas pendentes' });
    }
  },

  /**
   * Buscar detalhes completos de um alerta específico
   * 
   * GET /api/alertas/:id
   * 
   * @description
   * Retorna todos os detalhes de um alerta, incluindo informações da viagem,
   * motorista, usuários que leram/trataram e observações.
   * Usado para exibir modal de detalhes ou página de visualização.
   * 
   * @param {Object} req.params - Parâmetros da rota
   * @param {number} req.params.id - ID do alerta
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - data: Objeto com todos os detalhes do alerta
   * 
   * @throws {404} Se o alerta não for encontrado
   * 
   * @example
   * GET /api/alertas/123
   * 
   * @author Atlas Cargo
   * @since 2.0
   */
  buscarPorId: async (req, res) => {
    try {
      const sql = require('../config/mssql-compat');
      const { poolPromise } = require('../config/db');
      const { id } = req.params;
      
      const pool = await poolPromise;
      const result = await pool.request()
        .input('id', sql.Int, parseInt(id))
        .query(`
          SELECT 
            [alrt].[ID],
            [alrt].[IDVIAGEM],
            [alrt].[CDMOTORISTA],
            [alrt].[TYPE],
            [alrt].[MESSAGE],
            [alrt].[SEVERITY],
            [alrt].[PRIORIDADE],
            [alrt].[STATUS],
            [alrt].[DETAILS],
            [alrt].[CREATED_AT],
            [alrt].[ID_USUARIO_LEU],
            [alrt].[DH_LEITURA],
            [alrt].[ID_USUARIO_TRATOU],
            [alrt].[DH_TRATAMENTO],
            [alrt].[OBSERVACOES],
            [v].[IDVIAGEM] AS [viagem_codigo],
            [cg].[RZSOCIAL] AS [motorista_nome],
            [u1].[RZSOCIAL] AS [usuario_leu_nome],
            [u2].[RZSOCIAL] AS [usuario_tratou_nome]
          FROM [dbo].[ALERTS] [alrt]
          LEFT JOIN [dbo].[VIAGEMMESTRE] [v] ON [alrt].[IDVIAGEM] = [v].[IDVIAGEM]
          LEFT JOIN [dbo].[CADASTROGERAL] [cg] ON [alrt].[CDMOTORISTA] = [cg].[CDCADASTRO]
          LEFT JOIN [dbo].[CADASTROGERAL] [u1] ON [alrt].[ID_USUARIO_LEU] = [u1].[CDCADASTRO]
          LEFT JOIN [dbo].[CADASTROGERAL] [u2] ON [alrt].[ID_USUARIO_TRATOU] = [u2].[CDCADASTRO]
          WHERE [alrt].[ID] = @id
        `);

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Alerta não encontrado' });
      }

      res.json({
        success: true,
        data: result.recordset[0]
      });
    } catch (err) {
      console.error('Erro ao buscar alerta:', err);
      res.status(500).json({ error: 'Erro ao buscar alerta' });
    }
  },

  /**
   * Buscar histórico completo de ações realizadas em um alerta
   * 
   * GET /api/alertas/:id/historico
   * 
   * @description
   * Retorna o histórico completo de todas as ações realizadas em um alerta,
   * incluindo leituras, tratamentos, atualizações e cancelamentos.
   * Cada registro contém: usuário, ação, status anterior/novo, observações e data.
   * Útil para auditoria e rastreabilidade de ações.
   * 
   * @param {Object} req.params - Parâmetros da rota
   * @param {number} req.params.id - ID do alerta
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - data: Array de registros históricos ordenados por data (mais recente primeiro)
   * 
   * @example
   * GET /api/alertas/123/historico
   * 
   * @author Atlas Cargo
   * @since 2.0
   */
  buscarHistorico: async (req, res) => {
    try {
      const sql = require('../config/mssql-compat');
      const { poolPromise } = require('../config/db');
      const { id } = req.params;
      
      const pool = await poolPromise;
      const result = await pool.request()
        .input('id', sql.Int, parseInt(id))
        .query(`
          SELECT 
            [h].[ID],
            [h].[ID_ALERT],
            [h].[ID_USUARIO],
            [h].[ACAO],
            [h].[STATUS_ANTERIOR],
            [h].[STATUS_NOVO],
            [h].[OBSERVACOES],
            [h].[DH_ACAO],
            [u].[RZSOCIAL] AS [usuario_nome]
          FROM [dbo].[ALERT_HISTORY] [h]
          LEFT JOIN [dbo].[CADASTROGERAL] [u] ON [h].[ID_USUARIO] = [u].[CDCADASTRO]
          WHERE [h].[ID_ALERT] = @id
          ORDER BY [h].[DH_ACAO] DESC
        `);

      res.json({
        success: true,
        data: result.recordset
      });
    } catch (err) {
      console.error('Erro ao buscar histórico:', err);
      res.status(500).json({ error: 'Erro ao buscar histórico' });
    }
  },

  /**
   * Marcar alerta como lido por um usuário
   * 
   * POST /api/alertas/:id/ler
   * 
   * @description
   * Marca um alerta como lido, registrando qual usuário leu e quando.
   * A ação é registrada no histórico para auditoria.
   * Emite evento WebSocket para atualizar outros usuários em tempo real.
   * 
   * @param {Object} req.params - Parâmetros da rota
   * @param {number} req.params.id - ID do alerta
   * @param {Object} req.user - Usuário autenticado (via middleware)
   * @param {number} req.user.cdcadastro - ID do usuário
   * @param {Object} [req.body] - Body alternativo (se não usar token)
   * @param {number} [req.body.idUsuario] - ID do usuário (alternativo)
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - message: Mensagem de sucesso
   * 
   * @throws {400} Se ID do usuário não for fornecido
   * 
   * @example
   * POST /api/alertas/123/ler
   * // Body: { "idUsuario": 456 }
   * 
   * @author Atlas Cargo
   * @since 2.0
   */
  marcarComoLido: async (req, res) => {
    try {
      const sql = require('../config/mssql-compat');
      const { poolPromise } = require('../config/db');
      const { id } = req.params;
      const idUsuario = req.user?.cdcadastro || req.user?.id || req.body.idUsuario;
      
      if (!idUsuario) {
        return res.status(400).json({ error: 'ID do usuário é obrigatório' });
      }

      const pool = await poolPromise;
      const transaction = new sql.Transaction(pool);
      
      await transaction.begin();
      
      try {
        // Atualizar alerta
        await transaction.request()
          .input('id', sql.Int, parseInt(id))
          .input('idUsuario', sql.Decimal(15, 0), parseFloat(idUsuario))
          .query(`
            UPDATE [dbo].[ALERTS]
            SET ID_USUARIO_LEU = @idUsuario,
                DH_LEITURA = SYSUTCDATETIME()
            WHERE ID = @id
          `);

        // Registrar no histórico
        await transaction.request()
          .input('idAlert', sql.Int, parseInt(id))
          .input('idUsuario', sql.Decimal(15, 0), parseFloat(idUsuario))
          .query(`
            INSERT INTO [dbo].[ALERT_HISTORY] (ID_ALERT, ID_USUARIO, ACAO, DH_ACAO)
            VALUES (@idAlert, @idUsuario, 'LEU', SYSUTCDATETIME())
          `);

        await transaction.commit();

        // Emitir evento WebSocket
        try {
          const websocketTorre = req.app?.get('websocketTorre');
          if (websocketTorre) {
            websocketTorre.emitirAlertaLido(parseInt(id));
          }
        } catch (err) {
          console.warn('⚠️ Erro ao emitir evento WebSocket:', err.message);
        }

        res.json({ success: true, message: 'Alerta marcado como lido' });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error('Erro ao marcar alerta como lido:', err);
      res.status(500).json({ error: 'Erro ao marcar alerta como lido' });
    }
  },

  /**
   * Tratar alerta (mudar status e registrar tratamento)
   * 
   * POST /api/alertas/:id/tratar
   * 
   * @description
   * Trata um alerta mudando seu status (ex: de "Pendente" para "Tratado").
   * Registra quem tratou, quando tratou e observações opcionais.
   * A ação é registrada no histórico com status anterior e novo.
   * Emite evento WebSocket para atualizar outros usuários.
   * 
   * @param {Object} req.params - Parâmetros da rota
   * @param {number} req.params.id - ID do alerta
   * @param {Object} req.body - Dados do tratamento
   * @param {string} req.body.status - Novo status (Pendente, Em Análise, Tratado, Cancelado)
   * @param {string} [req.body.observacoes] - Observações sobre o tratamento
   * @param {Object} req.user - Usuário autenticado (via middleware)
   * @param {number} req.user.cdcadastro - ID do usuário que está tratando
   * @param {number} [req.body.idUsuario] - ID do usuário (alternativo)
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - message: Mensagem de sucesso
   * 
   * @throws {400} Se status ou ID do usuário não forem fornecidos
   * 
   * @example
   * POST /api/alertas/123/tratar
   * // Body: {
   * //   "status": "Tratado",
   * //   "observacoes": "Problema resolvido com motorista",
   * //   "idUsuario": 456
   * // }
   * 
   * @author Atlas Cargo
   * @since 2.0
   */
  tratar: async (req, res) => {
    try {
      const sql = require('../config/mssql-compat');
      const { poolPromise } = require('../config/db');
      const { id } = req.params;
      const { status, observacoes } = req.body;
      const idUsuario = req.user?.cdcadastro || req.body.idUsuario;
      
      if (!status) {
        return res.status(400).json({ error: 'Status é obrigatório' });
      }
      if (!idUsuario) {
        return res.status(400).json({ error: 'ID do usuário é obrigatório' });
      }

      const pool = await poolPromise;
      const transaction = new sql.Transaction(pool);
      
      await transaction.begin();
      
      try {
        // Buscar status anterior
        const alertaAnterior = await transaction.request()
          .input('id', sql.Int, parseInt(id))
          .query(`SELECT STATUS FROM [dbo].[ALERTS] WHERE ID = @id`);

        const statusAnterior = alertaAnterior.recordset[0]?.STATUS || null;

        // Atualizar alerta
        await transaction.request()
          .input('id', sql.Int, parseInt(id))
          .input('status', sql.NVarChar(50), status)
          .input('idUsuario', sql.Decimal(15, 0), parseFloat(idUsuario))
          .input('observacoes', sql.NVarChar(sql.MAX), observacoes || null)
          .query(`
            UPDATE [dbo].[ALERTS]
            SET STATUS = @status,
                ID_USUARIO_TRATOU = @idUsuario,
                DH_TRATAMENTO = SYSUTCDATETIME(),
                OBSERVACOES = @observacoes
            WHERE ID = @id
          `);

        // Registrar no histórico
        await transaction.request()
          .input('idAlert', sql.Int, parseInt(id))
          .input('idUsuario', sql.Decimal(15, 0), parseFloat(idUsuario))
          .input('statusAnterior', sql.NVarChar(50), statusAnterior)
          .input('statusNovo', sql.NVarChar(50), status)
          .input('observacoes', sql.NVarChar(sql.MAX), observacoes || null)
          .query(`
            INSERT INTO [dbo].[ALERT_HISTORY] 
              (ID_ALERT, ID_USUARIO, ACAO, STATUS_ANTERIOR, STATUS_NOVO, OBSERVACOES, DH_ACAO)
            VALUES (@idAlert, @idUsuario, 'TRATOU', @statusAnterior, @statusNovo, @observacoes, SYSUTCDATETIME())
          `);

        await transaction.commit();

        // Emitir evento WebSocket
        try {
          const websocketTorre = req.app?.get('websocketTorre');
          if (websocketTorre) {
            websocketTorre.emitirAlertaTratado(parseInt(id), status);
          }
        } catch (err) {
          console.warn('⚠️ Erro ao emitir evento WebSocket:', err.message);
        }

        res.json({ success: true, message: 'Alerta tratado com sucesso' });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error('Erro ao tratar alerta:', err);
      res.status(500).json({ error: 'Erro ao tratar alerta' });
    }
  },

  /**
   * Atualizar campos de um alerta
   * 
   * PUT /api/alertas/:id
   * 
   * @description
   * Atualiza campos específicos de um alerta (status, prioridade, observações).
   * Permite atualização parcial - apenas os campos fornecidos são atualizados.
   * Se houver mudança de status, registra no histórico.
   * 
   * @param {Object} req.params - Parâmetros da rota
   * @param {number} req.params.id - ID do alerta
   * @param {Object} req.body - Campos a atualizar
   * @param {string} [req.body.status] - Novo status
   * @param {string} [req.body.prioridade] - Nova prioridade
   * @param {string} [req.body.observacoes] - Novas observações
   * @param {Object} req.user - Usuário autenticado (via middleware)
   * @param {number} req.user.cdcadastro - ID do usuário
   * @param {number} [req.body.idUsuario] - ID do usuário (alternativo)
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - message: Mensagem de sucesso
   * 
   * @throws {400} Se nenhum campo for fornecido para atualizar
   * 
   * @example
   * PUT /api/alertas/123
   * // Body: {
   * //   "prioridade": "Urgente",
   * //   "observacoes": "Aumentar prioridade devido ao atraso"
   * // }
   * 
   * @author Atlas Cargo
   * @since 2.0
   */
  atualizar: async (req, res) => {
    try {
      const sql = require('../config/mssql-compat');
      const { poolPromise } = require('../config/db');
      const { id } = req.params;
      const { status, prioridade, observacoes } = req.body;
      const idUsuario = req.user?.cdcadastro || req.body.idUsuario;
      
      const pool = await poolPromise;
      const request = pool.request();
      request.input('id', sql.Int, parseInt(id));

      let updates = [];
      if (status) {
        request.input('status', sql.NVarChar(50), status);
        updates.push('STATUS = @status');
      }
      if (prioridade) {
        request.input('prioridade', sql.NVarChar(20), prioridade);
        updates.push('PRIORIDADE = @prioridade');
      }
      if (observacoes !== undefined) {
        request.input('observacoes', sql.NVarChar(sql.MAX), observacoes);
        updates.push('OBSERVACOES = @observacoes');
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar' });
      }

      const query = `UPDATE [dbo].[ALERTS] SET ${updates.join(', ')} WHERE ID = @id`;
      await request.query(query);

      // Registrar no histórico se houver mudança de status
      if (status && idUsuario) {
        try {
          await pool.request()
            .input('idAlert', sql.Int, parseInt(id))
            .input('idUsuario', sql.Decimal(15, 0), parseFloat(idUsuario))
            .input('statusNovo', sql.NVarChar(50), status)
            .query(`
              INSERT INTO [dbo].[ALERT_HISTORY] (ID_ALERT, ID_USUARIO, ACAO, STATUS_NOVO, DH_ACAO)
              VALUES (@idAlert, @idUsuario, 'ATUALIZOU', @statusNovo, SYSUTCDATETIME())
            `);
        } catch (err) {
          console.warn('⚠️ Erro ao registrar histórico:', err.message);
        }
      }

      res.json({ success: true, message: 'Alerta atualizado com sucesso' });
    } catch (err) {
      console.error('Erro ao atualizar alerta:', err);
      res.status(500).json({ error: 'Erro ao atualizar alerta' });
    }
  },

  /**
   * Cancelar um alerta
   * 
   * DELETE /api/alertas/:id
   * 
   * @description
   * Cancela um alerta, mudando seu status para "Cancelado".
   * Permite adicionar observações sobre o motivo do cancelamento.
   * A ação é registrada no histórico com status anterior e novo status "Cancelado".
   * Emite evento WebSocket para atualizar outros usuários.
   * 
   * @param {Object} req.params - Parâmetros da rota
   * @param {number} req.params.id - ID do alerta
   * @param {Object} req.body - Dados do cancelamento
   * @param {string} [req.body.observacoes] - Observações sobre o cancelamento
   * @param {Object} req.user - Usuário autenticado (via middleware)
   * @param {number} req.user.cdcadastro - ID do usuário que está cancelando
   * @param {number} [req.body.idUsuario] - ID do usuário (alternativo)
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - message: Mensagem de sucesso
   * 
   * @throws {400} Se ID do usuário não for fornecido
   * 
   * @example
   * DELETE /api/alertas/123
   * // Body: {
   * //   "observacoes": "Alerta falso positivo, motorista já chegou",
   * //   "idUsuario": 456
   * // }
   * 
   * @author Atlas Cargo
   * @since 2.0
   */
  cancelar: async (req, res) => {
    try {
      const sql = require('../config/mssql-compat');
      const { poolPromise } = require('../config/db');
      const { id } = req.params;
      const { observacoes } = req.body;
      const idUsuario = req.user?.cdcadastro || req.body.idUsuario;
      
      if (!idUsuario) {
        return res.status(400).json({ error: 'ID do usuário é obrigatório' });
      }

      const pool = await poolPromise;
      const transaction = new sql.Transaction(pool);
      
      await transaction.begin();
      
      try {
        // Buscar status anterior
        const alertaAnterior = await transaction.request()
          .input('id', sql.Int, parseInt(id))
          .query(`SELECT STATUS FROM [dbo].[ALERTS] WHERE ID = @id`);

        const statusAnterior = alertaAnterior.recordset[0]?.STATUS || null;

        // Atualizar alerta
        await transaction.request()
          .input('id', sql.Int, parseInt(id))
          .input('observacoes', sql.NVarChar(sql.MAX), observacoes || null)
          .query(`
            UPDATE [dbo].[ALERTS]
            SET STATUS = 'Cancelado',
                OBSERVACOES = @observacoes
            WHERE ID = @id
          `);

        // Registrar no histórico
        await transaction.request()
          .input('idAlert', sql.Int, parseInt(id))
          .input('idUsuario', sql.Decimal(15, 0), parseFloat(idUsuario))
          .input('statusAnterior', sql.NVarChar(50), statusAnterior)
          .input('observacoes', sql.NVarChar(sql.MAX), observacoes || null)
          .query(`
            INSERT INTO [dbo].[ALERT_HISTORY] 
              (ID_ALERT, ID_USUARIO, ACAO, STATUS_ANTERIOR, STATUS_NOVO, OBSERVACOES, DH_ACAO)
            VALUES (@idAlert, @idUsuario, 'CANCELOU', @statusAnterior, 'Cancelado', @observacoes, SYSUTCDATETIME())
          `);

        await transaction.commit();

        // Emitir evento WebSocket
        try {
          const websocketTorre = req.app?.get('websocketTorre');
          if (websocketTorre) {
            websocketTorre.emitirAlertaCancelado(parseInt(id));
          }
        } catch (err) {
          console.warn('⚠️ Erro ao emitir evento WebSocket:', err.message);
        }

        res.json({ success: true, message: 'Alerta cancelado com sucesso' });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error('Erro ao cancelar alerta:', err);
      res.status(500).json({ error: 'Erro ao cancelar alerta' });
    }
  },

  /**
   * Obter contador de alertas pendentes (para badge no menu)
   * 
   * GET /api/alertas/contador
   * 
   * @description
   * Retorna contadores de alertas pendentes para exibir badges no menu.
   * Inclui total de pendentes, urgentes e altas.
   * Otimizado para ser chamado frequentemente sem impacto de performance.
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - data: Objeto com contadores
   *     - total: Total de alertas pendentes
   *     - urgentes: Total de alertas urgentes pendentes
   *     - altas: Total de alertas de alta prioridade pendentes
   * 
   * @example
   * GET /api/alertas/contador
   * // Response: {
   * //   "success": true,
   * //   "data": {
   * //     "total": 15,
   * //     "urgentes": 3,
   * //     "altas": 5
   * //   }
   * // }
   * 
   * @author Atlas Cargo
   * @since 2.0
   */
  contador: async (req, res) => {
    try {
      const { poolPromise } = require('../config/db');
      const pool = await poolPromise;
      const result = await pool.query(`
        SELECT 
          COUNT(*)::int AS total,
          COALESCE(SUM(CASE WHEN "STATUS" = 'Pendente' OR "STATUS" IS NULL THEN 1 ELSE 0 END), 0)::int AS pendentes,
          COALESCE(SUM(CASE WHEN "STATUS" = 'Em Análise' THEN 1 ELSE 0 END), 0)::int AS "emAnalise",
          COALESCE(SUM(CASE WHEN "STATUS" = 'Tratado' THEN 1 ELSE 0 END), 0)::int AS tratados,
          COALESCE(SUM(CASE WHEN "STATUS" = 'Cancelado' THEN 1 ELSE 0 END), 0)::int AS cancelados,
          COALESCE(SUM(CASE WHEN ("STATUS" = 'Pendente' OR "STATUS" IS NULL) AND "PRIORIDADE" = 'Urgente' THEN 1 ELSE 0 END), 0)::int AS urgentes,
          COALESCE(SUM(CASE WHEN ("STATUS" = 'Pendente' OR "STATUS" IS NULL) AND "PRIORIDADE" = 'Alta' THEN 1 ELSE 0 END), 0)::int AS altas
        FROM "ALERTS"
      `);

      const stats = result.rows[0] || {};
      
      // Garantir que todos os valores sejam números
      const data = {
        total: parseInt(stats.total) || 0,
        pendentes: parseInt(stats.pendentes) || 0,
        emAnalise: parseInt(stats.emAnalise) || 0,
        tratados: parseInt(stats.tratados) || 0,
        cancelados: parseInt(stats.cancelados) || 0,
        urgentes: parseInt(stats.urgentes) || 0,
        altas: parseInt(stats.altas) || 0
      };

      res.json({
        success: true,
        data: data
      });
    } catch (err) {
      console.error('Erro ao buscar contador:', err);
      res.status(500).json({ error: 'Erro ao buscar contador' });
    }
  }
};

module.exports = alertController;
