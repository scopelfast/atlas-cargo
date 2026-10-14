// backend/controllers/sos.controller.js
// Controller para Alertas SOS (Emergência)
// Versão: 2.0 - Módulo separado
// Data: 2026-01-16
// Última atualização: 2026-01-18
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

const jwt = require('jsonwebtoken');
const sql = require('../config/mssql-compat');
const { poolPromise } = require('../config/db');
const { tenantIdForRequest } = require('../utils/tenant-context');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const { torreAllViagensRoom } = require('../services/socket-tenant.service');

/** Resolve ID do usuário: req.user.id/cdcadastro, body.idUsuario, ou busca no banco por login (token antigo sem id). */
async function resolverIdUsuario(req) {
  let id = req.user?.id ?? req.user?.cdcadastro ?? req.body?.idUsuario;
  if (id != null && id !== '') {
    const num = parseFloat(id);
    if (!Number.isNaN(num)) return num;
  }
  const login = req.user?.login;
  if (!login) return null;
  try {
    const pool = await poolPromise;
    const r = await pool.query(
      `SELECT "CDCADASTRO" FROM public."USUARIO" WHERE LOWER(TRIM("SGUSUARIO")) = LOWER(TRIM($1)) LIMIT 1`,
      [String(login)]
    );
    const row = r.rows && r.rows[0];
    if (row) {
      const cd = row.CDCADASTRO ?? row.cdcadastro;
      if (cd != null) return parseFloat(cd);
    }
  } catch (e) {
    console.warn('⚠️ [SOS] Erro ao buscar usuário por login:', e.message);
  }
  return null;
}

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

      const lat = parseFloat(latitude);
      const lon = parseFloat(longitude);
      const cdMot = parseFloat(motoristaId);
      if (!Number.isFinite(cdMot)) {
        return res.status(400).json({ error: 'ID do motorista inválido' });
      }

      const authHdr = req.headers.authorization;
      if (authHdr && authHdr.startsWith('Bearer ') && process.env.JWT_SECRET) {
        try {
          const decoded = jwt.verify(authHdr.slice(7), process.env.JWT_SECRET);
          if (decoded && decoded.tipo === 'motorista') {
            const idTok = parseFloat(decoded.id ?? decoded.cdcadastro);
            if (Number.isFinite(idTok) && idTok !== cdMot) {
              return res.status(403).json({ error: 'Token não corresponde ao motorista do alerta.' });
            }
          }
        } catch (_) {
          /* token inválido/expirado: permite SOS sem sessão (fila offline) */
        }
      }

      const pool = await poolPromise;
      const defTid = getDefaultTenantId();
      let tid = defTid;
      try {
        const cgRow = await pool.query(
          `SELECT COALESCE(NULLIF(TRIM("TENANT_ID"::text), ''), $2::text) AS tid
           FROM public."CADASTROGERAL" WHERE "CDCADASTRO" = $1 LIMIT 1`,
          [cdMot, defTid]
        );
        if (!cgRow.rows || cgRow.rows.length === 0) {
          return res.status(400).json({ error: 'Motorista não encontrado' });
        }
        tid = String(cgRow.rows[0].tid ?? cgRow.rows[0].TENANT_ID ?? defTid);
      } catch (eCg) {
        if (eCg.code === '42703') {
          const cgRow2 = await pool.query(
            'SELECT 1 FROM public."CADASTROGERAL" WHERE "CDCADASTRO" = $1 LIMIT 1',
            [cdMot]
          );
          if (!cgRow2.rows || cgRow2.rows.length === 0) {
            return res.status(400).json({ error: 'Motorista não encontrado' });
          }
          tid = tenantIdForRequest(req);
        } else {
          throw eCg;
        }
      }

      const cdVig = idviagem != null ? parseFloat(idviagem) : null;
      const msg = (message || '').substring(0, 500);

      if (cdVig != null && Number.isFinite(cdVig)) {
        const vRow = await pool.query(
          'SELECT 1 FROM public."VIAGEMMESTRE" WHERE "IDVIAGEM" = $1 AND "TENANT_ID" = $2 LIMIT 1',
          [cdVig, tid]
        );
        if (!vRow.rows || vRow.rows.length === 0) {
          return res.status(403).json({ error: 'Viagem não encontrada ou não pertence ao tenant' });
        }
      }

      // INSERT nativo PostgreSQL (evita erro de sintaxe da conversão db.js)
      let idAlerta;
      try {
        const qIns = await pool.query(
          `INSERT INTO public."SOS_ALERTS" (
            "CDMOTORISTA", "CDVIAGEM", "LATITUDE", "LONGITUDE", "LOCATION",
            "MESSAGE", "PRIORITY", "STATUS", "CREATED_AT", "SYNCED", "TENANT_ID"
          ) VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $5, $6, 'active', CURRENT_TIMESTAMP, true, $7)
          RETURNING "ID"`,
          [cdMot, cdVig, lat, lon, msg, 'critical', tid]
        );
        idAlerta = qIns.rows[0]?.ID ?? qIns.rows[0]?.id;
      } catch (err) {
        if (err.code === '42P01' || err.code === '42601' || err.code === '42703') {
          try {
            const qIns2 = await pool.query(
              `INSERT INTO public.sos_alerts (
                cdmotorista, cdviagem, latitude, longitude, location,
                message, priority, status, created_at, synced, tenant_id
              ) VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $5, $6, 'active', CURRENT_TIMESTAMP, true, $7)
              RETURNING "ID"`,
              [cdMot, cdVig, lat, lon, msg, 'critical', tid]
            );
            idAlerta = qIns2.rows[0]?.ID ?? qIns2.rows[0]?.id;
          } catch (err2) {
            if (err2.code === '42703') {
              try {
                const qIns3 = await pool.query(
                  `INSERT INTO public."SOS_ALERTS" (
                    "CDMOTORISTA", "CDVIAGEM", "LATITUDE", "LONGITUDE", "LOCATION",
                    "MESSAGE", "PRIORITY", "STATUS", "CREATED_AT", "SYNCED"
                  ) VALUES ($1, $2, $3, $4, ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography, $5, $6, 'active', CURRENT_TIMESTAMP, true)
                  RETURNING "ID"`,
                  [cdMot, cdVig, lat, lon, msg, 'critical']
                );
                idAlerta = qIns3.rows[0]?.ID ?? qIns3.rows[0]?.id;
              } catch (err3) {
                if (err3.code === '42P01') {
                  return res.status(503).json({
                    error: 'Módulo SOS não disponível',
                    details: 'Tabela de alertas SOS não existe. Execute: backend/scripts/criar_sos_alerts_postgres.sql',
                    code: 'TABLE_NOT_FOUND'
                  });
                }
                throw err3;
              }
            } else if (err2.code === '42P01') {
              return res.status(503).json({
                error: 'Módulo SOS não disponível',
                details: 'Tabela de alertas SOS não existe. Execute: backend/scripts/criar_sos_alerts_postgres.sql',
                code: 'TABLE_NOT_FOUND'
              });
            } else {
              throw err2;
            }
          }
        } else {
          throw err;
        }
      }

      // Buscar dados completos do alerta criado (PostgreSQL nativo)
      let row = null;
      try {
        const sel = await pool.query(
          `SELECT sa."ID", sa."CDMOTORISTA", sa."CDVIAGEM", sa."LATITUDE", sa."LONGITUDE",
            sa."STATUS", sa."PRIORITY", sa."MESSAGE", sa."CREATED_AT", sa."TENANT_ID",
            cg."RZSOCIAL" AS "NOME_MOTORISTA", vm."IDVIAGEM",
            COALESCE(co."NMCIDADE" || '/' || co."ESTADO", 'Não informado') AS "ORIGEM",
            COALESCE(cd."NMCIDADE" || '/' || cd."ESTADO", 'Não informado') AS "DESTINO"
           FROM public."SOS_ALERTS" sa
           LEFT JOIN public."CADASTROGERAL" cg ON sa."CDMOTORISTA" = cg."CDCADASTRO" AND cg."TENANT_ID" = sa."TENANT_ID"
           LEFT JOIN public."VIAGEMMESTRE" vm ON sa."CDVIAGEM" = vm."IDVIAGEM" AND vm."TENANT_ID" = sa."TENANT_ID"
           LEFT JOIN public."ROTEIRO" r ON vm."IDROTEIRO" = r."IDROTEIRO"
             AND (r."TENANT_ID" = vm."TENANT_ID" OR r."TENANT_ID" = 'default')
           LEFT JOIN public."CIDADE" co ON r."CDCIDADEORIGEM" = co."CDCIDADE"
           LEFT JOIN public."CIDADE" cd ON r."CDCIDADEDESTINO" = cd."CDCIDADE"
           WHERE sa."ID" = $1 AND sa."TENANT_ID" = $2`,
          [idAlerta, tid]
        );
        row = sel.rows[0] || null;
      } catch (err) {
        if (err.code === '42P01' || err.code === '42703') {
          row = {
            ID: idAlerta,
            CDMOTORISTA: cdMot,
            CDVIAGEM: cdVig,
            LATITUDE: lat,
            LONGITUDE: lon,
            STATUS: 'active',
            PRIORITY: 'critical',
            MESSAGE: msg,
            CREATED_AT: new Date(),
            TENANT_ID: tid,
            NOME_MOTORISTA: null,
            IDVIAGEM: cdVig,
            ORIGEM: 'Não informado',
            DESTINO: 'Não informado'
          };
        } else {
          throw err;
        }
      }
      if (!row) {
        row = {
          ID: idAlerta,
          CDMOTORISTA: cdMot,
          CDVIAGEM: cdVig,
          LATITUDE: lat,
          LONGITUDE: lon,
          STATUS: 'active',
          PRIORITY: 'critical',
          MESSAGE: msg,
          CREATED_AT: new Date(),
          TENANT_ID: tid,
          NOME_MOTORISTA: null,
          IDVIAGEM: cdVig,
          ORIGEM: 'Não informado',
          DESTINO: 'Não informado'
        };
      }

      // Emitir evento WebSocket para Torre de Controle
      try {
        const websocketTorre = req.app ? req.app.get('websocketTorre') : null;
        if (websocketTorre && row) websocketTorre.emitirSOS(row);
        const io = req.app ? req.app.get('io') : null;
        if (io) {
          io.to(torreAllViagensRoom(row.TENANT_ID ?? tid)).emit('sos-alerta', { type: 'novo', alerta: row });
        }
      } catch (err) {
        console.warn('⚠️ Erro ao emitir evento WebSocket SOS:', err.message);
      }

      res.json({
        success: true,
        message: 'Alerta SOS criado com sucesso',
        alerta: row
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
      const tid = tenantIdForRequest(req);
      const request = pool.request();
      request.input('tenantId', sql.NVarChar(64), tid);

      const result = await request.query(`
        SELECT 
          [sa].[ID],
          [sa].[CDMOTORISTA],
          [sa].[CDVIAGEM],
          [sa].[LATITUDE],
          [sa].[LONGITUDE],
          [sa].[STATUS],
          [sa].[PRIORITY],
          [sa].[MESSAGE],
          [sa].[CREATED_AT],
          [cg].[RZSOCIAL] AS [NOME_MOTORISTA],
          [cg].[NRCELULAR] AS [CELULAR_MOTORISTA],
          [vm].[IDVIAGEM],
          COALESCE([co].[NMCIDADE] || '/' || [co].[ESTADO], 'Não informado') AS [ORIGEM],
          COALESCE([cd].[NMCIDADE] || '/' || [cd].[ESTADO], 'Não informado') AS [DESTINO]
        FROM [dbo].[SOS_ALERTS] [sa]
        LEFT JOIN [dbo].[CADASTROGERAL] [cg] ON [sa].[CDMOTORISTA] = [cg].[CDCADASTRO] AND [cg].[TENANT_ID] = [sa].[TENANT_ID]
        LEFT JOIN [dbo].[VIAGEMMESTRE] [vm] ON [sa].[CDVIAGEM] = [vm].[IDVIAGEM] AND [sa].[TENANT_ID] = [vm].[TENANT_ID]
        LEFT JOIN [dbo].[ROTEIRO] [r] ON [vm].[IDROTEIRO] = [r].[IDROTEIRO]
          AND ([r].[TENANT_ID] = [vm].[TENANT_ID] OR [r].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[CIDADE] [co] ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
        LEFT JOIN [dbo].[CIDADE] [cd] ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
        WHERE [sa].[STATUS] = 'active'
          AND [sa].[TENANT_ID] = @tenantId
        ORDER BY [sa].[CREATED_AT] DESC
      `);
      
      // Adicionar LOCATION_DESCRIPTION se o campo existir (PostgreSQL - não usar sys.columns)
      if (result.recordset && result.recordset.length > 0) {
        try {
          const checkField = await pool.query(`
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'SOS_ALERTS' AND column_name = 'LOCATION_DESCRIPTION'
            LIMIT 1
          `);
          if (checkField.rows && checkField.rows.length > 0) {
            const ids = result.recordset.map(r => r.ID ?? r.id);
            if (ids.length > 0) {
              const descResult = await pool.query(
                `SELECT "ID", "LOCATION_DESCRIPTION" FROM public."SOS_ALERTS" WHERE "ID" = ANY($1::int[])`,
                [ids]
              );
              const descMap = {};
              (descResult.rows || []).forEach(row => {
                const id = row.ID ?? row.id;
                descMap[id] = row.LOCATION_DESCRIPTION ?? row.location_description;
              });
              result.recordset.forEach(sos => {
                sos.LOCATION_DESCRIPTION = descMap[sos.ID ?? sos.id] ?? null;
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
      const { idusuario } = req.user || {};
      const tid = tenantIdForRequest(req);
      const pool = await poolPromise;
      const idNum = parseInt(id, 10);
      const resolvedBy = idusuario != null && idusuario !== '' ? parseFloat(idusuario) : null;

      const up = await pool.query(
        `UPDATE public."SOS_ALERTS"
         SET "STATUS" = 'resolved', "RESOLVED_AT" = NOW(),
             "RESOLVED_BY" = $2, "RESOLUTION_NOTES" = $3
         WHERE "ID" = $1 AND "STATUS" = 'active' AND "TENANT_ID" = $4`,
        [idNum, resolvedBy, notes != null ? String(notes).substring(0, 500) : null, tid]
      );

      if (up.rowCount === 0) {
        return res.status(404).json({ error: 'SOS não encontrado ou já resolvido' });
      }

      try {
        const websocketTorre = req.app ? req.app.get('websocketTorre') : null;
        if (websocketTorre && typeof websocketTorre.emitirSOSTratado === 'function') {
          websocketTorre.emitirSOSTratado(idNum, 'resolved');
        }
        const io = req.app ? req.app.get('io') : null;
        if (io) {
          io.to(torreAllViagensRoom(tid)).emit('sos-alerta', { type: 'resolvido', id: idNum });
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
      const idmotorista = req.user?.cdcadastro ?? req.user?.id;

      if (idmotorista == null || idmotorista === '') {
        return res.status(401).json({ error: 'Sessão inválida.', errorKey: 'login.tokenInvalido' });
      }

      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const request = pool.request();
      request.input('tenantId', sql.NVarChar(64), tid);
      request.input('cdmotorista', sql.Decimal(15, 0), idmotorista);

      const result = await request.query(`
        SELECT 
          [sa].[ID],
          [sa].[CDMOTORISTA],
          [sa].[CDVIAGEM],
          [sa].[LATITUDE],
          [sa].[LONGITUDE],
          [sa].[STATUS],
          [sa].[PRIORITY],
          [sa].[MESSAGE],
          [sa].[CREATED_AT],
          [sa].[RESOLVED_AT],
          [vm].[IDVIAGEM],
          COALESCE([co].[NMCIDADE] || '/' || [co].[ESTADO], 'Não informado') AS [ORIGEM],
          COALESCE([cd].[NMCIDADE] || '/' || [cd].[ESTADO], 'Não informado') AS [DESTINO]
        FROM [dbo].[SOS_ALERTS] [sa]
        LEFT JOIN [dbo].[VIAGEMMESTRE] [vm] ON [sa].[CDVIAGEM] = [vm].[IDVIAGEM] AND [sa].[TENANT_ID] = [vm].[TENANT_ID]
        LEFT JOIN [dbo].[ROTEIRO] [r] ON [vm].[IDROTEIRO] = [r].[IDROTEIRO]
          AND ([r].[TENANT_ID] = [vm].[TENANT_ID] OR [r].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[CIDADE] [co] ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
        LEFT JOIN [dbo].[CIDADE] [cd] ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
        WHERE [sa].[TENANT_ID] = @tenantId AND [sa].[CDMOTORISTA] = @cdmotorista
        ORDER BY [sa].[CREATED_AT] DESC
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
   * @author Atlas Cargo
   * @since 2.0
   */
  listar: async (req, res) => {
    try {
      const { status, dataInicio, dataFim, idViagem, idMotorista, limit = 50, offset = 0 } = req.query;
      
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const request = pool.request();
      request.input('tenantId', sql.NVarChar(64), tid);

      let query = `
        SELECT 
          [sa].[ID],
          [sa].[CDMOTORISTA],
          [sa].[CDVIAGEM],
          [sa].[LATITUDE],
          [sa].[LONGITUDE],
          [sa].[STATUS],
          [sa].[PRIORITY],
          [sa].[MESSAGE],
          [sa].[CREATED_AT],
          [sa].[RESOLVED_AT],
          [sa].[RESOLVED_BY],
          [sa].[ID_USUARIO_LEU],
          [sa].[DH_LEITURA],
          [sa].[TEMPO_RESPOSTA],
          [cg].[RZSOCIAL] AS [NOME_MOTORISTA],
          [cg].[NRCELULAR] AS [CELULAR_MOTORISTA],
          [vm].[IDVIAGEM],
          COALESCE([co].[NMCIDADE] || '/' || [co].[ESTADO], 'Não informado') AS [ORIGEM],
          COALESCE([cd].[NMCIDADE] || '/' || [cd].[ESTADO], 'Não informado') AS [DESTINO],
          [u1].[RZSOCIAL] AS [usuario_leu_nome],
          [u2].[RZSOCIAL] AS [usuario_resolveu_nome]
        FROM [dbo].[SOS_ALERTS] [sa]
        LEFT JOIN [dbo].[CADASTROGERAL] [cg] ON [sa].[CDMOTORISTA] = [cg].[CDCADASTRO] AND [cg].[TENANT_ID] = [sa].[TENANT_ID]
        LEFT JOIN [dbo].[VIAGEMMESTRE] [vm] ON [sa].[CDVIAGEM] = [vm].[IDVIAGEM] AND [sa].[TENANT_ID] = [vm].[TENANT_ID]
        LEFT JOIN [dbo].[ROTEIRO] [r] ON [vm].[IDROTEIRO] = [r].[IDROTEIRO]
          AND ([r].[TENANT_ID] = [vm].[TENANT_ID] OR [r].[TENANT_ID] = 'default')
        LEFT JOIN [dbo].[CIDADE] [co] ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
        LEFT JOIN [dbo].[CIDADE] [cd] ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
        LEFT JOIN [dbo].[CADASTROGERAL] [u1] ON [sa].[ID_USUARIO_LEU] = [u1].[CDCADASTRO] AND [u1].[TENANT_ID] = [sa].[TENANT_ID]
        LEFT JOIN [dbo].[CADASTROGERAL] [u2] ON [sa].[RESOLVED_BY] = [u2].[CDCADASTRO] AND [u2].[TENANT_ID] = [sa].[TENANT_ID]
        WHERE 1=1
          AND [sa].[TENANT_ID] = @tenantId
      `;

      if (status) {
        request.input('status', sql.NVarChar(50), status);
        query += ` AND [sa].[STATUS] = @status`;
      }
      if (dataInicio) {
        request.input('dataInicio', sql.DateTime2, dataInicio);
        query += ` AND CAST([sa].[CREATED_AT] AS DATE) >= CAST(@dataInicio AS DATE)`;
      }
      if (dataFim) {
        request.input('dataFim', sql.DateTime2, dataFim);
        query += ` AND CAST([sa].[CREATED_AT] AS DATE) <= CAST(@dataFim AS DATE)`;
      }
      if (idViagem) {
        request.input('idViagem', sql.Decimal(15, 0), parseFloat(idViagem));
        query += ` AND [sa].[CDVIAGEM] = @idViagem`;
      }
      if (idMotorista) {
        request.input('idMotorista', sql.Decimal(15, 0), parseFloat(idMotorista));
        query += ` AND [sa].[CDMOTORISTA] = @idMotorista`;
      }

      query += ` ORDER BY [sa].[CREATED_AT] DESC
        LIMIT @limit OFFSET @offset
      `;

      request.input('offset', sql.Int, parseInt(offset));
      request.input('limit', sql.Int, parseInt(limit));

      const result = await request.query(query);

      // Contar total
      let countQuery = `SELECT COUNT(*) AS [total] FROM [dbo].[SOS_ALERTS] [sa] WHERE 1=1 AND [sa].[TENANT_ID] = @tenantId`;
      const countRequest = pool.request();
      countRequest.input('tenantId', sql.NVarChar(64), tid);
      if (status) {
        countRequest.input('status', sql.NVarChar(50), status);
        countQuery += ` AND [sa].[STATUS] = @status`;
      }
      if (dataInicio) {
        countRequest.input('dataInicio', sql.DateTime2, dataInicio);
        countQuery += ` AND CAST([sa].[CREATED_AT] AS DATE) >= CAST(@dataInicio AS DATE)`;
      }
      if (dataFim) {
        countRequest.input('dataFim', sql.DateTime2, dataFim);
        countQuery += ` AND CAST([sa].[CREATED_AT] AS DATE) <= CAST(@dataFim AS DATE)`;
      }
      if (idViagem) {
        countRequest.input('idViagem', sql.Decimal(15, 0), parseFloat(idViagem));
        countQuery += ` AND [sa].[CDVIAGEM] = @idViagem`;
      }
      if (idMotorista) {
        countRequest.input('idMotorista', sql.Decimal(15, 0), parseFloat(idMotorista));
        countQuery += ` AND [sa].[CDMOTORISTA] = @idMotorista`;
      }

      const countResult = await countRequest.query(countQuery);
      const row0 = countResult.recordset[0];
      const total = row0?.total ?? row0?.TOTAL ?? 0;

      // Contar pendentes
      const pendentesResult = await pool.request()
        .input('tenantId', sql.NVarChar(64), tid)
        .query(`
        SELECT COUNT(*) AS [total] FROM [dbo].[SOS_ALERTS]
        WHERE [STATUS] = 'active' AND [TENANT_ID] = @tenantId
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
      if (err.code === '42P01' || err.code === '42703') {
        console.warn('⚠️ [SOS] listar: tabela/coluna não existe (', err.code, '), retornando vazio');
        return res.json({ success: true, data: [], total: 0, pendentes: 0 });
      }
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
      const tid = tenantIdForRequest(req);
      const result = await pool.request()
        .input('id', sql.Int, parseInt(id))
        .input('tenantId', sql.NVarChar(64), tid)
        .query(`
          SELECT 
            [sa].[ID],
            [sa].[CDMOTORISTA],
            [sa].[CDVIAGEM],
            [sa].[LATITUDE],
            [sa].[LONGITUDE],
            [sa].[STATUS],
            [sa].[PRIORITY],
            [sa].[MESSAGE],
            [sa].[CREATED_AT],
            [sa].[RESOLVED_AT],
            [sa].[RESOLVED_BY],
            [sa].[RESOLUTION_NOTES],
            [sa].[ID_USUARIO_LEU],
            [sa].[DH_LEITURA],
            [sa].[TEMPO_RESPOSTA],
            [cg].[RZSOCIAL] AS [NOME_MOTORISTA],
            [cg].[NRCELULAR] AS [CELULAR_MOTORISTA],
            [vm].[IDVIAGEM],
            COALESCE([co].[NMCIDADE] || '/' || [co].[ESTADO], 'Não informado') AS [ORIGEM],
            COALESCE([cd].[NMCIDADE] || '/' || [cd].[ESTADO], 'Não informado') AS [DESTINO],
            [u1].[RZSOCIAL] AS [usuario_leu_nome],
            [u2].[RZSOCIAL] AS [usuario_resolveu_nome]
          FROM [dbo].[SOS_ALERTS] [sa]
          LEFT JOIN [dbo].[CADASTROGERAL] [cg] ON [sa].[CDMOTORISTA] = [cg].[CDCADASTRO] AND [cg].[TENANT_ID] = [sa].[TENANT_ID]
          LEFT JOIN [dbo].[VIAGEMMESTRE] [vm] ON [sa].[CDVIAGEM] = [vm].[IDVIAGEM] AND [sa].[TENANT_ID] = [vm].[TENANT_ID]
          LEFT JOIN [dbo].[ROTEIRO] [r] ON [vm].[IDROTEIRO] = [r].[IDROTEIRO]
            AND ([r].[TENANT_ID] = [vm].[TENANT_ID] OR [r].[TENANT_ID] = 'default')
          LEFT JOIN [dbo].[CIDADE] [co] ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
          LEFT JOIN [dbo].[CIDADE] [cd] ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
          LEFT JOIN [dbo].[CADASTROGERAL] [u1] ON [sa].[ID_USUARIO_LEU] = [u1].[CDCADASTRO] AND [u1].[TENANT_ID] = [sa].[TENANT_ID]
          LEFT JOIN [dbo].[CADASTROGERAL] [u2] ON [sa].[RESOLVED_BY] = [u2].[CDCADASTRO] AND [u2].[TENANT_ID] = [sa].[TENANT_ID]
          WHERE [sa].[ID] = @id AND [sa].[TENANT_ID] = @tenantId
        `);
      
      // Adicionar LOCATION_DESCRIPTION se o campo existir (PostgreSQL - não usar sys.columns)
      if (result.recordset && result.recordset.length > 0) {
        try {
          const checkField = await pool.query(`
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'SOS_ALERTS' AND column_name = 'LOCATION_DESCRIPTION'
            LIMIT 1
          `);
          if (checkField.rows && checkField.rows.length > 0) {
            const descResult = await pool.query(
              `SELECT "LOCATION_DESCRIPTION" FROM public."SOS_ALERTS" WHERE "ID" = $1 AND "TENANT_ID" = $2`,
              [parseInt(id, 10), tid]
            );
            if (descResult.rows && descResult.rows.length > 0) {
              const row = descResult.rows[0];
              result.recordset[0].LOCATION_DESCRIPTION = row.LOCATION_DESCRIPTION ?? row.location_description ?? null;
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
      const idNum = parseInt(id, 10);
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);

      const own = await pool.query(
        'SELECT 1 FROM public."SOS_ALERTS" WHERE "ID" = $1 AND "TENANT_ID" = $2 LIMIT 1',
        [idNum, tid]
      );
      if (!own.rows || own.rows.length === 0) {
        return res.status(404).json({ error: 'SOS não encontrado' });
      }

      try {
        const result = await pool.query(
          `SELECT h."ID", h."ID_SOS", h."ID_USUARIO", h."ACAO", h."DH_ACAO",
                  h."STATUS_ANTERIOR", h."STATUS_NOVO", h."OBSERVACOES",
                  u."RZSOCIAL" AS usuario_nome
           FROM public."SOS_HISTORY" h
           LEFT JOIN public."CADASTROGERAL" u ON h."ID_USUARIO" = u."CDCADASTRO"
           WHERE h."ID_SOS" = $1
           ORDER BY h."DH_ACAO" DESC`,
          [idNum]
        );
        const rows = result.rows || [];
        return res.json({ success: true, data: rows });
      } catch (errHist) {
        if (errHist.code === '42P01' || /SOS_HISTORY|não existe|does not exist/i.test(String(errHist.message))) {
          return res.json({ success: true, data: [] });
        }
        throw errHist;
      }
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
   * @author Atlas Cargo
   * @since 2.0
   */
  marcarComoLido: async (req, res) => {
    try {
      const { id } = req.params;
      let idUsuario = req.user?.id ?? req.user?.cdcadastro ?? req.body?.idUsuario;
      if (idUsuario == null || idUsuario === '') idUsuario = await resolverIdUsuario(req);

      if (!idUsuario) {
        return res.status(400).json({ error: 'ID do usuário é obrigatório' });
      }

      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const client = await pool.connect();
      const idNum = parseInt(id, 10);
      const idUsuarioNum = parseFloat(idUsuario);

      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE public."SOS_ALERTS"
           SET "ID_USUARIO_LEU" = $1, "DH_LEITURA" = NOW()
           WHERE "ID" = $2 AND "TENANT_ID" = $3`,
          [idUsuarioNum, idNum, tid]
        );
        try {
          await client.query(
            `INSERT INTO public."SOS_HISTORY" ("ID_SOS", "ID_USUARIO", "ACAO", "DH_ACAO")
             VALUES ($1, $2, 'LEU', NOW())`,
            [idNum, idUsuarioNum]
          );
        } catch (errHist) {
          if (errHist.code !== '42P01') console.warn('⚠️ SOS_HISTORY insert:', errHist.message);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      try {
        const websocketTorre = req.app?.get('websocketTorre');
        if (websocketTorre && typeof websocketTorre.emitirSOSLido === 'function') {
          websocketTorre.emitirSOSLido(idNum);
        }
      } catch (err) {
        console.warn('⚠️ Erro ao emitir evento WebSocket:', err.message);
      }

      res.json({ success: true, message: 'SOS marcado como lido' });
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
   * @author Atlas Cargo
   * @since 2.0
   */
  tratar: async (req, res) => {
    try {
      const { id } = req.params;
      const { status, observacoes, locationDescription } = req.body;
      let idUsuario = req.user?.id ?? req.user?.cdcadastro ?? req.body?.idUsuario;
      if (idUsuario == null || idUsuario === '') idUsuario = await resolverIdUsuario(req);

      if (!status) {
        return res.status(400).json({ error: 'Status é obrigatório' });
      }
      if (!idUsuario) {
        return res.status(400).json({ error: 'ID do usuário é obrigatório' });
      }

      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const client = await pool.connect();
      const idNum = parseInt(id, 10);
      const idUsuarioNum = parseFloat(idUsuario);
      const statusStr = (status || '').substring(0, 50);

      try {
        await client.query('BEGIN');

        const sel = await client.query(
          `SELECT "STATUS", "CREATED_AT" FROM public."SOS_ALERTS" WHERE "ID" = $1 AND "TENANT_ID" = $2`,
          [idNum, tid]
        );
        const row = sel.rows && sel.rows[0];
        if (!row) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'SOS não encontrado' });
        }
        const statusAnterior = row.STATUS ?? row.status;
        const createdAt = row.CREATED_AT ?? row.created_at;

        let updateSql = `UPDATE public."SOS_ALERTS" SET "STATUS" = $1`;
        const params = [statusStr];
        let idx = 2;

        if (status === 'resolved' || status === 'Resolvido') {
          updateSql += `, "RESOLVED_BY" = $${idx}, "RESOLVED_AT" = NOW()`;
          idx++;
          params.push(idUsuarioNum);
          if (createdAt) {
            updateSql += `, "TEMPO_RESPOSTA" = EXTRACT(EPOCH FROM (NOW() - $${idx}::timestamptz)) / 60`;
            params.push(createdAt);
            idx++;
          }
        } else if (status === 'cancelled' || status === 'Cancelado') {
          updateSql += `, "RESOLVED_BY" = $${idx}`;
          params.push(idUsuarioNum);
          idx++;
        }

        if (observacoes != null && observacoes !== '') {
          updateSql += `, "RESOLUTION_NOTES" = $${idx}`;
          params.push(String(observacoes).substring(0, 4000));
          idx++;
        }

        updateSql += ` WHERE "ID" = $${idx} AND "TENANT_ID" = $${idx + 1}`;
        params.push(idNum, tid);
        await client.query(updateSql, params);

        try {
          await client.query(
            `INSERT INTO public."SOS_HISTORY"
             ("ID_SOS", "ID_USUARIO", "ACAO", "STATUS_ANTERIOR", "STATUS_NOVO", "OBSERVACOES", "DH_ACAO")
             VALUES ($1, $2, 'TRATOU', $3, $4, $5, NOW())`,
            [idNum, idUsuarioNum, statusAnterior, statusStr, observacoes || null]
          );
        } catch (errHist) {
          if (errHist.code !== '42P01') console.warn('⚠️ SOS_HISTORY insert:', errHist.message);
        }

        await client.query('COMMIT');

        // Atualizar LOCATION_DESCRIPTION fora da transação (coluna pode não existir)
        if (locationDescription !== undefined) {
          try {
            await client.query(
              `UPDATE public."SOS_ALERTS" SET "LOCATION_DESCRIPTION" = $1 WHERE "ID" = $2 AND "TENANT_ID" = $3`,
              [locationDescription == null ? null : String(locationDescription).substring(0, 500), idNum, tid]
            );
          } catch (errCol) {
            if (errCol.code === '42703') console.warn('⚠️ Coluna LOCATION_DESCRIPTION não existe em SOS_ALERTS');
          }
        }
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      try {
        const websocketTorre = req.app?.get('websocketTorre');
        if (websocketTorre && typeof websocketTorre.emitirSOSTratado === 'function') {
          websocketTorre.emitirSOSTratado(idNum, statusStr);
        }
      } catch (err) {
        console.warn('⚠️ Erro ao emitir evento WebSocket:', err.message);
      }

      res.json({ success: true, message: 'SOS tratado com sucesso' });
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
      const tid = tenantIdForRequest(req);
      const idNum = parseInt(id, 10);
      const parts = [];
      const params = [];
      let idx = 1;

      if (status) {
        parts.push(`"STATUS" = $${idx}`);
        params.push(String(status).substring(0, 50));
        idx++;
      }
      if (observacoes !== undefined) {
        parts.push(`"RESOLUTION_NOTES" = $${idx}`);
        params.push(observacoes == null ? null : String(observacoes).substring(0, 4000));
        idx++;
      }

      if (parts.length === 0 && locationDescription === undefined) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar' });
      }

      if (parts.length > 0) {
        params.push(idNum, tid);
        await pool.query(
          `UPDATE public."SOS_ALERTS" SET ${parts.join(', ')} WHERE "ID" = $${idx} AND "TENANT_ID" = $${idx + 1}`,
          params
        );
      }
      if (locationDescription !== undefined) {
        try {
          await pool.query(
            `UPDATE public."SOS_ALERTS" SET "LOCATION_DESCRIPTION" = $1 WHERE "ID" = $2 AND "TENANT_ID" = $3`,
            [locationDescription == null ? null : String(locationDescription).substring(0, 500), idNum, tid]
          );
        } catch (errCol) {
          if (errCol.code === '42703') console.warn('⚠️ Coluna LOCATION_DESCRIPTION não existe');
        }
      }

      if (status && idUsuario) {
        try {
          await pool.query(
            `INSERT INTO public."SOS_HISTORY" ("ID_SOS", "ID_USUARIO", "ACAO", "STATUS_NOVO", "DH_ACAO")
             VALUES ($1, $2, 'ATUALIZOU', $3, NOW())`,
            [idNum, parseFloat(idUsuario), String(status).substring(0, 50)]
          );
        } catch (err) {
          if (err.code !== '42P01') console.warn('⚠️ Erro ao registrar histórico:', err.message);
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
   * @author Atlas Cargo
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
          'User-Agent': 'AtlasCargo/2.0'
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
   * @author Atlas Cargo
   * @since 2.0
   */
  contador: async (req, res) => {
    const zeros = { total: 0, ativos: 0, emTratamento: 0, resolvidos: 0, cancelados: 0 };
    try {
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      let result;
      // Tentar tabela maiúscula (colunas "STATUS") e depois minúscula (coluna status)
      try {
        result = await pool.query(`
          SELECT 
            COUNT(*)::int AS total,
            COALESCE(SUM(CASE WHEN "STATUS" = 'active' THEN 1 ELSE 0 END), 0)::int AS ativos,
            COALESCE(SUM(CASE WHEN "STATUS" = 'resolved' THEN 1 ELSE 0 END), 0)::int AS resolvidos,
            COALESCE(SUM(CASE WHEN "STATUS" = 'cancelled' THEN 1 ELSE 0 END), 0)::int AS cancelados
          FROM public."SOS_ALERTS"
          WHERE "TENANT_ID" = $1
        `, [tid]);
      } catch (qerr1) {
        if (qerr1.code !== '42P01' && qerr1.code !== '42703') throw qerr1;
        try {
          result = await pool.query(`
            SELECT 
              COUNT(*)::int AS total,
              COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0)::int AS ativos,
              COALESCE(SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END), 0)::int AS resolvidos,
              COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0)::int AS cancelados
            FROM public.sos_alerts
            WHERE tenant_id = $1
          `, [tid]);
        } catch (qerr2) {
          if (qerr2.code === '42P01' || qerr2.code === '42703') {
            console.warn('⚠️ [SOS] contador: tabela SOS não encontrada, retornando zeros');
            return res.json({ success: true, data: zeros });
          }
          throw qerr2;
        }
      }

      const stats = result.rows[0] || {};
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
