// backend/controllers/sos.controller.js
// Controller para Alertas SOS (Emergência)
// Versão: 2.0 - Módulo separado
// Data: 2025-01-16
// Última atualização: 2025-01-18
//
// Este controller gerencia todas as operações relacionadas a alertas SOS (emergências).
// Inclui funcionalidades para listar, filtrar, tratar, marcar como lido e consultar
// histórico de SOS. Todas as ações são registradas no histórico para auditoria.
// SOS são alertas críticos de emergência que requerem resposta rápida.
//
// Endpoints principais:
// - GET    /api/sos - Listar SOS com filtros
// - GET    /api/sos/pendentes - Apenas pendentes
// - GET    /api/sos/:id - Detalhes de um SOS
// - GET    /api/sos/:id/historico - Histórico de ações
// - POST   /api/sos/:id/ler - Marcar como lido
// - POST   /api/sos/:id/tratar - Tratar SOS
// - PUT    /api/sos/:id - Atualizar SOS
// - GET    /api/sos/contador - Contador de pendentes

const sql = require('mssql');
const { poolPromise } = require('../config/db');

const sosController = {
  /**
   * Criar alerta SOS
   * POST /api/motorista/sos
   */
  criar: async (req, res) => {
    try {
      const {
        idviagem,
        latitude,
        longitude,
        message,
        idmotorista,
        cdMotorista
      } = req.body;

      // Tentar obter ID do motorista de várias fontes
      const motoristaId = idmotorista || cdMotorista || req.user?.idmotorista || req.user?.cdcadastro;

      if (!motoristaId) {
        console.error('❌ [SOS] ID do motorista não encontrado');
        console.error('❌ [SOS] Body:', JSON.stringify(req.body, null, 2));
        console.error('❌ [SOS] User:', req.user);
        return res.status(400).json({ error: 'ID do motorista é obrigatório' });
      }

      if (!latitude || !longitude) {
        return res.status(400).json({ error: 'Coordenadas GPS são obrigatórias' });
      }

      const pool = await poolPromise;

      // Criar ponto geográfico
      const locationPoint = `POINT(${longitude} ${latitude})`;

      // Inserir alerta SOS
      const request = pool.request();
      request.input('cdmotorista', sql.Decimal(15, 0), motoristaId);
      request.input('cdviagem', sql.Decimal(15, 0), idviagem || null);
      request.input('latitude', sql.Float, latitude);
      request.input('longitude', sql.Float, longitude);
      request.input('message', sql.NVarChar(500), message || null);
      request.input('priority', sql.NVarChar(10), 'critical'); // SOS sempre é crítico

      const result = await request.query(`
        INSERT INTO SOS_ALERTS (
          CDMOTORISTA,
          CDVIAGEM,
          LATITUDE,
          LONGITUDE,
          LOCATION,
          MESSAGE,
          PRIORITY,
          STATUS,
          CREATED_AT,
          SYNCED
        )
        VALUES (
          @cdmotorista,
          @cdviagem,
          @latitude,
          @longitude,
          geography::STPointFromText('${locationPoint}', 4326),
          @message,
          @priority,
          'active',
          SYSUTCDATETIME(),
          1
        );
        SELECT SCOPE_IDENTITY() AS ID;
      `);

      const idAlerta = result.recordset[0].ID;

      // Buscar dados completos do alerta criado
      const alertaRequest = pool.request();
      alertaRequest.input('id', sql.Int, idAlerta);

      // Verificar se o campo LOCATION_DESCRIPTION existe
      let locationDescriptionField = '';
      try {
        const checkField = await pool.request().query(`
          SELECT COUNT(*) as existe
          FROM sys.columns 
          WHERE object_id = OBJECT_ID(N'[dbo].[SOS_ALERTS]') 
          AND name = 'LOCATION_DESCRIPTION'
        `);
        if (checkField.recordset[0].existe > 0) {
          locationDescriptionField = 'sa.LOCATION_DESCRIPTION,';
        }
      } catch (err) {
        console.warn('⚠️ Erro ao verificar campo LOCATION_DESCRIPTION:', err.message);
      }

      const alerta = await alertaRequest.query(`
        SELECT 
          sa.ID,
          sa.CDMOTORISTA,
          sa.CDVIAGEM,
          sa.LATITUDE,
          sa.LONGITUDE,
          ${locationDescriptionField}
          sa.STATUS,
          sa.PRIORITY,
          sa.MESSAGE,
          sa.CREATED_AT,
          cg.RZSOCIAL AS NOME_MOTORISTA,
          vm.IDVIAGEM,
          ISNULL(co.NMCIDADE + '/' + co.ESTADO, 'Não informado') AS ORIGEM,
          ISNULL(cd.NMCIDADE + '/' + cd.ESTADO, 'Não informado') AS DESTINO
        FROM SOS_ALERTS sa
        LEFT JOIN CADASTROGERAL cg ON sa.CDMOTORISTA = cg.CDCADASTRO
        LEFT JOIN VIAGEMMESTRE vm ON sa.CDVIAGEM = vm.IDVIAGEM
        LEFT JOIN ROTEIRO r ON vm.IDROTEIRO = r.IDROTEIRO
        LEFT JOIN CIDADE co ON r.CDCIDADEORIGEM = co.CDCIDADE
        LEFT JOIN CIDADE cd ON r.CDCIDADEDESTINO = cd.CDCIDADE
        WHERE sa.ID = @id
      `);
      
      // Adicionar LOCATION_DESCRIPTION se o campo existir
      if (alerta.recordset.length > 0) {
        try {
          const checkField = await pool.request().query(`
            SELECT COUNT(*) as existe
            FROM sys.columns 
            WHERE object_id = OBJECT_ID(N'[dbo].[SOS_ALERTS]') 
            AND name = 'LOCATION_DESCRIPTION'
          `);
          if (checkField.recordset[0].existe > 0) {
            const descResult = await pool.request()
              .input('id', sql.Int, parseInt(idAlerta))
              .query(`SELECT LOCATION_DESCRIPTION FROM [dbo].[SOS_ALERTS] WHERE ID = @id`);
            if (descResult.recordset.length > 0) {
              alerta.recordset[0].LOCATION_DESCRIPTION = descResult.recordset[0].LOCATION_DESCRIPTION;
            }
          }
        } catch (err) {
          console.warn('⚠️ Erro ao buscar LOCATION_DESCRIPTION:', err.message);
        }
      }

      // Emitir evento WebSocket para Torre de Controle
      try {
        const websocketTorre = req.app ? req.app.get('websocketTorre') : null;
        if (websocketTorre && alerta.recordset[0]) {
          websocketTorre.emitirSOS(alerta.recordset[0]);
        }
        
        // Também emitir via Socket.io direto (compatibilidade com sistema existente)
        const io = req.app ? req.app.get('io') : null;
        if (io) {
          io.emit('sos-alerta', {
            type: 'novo',
            alerta: alerta.recordset[0]
          });
        }
      } catch (err) {
        console.warn('⚠️ Erro ao emitir evento WebSocket SOS:', err.message);
      }

      res.json({
        success: true,
        message: 'Alerta SOS criado com sucesso',
        alerta: alerta.recordset[0]
      });

    } catch (error) {
      console.error('Erro ao criar alerta SOS:', error);
      res.status(500).json({ 
        error: 'Erro ao criar alerta SOS',
        details: error.message 
      });
    }
  },

  /**
   * Listar alertas SOS ativos
   * GET /api/sos/ativos
   */
  listarAtivos: async (req, res) => {
    try {
      const pool = await poolPromise;
      const request = pool.request();

      const result = await request.query(`
        SELECT 
          sa.ID,
          sa.CDMOTORISTA,
          sa.CDVIAGEM,
          sa.LATITUDE,
          sa.LONGITUDE,
          sa.STATUS,
          sa.PRIORITY,
          sa.MESSAGE,
          sa.CREATED_AT,
          cg.RZSOCIAL AS NOME_MOTORISTA,
          cg.NRCELULAR AS CELULAR_MOTORISTA,
          vm.IDVIAGEM,
          ISNULL(co.NMCIDADE + '/' + co.ESTADO, 'Não informado') AS ORIGEM,
          ISNULL(cd.NMCIDADE + '/' + cd.ESTADO, 'Não informado') AS DESTINO
        FROM SOS_ALERTS sa
        LEFT JOIN CADASTROGERAL cg ON sa.CDMOTORISTA = cg.CDCADASTRO
        LEFT JOIN VIAGEMMESTRE vm ON sa.CDVIAGEM = vm.IDVIAGEM
        LEFT JOIN ROTEIRO r ON vm.IDROTEIRO = r.IDROTEIRO
        LEFT JOIN CIDADE co ON r.CDCIDADEORIGEM = co.CDCIDADE
        LEFT JOIN CIDADE cd ON r.CDCIDADEDESTINO = cd.CDCIDADE
        WHERE sa.STATUS = 'active'
        ORDER BY sa.CREATED_AT DESC
      `);
      
      // Adicionar LOCATION_DESCRIPTION se o campo existir
      if (result.recordset.length > 0) {
        try {
          const checkField = await pool.request().query(`
            SELECT COUNT(*) as existe
            FROM sys.columns 
            WHERE object_id = OBJECT_ID(N'[dbo].[SOS_ALERTS]') 
            AND name = 'LOCATION_DESCRIPTION'
          `);
          if (checkField.recordset[0].existe > 0) {
            const ids = result.recordset.map(r => r.ID).join(',');
            if (ids) {
              const descResult = await pool.request().query(`
                SELECT ID, LOCATION_DESCRIPTION 
                FROM [dbo].[SOS_ALERTS] 
                WHERE ID IN (${ids})
              `);
              const descMap = {};
              descResult.recordset.forEach(row => {
                descMap[row.ID] = row.LOCATION_DESCRIPTION;
              });
              result.recordset.forEach(sos => {
                sos.LOCATION_DESCRIPTION = descMap[sos.ID] || null;
              });
            }
          }
        } catch (err) {
          console.warn('⚠️ Erro ao buscar LOCATION_DESCRIPTION:', err.message);
        }
      }

      res.json({
        success: true,
        alertas: result.recordset
      });

    } catch (error) {
      console.error('Erro ao listar alertas SOS:', error);
      res.status(500).json({ 
        error: 'Erro ao listar alertas SOS',
        details: error.message 
      });
    }
  },

  /**
   * Resolver alerta SOS
   * PUT /api/sos/:id/resolver
   */
  resolver: async (req, res) => {
    try {
      const { id } = req.params;
      const { notes } = req.body;
      const { idusuario } = req.user || {}; // Usuário que está resolvendo

      const pool = await poolPromise;
      const request = pool.request();
      request.input('id', sql.Int, id);
      request.input('resolvedBy', sql.Decimal(15, 0), idusuario || null);
      request.input('notes', sql.NVarChar(500), notes || null);

      await request.query(`
        UPDATE SOS_ALERTS
        SET 
          STATUS = 'resolved',
          RESOLVED_AT = SYSUTCDATETIME(),
          RESOLVED_BY = @resolvedBy,
          RESOLUTION_NOTES = @notes
        WHERE ID = @id AND STATUS = 'active'
      `);

      // Emitir evento WebSocket
      try {
        const websocketTorre = req.app ? req.app.get('websocketTorre') : null;
        if (websocketTorre) {
          // Buscar ID da viagem se houver
          const viagemResult = await pool.request()
            .input('id', sql.Int, id)
            .query(`SELECT TOP 1 CDVIAGEM FROM SOS_ALERTS WHERE ID = @id`);
          const idviagem = viagemResult.recordset.length > 0 
            ? viagemResult.recordset[0].CDVIAGEM 
            : null;
          websocketTorre.emitirAlertaResolvido(id, idviagem);
        }

        // Também emitir via Socket.io direto (compatibilidade)
        const io = req.app ? req.app.get('io') : null;
        if (io) {
          io.emit('sos-alerta', {
            type: 'resolvido',
            id: id
          });
        }
      } catch (err) {
        console.warn('⚠️ Erro ao emitir evento WebSocket SOS resolvido:', err.message);
      }

      res.json({
        success: true,
        message: 'Alerta SOS resolvido com sucesso'
      });

    } catch (error) {
      console.error('Erro ao resolver alerta SOS:', error);
      res.status(500).json({ 
        error: 'Erro ao resolver alerta SOS',
        details: error.message 
      });
    }
  },

  /**
   * Buscar alertas por motorista
   * GET /api/motorista/sos/historico
   */
  historico: async (req, res) => {
    try {
      const { idmotorista } = req.user || req.query;

      if (!idmotorista) {
        return res.status(400).json({ error: 'ID do motorista é obrigatório' });
      }

      const pool = await poolPromise;
      const request = pool.request();
      request.input('cdmotorista', sql.Decimal(15, 0), idmotorista);

      const result = await request.query(`
        SELECT 
          sa.ID,
          sa.CDMOTORISTA,
          sa.CDVIAGEM,
          sa.LATITUDE,
          sa.LONGITUDE,
          sa.STATUS,
          sa.PRIORITY,
          sa.MESSAGE,
          sa.CREATED_AT,
          sa.RESOLVED_AT,
          vm.IDVIAGEM,
          ISNULL(co.NMCIDADE + '/' + co.ESTADO, 'Não informado') AS ORIGEM,
          ISNULL(cd.NMCIDADE + '/' + cd.ESTADO, 'Não informado') AS DESTINO
        FROM SOS_ALERTS sa
        LEFT JOIN VIAGEMMESTRE vm ON sa.CDVIAGEM = vm.IDVIAGEM
        LEFT JOIN ROTEIRO r ON vm.IDROTEIRO = r.IDROTEIRO
        LEFT JOIN CIDADE co ON r.CDCIDADEORIGEM = co.CDCIDADE
        LEFT JOIN CIDADE cd ON r.CDCIDADEDESTINO = cd.CDCIDADE
        WHERE sa.CDMOTORISTA = @cdmotorista
        ORDER BY sa.CREATED_AT DESC
      `);

      res.json({
        success: true,
        alertas: result.recordset
      });

    } catch (error) {
      console.error('Erro ao buscar histórico SOS:', error);
      res.status(500).json({ 
        error: 'Erro ao buscar histórico SOS',
        details: error.message 
      });
    }
  },

  /**
   * Listar alertas SOS com filtros avançados
   * 
   * GET /api/sos?status=active&dataInicio=2024-01-01&dataFim=2024-01-31&idViagem=123&idMotorista=456&limit=50&offset=0
   * 
   * @description
   * Lista alertas SOS do sistema com suporte a múltiplos filtros.
   * Retorna informações completas incluindo localização GPS, motorista, viagem
   * e usuários que leram/trataram. Ordenado por data de criação (mais recente primeiro).
   * 
   * @param {Object} req.query - Query parameters com filtros
   * @param {string} [req.query.status] - Status do SOS (active, resolved)
   * @param {string} [req.query.dataInicio] - Data inicial (YYYY-MM-DD)
   * @param {string} [req.query.dataFim] - Data final (YYYY-MM-DD)
   * @param {number} [req.query.idViagem] - ID da viagem
   * @param {number} [req.query.idMotorista] - ID do motorista
   * @param {number} [req.query.limit=50] - Limite de registros
   * @param {number} [req.query.offset=0] - Offset para paginação
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - data: Array de alertas SOS
   *   - total: Total de registros encontrados
   *   - pendentes: Total de SOS pendentes (para badge)
   * 
   * @author Sistema DivulgaCarga
   * @since 2.0
   */
  listar: async (req, res) => {
    try {
      const { status, dataInicio, dataFim, idViagem, idMotorista, limit = 50, offset = 0 } = req.query;
      
      const pool = await poolPromise;
      const request = pool.request();

      let query = `
        SELECT 
          sa.ID,
          sa.CDMOTORISTA,
          sa.CDVIAGEM,
          sa.LATITUDE,
          sa.LONGITUDE,
          sa.STATUS,
          sa.PRIORITY,
          sa.MESSAGE,
          sa.CREATED_AT,
          sa.RESOLVED_AT,
          sa.RESOLVED_BY,
          sa.ID_USUARIO_LEU,
          sa.DH_LEITURA,
          sa.TEMPO_RESPOSTA,
          cg.RZSOCIAL AS NOME_MOTORISTA,
          cg.NRCELULAR AS CELULAR_MOTORISTA,
          vm.IDVIAGEM,
          ISNULL(co.NMCIDADE + '/' + co.ESTADO, 'Não informado') AS ORIGEM,
          ISNULL(cd.NMCIDADE + '/' + cd.ESTADO, 'Não informado') AS DESTINO,
          u1.RZSOCIAL as usuario_leu_nome,
          u2.RZSOCIAL as usuario_resolveu_nome
        FROM [dbo].[SOS_ALERTS] sa
        LEFT JOIN [dbo].[CADASTROGERAL] cg ON sa.CDMOTORISTA = cg.CDCADASTRO
        LEFT JOIN [dbo].[VIAGEMMESTRE] vm ON sa.CDVIAGEM = vm.IDVIAGEM
        LEFT JOIN [dbo].[ROTEIRO] r ON vm.IDROTEIRO = r.IDROTEIRO
        LEFT JOIN [dbo].[CIDADE] co ON r.CDCIDADEORIGEM = co.CDCIDADE
        LEFT JOIN [dbo].[CIDADE] cd ON r.CDCIDADEDESTINO = cd.CDCIDADE
        LEFT JOIN [dbo].[CADASTROGERAL] u1 ON sa.ID_USUARIO_LEU = u1.CDCADASTRO
        LEFT JOIN [dbo].[CADASTROGERAL] u2 ON sa.RESOLVED_BY = u2.CDCADASTRO
        WHERE 1=1
      `;

      if (status) {
        request.input('status', sql.NVarChar(50), status);
        query += ` AND sa.STATUS = @status`;
      }
      if (dataInicio) {
        request.input('dataInicio', sql.DateTime2, dataInicio);
        query += ` AND CAST(sa.CREATED_AT AS DATE) >= CAST(@dataInicio AS DATE)`;
      }
      if (dataFim) {
        request.input('dataFim', sql.DateTime2, dataFim);
        query += ` AND CAST(sa.CREATED_AT AS DATE) <= CAST(@dataFim AS DATE)`;
      }
      if (idViagem) {
        request.input('idViagem', sql.Decimal(15, 0), parseFloat(idViagem));
        query += ` AND sa.CDVIAGEM = @idViagem`;
      }
      if (idMotorista) {
        request.input('idMotorista', sql.Decimal(15, 0), parseFloat(idMotorista));
        query += ` AND sa.CDMOTORISTA = @idMotorista`;
      }

      query += ` ORDER BY sa.CREATED_AT DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;

      request.input('offset', sql.Int, parseInt(offset));
      request.input('limit', sql.Int, parseInt(limit));

      const result = await request.query(query);

      // Contar total
      let countQuery = `SELECT COUNT(*) as total FROM [dbo].[SOS_ALERTS] sa WHERE 1=1`;
      const countRequest = pool.request();
      if (status) {
        countRequest.input('status', sql.NVarChar(50), status);
        countQuery += ` AND sa.STATUS = @status`;
      }
      if (dataInicio) {
        countRequest.input('dataInicio', sql.DateTime2, dataInicio);
        countQuery += ` AND CAST(sa.CREATED_AT AS DATE) >= CAST(@dataInicio AS DATE)`;
      }
      if (dataFim) {
        countRequest.input('dataFim', sql.DateTime2, dataFim);
        countQuery += ` AND CAST(sa.CREATED_AT AS DATE) <= CAST(@dataFim AS DATE)`;
      }
      if (idViagem) {
        countRequest.input('idViagem', sql.Decimal(15, 0), parseFloat(idViagem));
        countQuery += ` AND sa.CDVIAGEM = @idViagem`;
      }
      if (idMotorista) {
        countRequest.input('idMotorista', sql.Decimal(15, 0), parseFloat(idMotorista));
        countQuery += ` AND sa.CDMOTORISTA = @idMotorista`;
      }

      const countResult = await countRequest.query(countQuery);
      const total = countResult.recordset[0].total;

      // Contar pendentes
      const pendentesResult = await pool.request().query(`
        SELECT COUNT(*) as total FROM [dbo].[SOS_ALERTS] 
        WHERE STATUS = 'active'
      `);
      const pendentes = pendentesResult.recordset[0].total;

      res.json({
        success: true,
        data: result.recordset,
        total: total,
        pendentes: pendentes
      });
    } catch (err) {
      console.error('Erro ao listar SOS:', err);
      res.status(500).json({ error: 'Erro ao listar SOS' });
    }
  },

  /**
   * Listar apenas SOS pendentes
   * GET /api/sos/pendentes
   */
  listarPendentes: async (req, res) => {
    try {
      req.query.status = 'active';
      return sosController.listar(req, res);
    } catch (err) {
      console.error('Erro ao listar SOS pendentes:', err);
      res.status(500).json({ error: 'Erro ao listar SOS pendentes' });
    }
  },

  /**
   * Buscar detalhes de um SOS
   * GET /api/sos/:id
   */
  buscarPorId: async (req, res) => {
    try {
      const { id } = req.params;
      
      const pool = await poolPromise;
      const result = await pool.request()
        .input('id', sql.Int, parseInt(id))
        .query(`
          SELECT 
            sa.ID,
            sa.CDMOTORISTA,
            sa.CDVIAGEM,
            sa.LATITUDE,
            sa.LONGITUDE,
            sa.STATUS,
            sa.PRIORITY,
            sa.MESSAGE,
            sa.CREATED_AT,
            sa.RESOLVED_AT,
            sa.RESOLVED_BY,
            sa.RESOLUTION_NOTES,
            sa.ID_USUARIO_LEU,
            sa.DH_LEITURA,
            sa.TEMPO_RESPOSTA,
            cg.RZSOCIAL AS NOME_MOTORISTA,
            cg.NRCELULAR AS CELULAR_MOTORISTA,
            vm.IDVIAGEM,
            ISNULL(co.NMCIDADE + '/' + co.ESTADO, 'Não informado') AS ORIGEM,
            ISNULL(cd.NMCIDADE + '/' + cd.ESTADO, 'Não informado') AS DESTINO,
            u1.RZSOCIAL as usuario_leu_nome,
            u2.RZSOCIAL as usuario_resolveu_nome
          FROM [dbo].[SOS_ALERTS] sa
          LEFT JOIN [dbo].[CADASTROGERAL] cg ON sa.CDMOTORISTA = cg.CDCADASTRO
          LEFT JOIN [dbo].[VIAGEMMESTRE] vm ON sa.CDVIAGEM = vm.IDVIAGEM
          LEFT JOIN [dbo].[ROTEIRO] r ON vm.IDROTEIRO = r.IDROTEIRO
          LEFT JOIN [dbo].[CIDADE] co ON r.CDCIDADEORIGEM = co.CDCIDADE
          LEFT JOIN [dbo].[CIDADE] cd ON r.CDCIDADEDESTINO = cd.CDCIDADE
          LEFT JOIN [dbo].[CADASTROGERAL] u1 ON sa.ID_USUARIO_LEU = u1.CDCADASTRO
          LEFT JOIN [dbo].[CADASTROGERAL] u2 ON sa.RESOLVED_BY = u2.CDCADASTRO
          WHERE sa.ID = @id
        `);
      
      // Adicionar LOCATION_DESCRIPTION se o campo existir
      if (result.recordset.length > 0) {
        try {
          const checkField = await pool.request().query(`
            SELECT COUNT(*) as existe
            FROM sys.columns 
            WHERE object_id = OBJECT_ID(N'[dbo].[SOS_ALERTS]') 
            AND name = 'LOCATION_DESCRIPTION'
          `);
          if (checkField.recordset[0].existe > 0) {
            const descResult = await pool.request()
              .input('id', sql.Int, parseInt(id))
              .query(`SELECT LOCATION_DESCRIPTION FROM [dbo].[SOS_ALERTS] WHERE ID = @id`);
            if (descResult.recordset.length > 0) {
              result.recordset[0].LOCATION_DESCRIPTION = descResult.recordset[0].LOCATION_DESCRIPTION;
            }
          }
        } catch (err) {
          console.warn('⚠️ Erro ao buscar LOCATION_DESCRIPTION:', err.message);
        }
      }

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'SOS não encontrado' });
      }

      res.json({
        success: true,
        data: result.recordset[0]
      });
    } catch (err) {
      console.error('Erro ao buscar SOS:', err);
      res.status(500).json({ error: 'Erro ao buscar SOS' });
    }
  },

  /**
   * Buscar histórico de ações de um SOS
   * GET /api/sos/:id/historico
   */
  buscarHistorico: async (req, res) => {
    try {
      const { id } = req.params;
      
      const pool = await poolPromise;
      const result = await pool.request()
        .input('id', sql.Int, parseInt(id))
        .query(`
          SELECT 
            h.*,
            u.RZSOCIAL as usuario_nome
          FROM [dbo].[SOS_HISTORY] h
          LEFT JOIN [dbo].[CADASTROGERAL] u ON h.ID_USUARIO = u.CDCADASTRO
          WHERE h.ID_SOS = @id
          ORDER BY h.DH_ACAO DESC
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
   * Marcar alerta SOS como lido por um usuário
   * 
   * POST /api/sos/:id/ler
   * 
   * @description
   * Marca um alerta SOS como lido, registrando qual usuário leu e quando.
   * A ação é registrada no histórico para auditoria.
   * Emite evento WebSocket para atualizar outros usuários em tempo real.
   * 
   * @param {Object} req.params - Parâmetros da rota
   * @param {number} req.params.id - ID do SOS
   * @param {Object} req.user - Usuário autenticado (via middleware)
   * @param {number} req.user.cdcadastro - ID do usuário
   * @param {number} [req.body.idUsuario] - ID do usuário (alternativo)
   * 
   * @returns {Object} JSON com sucesso
   * 
   * @throws {400} Se ID do usuário não for fornecido
   * 
   * @author Sistema DivulgaCarga
   * @since 2.0
   */
  marcarComoLido: async (req, res) => {
    try {
      const { id } = req.params;
      const idUsuario = req.user?.cdcadastro || req.body.idUsuario;
      
      if (!idUsuario) {
        return res.status(400).json({ error: 'ID do usuário é obrigatório' });
      }

      const pool = await poolPromise;
      const transaction = new sql.Transaction(pool);
      
      await transaction.begin();
      
      try {
        // Atualizar SOS
        await transaction.request()
          .input('id', sql.Int, parseInt(id))
          .input('idUsuario', sql.Decimal(15, 0), parseFloat(idUsuario))
          .query(`
            UPDATE [dbo].[SOS_ALERTS]
            SET ID_USUARIO_LEU = @idUsuario,
                DH_LEITURA = SYSUTCDATETIME()
            WHERE ID = @id
          `);

        // Registrar no histórico
        await transaction.request()
          .input('idSos', sql.Int, parseInt(id))
          .input('idUsuario', sql.Decimal(15, 0), parseFloat(idUsuario))
          .query(`
            INSERT INTO [dbo].[SOS_HISTORY] (ID_SOS, ID_USUARIO, ACAO, DH_ACAO)
            VALUES (@idSos, @idUsuario, 'LEU', SYSUTCDATETIME())
          `);

        await transaction.commit();

        // Emitir evento WebSocket
        try {
          const websocketTorre = req.app?.get('websocketTorre');
          if (websocketTorre) {
            websocketTorre.emitirSOSLido(parseInt(id));
          }
        } catch (err) {
          console.warn('⚠️ Erro ao emitir evento WebSocket:', err.message);
        }

        res.json({ success: true, message: 'SOS marcado como lido' });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error('Erro ao marcar SOS como lido:', err);
      res.status(500).json({ error: 'Erro ao marcar SOS como lido' });
    }
  },

  /**
   * Tratar alerta SOS (mudar status e calcular tempo de resposta)
   * 
   * POST /api/sos/:id/tratar
   * 
   * @description
   * Trata um alerta SOS mudando seu status (ex: de "active" para "resolved").
   * Se o status for "resolved", calcula automaticamente o tempo de resposta
   * em minutos desde a criação até a resolução.
   * Registra quem tratou, quando tratou e observações opcionais.
   * A ação é registrada no histórico com status anterior e novo.
   * Emite evento WebSocket para atualizar outros usuários.
   * 
   * @param {Object} req.params - Parâmetros da rota
   * @param {number} req.params.id - ID do SOS
   * @param {Object} req.body - Dados do tratamento
   * @param {string} req.body.status - Novo status (active, in_progress, resolved, cancelled)
   * @param {string} [req.body.observacoes] - Observações sobre o tratamento
   * @param {Object} req.user - Usuário autenticado (via middleware)
   * @param {number} req.user.cdcadastro - ID do usuário que está tratando
   * @param {number} [req.body.idUsuario] - ID do usuário (alternativo)
   * 
   * @returns {Object} JSON com sucesso
   * 
   * @throws {400} Se status ou ID do usuário não forem fornecidos
   * 
   * @author Sistema DivulgaCarga
   * @since 2.0
   */
  tratar: async (req, res) => {
    try {
      const { id } = req.params;
      const { status, observacoes, locationDescription } = req.body;
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
        const sosAnterior = await transaction.request()
          .input('id', sql.Int, parseInt(id))
          .query(`SELECT STATUS, CREATED_AT FROM [dbo].[SOS_ALERTS] WHERE ID = @id`);

        const statusAnterior = sosAnterior.recordset[0]?.STATUS || null;
        const createdAt = sosAnterior.recordset[0]?.CREATED_AT;

        // Atualizar SOS
        let updateQuery = `
          UPDATE [dbo].[SOS_ALERTS]
          SET STATUS = @status
        `;

        // Se mudando para "resolved", definir RESOLVED_BY e RESOLVED_AT
        if (status === 'resolved' || status === 'Resolvido') {
          updateQuery += `, RESOLVED_BY = @idUsuario, RESOLVED_AT = SYSUTCDATETIME()`;
          
          // Calcular tempo de resposta
          if (createdAt) {
            updateQuery += `, TEMPO_RESPOSTA = DATEDIFF(MINUTE, CAST('${createdAt.toISOString()}' AS DATETIME2), SYSUTCDATETIME())`;
          }
        } else if (status === 'cancelled' || status === 'Cancelado') {
          // Se cancelado, também definir RESOLVED_BY
          updateQuery += `, RESOLVED_BY = @idUsuario`;
        }
        // Para "in_progress" e outros status, não altera RESOLVED_BY nem RESOLVED_AT

        if (observacoes) {
          updateQuery += `, RESOLUTION_NOTES = @observacoes`;
        }

        // Verificar se o campo LOCATION_DESCRIPTION existe antes de atualizar
        if (locationDescription !== undefined) {
          try {
            const checkField = await transaction.request().query(`
              SELECT COUNT(*) as existe
              FROM sys.columns 
              WHERE object_id = OBJECT_ID(N'[dbo].[SOS_ALERTS]') 
              AND name = 'LOCATION_DESCRIPTION'
            `);
            if (checkField.recordset[0].existe > 0) {
              updateQuery += `, LOCATION_DESCRIPTION = @locationDescription`;
              updateRequest.input('locationDescription', sql.NVarChar(500), locationDescription || null);
            } else {
              console.warn('⚠️ Campo LOCATION_DESCRIPTION não existe na tabela. Execute o script: adicionar_campo_descricao_local_sos.sql');
            }
          } catch (err) {
            console.warn('⚠️ Erro ao verificar campo LOCATION_DESCRIPTION:', err.message);
          }
        }

        updateQuery += ` WHERE ID = @id`;

        const updateRequest = transaction.request();
        updateRequest.input('id', sql.Int, parseInt(id));
        updateRequest.input('status', sql.NVarChar(50), status);
        updateRequest.input('idUsuario', sql.Decimal(15, 0), parseFloat(idUsuario));
        if (observacoes) {
          updateRequest.input('observacoes', sql.NVarChar(sql.MAX), observacoes);
        }

        await updateRequest.query(updateQuery);

        // Registrar no histórico
        await transaction.request()
          .input('idSos', sql.Int, parseInt(id))
          .input('idUsuario', sql.Decimal(15, 0), parseFloat(idUsuario))
          .input('statusAnterior', sql.NVarChar(50), statusAnterior)
          .input('statusNovo', sql.NVarChar(50), status)
          .input('observacoes', sql.NVarChar(sql.MAX), observacoes || null)
          .query(`
            INSERT INTO [dbo].[SOS_HISTORY] 
              (ID_SOS, ID_USUARIO, ACAO, STATUS_ANTERIOR, STATUS_NOVO, OBSERVACOES, DH_ACAO)
            VALUES (@idSos, @idUsuario, 'TRATOU', @statusAnterior, @statusNovo, @observacoes, SYSUTCDATETIME())
          `);

        await transaction.commit();

        // Emitir evento WebSocket
        try {
          const websocketTorre = req.app?.get('websocketTorre');
          if (websocketTorre) {
            websocketTorre.emitirSOSTratado(parseInt(id), status);
          }
        } catch (err) {
          console.warn('⚠️ Erro ao emitir evento WebSocket:', err.message);
        }

        res.json({ success: true, message: 'SOS tratado com sucesso' });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error('Erro ao tratar SOS:', err);
      res.status(500).json({ error: 'Erro ao tratar SOS' });
    }
  },

  /**
   * Atualizar SOS
   * PUT /api/sos/:id
   */
  atualizar: async (req, res) => {
    try {
      const { id } = req.params;
      const { status, observacoes, locationDescription } = req.body;
      const idUsuario = req.user?.cdcadastro || req.body.idUsuario;
      
      const pool = await poolPromise;
      const request = pool.request();
      request.input('id', sql.Int, parseInt(id));

      let updates = [];
      if (status) {
        request.input('status', sql.NVarChar(50), status);
        updates.push('STATUS = @status');
      }
      if (observacoes !== undefined) {
        request.input('observacoes', sql.NVarChar(sql.MAX), observacoes);
        updates.push('RESOLUTION_NOTES = @observacoes');
      }
      // Verificar se o campo LOCATION_DESCRIPTION existe antes de atualizar
      if (locationDescription !== undefined) {
        try {
          const checkField = await pool.request().query(`
            SELECT COUNT(*) as existe
            FROM sys.columns 
            WHERE object_id = OBJECT_ID(N'[dbo].[SOS_ALERTS]') 
            AND name = 'LOCATION_DESCRIPTION'
          `);
          if (checkField.recordset[0].existe > 0) {
            request.input('locationDescription', sql.NVarChar(500), locationDescription || null);
            updates.push('LOCATION_DESCRIPTION = @locationDescription');
          } else {
            console.warn('⚠️ Campo LOCATION_DESCRIPTION não existe na tabela. Execute o script: adicionar_campo_descricao_local_sos.sql');
          }
        } catch (err) {
          console.warn('⚠️ Erro ao verificar campo LOCATION_DESCRIPTION:', err.message);
        }
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar' });
      }

      const query = `UPDATE [dbo].[SOS_ALERTS] SET ${updates.join(', ')} WHERE ID = @id`;
      await request.query(query);

      // Registrar no histórico se houver mudança de status
      if (status && idUsuario) {
        try {
          await pool.request()
            .input('idSos', sql.Int, parseInt(id))
            .input('idUsuario', sql.Decimal(15, 0), parseFloat(idUsuario))
            .input('statusNovo', sql.NVarChar(50), status)
            .query(`
              INSERT INTO [dbo].[SOS_HISTORY] (ID_SOS, ID_USUARIO, ACAO, STATUS_NOVO, DH_ACAO)
              VALUES (@idSos, @idUsuario, 'ATUALIZOU', @statusNovo, SYSUTCDATETIME())
            `);
        } catch (err) {
          console.warn('⚠️ Erro ao registrar histórico:', err.message);
        }
      }

      res.json({ success: true, message: 'SOS atualizado com sucesso' });
    } catch (err) {
      console.error('Erro ao atualizar SOS:', err);
      res.status(500).json({ error: 'Erro ao atualizar SOS' });
    }
  },

  /**
   * Buscar endereço via Nominatim (reverse geocoding)
   * 
   * GET /api/sos/geocodificar/:lat/:lon
   * 
   * @description
   * Busca o endereço completo de uma localização usando coordenadas GPS
   * através do servidor Nominatim configurado.
   * 
   * @param {number} lat - Latitude
   * @param {number} lon - Longitude
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - data: Objeto com endereço formatado
   *     - display_name: Endereço completo formatado
   *     - address: Objeto com componentes do endereço
   * 
   * @author Sistema DivulgaCarga
   * @since 2.0
   */
  geocodificar: async (req, res) => {
    try {
      const { lat, lon } = req.params;
      
      if (!lat || !lon) {
        return res.status(400).json({
          success: false,
          error: 'Latitude e longitude são obrigatórios'
        });
      }

      const latNum = parseFloat(lat);
      const lonNum = parseFloat(lon);

      if (isNaN(latNum) || isNaN(lonNum)) {
        return res.status(400).json({
          success: false,
          error: 'Latitude e longitude devem ser números válidos'
        });
      }

      // Usar configuração centralizada do Nominatim
      const { getReverseGeocodingUrl } = require('../config/nominatim');
      const axios = require('axios');
      
      const url = getReverseGeocodingUrl(latNum, lonNum);
      
      console.log(`📍 [SOS Geocoding] Buscando endereço para: ${latNum}, ${lonNum}`);
      console.log(`📍 [SOS Geocoding] URL: ${url}`);
      
      const response = await axios.get(url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'DivulgaCarga/1.0'
        }
      });

      if (response.data && response.data.display_name) {
        res.json({
          success: true,
          data: {
            display_name: response.data.display_name,
            address: response.data.address || {},
            lat: latNum,
            lon: lonNum
          }
        });
      } else {
        res.json({
          success: false,
          error: 'Endereço não encontrado',
          data: {
            display_name: `Coordenadas: ${latNum.toFixed(6)}, ${lonNum.toFixed(6)}`,
            address: {},
            lat: latNum,
            lon: lonNum
          }
        });
      }
    } catch (error) {
      console.error('Erro ao buscar endereço via Nominatim:', error.message);
      res.status(500).json({
        success: false,
        error: 'Erro ao buscar endereço: ' + error.message
      });
    }
  },

  /**
   * Obter contador de alertas SOS pendentes (para badge no menu)
   * 
   * GET /api/sos/contador
   * 
   * @description
   * Retorna contadores de alertas SOS pendentes para exibir badges no menu.
   * Inclui total de pendentes e críticos.
   * Otimizado para ser chamado frequentemente sem impacto de performance.
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - data: Objeto com contadores
   *     - total: Total de SOS pendentes
   *     - criticos: Total de SOS críticos pendentes
   * 
   * @author Sistema DivulgaCarga
   * @since 2.0
   */
  contador: async (req, res) => {
    try {
      const pool = await poolPromise;
      const result = await pool.request().query(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN STATUS = 'active' THEN 1 ELSE 0 END) as ativos,
          SUM(CASE WHEN STATUS = 'resolved' THEN 1 ELSE 0 END) as resolvidos,
          SUM(CASE WHEN STATUS = 'cancelled' THEN 1 ELSE 0 END) as cancelados
        FROM [dbo].[SOS_ALERTS]
      `);

      const stats = result.recordset[0] || {};
      
      // Garantir que todos os valores sejam números
      const data = {
        total: parseInt(stats.total) || 0,
        ativos: parseInt(stats.ativos) || 0,
        emTratamento: parseInt(stats.em_tratamento) || 0,
        resolvidos: parseInt(stats.resolvidos) || 0,
        cancelados: parseInt(stats.cancelados) || 0
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

module.exports = sosController;
