// backend/controllers/message.controller.js
// Controller para Chat Motorista ↔ Operador
// Versão: 2.0 - Módulo separado
// Data: 2025-01-16
// Última atualização: 2025-01-18
//
// Este controller gerencia todas as operações relacionadas ao sistema de chat.
// Inclui funcionalidades para conversas, mensagens, busca e contadores de não lidas.
// O sistema agrupa mensagens em conversas (por viagem, motorista ou grupo).
//
// Endpoints principais:
// - GET    /api/chat/conversas - Listar conversas
// - GET    /api/chat/conversas/:id - Mensagens de uma conversa
// - POST   /api/chat/conversas - Criar nova conversa
// - PUT    /api/chat/conversas/:id - Atualizar conversa
// - POST   /api/chat/mensagens - Enviar mensagem
// - GET    /api/chat/buscar - Buscar conversas/mensagens
// - GET    /api/chat/nao-lidas - Contador de não lidas

const sql = require('mssql');
const { poolPromise } = require('../config/db');

const messageController = {
  /**
   * Enviar uma nova mensagem
   * 
   * POST /api/messages
   * POST /api/chat/mensagens
   * 
   * @description
   * Envia uma nova mensagem no chat. Se não houver conversa associada,
   * cria uma nova conversa automaticamente. Atualiza a última mensagem
   * da conversa e incrementa o contador de não lidas.
   * Emite eventos WebSocket para notificar outros usuários em tempo real.
   * 
   * @param {Object} req.body - Dados da mensagem
   * @param {number} req.body.idviagem - ID da viagem (obrigatório)
   * @param {string} req.body.content - Conteúdo da mensagem (obrigatório)
   * @param {string} req.body.senderType - Tipo do remetente ('MOTORISTA' ou 'OPERADOR')
   * @param {number} req.body.senderId - ID do remetente
   * @param {string} [req.body.senderName] - Nome do remetente
   * @param {string} [req.body.tipo='TEXTO'] - Tipo da mensagem (TEXTO, IMAGEM, ARQUIVO)
   * @param {number} [req.body.idConversa] - ID da conversa (opcional, cria nova se não fornecido)
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - message: Objeto com dados da mensagem criada
   *   - messageText: Mensagem de sucesso
   * 
   * @throws {400} Se dados obrigatórios não forem fornecidos
   * @throws {400} Se mensagem estiver vazia
   * 
   * @example
   * POST /api/chat/mensagens
   * // Body: {
   * //   "idviagem": 123,
   * //   "content": "Olá, tudo bem?",
   * //   "senderType": "OPERADOR",
   * //   "senderId": 456,
   * //   "senderName": "João Silva",
   * //   "tipo": "TEXTO"
   * // }
   * 
   * @author Sistema DivulgaCarga
   * @since 2.0
   */
  enviar: async (req, res) => {
    try {
      const { idviagem, content, senderType, senderId, senderName } = req.body;

      if (!idviagem || !content || !senderType || !senderId) {
        return res.status(400).json({ error: 'Dados incompletos para enviar mensagem' });
      }

      if (content.trim().length === 0) {
        return res.status(400).json({ error: 'Mensagem não pode estar vazia' });
      }

      const pool = await poolPromise;
      const transaction = new sql.Transaction(pool);
      
      await transaction.begin();
      
      try {
        // Buscar ou criar conversa
        let idConversa = null;
        if (req.body.idConversa) {
          idConversa = parseInt(req.body.idConversa);
        } else {
          // Buscar conversa existente ou criar nova
          const conversaResult = await transaction.request()
            .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
            .query(`
              SELECT TOP 1 ID FROM [dbo].[CONVERSAS]
              WHERE ID_VIAGEM = @idviagem
            `);
          
          if (conversaResult.recordset.length > 0) {
            idConversa = conversaResult.recordset[0].ID;
          } else {
            // Criar nova conversa
            const novaConversa = await transaction.request()
              .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
              .input('idCriador', sql.Decimal(15, 0), parseFloat(senderId))
              .query(`
                INSERT INTO [dbo].[CONVERSAS] (
                  TIPO, ID_VIAGEM, ID_CRIADOR, MENSAGENS_NAO_LIDAS, DH_CRIACAO
                )
                VALUES (
                  'VIAGEM', @idviagem, @idCriador, 0, SYSUTCDATETIME()
                );
                SELECT SCOPE_IDENTITY() AS ID;
              `);
            idConversa = novaConversa.recordset[0].ID;
          }
        }

        // Inserir mensagem
        const result = await transaction.request()
          .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
          .input('idConversa', sql.Int, idConversa)
          .input('senderType', sql.NVarChar(10), senderType)
          .input('senderId', sql.Decimal(15, 0), parseFloat(senderId))
          .input('senderName', sql.NVarChar(255), senderName || null)
          .input('content', sql.NVarChar(sql.MAX), content.trim())
          .input('tipo', sql.NVarChar(20), req.body.tipo || 'TEXTO')
          .query(`
            INSERT INTO [dbo].[MESSAGES] (
              IDVIAGEM, ID_CONVERSA, SENDER_TYPE, SENDER_ID, SENDER_NAME, CONTENT, TIPO,
              READ_BY_SENDER, READ_BY_RECEIVER, SYNCED
            )
            VALUES (
              @idviagem, @idConversa, @senderType, @senderId, @senderName, @content, @tipo,
              1, -- Remetente já leu (ele mesmo enviou)
              0, -- Destinatário ainda não leu
              1  -- Já sincronizado (está no servidor)
            );
            
            SELECT SCOPE_IDENTITY() AS ID;
          `);

        const messageId = result.recordset[0].ID;

        // Atualizar conversa (última mensagem e contador)
        await transaction.request()
          .input('idConversa', sql.Int, idConversa)
          .input('ultimaMensagem', sql.NVarChar(sql.MAX), content.trim())
          .query(`
            UPDATE [dbo].[CONVERSAS]
            SET ULTIMA_MENSAGEM = @ultimaMensagem,
                DH_ULTIMA_MENSAGEM = SYSUTCDATETIME(),
                MENSAGENS_NAO_LIDAS = MENSAGENS_NAO_LIDAS + 1
            WHERE ID = @idConversa
          `);

        await transaction.commit();

        // Buscar mensagem completa (após commit)
        const messageResult = await pool.request()
          .input('id', sql.Int, messageId)
          .query(`
            SELECT 
              ID, IDVIAGEM, ID_CONVERSA, SENDER_TYPE, SENDER_ID, SENDER_NAME,
              CONTENT, TIPO, READ_BY_SENDER, READ_BY_RECEIVER,
              DH_LEITURA, CREATED_AT, SYNCED
            FROM [dbo].[MESSAGES]
            WHERE ID = @id
          `);

        const message = messageResult.recordset[0];

        // Emitir via WebSocket (se disponível)
        const app = require('../app');
        const io = app.get('io');
        if (io) {
          io.to(`viagem-${idviagem}`).emit('nova-mensagem', message);
          io.to(`conversa-${idConversa}`).emit('nova-mensagem', message);
        }

        // Emitir também para Torre de Controle
        try {
          const websocketTorre = app.get('websocketTorre');
          if (websocketTorre) {
            websocketTorre.emitirNovaMensagem(message);
          }
        } catch (err) {
          console.warn('⚠️ Erro ao emitir evento WebSocket mensagem:', err.message);
        }

        res.json({
          success: true,
          message: message,
          messageText: 'Mensagem enviada com sucesso!'
        });
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    } catch (err) {
      console.error('Erro ao enviar mensagem:', err);
      res.status(500).json({ error: 'Erro ao enviar mensagem.' });
    }
  },

  /**
   * Buscar mensagens de uma viagem
   * GET /api/messages/viagem/:idviagem
   */
  buscarPorViagem: async (req, res) => {
    try {
      const { idviagem } = req.params;
      const { limit = 100, offset = 0 } = req.query;

      if (!idviagem) {
        return res.status(400).json({ error: 'ID da viagem é obrigatório' });
      }

      const pool = await poolPromise;
      const result = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idviagem)
        .input('limit', sql.Int, parseInt(limit))
        .input('offset', sql.Int, parseInt(offset))
        .query(`
          SELECT 
            m.ID, m.IDVIAGEM, m.SENDER_TYPE, m.SENDER_ID, 
            COALESCE(m.SENDER_NAME, 
              CASE 
                WHEN m.SENDER_TYPE = 'OPERADOR' THEN cg.RZSOCIAL
                WHEN m.SENDER_TYPE = 'driver' THEN cg2.RZSOCIAL
                ELSE NULL
              END
            ) AS SENDER_NAME,
            m.CONTENT, m.READ_BY_SENDER, m.READ_BY_RECEIVER,
            m.CREATED_AT, m.SYNCED
          FROM [dbo].[MESSAGES] m
          LEFT JOIN [dbo].[CADASTROGERAL] cg ON m.SENDER_TYPE = 'OPERADOR' AND m.SENDER_ID = cg.CDCADASTRO
          LEFT JOIN [dbo].[CADASTROGERAL] cg2 ON m.SENDER_TYPE = 'driver' AND m.SENDER_ID = cg2.CDCADASTRO
          WHERE m.IDVIAGEM = @idviagem
          ORDER BY m.CREATED_AT DESC
          OFFSET @offset ROWS
          FETCH NEXT @limit ROWS ONLY
        `);

      // Contar total de mensagens
      const countResult = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), idviagem)
        .query(`
          SELECT COUNT(*) AS total
          FROM [dbo].[MESSAGES]
          WHERE IDVIAGEM = @idviagem
        `);

      res.json({
        success: true,
        messages: result.recordset.reverse(), // Mais antigas primeiro
        total: countResult.recordset[0].total
      });
    } catch (err) {
      console.error('Erro ao buscar mensagens:', err);
      res.status(500).json({ error: 'Erro ao buscar mensagens.' });
    }
  },

  /**
   * Marcar mensagens como lidas
   * PUT /api/messages/marcar-lidas
   */
  marcarComoLidas: async (req, res) => {
    try {
      const { idviagem, userId, userType } = req.body;

      if (!idviagem || !userId || !userType) {
        return res.status(400).json({ error: 'Dados incompletos' });
      }

      const pool = await poolPromise;
      
      // Marcar como lidas todas as mensagens que não são do próprio usuário
      await pool.request()
        .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
        .input('senderId', sql.Decimal(15, 0), parseFloat(userId))
        .input('senderType', sql.NVarChar(10), userType)
        .query(`
          UPDATE [dbo].[MESSAGES]
          SET READ_BY_RECEIVER = 1,
              DH_LEITURA = SYSUTCDATETIME()
          WHERE IDVIAGEM = @idviagem
            AND (SENDER_ID != @senderId OR SENDER_TYPE != @senderType)
            AND READ_BY_RECEIVER = 0
        `);

      // Atualizar contador de não lidas na conversa
      await pool.request()
        .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
        .input('senderId', sql.Decimal(15, 0), parseFloat(userId))
        .input('senderType', sql.NVarChar(10), userType)
        .query(`
          UPDATE c
          SET c.MENSAGENS_NAO_LIDAS = (
            SELECT COUNT(*)
            FROM [dbo].[MESSAGES] m
            WHERE m.ID_CONVERSA = c.ID
              AND (m.SENDER_ID != @senderId OR m.SENDER_TYPE != @senderType)
              AND m.READ_BY_RECEIVER = 0
          )
          FROM [dbo].[CONVERSAS] c
          WHERE c.ID_VIAGEM = @idviagem
        `);

      res.json({ success: true, message: 'Mensagens marcadas como lidas' });
    } catch (err) {
      console.error('Erro ao marcar como lidas:', err);
      res.status(500).json({ error: 'Erro ao marcar mensagens como lidas.' });
    }
  },

  /**
   * Listar todas as conversas com filtros
   * 
   * GET /api/chat/conversas?tipo=MOTORISTA&idMotorista=456&idViagem=123&limit=50&offset=0
   * 
   * @description
   * Lista todas as conversas do sistema com suporte a filtros:
   * - tipo: Filtra por tipo (MOTORISTA, VIAGEM, GRUPO)
   * - idMotorista: Filtra por motorista específico
   * - idViagem: Filtra por viagem específica
   * - limit/offset: Paginação
   * 
   * Retorna informações da conversa incluindo última mensagem, data da última mensagem,
   * contador de não lidas e informações do motorista/viagem.
   * 
   * @param {Object} req.query - Query parameters com filtros
   * @param {string} [req.query.tipo] - Tipo da conversa
   * @param {number} [req.query.idMotorista] - ID do motorista
   * @param {number} [req.query.idViagem] - ID da viagem
   * @param {number} [req.query.limit=50] - Limite de registros
   * @param {number} [req.query.offset=0] - Offset para paginação
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - data: Array de conversas ordenadas por última mensagem (mais recente primeiro)
   * 
   * @example
   * GET /api/chat/conversas?tipo=VIAGEM&limit=20
   * 
   * @author Sistema DivulgaCarga
   * @since 2.0
   */
  listarConversas: async (req, res) => {
    try {
      const sql = require('mssql');
      const { poolPromise } = require('../config/db');
      const { tipo, idMotorista, idViagem, limit = 50, offset = 0 } = req.query;
      
      const pool = await poolPromise;
      const request = pool.request();

      let query = `
        SELECT 
          c.ID,
          c.TIPO,
          c.ID_MOTORISTA,
          c.ID_VIAGEM,
          c.ID_CRIADOR,
          c.ULTIMA_MENSAGEM,
          c.DH_ULTIMA_MENSAGEM,
          c.MENSAGENS_NAO_LIDAS,
          c.DH_CRIACAO,
          COALESCE(
            NULLIF(UPPER(cg_vm.RZSOCIAL), ''),
            NULLIF(cg.RZSOCIAL, ''),
            NULLIF(cg_conv.RZSOCIAL, ''),
            NULLIF(cg_conv_any.RZSOCIAL, '')
          ) as motorista_nome,
          mv.CDMOTORISTA as motorista_id,
          UPPER(cg_vm.RZSOCIAL) as motorista_nome_upper,
          cg_vm.CGCCPF as motorista_cpf,
          v.IDVIAGEM as viagem_codigo,
          r.IDROTEIRO as viagem_rota_id,
          r.DSROTEIRO as viagem_rota_descricao,
          ISNULL(co.NMCIDADE, '') + CASE WHEN co.NMCIDADE IS NOT NULL AND co.ESTADO IS NOT NULL THEN '/' + co.ESTADO ELSE '' END as viagem_origem,
          ISNULL(cd.NMCIDADE, '') + CASE WHEN cd.NMCIDADE IS NOT NULL AND cd.ESTADO IS NOT NULL THEN '/' + cd.ESTADO ELSE '' END as viagem_destino,
          v.DTPREVINICIO as viagem_dt_carregamento,
          v.DTPREVFINAL as viagem_dt_descarga,
          ISNULL(sv.DSSITUACAOVIAGEM, '') as viagem_situacao,
          v.CDSITUACAOVIAGEM as viagem_situacao_codigo,
          u.RZSOCIAL as criador_nome
        FROM [dbo].[CONVERSAS] c
        LEFT JOIN [dbo].[CADASTROGERAL] cg ON c.ID_MOTORISTA = cg.CDCADASTRO
        LEFT JOIN [dbo].[VIAGEMMESTRE] v ON c.ID_VIAGEM = v.IDVIAGEM
        LEFT JOIN [dbo].[VIAGEMMOTORISTA] mv ON v.IDVIAGEM = mv.IDVIAGEM
        LEFT JOIN [dbo].[CADASTROGERAL] cg_vm ON mv.CDMOTORISTA = cg_vm.CDCADASTRO
        LEFT JOIN [dbo].[ROTEIRO] r ON v.IDROTEIRO = r.IDROTEIRO
        LEFT JOIN [dbo].[CIDADE] co ON r.CDCIDADEORIGEM = co.CDCIDADE
        LEFT JOIN [dbo].[CIDADE] cd ON r.CDCIDADEDESTINO = cd.CDCIDADE
        LEFT JOIN [dbo].[SITUACAOVIAGEM] sv ON v.CDSITUACAOVIAGEM = sv.CDSITUACAOVIAGEM
        OUTER APPLY (
          SELECT TOP 1 
            CDCADASTRO_MOTORISTA
          FROM [dbo].[CONVOCACAO]
          WHERE IDVIAGEM = v.IDVIAGEM
            AND STATUS IN ('CONFIRMADA', 'ACEITA')
          ORDER BY DHCONVOCACAO DESC
        ) conv_top
        LEFT JOIN [dbo].[CADASTROGERAL] cg_conv ON conv_top.CDCADASTRO_MOTORISTA = cg_conv.CDCADASTRO
        OUTER APPLY (
          SELECT TOP 1 
            CDCADASTRO_MOTORISTA
          FROM [dbo].[CONVOCACAO]
          WHERE IDVIAGEM = v.IDVIAGEM
          ORDER BY DHCONVOCACAO DESC
        ) conv_any
        LEFT JOIN [dbo].[CADASTROGERAL] cg_conv_any ON conv_any.CDCADASTRO_MOTORISTA = cg_conv_any.CDCADASTRO
        LEFT JOIN [dbo].[CADASTROGERAL] u ON c.ID_CRIADOR = u.CDCADASTRO
        WHERE 1=1
      `;

      if (tipo) {
        request.input('tipo', sql.NVarChar(20), tipo);
        query += ` AND c.TIPO = @tipo`;
      }
      if (idMotorista) {
        request.input('idMotorista', sql.Decimal(15, 0), parseFloat(idMotorista));
        query += ` AND c.ID_MOTORISTA = @idMotorista`;
      }
      if (idViagem) {
        request.input('idViagem', sql.Decimal(15, 0), parseFloat(idViagem));
        query += ` AND c.ID_VIAGEM = @idViagem`;
      }

      query += ` ORDER BY c.DH_ULTIMA_MENSAGEM DESC
        OFFSET @offset ROWS
        FETCH NEXT @limit ROWS ONLY
      `;

      request.input('offset', sql.Int, parseInt(offset));
      request.input('limit', sql.Int, parseInt(limit));

      const result = await request.query(query);

      // Debug: Log para verificar dados retornados
      if (result.recordset.length > 0) {
        console.log('🔍 [CHAT] Debug - Primeira conversa:', {
          id: result.recordset[0].ID,
          idViagem: result.recordset[0].ID_VIAGEM,
          motorista_nome: result.recordset[0].motorista_nome,
          motorista_id: result.recordset[0].motorista_id,
          motorista_cpf: result.recordset[0].motorista_cpf
        });
      }

      res.json({
        success: true,
        data: result.recordset
      });
    } catch (err) {
      console.error('Erro ao listar conversas:', err);
      res.status(500).json({ error: 'Erro ao listar conversas' });
    }
  },

  /**
   * Buscar todas as mensagens de uma conversa específica
   * 
   * GET /api/chat/conversas/:id?limit=100&offset=0
   * 
   * @description
   * Retorna todas as mensagens de uma conversa específica, ordenadas por data
   * (mais antigas primeiro, para facilitar scroll no chat).
   * Suporta paginação para conversas com muitas mensagens.
   * 
   * @param {Object} req.params - Parâmetros da rota
   * @param {number} req.params.id - ID da conversa
   * @param {Object} req.query - Query parameters
   * @param {number} [req.query.limit=100] - Limite de mensagens por página
   * @param {number} [req.query.offset=0] - Offset para paginação
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - messages: Array de mensagens (ordenadas: mais antigas primeiro)
   *   - total: Total de mensagens na conversa
   * 
   * @throws {400} Se ID da conversa não for fornecido
   * 
   * @example
   * GET /api/chat/conversas/1?limit=50
   * 
   * @author Sistema DivulgaCarga
   * @since 2.0
   */
  buscarMensagensConversa: async (req, res) => {
    try {
      const { id } = req.params;
      const { limit = 100, offset = 0 } = req.query;

      if (!id) {
        return res.status(400).json({ error: 'ID da conversa é obrigatório' });
      }

      const pool = await poolPromise;
      const result = await pool.request()
        .input('idConversa', sql.Int, parseInt(id))
        .input('limit', sql.Int, parseInt(limit))
        .input('offset', sql.Int, parseInt(offset))
        .query(`
          SELECT 
            m.ID,
            m.IDVIAGEM,
            m.ID_CONVERSA,
            m.SENDER_TYPE,
            m.SENDER_ID,
            COALESCE(m.SENDER_NAME, 
              CASE 
                WHEN m.SENDER_TYPE = 'OPERADOR' THEN cg.RZSOCIAL
                WHEN m.SENDER_TYPE = 'driver' THEN cg2.RZSOCIAL
                ELSE NULL
              END
            ) AS SENDER_NAME,
            m.CONTENT,
            m.TIPO,
            m.READ_BY_SENDER,
            m.READ_BY_RECEIVER,
            m.DH_LEITURA,
            m.CREATED_AT,
            m.SYNCED
          FROM [dbo].[MESSAGES] m
          LEFT JOIN [dbo].[CADASTROGERAL] cg ON m.SENDER_TYPE = 'OPERADOR' AND m.SENDER_ID = cg.CDCADASTRO
          LEFT JOIN [dbo].[CADASTROGERAL] cg2 ON m.SENDER_TYPE = 'driver' AND m.SENDER_ID = cg2.CDCADASTRO
          WHERE m.ID_CONVERSA = @idConversa
          ORDER BY m.CREATED_AT DESC
          OFFSET @offset ROWS
          FETCH NEXT @limit ROWS ONLY
        `);

      // Contar total
      const countResult = await pool.request()
        .input('idConversa', sql.Int, parseInt(id))
        .query(`
          SELECT COUNT(*) AS total
          FROM [dbo].[MESSAGES]
          WHERE ID_CONVERSA = @idConversa
        `);

      res.json({
        success: true,
        messages: result.recordset.reverse(), // Mais antigas primeiro
        total: countResult.recordset[0].total
      });
    } catch (err) {
      console.error('Erro ao buscar mensagens da conversa:', err);
      res.status(500).json({ error: 'Erro ao buscar mensagens da conversa.' });
    }
  },

  /**
   * Criar uma nova conversa
   * 
   * POST /api/chat/conversas
   * 
   * @description
   * Cria uma nova conversa no sistema. Verifica se já existe uma conversa
   * com os mesmos parâmetros antes de criar, evitando duplicatas.
   * Tipos de conversa suportados: MOTORISTA, VIAGEM, GRUPO.
   * 
   * @param {Object} req.body - Dados da conversa
   * @param {string} req.body.tipo - Tipo da conversa (MOTORISTA, VIAGEM, GRUPO) (obrigatório)
   * @param {number} [req.body.idMotorista] - ID do motorista (se tipo=MOTORISTA)
   * @param {number} [req.body.idViagem] - ID da viagem (se tipo=VIAGEM)
   * @param {number} req.body.idCriador - ID do usuário criador (obrigatório)
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - data: Objeto com dados da conversa criada (ou existente)
   *   - message: Mensagem informativa
   * 
   * @throws {400} Se tipo ou ID do criador não forem fornecidos
   * 
   * @example
   * POST /api/chat/conversas
   * // Body: {
   * //   "tipo": "VIAGEM",
   * //   "idViagem": 123,
   * //   "idCriador": 456
   * // }
   * 
   * @author Sistema DivulgaCarga
   * @since 2.0
   */
  criarConversa: async (req, res) => {
    try {
      const { tipo, idMotorista, idViagem, idCriador } = req.body;

      if (!tipo || !idCriador) {
        return res.status(400).json({ error: 'Tipo e ID do criador são obrigatórios' });
      }

      const pool = await poolPromise;
      
      // Verificar se já existe conversa
      let queryVerificar = `
        SELECT ID FROM [dbo].[CONVERSAS]
        WHERE TIPO = @tipo AND ID_CRIADOR = @idCriador
      `;
      const requestVerificar = pool.request();
      requestVerificar.input('tipo', sql.NVarChar(20), tipo);
      requestVerificar.input('idCriador', sql.Decimal(15, 0), parseFloat(idCriador));

      if (idMotorista) {
        requestVerificar.input('idMotorista', sql.Decimal(15, 0), parseFloat(idMotorista));
        queryVerificar += ` AND ID_MOTORISTA = @idMotorista`;
      }
      if (idViagem) {
        requestVerificar.input('idViagem', sql.Decimal(15, 0), parseFloat(idViagem));
        queryVerificar += ` AND ID_VIAGEM = @idViagem`;
      }

      const existe = await requestVerificar.query(queryVerificar);

      if (existe.recordset.length > 0) {
        return res.json({
          success: true,
          data: { id: existe.recordset[0].ID },
          message: 'Conversa já existe'
        });
      }

      // Criar nova conversa
      const result = await pool.request()
        .input('tipo', sql.NVarChar(20), tipo)
        .input('idMotorista', sql.Decimal(15, 0), idMotorista ? parseFloat(idMotorista) : null)
        .input('idViagem', sql.Decimal(15, 0), idViagem ? parseFloat(idViagem) : null)
        .input('idCriador', sql.Decimal(15, 0), parseFloat(idCriador))
        .query(`
          INSERT INTO [dbo].[CONVERSAS] (
            TIPO, ID_MOTORISTA, ID_VIAGEM, ID_CRIADOR, MENSAGENS_NAO_LIDAS, DH_CRIACAO
          )
          VALUES (
            @tipo, @idMotorista, @idViagem, @idCriador, 0, SYSUTCDATETIME()
          );
          SELECT SCOPE_IDENTITY() AS ID;
        `);

      const conversaId = result.recordset[0].ID;

      // Buscar conversa completa
      const conversaResult = await pool.request()
        .input('id', sql.Int, conversaId)
        .query(`
          SELECT 
            c.*,
            cg.RZSOCIAL as motorista_nome,
            v.IDVIAGEM as viagem_codigo
          FROM [dbo].[CONVERSAS] c
          LEFT JOIN [dbo].[CADASTROGERAL] cg ON c.ID_MOTORISTA = cg.CDCADASTRO
          LEFT JOIN [dbo].[VIAGEMMESTRE] v ON c.ID_VIAGEM = v.IDVIAGEM
          WHERE c.ID = @id
        `);

      res.json({
        success: true,
        data: conversaResult.recordset[0]
      });
    } catch (err) {
      console.error('Erro ao criar conversa:', err);
      res.status(500).json({ error: 'Erro ao criar conversa.' });
    }
  },

  /**
   * Buscar conversas e mensagens por termo
   * 
   * GET /api/chat/buscar?q=termo
   * 
   * @description
   * Realiza busca textual em conversas e mensagens. Busca em:
   * - Última mensagem das conversas
   * - Nome do motorista
   * - Conteúdo das mensagens
   * 
   * Retorna até 20 resultados de cada tipo (conversas e mensagens).
   * Útil para funcionalidade de busca no chat.
   * 
   * @param {Object} req.query - Query parameters
   * @param {string} req.query.q - Termo de busca (obrigatório)
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - data: Objeto com:
   *     - conversas: Array de conversas encontradas
   *     - mensagens: Array de mensagens encontradas
   * 
   * @throws {400} Se termo de busca não for fornecido ou estiver vazio
   * 
   * @example
   * GET /api/chat/buscar?q=problema
   * 
   * @author Sistema DivulgaCarga
   * @since 2.0
   */
  buscar: async (req, res) => {
    try {
      const { q } = req.query;

      if (!q || q.trim().length === 0) {
        return res.status(400).json({ error: 'Termo de busca é obrigatório' });
      }

      const pool = await poolPromise;
      const termo = `%${q.trim()}%`;

      // Buscar em conversas
      const conversasResult = await pool.request()
        .input('termo', sql.NVarChar(255), termo)
        .query(`
          SELECT TOP 20
            c.ID,
            c.TIPO,
            c.ID_MOTORISTA,
            c.ID_VIAGEM,
            c.ULTIMA_MENSAGEM,
            cg.RZSOCIAL as motorista_nome,
            v.IDVIAGEM as viagem_codigo
          FROM [dbo].[CONVERSAS] c
          LEFT JOIN [dbo].[CADASTROGERAL] cg ON c.ID_MOTORISTA = cg.CDCADASTRO
          LEFT JOIN [dbo].[VIAGEMMESTRE] v ON c.ID_VIAGEM = v.IDVIAGEM
          WHERE c.ULTIMA_MENSAGEM LIKE @termo
             OR cg.RZSOCIAL LIKE @termo
          ORDER BY c.DH_ULTIMA_MENSAGEM DESC
        `);

      // Buscar em mensagens
      const mensagensResult = await pool.request()
        .input('termo', sql.NVarChar(sql.MAX), termo)
        .query(`
          SELECT TOP 20
            m.ID,
            m.ID_CONVERSA,
            m.SENDER_NAME,
            m.CONTENT,
            m.CREATED_AT,
            c.ID as conversa_id,
            cg.RZSOCIAL as motorista_nome
          FROM [dbo].[MESSAGES] m
          LEFT JOIN [dbo].[CONVERSAS] c ON m.ID_CONVERSA = c.ID
          LEFT JOIN [dbo].[CADASTROGERAL] cg ON c.ID_MOTORISTA = cg.CDCADASTRO
          WHERE m.CONTENT LIKE @termo
          ORDER BY m.CREATED_AT DESC
        `);

      res.json({
        success: true,
        data: {
          conversas: conversasResult.recordset,
          mensagens: mensagensResult.recordset
        }
      });
    } catch (err) {
      console.error('Erro ao buscar:', err);
      res.status(500).json({ error: 'Erro ao buscar.' });
    }
  },

  /**
   * Obter contador de mensagens não lidas (para badge no menu)
   * 
   * GET /api/chat/nao-lidas?idUsuario=456&userType=OPERADOR
   * 
   * @description
   * Retorna contadores de mensagens não lidas para um usuário específico.
   * Inclui total geral e contador por conversa.
   * Otimizado para ser chamado frequentemente sem impacto de performance.
   * 
   * @param {Object} req.query - Query parameters
   * @param {number} req.query.idUsuario - ID do usuário (obrigatório)
   * @param {string} req.query.userType - Tipo do usuário (MOTORISTA ou OPERADOR) (obrigatório)
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - data: Objeto com:
   *     - total: Total de mensagens não lidas
   *     - porConversa: Array com contador por conversa
   * 
   * @throws {400} Se ID do usuário ou tipo não forem fornecidos
   * 
   * @example
   * GET /api/chat/nao-lidas?idUsuario=456&userType=OPERADOR
   * // Response: {
   * //   "success": true,
   * //   "data": {
   * //     "total": 5,
   * //     "porConversa": [
   * //       { "ID_CONVERSA": 1, "nao_lidas": 3 },
   * //       { "ID_CONVERSA": 2, "nao_lidas": 2 }
   * //     ]
   * //   }
   * // }
   * 
   * @author Sistema DivulgaCarga
   * @since 2.0
   */
  contadorNaoLidas: async (req, res) => {
    try {
      const { idUsuario, userType } = req.query;

      if (!idUsuario || !userType) {
        return res.status(400).json({ error: 'ID do usuário e tipo são obrigatórios' });
      }

      const pool = await poolPromise;
      
      // Contar mensagens não lidas onde o usuário é o destinatário
      const result = await pool.request()
        .input('userId', sql.Decimal(15, 0), parseFloat(idUsuario))
        .input('userType', sql.NVarChar(10), userType)
        .query(`
          SELECT COUNT(*) as total
          FROM [dbo].[MESSAGES]
          WHERE (SENDER_ID != @userId OR SENDER_TYPE != @userType)
            AND READ_BY_RECEIVER = 0
        `);

      // Contar por conversa
      const porConversaResult = await pool.request()
        .input('userId', sql.Decimal(15, 0), parseFloat(idUsuario))
        .input('userType', sql.NVarChar(10), userType)
        .query(`
          SELECT 
            ID_CONVERSA,
            COUNT(*) as nao_lidas
          FROM [dbo].[MESSAGES]
          WHERE (SENDER_ID != @userId OR SENDER_TYPE != @userType)
            AND READ_BY_RECEIVER = 0
          GROUP BY ID_CONVERSA
        `);

      res.json({
        success: true,
        data: {
          total: result.recordset[0].total,
          porConversa: porConversaResult.recordset
        }
      });
    } catch (err) {
      console.error('Erro ao buscar contador:', err);
      res.status(500).json({ error: 'Erro ao buscar contador.' });
    }
  },

  /**
   * Atualizar campos de uma conversa
   * 
   * PUT /api/chat/conversas/:id
   * 
   * @description
   * Atualiza campos específicos de uma conversa (última mensagem, contador de não lidas).
   * Permite atualização parcial - apenas os campos fornecidos são atualizados.
   * Geralmente usado internamente quando novas mensagens são enviadas.
   * 
   * @param {Object} req.params - Parâmetros da rota
   * @param {number} req.params.id - ID da conversa
   * @param {Object} req.body - Campos a atualizar
   * @param {string} [req.body.ultimaMensagem] - Nova última mensagem
   * @param {number} [req.body.mensagensNaoLidas] - Novo contador de não lidas
   * 
   * @returns {Object} JSON com:
   *   - success: boolean
   *   - message: Mensagem de sucesso
   * 
   * @throws {400} Se nenhum campo for fornecido para atualizar
   * 
   * @example
   * PUT /api/chat/conversas/1
   * // Body: {
   * //   "ultimaMensagem": "Nova mensagem",
   * //   "mensagensNaoLidas": 3
   * // }
   * 
   * @author Sistema DivulgaCarga
   * @since 2.0
   */
  atualizarConversa: async (req, res) => {
    try {
      const { id } = req.params;
      const { ultimaMensagem, mensagensNaoLidas } = req.body;

      const pool = await poolPromise;
      const request = pool.request();
      request.input('id', sql.Int, parseInt(id));

      let updates = [];
      if (ultimaMensagem !== undefined) {
        request.input('ultimaMensagem', sql.NVarChar(sql.MAX), ultimaMensagem);
        updates.push('ULTIMA_MENSAGEM = @ultimaMensagem');
        updates.push('DH_ULTIMA_MENSAGEM = SYSUTCDATETIME()');
      }
      if (mensagensNaoLidas !== undefined) {
        request.input('mensagensNaoLidas', sql.Int, parseInt(mensagensNaoLidas));
        updates.push('MENSAGENS_NAO_LIDAS = @mensagensNaoLidas');
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'Nenhum campo para atualizar' });
      }

      const query = `UPDATE [dbo].[CONVERSAS] SET ${updates.join(', ')} WHERE ID = @id`;
      await request.query(query);

      res.json({ success: true, message: 'Conversa atualizada com sucesso' });
    } catch (err) {
      console.error('Erro ao atualizar conversa:', err);
      res.status(500).json({ error: 'Erro ao atualizar conversa.' });
    }
  },

  /**
   * Buscar nome do operador/motorista por ID
   * GET /api/messages/operador/:id
   */
  buscarNomeOperador: async (req, res) => {
    try {
      const { id } = req.params;
      
      if (!id) {
        return res.status(400).json({ error: 'ID é obrigatório' });
      }

      const pool = await poolPromise;
      const result = await pool.request()
        .input('id', sql.Decimal(15, 0), parseFloat(id))
        .query(`
          SELECT RZSOCIAL, NOME
          FROM [dbo].[CADASTROGERAL]
          WHERE CDCADASTRO = @id
        `);

      if (result.recordset.length === 0) {
        return res.status(404).json({ error: 'Operador não encontrado' });
      }

      const operador = result.recordset[0];
      res.json({
        success: true,
        nome: operador.RZSOCIAL || operador.NOME || 'Operador'
      });
    } catch (err) {
      console.error('Erro ao buscar nome do operador:', err);
      res.status(500).json({ error: 'Erro ao buscar nome do operador.' });
    }
  }
};

module.exports = messageController;
