// backend/controllers/message.controller.js
// Controller para Chat Motorista ↔ Operador
// Versão: 2.0 - Módulo separado
// Data: 2026-01-16
// Última atualização: 2026-01-18
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

const path = require('path');
const fs = require('fs');
const sql = require('../config/mssql-compat');
const { poolPromise } = require('../config/db');
const { transcreverAudioDetalhado } = require('../services/transcricao.service');
const { tenantIdForRequest } = require('../utils/tenant-context');
const { chatDashboardRoom } = require('../services/socket-tenant.service');

/** Pasta de upload de áudio (relativa ao backend, dentro de public para ser servida estaticamente) */
const UPLOAD_AUDIO_DIR = path.join(__dirname, '..', 'public', 'uploads', 'audio');
const AUDIO_PREVIEW_TEXT = '🎙️ Áudio';

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
   * @author Atlas Cargo
   * @since 2.0
   */
  enviar: async (req, res) => {
    let client = null;
    try {
      const { idviagem, content, senderType, senderId, senderName } = req.body;

      if (!idviagem || !content || !senderType || !senderId) {
        return res.status(400).json({ error: 'Dados incompletos para enviar mensagem' });
      }

      if (content.trim().length === 0) {
        return res.status(400).json({ error: 'Mensagem não pode estar vazia' });
      }

      // Normalizar senderType (frontend pode enviar 'driver' ou 'motorista')
      const senderTypeNorm = String(senderType || '').toUpperCase() === 'DRIVER' || String(senderType || '').toUpperCase() === 'MOTORISTA'
        ? 'MOTORISTA'
        : (senderType || '').substring(0, 10);

      const pool = await poolPromise;
      const idViagemNum = parseFloat(idviagem);
      const tid = tenantIdForRequest(req);

      try {
        const checkViagem = await pool.query(
          `SELECT 1 FROM public."VIAGEMMESTRE" WHERE "IDVIAGEM" = $1 AND "TENANT_ID" = $2 LIMIT 1`,
          [idViagemNum, tid]
        );
        if (!checkViagem.rows || checkViagem.rows.length === 0) {
          return res.status(400).json({ error: 'Viagem não cadastrada no sistema.' });
        }
      } catch (errCheck) {
        const code = errCheck.code || '';
        if (code === '42P01' || /relação.*não existe|table.*does not exist/i.test(String(errCheck.message || ''))) {
          return res.status(400).json({ error: 'Viagem não cadastrada no sistema.' });
        }
      }

      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        let idConversa = null;
        if (req.body.idConversa) {
          idConversa = parseInt(req.body.idConversa, 10);
          const convOk = await client.query(
            `SELECT "ID" FROM public."CONVERSAS" WHERE "ID" = $1 AND "TENANT_ID" = $2 LIMIT 1`,
            [idConversa, tid]
          );
          if (!convOk.rows || convOk.rows.length === 0) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(403).json({ error: 'Conversa não encontrada ou sem permissão.' });
          }
        } else {
          const findConv = await client.query(
            `SELECT "ID" FROM public."CONVERSAS" WHERE "ID_VIAGEM" = $1 AND "TENANT_ID" = $2 LIMIT 1`,
            [idViagemNum, tid]
          );
          if (findConv.rows && findConv.rows.length > 0) {
            idConversa = findConv.rows[0].ID ?? findConv.rows[0].id;
          } else {
            const idCriador = Math.floor(Number(senderId)) || 0;
            const insertConv = await client.query(
              `INSERT INTO public."CONVERSAS" ("TIPO", "ID_VIAGEM", "ID_CRIADOR", "MENSAGENS_NAO_LIDAS", "DH_CRIACAO", "TENANT_ID")
               VALUES ('VIAGEM', $1, $2, 0, NOW(), $3)
               RETURNING "ID"`,
              [idViagemNum, idCriador, tid]
            );
            const row = insertConv.rows && insertConv.rows[0];
            idConversa = row ? (row.ID ?? row.id) : null;
          }
        }

        if (idConversa == null) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(500).json({ error: 'Não foi possível obter ou criar a conversa.' });
        }

        const tipoMsg = (req.body.tipo || 'TEXTO').substring(0, 20);
        const senderIdNum = Number(senderId);
        const insertMsg = await client.query(
          `INSERT INTO public."MESSAGES" (
            "IDVIAGEM", "ID_CONVERSA", "SENDER_TYPE", "SENDER_ID", "SENDER_NAME", "CONTENT", "TIPO",
            "READ_BY_SENDER", "READ_BY_RECEIVER", "SYNCED", "CREATED_AT", "TENANT_ID"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, false, true, NOW(), $8)
          RETURNING "ID", "IDVIAGEM", "ID_CONVERSA", "SENDER_TYPE", "SENDER_ID", "SENDER_NAME",
            "CONTENT", "TIPO", "READ_BY_SENDER", "READ_BY_RECEIVER", "DH_LEITURA", "CREATED_AT", "SYNCED"`,
          [
            idViagemNum,
            idConversa,
            senderTypeNorm,
            isNaN(senderIdNum) ? 0 : senderIdNum,
            (senderName || null),
            content.trim(),
            tipoMsg,
            tid
          ]
        );

        const messageRow = insertMsg.rows && insertMsg.rows[0];
        if (!messageRow) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(500).json({ error: 'Erro ao inserir mensagem.' });
        }

        await client.query(
          `UPDATE public."CONVERSAS"
           SET "ULTIMA_MENSAGEM" = $1, "DH_ULTIMA_MENSAGEM" = NOW(),
               "MENSAGENS_NAO_LIDAS" = CASE
                 WHEN UPPER(COALESCE($3::text, '')) IN ('MOTORISTA', 'DRIVER')
                   THEN COALESCE("MENSAGENS_NAO_LIDAS", 0) + 1
                 ELSE COALESCE("MENSAGENS_NAO_LIDAS", 0)
               END
           WHERE "ID" = $2 AND "TENANT_ID" = $4`,
          [content.trim().substring(0, 4000), idConversa, senderTypeNorm, tid]
        );

        await client.query('COMMIT');
        client.release();

        const message = {
          ID: messageRow.ID ?? messageRow.id,
          IDVIAGEM: messageRow.IDVIAGEM ?? messageRow.idviagem,
          ID_CONVERSA: messageRow.ID_CONVERSA ?? messageRow.id_conversa,
          SENDER_TYPE: messageRow.SENDER_TYPE ?? messageRow.sender_type,
          SENDER_ID: messageRow.SENDER_ID ?? messageRow.sender_id,
          SENDER_NAME: messageRow.SENDER_NAME ?? messageRow.sender_name,
          CONTENT: messageRow.CONTENT ?? messageRow.content,
          TIPO: messageRow.TIPO ?? messageRow.tipo,
          READ_BY_SENDER: messageRow.READ_BY_SENDER ?? messageRow.read_by_sender,
          READ_BY_RECEIVER: messageRow.READ_BY_RECEIVER ?? messageRow.read_by_receiver,
          DH_LEITURA: messageRow.DH_LEITURA ?? messageRow.dh_leitura,
          CREATED_AT: messageRow.CREATED_AT ?? messageRow.created_at,
          SYNCED: messageRow.SYNCED ?? messageRow.synced
        };

        const io = req.app && req.app.get ? req.app.get('io') : null;
        if (io) {
          io.to(`viagem-${idviagem}`).emit('nova-mensagem', message);
          io.to(`conversa-${idConversa}`).emit('nova-mensagem', message);
          const st = String(message.SENDER_TYPE || '').toUpperCase();
          if (st === 'MOTORISTA' || st === 'DRIVER') {
            io.to(chatDashboardRoom(tid)).emit('nova-mensagem', message);
          }
        }
        try {
          const websocketTorre = req.app && req.app.get ? req.app.get('websocketTorre') : null;
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
        try {
          if (client) await client.query('ROLLBACK');
        } catch (_) {}
        if (client) client.release();
        throw err;
      }
    } catch (err) {
      console.error('Erro ao enviar mensagem:', err.message || err);
      if (process.env.NODE_ENV !== 'production' && err.stack) console.error(err.stack);
      const isDev = process.env.NODE_ENV !== 'production';
      res.status(500).json({
        error: isDev ? (err.message || 'Erro ao enviar mensagem.') : 'Erro ao enviar mensagem.',
        ...(isDev && err.code && { code: err.code })
      });
    }
  },

  /**
   * Upload de áudio e registro como mensagem tipo AUDIO
   * POST /api/messages/upload-audio
   * multipart/form-data: file, idviagem, senderType, senderId, senderName, [idConversa]
   */
  uploadAudio: async (req, res) => {
    try {
      if (!req.file || !req.file.path) {
        return res.status(400).json({ error: 'Arquivo de áudio é obrigatório.' });
      }
      const idviagem = req.body.idviagem;
      const senderType = req.body.senderType || 'driver';
      const senderId = req.body.senderId;
      const senderName = req.body.senderName || null;
      if (!idviagem || !senderId) {
        return res.status(400).json({ error: 'idviagem e senderId são obrigatórios.' });
      }

      const relativePath = path.relative(path.join(__dirname, '..', 'public'), req.file.path);
      const urlPath = '/' + relativePath.replace(/\\/g, '/');
      const contentObj = { url: urlPath };

      const idioma = req.body.idioma && String(req.body.idioma).trim();
      const tidUpload = tenantIdForRequest(req);
      if (idioma) {
        console.log('[upload-audio] Idioma da transcrição:', idioma);
        try {
          const rTrans = await transcreverAudioDetalhado(req.file.path, idioma, { tenantId: tidUpload });
          if (rTrans && rTrans.text) {
            contentObj.transcricao = rTrans.text;
            console.log('[upload-audio] Transcrição incluída no conteúdo.');
          } else {
            console.log(
              '[upload-audio] Áudio salvo sem transcrição:',
              (rTrans && rTrans.code) || 'SEM_TEXTO',
              (rTrans && rTrans.error) || ''
            );
            if (rTrans && rTrans.error) {
              contentObj.transcricaoErro = { code: rTrans.code, message: rTrans.error };
            }
          }
        } catch (errTransc) {
          console.warn('[upload-audio] Transcrição de áudio ignorada:', errTransc.message || errTransc);
        }
      } else {
        console.log('[upload-audio] Áudio salvo sem transcrição (opção "Não transcrever").');
      }

      const contentStr = JSON.stringify(contentObj);

      // Mesma regra de enviar(): motorista sempre grava como MOTORISTA (evita 'driver' no DB e quebra socket/badge)
      const senderTypeNorm = String(senderType || '').toUpperCase() === 'DRIVER' || String(senderType || '').toUpperCase() === 'MOTORISTA'
        ? 'MOTORISTA'
        : (senderType || 'OPERADOR').substring(0, 20);

      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      try {
        const checkViagem = await pool.query(
          `SELECT 1 FROM public."VIAGEMMESTRE" WHERE "IDVIAGEM" = $1 AND "TENANT_ID" = $2 LIMIT 1`,
          [parseFloat(idviagem), tid]
        );
        if (!checkViagem.rows || checkViagem.rows.length === 0) {
          return res.status(400).json({ error: 'Viagem não cadastrada no sistema.' });
        }
      } catch (errChk) {
        const code = errChk.code || '';
        if (code === '42P01' || /relação.*não existe|table.*does not exist/i.test(String(errChk.message || ''))) {
          return res.status(400).json({ error: 'Viagem não cadastrada no sistema.' });
        }
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let idConversa = null;
        if (req.body.idConversa) {
          idConversa = parseInt(req.body.idConversa, 10);
          const convOk = await client.query(
            `SELECT "ID" FROM public."CONVERSAS" WHERE "ID" = $1 AND "TENANT_ID" = $2 LIMIT 1`,
            [idConversa, tid]
          );
          if (!convOk.rows || convOk.rows.length === 0) {
            await client.query('ROLLBACK');
            client.release();
            return res.status(403).json({ error: 'Conversa não encontrada ou sem permissão.' });
          }
        } else {
          const idViagemNum = parseFloat(idviagem);
          const findConv = await client.query(
            `SELECT "ID" FROM public."CONVERSAS" WHERE "ID_VIAGEM" = $1 AND "TENANT_ID" = $2 LIMIT 1`,
            [idViagemNum, tid]
          );
          if (findConv.rows && findConv.rows.length > 0) {
            idConversa = findConv.rows[0].ID ?? findConv.rows[0].id;
          } else {
            const insertConv = await client.query(
              `INSERT INTO public."CONVERSAS" ("TIPO", "ID_VIAGEM", "ID_CRIADOR", "MENSAGENS_NAO_LIDAS", "DH_CRIACAO", "TENANT_ID")
               VALUES ('VIAGEM', $1, $2, 0, NOW(), $3)
               RETURNING "ID"`,
              [idViagemNum, parseFloat(senderId), tid]
            );
            const row = insertConv.rows && insertConv.rows[0];
            idConversa = row ? (row.ID ?? row.id) : null;
          }
        }
        if (idConversa == null) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(500).json({ error: 'Não foi possível obter ou criar a conversa.' });
        }

        const idViagemNum = parseFloat(idviagem);
        const insertMsg = await client.query(
          `INSERT INTO public."MESSAGES" (
            "IDVIAGEM", "ID_CONVERSA", "SENDER_TYPE", "SENDER_ID", "SENDER_NAME", "CONTENT", "TIPO",
            "READ_BY_SENDER", "READ_BY_RECEIVER", "SYNCED", "CREATED_AT", "TENANT_ID"
          ) VALUES ($1, $2, $3, $4, $5, $6, 'AUDIO', true, false, true, NOW(), $7)
          RETURNING "ID", "IDVIAGEM", "ID_CONVERSA", "SENDER_TYPE", "SENDER_ID", "SENDER_NAME",
            "CONTENT", "TIPO", "READ_BY_SENDER", "READ_BY_RECEIVER", "DH_LEITURA", "CREATED_AT", "SYNCED"`,
          [
            idViagemNum,
            idConversa,
            senderTypeNorm,
            parseFloat(senderId),
            senderName,
            contentStr,
            tid
          ]
        );
        const messageRow = insertMsg.rows && insertMsg.rows[0];
        if (!messageRow) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(500).json({ error: 'Erro ao inserir mensagem de áudio.' });
        }
        await client.query(
          `UPDATE public."CONVERSAS"
           SET "ULTIMA_MENSAGEM" = $1, "DH_ULTIMA_MENSAGEM" = NOW(),
               "MENSAGENS_NAO_LIDAS" = CASE
                 WHEN UPPER(COALESCE($3::text, '')) IN ('MOTORISTA', 'DRIVER')
                   THEN COALESCE("MENSAGENS_NAO_LIDAS", 0) + 1
                 ELSE COALESCE("MENSAGENS_NAO_LIDAS", 0)
               END
           WHERE "ID" = $2 AND "TENANT_ID" = $4`,
          [AUDIO_PREVIEW_TEXT, idConversa, senderTypeNorm, tid]
        );
        await client.query('COMMIT');
        client.release();

        const message = {
          ID: messageRow.ID ?? messageRow.id,
          IDVIAGEM: messageRow.IDVIAGEM ?? messageRow.idviagem,
          ID_CONVERSA: messageRow.ID_CONVERSA ?? messageRow.id_conversa,
          SENDER_TYPE: messageRow.SENDER_TYPE ?? messageRow.sender_type,
          SENDER_ID: messageRow.SENDER_ID ?? messageRow.sender_id,
          SENDER_NAME: messageRow.SENDER_NAME ?? messageRow.sender_name,
          CONTENT: messageRow.CONTENT ?? messageRow.content,
          TIPO: messageRow.TIPO ?? messageRow.tipo,
          READ_BY_SENDER: messageRow.READ_BY_SENDER ?? messageRow.read_by_sender,
          READ_BY_RECEIVER: messageRow.READ_BY_RECEIVER ?? messageRow.read_by_receiver,
          DH_LEITURA: messageRow.DH_LEITURA ?? messageRow.dh_leitura,
          CREATED_AT: messageRow.CREATED_AT ?? messageRow.created_at,
          SYNCED: messageRow.SYNCED ?? messageRow.synced
        };
        const io = req.app && req.app.get ? req.app.get('io') : null;
        if (io) {
          io.to(`viagem-${idviagem}`).emit('nova-mensagem', message);
          io.to(`conversa-${idConversa}`).emit('nova-mensagem', message);
          const st = String(message.SENDER_TYPE || '').toUpperCase();
          if (st === 'MOTORISTA' || st === 'DRIVER') {
            io.to(chatDashboardRoom(tid)).emit('nova-mensagem', message);
          }
        }
        try {
          const websocketTorre = req.app && req.app.get ? req.app.get('websocketTorre') : null;
          if (websocketTorre) websocketTorre.emitirNovaMensagem(message);
        } catch (e) {
          console.warn('⚠️ Erro ao emitir WebSocket mensagem:', e.message);
        }
        return res.json({ success: true, message, messageText: 'Áudio enviado com sucesso!' });
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        client.release();
        throw err;
      }
    } catch (err) {
      console.error('Erro ao fazer upload de áudio:', err);
      res.status(500).json({ error: 'Erro ao enviar áudio.' });
    }
  },

  /**
   * Transcrever áudio de uma mensagem existente (sob demanda).
   * POST /api/messages/transcrever-audio
   * Body: { idMensagem: number, idioma: string }
   */
  transcreverAudioOnDemand: async (req, res) => {
    try {
      const { idMensagem, idioma } = req.body || {};
      const id = idMensagem != null ? parseInt(idMensagem, 10) : NaN;
      const lang = idioma && String(idioma).trim();
      if (!id || isNaN(id) || !lang) {
        return res.status(400).json({ error: 'idMensagem e idioma são obrigatórios.' });
      }
      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);
      const sel = await pool.query(
        `SELECT "ID", "CONTENT", "TIPO" FROM public."MESSAGES" WHERE "ID" = $1 AND "TENANT_ID" = $2`,
        [id, tid]
      );
      const row = sel.rows && sel.rows[0];
      if (!row) {
        return res.status(404).json({ error: 'Mensagem não encontrada.' });
      }
      if ((row.TIPO || row.tipo) !== 'AUDIO') {
        return res.status(400).json({ error: 'A mensagem não é de áudio.' });
      }
      let contentObj = {};
      try {
        contentObj = typeof row.CONTENT === 'string' ? JSON.parse(row.CONTENT) : (row.CONTENT || {});
      } catch (_) {
        return res.status(400).json({ error: 'Conteúdo da mensagem inválido.' });
      }
      const url = contentObj.url;
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: 'URL do áudio não encontrada na mensagem.' });
      }
      const filePath = path.join(__dirname, '..', 'public', url.replace(/^\//, ''));
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Arquivo de áudio não encontrado no servidor.' });
      }
      const rTrans = await transcreverAudioDetalhado(filePath, lang, { tenantId: tid });
      if (!rTrans || !rTrans.text) {
        return res.status(502).json({
          code: (rTrans && rTrans.code) || 'SEM_TEXTO',
          error:
            (rTrans && rTrans.error) ||
            'Transcrição não retornou texto. Verifique a chave OpenAI e se o áudio tem fala.',
        });
      }
      const transcricao = rTrans.text;
      contentObj.transcricao = transcricao;
      delete contentObj.transcricaoErro;
      const newContentStr = JSON.stringify(contentObj);
      await pool.query(
        `UPDATE public."MESSAGES" SET "CONTENT" = $1 WHERE "ID" = $2 AND "TENANT_ID" = $3`,
        [newContentStr, id, tid]
      );
      const updated = await pool.query(
        `SELECT "ID", "IDVIAGEM", "ID_CONVERSA", "SENDER_TYPE", "SENDER_ID", "SENDER_NAME",
                "CONTENT", "TIPO", "READ_BY_SENDER", "READ_BY_RECEIVER", "CREATED_AT", "SYNCED"
         FROM public."MESSAGES" WHERE "ID" = $1 AND "TENANT_ID" = $2`,
        [id, tid]
      );
      const msgRow = updated.rows && updated.rows[0];
      const message = msgRow ? {
        ID: msgRow.ID ?? msgRow.id,
        IDVIAGEM: msgRow.IDVIAGEM ?? msgRow.idviagem,
        ID_CONVERSA: msgRow.ID_CONVERSA ?? msgRow.id_conversa,
        SENDER_TYPE: msgRow.SENDER_TYPE ?? msgRow.sender_type,
        SENDER_ID: msgRow.SENDER_ID ?? msgRow.sender_id,
        SENDER_NAME: msgRow.SENDER_NAME ?? msgRow.sender_name,
        CONTENT: msgRow.CONTENT ?? msgRow.content,
        TIPO: msgRow.TIPO ?? msgRow.tipo,
        READ_BY_SENDER: msgRow.READ_BY_SENDER ?? msgRow.read_by_sender,
        READ_BY_RECEIVER: msgRow.READ_BY_RECEIVER ?? msgRow.read_by_receiver,
        CREATED_AT: msgRow.CREATED_AT ?? msgRow.created_at,
        SYNCED: msgRow.SYNCED ?? msgRow.synced
      } : null;
      try {
        const websocketTorre = req.app && req.app.get ? req.app.get('websocketTorre') : null;
        if (websocketTorre && message) websocketTorre.emitirNovaMensagem(message);
      } catch (e) {
        console.warn('⚠️ Erro ao emitir WebSocket após transcrição:', e.message);
      }
      return res.json({ success: true, message, transcricao });
    } catch (err) {
      console.error('Erro ao transcrever áudio sob demanda:', err);
      res.status(500).json({ error: err.message || 'Erro ao transcrever áudio.' });
    }
  },

  /**
   * Buscar mensagens de uma viagem
   * GET /api/messages/viagem/:idviagem
   * Usa SQL nativo PostgreSQL (public."MESSAGES" + public."CONVERSAS") para evitar erros de conversão.
   */
  buscarPorViagem: async (req, res) => {
    try {
      const { idviagem } = req.params;
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
      const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
      const idVig = parseFloat(idviagem);

      console.log('💬 [CHAT] buscarPorViagem chamado:', { idviagem, limit, offset });

      if (!idviagem) {
        console.warn('💬 [CHAT] idviagem ausente, retornando 400');
        return res.status(400).json({ error: 'ID da viagem é obrigatório' });
      }

      const pool = await poolPromise;
      const tid = tenantIdForRequest(req);

      // Tentativa 1: SQL nativo PostgreSQL (MESSAGES via CONVERSAS – esquema Atlas Cargo)
      try {
        const rowsResult = await pool.query(
          `SELECT m."ID", c."ID_VIAGEM" AS "IDVIAGEM", m."SENDER_TYPE", m."SENDER_ID",
            COALESCE(m."SENDER_NAME",
              CASE WHEN m."SENDER_TYPE" = 'OPERADOR' THEN cg."RZSOCIAL"
                   WHEN m."SENDER_TYPE" IN ('driver', 'MOTORISTA') THEN cg2."RZSOCIAL"
                   ELSE NULL END
            ) AS "SENDER_NAME",
            m."CONTENT", m."TIPO", m."READ_BY_SENDER", m."READ_BY_RECEIVER", m."CREATED_AT", m."SYNCED"
           FROM public."MESSAGES" m
           INNER JOIN public."CONVERSAS" c ON m."ID_CONVERSA" = c."ID"
           LEFT JOIN public."CADASTROGERAL" cg ON m."SENDER_TYPE" = 'OPERADOR' AND m."SENDER_ID" = cg."CDCADASTRO"
           LEFT JOIN public."CADASTROGERAL" cg2 ON m."SENDER_TYPE" IN ('driver', 'MOTORISTA') AND m."SENDER_ID" = cg2."CDCADASTRO"
           WHERE c."ID_VIAGEM" = $1 AND c."TENANT_ID" = $2 AND m."TENANT_ID" = $2
           ORDER BY m."CREATED_AT" DESC
           OFFSET $3 LIMIT $4`,
          [idVig, tid, offset, limit]
        );
        const countResult = await pool.query(
          `SELECT COUNT(*) AS total FROM public."MESSAGES" m
           INNER JOIN public."CONVERSAS" c ON m."ID_CONVERSA" = c."ID"
           WHERE c."ID_VIAGEM" = $1 AND c."TENANT_ID" = $2 AND m."TENANT_ID" = $2`,
          [idVig, tid]
        );
        const rows = rowsResult.rows || [];
        const total = parseInt(countResult.rows?.[0]?.total ?? countResult.rows?.[0]?.TOTAL ?? rows.length, 10);
        const messages = rows.map(r => ({ ...r, IDVIAGEM: r.IDVIAGEM ?? idVig }));
        console.log('💬 [CHAT] OK (PG nativo via CONVERSAS):', messages.length, 'mensagens, total:', total);
        return res.json({ success: true, messages: messages.reverse(), total });
      } catch (err1) {
        const code = err1.code || '';
        const msg = String(err1.message || '');
        console.warn('💬 [CHAT] PG nativo (CONVERSAS) falhou:', code, msg);
        if (code !== '42P01' && code !== '42703' && !/não existe|does not exist/i.test(msg)) {
          throw err1;
        }
      }

      // Tentativa 1b: MESSAGES com coluna IDVIAGEM direta (quando não há CONVERSAS ou JOIN vazio)
      try {
        const rowsResult = await pool.query(
          `SELECT m."ID", m."IDVIAGEM", m."SENDER_TYPE", m."SENDER_ID",
            COALESCE(m."SENDER_NAME",
              CASE WHEN m."SENDER_TYPE" = 'OPERADOR' THEN cg."RZSOCIAL"
                   WHEN m."SENDER_TYPE" IN ('driver', 'MOTORISTA') THEN cg2."RZSOCIAL"
                   ELSE NULL END
            ) AS "SENDER_NAME",
            m."CONTENT", m."TIPO", m."READ_BY_SENDER", m."READ_BY_RECEIVER", m."CREATED_AT", m."SYNCED"
           FROM public."MESSAGES" m
           LEFT JOIN public."CADASTROGERAL" cg ON m."SENDER_TYPE" = 'OPERADOR' AND m."SENDER_ID" = cg."CDCADASTRO"
           LEFT JOIN public."CADASTROGERAL" cg2 ON m."SENDER_TYPE" IN ('driver', 'MOTORISTA') AND m."SENDER_ID" = cg2."CDCADASTRO"
           WHERE m."IDVIAGEM" = $1 AND m."TENANT_ID" = $2
           ORDER BY m."CREATED_AT" DESC
           OFFSET $3 LIMIT $4`,
          [idVig, tid, offset, limit]
        );
        const countResult = await pool.query(
          `SELECT COUNT(*) AS total FROM public."MESSAGES" WHERE "IDVIAGEM" = $1 AND "TENANT_ID" = $2`,
          [idVig, tid]
        );
        const rows = rowsResult.rows || [];
        const total = parseInt(countResult.rows?.[0]?.total ?? countResult.rows?.[0]?.TOTAL ?? rows.length, 10);
        const messages = rows.map(r => ({ ...r, IDVIAGEM: r.IDVIAGEM ?? idVig }));
        console.log('💬 [CHAT] OK (PG nativo por IDVIAGEM):', messages.length, 'mensagens, total:', total);
        return res.json({ success: true, messages: messages.reverse(), total });
      } catch (err1b) {
        const code = err1b.code || '';
        const msg = String(err1b.message || '');
        console.warn('💬 [CHAT] PG nativo (IDVIAGEM) falhou:', code, msg);
        if (code !== '42P01' && code !== '42703' && !/não existe|does not exist/i.test(msg)) {
          throw err1b;
        }
      }

      // Tentativa 2: via pool.request() (conversão db.js) – fallback
      const reqBase = () => pool.request()
        .input('idviagem', sql.Decimal(15, 0), idviagem)
        .input('TENANT_ID', tid)
        .input('limit', sql.Int, limit)
        .input('offset', sql.Int, offset);
      try {
        const result = await reqBase().query(`
          SELECT m.[ID], c.[ID_VIAGEM] AS IDVIAGEM, m.[SENDER_TYPE], m.[SENDER_ID],
            COALESCE(m.[SENDER_NAME],
              CASE WHEN m.[SENDER_TYPE] = 'OPERADOR' THEN cg.[RZSOCIAL]
                   WHEN m.[SENDER_TYPE] IN ('driver', 'MOTORISTA') THEN cg2.[RZSOCIAL]
                   ELSE NULL END) AS SENDER_NAME,
            m.[CONTENT], m.[READ_BY_SENDER], m.[READ_BY_RECEIVER], m.[CREATED_AT], m.[SYNCED]
          FROM [dbo].[MESSAGES] m
          INNER JOIN [dbo].[CONVERSAS] c ON m.[ID_CONVERSA] = c.[ID]
          LEFT JOIN [dbo].[CADASTROGERAL] cg ON m.[SENDER_TYPE] = 'OPERADOR' AND m.[SENDER_ID] = cg.[CDCADASTRO] AND cg.[TENANT_ID] = c.[TENANT_ID]
          LEFT JOIN [dbo].[CADASTROGERAL] cg2 ON m.[SENDER_TYPE] IN ('driver', 'MOTORISTA') AND m.[SENDER_ID] = cg2.[CDCADASTRO] AND cg2.[TENANT_ID] = c.[TENANT_ID]
          WHERE c.[ID_VIAGEM] = @idviagem AND c.[TENANT_ID] = @TENANT_ID AND m.[TENANT_ID] = @TENANT_ID
          ORDER BY m.[CREATED_AT] DESC
          OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
        `);
        const countResult = await pool.request()
          .input('idviagem', sql.Decimal(15, 0), idviagem)
          .input('TENANT_ID', tid)
          .query(`
          SELECT COUNT(*) AS total FROM [dbo].[MESSAGES] m
          INNER JOIN [dbo].[CONVERSAS] c ON m.[ID_CONVERSA] = c.[ID]
          WHERE c.[ID_VIAGEM] = @idviagem AND c.[TENANT_ID] = @TENANT_ID AND m.[TENANT_ID] = @TENANT_ID
        `);
        const total = countResult.recordset?.[0]?.total ?? countResult.recordset?.[0]?.TOTAL ?? (result.recordset || []).length;
        const messages = (result.recordset || []).map(row => ({ ...row, IDVIAGEM: row.IDVIAGEM ?? idviagem }));
        console.log('💬 [CHAT] OK (fallback):', messages.length, 'mensagens');
        return res.json({ success: true, messages: messages.reverse(), total });
      } catch (err2) {
        console.warn('💬 [CHAT] Fallback falhou:', err2.message);
      }

      console.log('💬 [CHAT] Retornando lista vazia');
      return res.json({ success: true, messages: [], total: 0 });
    } catch (err) {
      console.error('💬 [CHAT] Erro ao buscar mensagens:', err.code, err.message);
      res.status(500).json({ success: false, error: 'Erro ao buscar mensagens.', messages: [] });
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
      const idViagemNum = parseFloat(idviagem);
      const senderIdNum = parseFloat(userId);
      const senderTypeStr = (userType || '').substring(0, 20);
      const tid = tenantIdForRequest(req);

      const isMotorista = senderTypeStr.toUpperCase() === 'MOTORISTA' || senderTypeStr.toUpperCase() === 'DRIVER';
      const isDevLog = process.env.NODE_ENV !== 'production';

      let totalConvAntes = null;
      if (isDevLog) {
        try {
          const beforeRes = await pool.query(
            `SELECT COALESCE(SUM(c."MENSAGENS_NAO_LIDAS"), 0)::int AS total
             FROM public."CONVERSAS" c
             WHERE c."ID_VIAGEM" = $1 AND c."TENANT_ID" = $2`,
            [idViagemNum, tid]
          );
          totalConvAntes = beforeRes.rows && beforeRes.rows[0]
            ? (parseInt(beforeRes.rows[0].total, 10) || 0)
            : 0;
          console.log(
            `💬 [CHAT][marcar-lidas][inicio] viagem=${idViagemNum} userId=${senderIdNum} userType=${senderTypeStr} isMotorista=${isMotorista} totalConvAntes=${totalConvAntes}`
          );
        } catch (_) {}
      }

      // Marcar como lidas todas as mensagens que não são do próprio usuário (PostgreSQL nativo)
      let updateQuery = `
        UPDATE public."MESSAGES" m
        SET "READ_BY_RECEIVER" = true, "DH_LEITURA" = NOW()
        FROM public."CONVERSAS" c
        WHERE m."ID_CONVERSA" = c."ID"
          AND m."IDVIAGEM" = $1
          AND c."TENANT_ID" = $4
          AND m."TENANT_ID" = $4
          AND (m."SENDER_ID" IS DISTINCT FROM $2 OR m."SENDER_TYPE" IS DISTINCT FROM $3)
          AND (COALESCE(m."READ_BY_RECEIVER", false) IS NOT TRUE)
      `;

      if (isMotorista) {
        updateQuery += `
          AND (
            c."ID_MOTORISTA" = $2 
            OR EXISTS (
              SELECT 1 FROM public."VIAGEMMOTORISTA" vm
              WHERE vm."IDVIAGEM" = c."ID_VIAGEM" AND vm."CDMOTORISTA" = $2 AND vm."TENANT_ID" = $4
            )
            OR m."IDVIAGEM" IN (
              SELECT vm2."IDVIAGEM" FROM public."VIAGEMMOTORISTA" vm2
              WHERE vm2."CDMOTORISTA" = $2 AND vm2."TENANT_ID" = $4
            )
          )
        `;
      }

      const updateMsgResult = await pool.query(updateQuery, [idViagemNum, senderIdNum, senderTypeStr, tid]);

      // ATENÇÃO:
      // CONVERSAS.MENSAGENS_NAO_LIDAS é usado pelo painel web (OPERADOR).
      // Quando o motorista marca como lida, não devemos recalcular esse campo,
      // senão o badge do operador "sobe e some" sem leitura real no web.
      let updateConvRowCount = 0;
      if (!isMotorista) {
        const updateConvQuery = `
          UPDATE public."CONVERSAS" c
          SET "MENSAGENS_NAO_LIDAS" = (
            SELECT COUNT(*)::int
            FROM public."MESSAGES" m
            WHERE m."ID_CONVERSA" = c."ID"
              AND m."TENANT_ID" = c."TENANT_ID"
              AND (m."SENDER_ID" IS DISTINCT FROM $2 OR m."SENDER_TYPE" IS DISTINCT FROM $3)
              AND (COALESCE(m."READ_BY_RECEIVER", false) IS NOT TRUE)
          )
          WHERE c."ID_VIAGEM" = $1 AND c."TENANT_ID" = $4
        `;

        const updateConvResult = await pool.query(updateConvQuery, [idViagemNum, senderIdNum, senderTypeStr, tid]);
        updateConvRowCount = updateConvResult && Number.isFinite(updateConvResult.rowCount)
          ? updateConvResult.rowCount
          : 0;
      }

      if (isDevLog) {
        try {
          const afterRes = await pool.query(
            `SELECT COALESCE(SUM(c."MENSAGENS_NAO_LIDAS"), 0)::int AS total
             FROM public."CONVERSAS" c
             WHERE c."ID_VIAGEM" = $1 AND c."TENANT_ID" = $2`,
            [idViagemNum, tid]
          );
          const totalConvDepois = afterRes.rows && afterRes.rows[0]
            ? (parseInt(afterRes.rows[0].total, 10) || 0)
            : 0;
          const msgsMarcadas = updateMsgResult && Number.isFinite(updateMsgResult.rowCount)
            ? updateMsgResult.rowCount
            : 0;
          console.log(
            `💬 [CHAT][marcar-lidas][fim] viagem=${idViagemNum} userId=${senderIdNum} userType=${senderTypeStr} msgsMarcadas=${msgsMarcadas} convRecalc=${updateConvRowCount} totalConvAntes=${totalConvAntes} totalConvDepois=${totalConvDepois}`
          );
        } catch (_) {}
      }

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
   * @author Atlas Cargo
   * @since 2.0
   */
  listarConversas: async (req, res) => {
    try {
      const { poolPromise } = require('../config/db');
      const { tipo, idMotorista, idViagem, limit = 50, offset = 0 } = req.query;
      const pool = await poolPromise;
      const lim = Math.min(parseInt(limit, 10) || 50, 200);
      const off = Math.max(0, parseInt(offset, 10) || 0);
      const tid = tenantIdForRequest(req);

      // Tentativa 1: query nativa PostgreSQL (evita conversão que gera c.id_motorista)
      const params = [tid];
      let paramIdx = 1;
      let where = ' WHERE c."TENANT_ID" = $1 ';
      if (tipo) { paramIdx++; params.push(tipo); where += ` AND c."TIPO" = $${paramIdx}`; }
      if (idMotorista) { paramIdx++; params.push(parseFloat(idMotorista)); where += ` AND c."ID_MOTORISTA" = $${paramIdx}`; }
      if (idViagem) { paramIdx++; params.push(parseFloat(idViagem)); where += ` AND c."ID_VIAGEM" = $${paramIdx}`; }
      paramIdx++; params.push(off);
      paramIdx++; params.push(lim);

      try {
        const sqlNative = `
          SELECT c."ID", c."TIPO", c."ID_MOTORISTA", c."ID_VIAGEM", c."ID_CRIADOR",
                 c."ULTIMA_MENSAGEM", c."DH_ULTIMA_MENSAGEM", c."MENSAGENS_NAO_LIDAS", c."DH_CRIACAO",
                 COALESCE(cg."RZSOCIAL",
                   (SELECT cg2."RZSOCIAL" FROM public."VIAGEMMOTORISTA" vm_m2
                    INNER JOIN public."CADASTROGERAL" cg2 ON vm_m2."CDMOTORISTA" = cg2."CDCADASTRO"
                    WHERE vm_m2."IDVIAGEM" = c."ID_VIAGEM"
                      AND vm_m2."TENANT_ID" = c."TENANT_ID"
                      AND cg2."TENANT_ID" = c."TENANT_ID"
                    LIMIT 1)
                 ) AS motorista_nome,
                 vm."IDVIAGEM" AS viagem_codigo,
                 COALESCE(co."NMCIDADE", '') || CASE WHEN co."ESTADO" IS NOT NULL THEN '/' || co."ESTADO" ELSE '' END AS viagem_origem,
                 COALESCE(cd."NMCIDADE", '') || CASE WHEN cd."ESTADO" IS NOT NULL THEN '/' || cd."ESTADO" ELSE '' END AS viagem_destino,
                 u."RZSOCIAL" AS criador_nome
          FROM public."CONVERSAS" c
          LEFT JOIN public."CADASTROGERAL" cg ON c."ID_MOTORISTA" = cg."CDCADASTRO" AND cg."TENANT_ID" = c."TENANT_ID"
          LEFT JOIN public."VIAGEMMESTRE" vm ON c."ID_VIAGEM" = vm."IDVIAGEM" AND vm."TENANT_ID" = c."TENANT_ID"
          LEFT JOIN public."ROTEIRO" r ON vm."IDROTEIRO" = r."IDROTEIRO"
            AND (r."TENANT_ID" = vm."TENANT_ID" OR r."TENANT_ID" = 'default')
          LEFT JOIN public."CIDADE" co ON r."CDCIDADEORIGEM" = co."CDCIDADE"
          LEFT JOIN public."CIDADE" cd ON r."CDCIDADEDESTINO" = cd."CDCIDADE"
          LEFT JOIN public."CADASTROGERAL" u ON c."ID_CRIADOR" = u."CDCADASTRO" AND u."TENANT_ID" = c."TENANT_ID"
          ${where}
          ORDER BY c."DH_ULTIMA_MENSAGEM" DESC NULLS LAST
          OFFSET $${paramIdx - 1} LIMIT $${paramIdx}
        `;
        const result = await pool.query(sqlNative, params);
        const rows = result.rows || [];
        return res.json({ success: true, data: rows });
      } catch (errNative) {
        const code = errNative.code || '';
        const msg = String(errNative.message || '');
        console.warn('💬 [CHAT] listarConversas PG nativo falhou:', code, msg);
        if (code !== '42P01' && code !== '42703' && !/não existe|does not exist/i.test(msg)) {
          throw errNative;
        }
      }

      // PG: se chegou aqui, esquema pode diferir; retorna lista vazia (evita pool.request que é MSSQL)
      return res.json({ success: true, data: [] });
    } catch (err) {
      const code = err.code || '';
      const msg = String(err.message || '');
      console.error('Erro ao listar conversas:', code, msg);
      if (code === '42703' || code === '42P01' || /coluna.*não existe|does not exist|relação.*não existe/i.test(msg)) {
        console.warn('💬 [CHAT] listarConversas: esquema pode diferir (PG). Retornando lista vazia.');
        return res.json({ success: true, data: [] });
      }
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
   * @author Atlas Cargo
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
      const idConv = parseInt(id, 10);
      const lim = Math.min(parseInt(limit, 10) || 100, 200);
      const off = Math.max(0, parseInt(offset, 10) || 0);
      const tid = tenantIdForRequest(req);

      const result = await pool.query(
        `SELECT 
            m."ID", m."IDVIAGEM", m."ID_CONVERSA", m."SENDER_TYPE", m."SENDER_ID",
            COALESCE(m."SENDER_NAME",
              CASE
                WHEN m."SENDER_TYPE" = 'OPERADOR' THEN cg."RZSOCIAL"
                WHEN m."SENDER_TYPE" IN ('driver', 'MOTORISTA') THEN cg2."RZSOCIAL"
                ELSE NULL
              END
            ) AS "SENDER_NAME",
            m."CONTENT", m."TIPO", m."READ_BY_SENDER", m."READ_BY_RECEIVER",
            m."DH_LEITURA", m."CREATED_AT", m."SYNCED"
          FROM public."MESSAGES" m
          INNER JOIN public."CONVERSAS" conv ON m."ID_CONVERSA" = conv."ID" AND conv."TENANT_ID" = $4
          LEFT JOIN public."CADASTROGERAL" cg ON m."SENDER_TYPE" = 'OPERADOR' AND m."SENDER_ID" = cg."CDCADASTRO"
          LEFT JOIN public."CADASTROGERAL" cg2 ON m."SENDER_TYPE" IN ('driver', 'MOTORISTA') AND m."SENDER_ID" = cg2."CDCADASTRO"
          WHERE m."ID_CONVERSA" = $1 AND m."TENANT_ID" = $4
          ORDER BY m."CREATED_AT" ASC
          OFFSET $2 LIMIT $3`,
        [idConv, off, lim, tid]
      );

      const countResult = await pool.query(
        `SELECT COUNT(*) AS total FROM public."MESSAGES" WHERE "ID_CONVERSA" = $1 AND "TENANT_ID" = $2`,
        [idConv, tid]
      );

      const rows = result.rows || [];
      const total = (countResult.rows && countResult.rows[0]) ? parseInt(countResult.rows[0].total, 10) : rows.length;

      res.json({
        success: true,
        messages: rows,
        total: total
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
   * @author Atlas Cargo
   * @since 2.0
   */
  criarConversa: async (req, res) => {
    try {
      const { tipo, idMotorista, idViagem, idCriador } = req.body;

      if (!tipo || !idCriador) {
        return res.status(400).json({ error: 'Tipo e ID do criador são obrigatórios' });
      }

      const pool = await poolPromise;
      const tidConv = tenantIdForRequest(req);

      if (idViagem) {
        try {
          const vOk = await pool.query(
            `SELECT 1 FROM public."VIAGEMMESTRE" WHERE "IDVIAGEM" = $1 AND "TENANT_ID" = $2 LIMIT 1`,
            [parseFloat(idViagem), tidConv]
          );
          if (!vOk.rows || vOk.rows.length === 0) {
            return res.status(400).json({ error: 'Viagem não encontrada ou não pertence ao seu tenant.' });
          }
        } catch (eV) {
          if (eV.code !== '42P01' && eV.code !== '42703') throw eV;
        }
      }
      if (idMotorista) {
        try {
          const mOk = await pool.query(
            `SELECT 1 FROM public."CADASTROGERAL" WHERE "CDCADASTRO" = $1 AND "TENANT_ID" = $2 LIMIT 1`,
            [parseFloat(idMotorista), tidConv]
          );
          if (!mOk.rows || mOk.rows.length === 0) {
            return res.status(400).json({ error: 'Motorista não encontrado ou não pertence ao seu tenant.' });
          }
        } catch (eM) {
          if (eM.code !== '42P01' && eM.code !== '42703') throw eM;
        }
      }

      // Verificar se já existe conversa
      let queryVerificar = `
        SELECT ID FROM [dbo].[CONVERSAS]
        WHERE TIPO = @tipo AND ID_CRIADOR = @idCriador AND TENANT_ID = @TENANT_ID
      `;
      const requestVerificar = pool.request();
      requestVerificar.input('tipo', sql.NVarChar(20), tipo);
      requestVerificar.input('idCriador', sql.Decimal(15, 0), parseFloat(idCriador));
      requestVerificar.input('TENANT_ID', sql.VarChar(64), tidConv);

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
        .input('TENANT_ID', sql.VarChar(64), tidConv)
        .query(`
          INSERT INTO [dbo].[CONVERSAS] (
            TIPO, ID_MOTORISTA, ID_VIAGEM, ID_CRIADOR, MENSAGENS_NAO_LIDAS, DH_CRIACAO, TENANT_ID
          )
          VALUES (
            @tipo, @idMotorista, @idViagem, @idCriador, 0, SYSUTCDATETIME(), @TENANT_ID
          );
          SELECT SCOPE_IDENTITY() AS ID;
        `);

      const conversaId = result.recordset[0].ID;

      // Buscar conversa completa
      const conversaResult = await pool.request()
        .input('id', sql.Int, conversaId)
        .input('TENANT_ID', sql.VarChar(64), tidConv)
        .query(`
          SELECT 
            c.*,
            cg.RZSOCIAL as motorista_nome,
            v.IDVIAGEM as viagem_codigo
          FROM [dbo].[CONVERSAS] c
          LEFT JOIN [dbo].[CADASTROGERAL] cg ON c.ID_MOTORISTA = cg.CDCADASTRO AND cg.TENANT_ID = @TENANT_ID
          LEFT JOIN [dbo].[VIAGEMMESTRE] v ON c.ID_VIAGEM = v.IDVIAGEM AND v.TENANT_ID = @TENANT_ID
          WHERE c.ID = @id AND c.TENANT_ID = @TENANT_ID
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
   * @author Atlas Cargo
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
      const tidBusca = tenantIdForRequest(req);

      // Buscar em conversas
      const conversasResult = await pool.request()
        .input('termo', sql.NVarChar(255), termo)
        .input('TENANT_ID', sql.VarChar(64), tidBusca)
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
          LEFT JOIN [dbo].[CADASTROGERAL] cg ON c.ID_MOTORISTA = cg.CDCADASTRO AND cg.TENANT_ID = @TENANT_ID
          LEFT JOIN [dbo].[VIAGEMMESTRE] v ON c.ID_VIAGEM = v.IDVIAGEM AND v.TENANT_ID = @TENANT_ID
          WHERE c.TENANT_ID = @TENANT_ID
            AND (c.ULTIMA_MENSAGEM LIKE @termo
             OR cg.RZSOCIAL LIKE @termo)
          ORDER BY c.DH_ULTIMA_MENSAGEM DESC
        `);

      // Buscar em mensagens
      const mensagensResult = await pool.request()
        .input('termo', sql.NVarChar(sql.MAX), termo)
        .input('TENANT_ID', sql.VarChar(64), tidBusca)
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
          INNER JOIN [dbo].[CONVERSAS] c ON m.ID_CONVERSA = c.ID AND c.TENANT_ID = @TENANT_ID
          LEFT JOIN [dbo].[CADASTROGERAL] cg ON c.ID_MOTORISTA = cg.CDCADASTRO AND cg.TENANT_ID = @TENANT_ID
          WHERE m.TENANT_ID = @TENANT_ID AND m.CONTENT LIKE @termo
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
   * @author Atlas Cargo
   * @since 2.0
   */
  contadorNaoLidas: async (req, res) => {
    try {
      const { idUsuario, userType } = req.query;

      if (!idUsuario || !userType) {
        return res.status(400).json({ error: 'ID do usuário e tipo são obrigatórios' });
      }

      const pool = await poolPromise;
      const userIdNum = parseFloat(idUsuario);
      const userTypeStr = (userType || '').substring(0, 20);
      const tidNl = tenantIdForRequest(req);

      const isMotorista = userTypeStr.toUpperCase() === 'MOTORISTA' || userTypeStr.toUpperCase() === 'DRIVER';

      // OPERADOR: usar a mesma fonte que a lista de conversas (CONVERSAS.MENSAGENS_NAO_LIDAS).
      // O contador só por MESSAGES.READ_BY_RECEIVER pode divergir (ex.: coluna da conversa +1 e leitura não sincronizada).
      if (!isMotorista) {
        try {
          const sumRes = await pool.query(
            `SELECT COALESCE(SUM(c."MENSAGENS_NAO_LIDAS"), 0)::int AS total
             FROM public."CONVERSAS" c
             WHERE c."TENANT_ID" = $1`,
            [tidNl]
          );
          const porRes = await pool.query(
            `SELECT c."ID" AS "ID_CONVERSA", COALESCE(c."MENSAGENS_NAO_LIDAS", 0)::int AS nao_lidas
             FROM public."CONVERSAS" c
             WHERE c."TENANT_ID" = $1 AND COALESCE(c."MENSAGENS_NAO_LIDAS", 0) > 0`,
            [tidNl]
          );
          const rowSum = sumRes.rows && sumRes.rows[0];
          const totalOp = rowSum
            ? (typeof rowSum.total === 'number' ? rowSum.total : parseInt(rowSum.total, 10) || 0)
            : 0;
          const porConversaOp = (porRes.rows || []).map((r) => ({
            ID_CONVERSA: r.ID_CONVERSA ?? r.id_conversa,
            nao_lidas: r.nao_lidas ?? r.naolidas ?? 0
          }));
          return res.json({
            success: true,
            data: {
              total: Number.isFinite(totalOp) ? totalOp : 0,
              porConversa: porConversaOp
            }
          });
        } catch (errOp) {
          const code = errOp.code || '';
          if (code !== '42P01' && code !== '42703') {
            console.warn('💬 [CHAT] nao-lidas OPERADOR via CONVERSAS falhou, fallback MESSAGES:', errOp.message);
          }
        }
      }

      let baseQuery = `
         FROM public."MESSAGES" m
         ${isMotorista ? 'LEFT JOIN public."CONVERSAS" c ON m."ID_CONVERSA" = c."ID"' : ''}
         WHERE m."TENANT_ID" = $3
           AND (m."SENDER_ID" IS DISTINCT FROM $1 OR m."SENDER_TYPE" IS DISTINCT FROM $2)
           AND (COALESCE(m."READ_BY_RECEIVER", false) IS NOT TRUE)
      `;

      if (isMotorista) {
        baseQuery += `
           AND (
             c."ID_MOTORISTA" = $1 
             OR EXISTS (
               SELECT 1 FROM public."VIAGEMMOTORISTA" vm
               WHERE vm."IDVIAGEM" = c."ID_VIAGEM" AND vm."CDMOTORISTA" = $1 AND vm."TENANT_ID" = $3
             )
             OR m."IDVIAGEM" IN (
               SELECT vm2."IDVIAGEM" FROM public."VIAGEMMOTORISTA" vm2
               WHERE vm2."CDMOTORISTA" = $1 AND vm2."TENANT_ID" = $3
             )
           )
        `;
      }

      // Contar mensagens não lidas (motorista ou fallback operador)
      const result = await pool.query(
        `SELECT COUNT(*)::int AS total ${baseQuery}`,
        [userIdNum, userTypeStr, tidNl]
      );

      const porConversaResult = await pool.query(
        `SELECT m."ID_CONVERSA", COUNT(*)::int AS nao_lidas ${baseQuery} GROUP BY m."ID_CONVERSA"`,
        [userIdNum, userTypeStr, tidNl]
      );

      const row = result.rows && result.rows[0];
      const total = row && (row.total !== undefined && row.total !== null)
        ? (typeof row.total === 'number' ? row.total : parseInt(row.total, 10) || 0)
        : 0;
      const porConversa = (porConversaResult.rows || []).map(r => ({
        ID_CONVERSA: r.ID_CONVERSA ?? r.id_conversa,
        nao_lidas: r.nao_lidas ?? r.nao_lidas
      }));

      res.json({
        success: true,
        data: {
          total: Number.isFinite(total) ? total : 0,
          porConversa
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
   * @author Atlas Cargo
   * @since 2.0
   */
  atualizarConversa: async (req, res) => {
    try {
      const { id } = req.params;
      const { ultimaMensagem, mensagensNaoLidas } = req.body;

      const pool = await poolPromise;
      const request = pool.request();
      request.input('id', sql.Int, parseInt(id));
      request.input('TENANT_ID', sql.VarChar(64), tenantIdForRequest(req));

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

      const query = `UPDATE [dbo].[CONVERSAS] SET ${updates.join(', ')} WHERE ID = @id AND TENANT_ID = @TENANT_ID`;
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
        .input('TENANT_ID', sql.VarChar(64), tenantIdForRequest(req))
        .query(`
          SELECT RZSOCIAL, NOME
          FROM [dbo].[CADASTROGERAL]
          WHERE CDCADASTRO = @id AND TENANT_ID = @TENANT_ID
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
