// backend/controllers/sos.controller.js
// Controller para Alertas SOS (Emergência)
// Versão: 1.0
// Data: 2025-01-16

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
        message
      } = req.body;

      const { idmotorista } = req.user || req.body; // Via token JWT ou body (dev)

      if (!idmotorista) {
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
      request.input('cdmotorista', sql.Decimal(15, 0), idmotorista);
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

      const alerta = await alertaRequest.query(`
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
  }
};

module.exports = sosController;
