// backend/controllers/message.controller.js
// Controller para Chat Motorista ↔ Operador
// Versão: 1.0
// Data: 2025-01-16

const sql = require('mssql');
const { poolPromise } = require('../config/db');

const messageController = {
  /**
   * Enviar mensagem
   * POST /api/messages
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
      
      // Inserir mensagem
      const result = await pool.request()
        .input('idviagem', sql.Decimal(15, 0), parseFloat(idviagem))
        .input('senderType', sql.NVarChar(10), senderType)
        .input('senderId', sql.Decimal(15, 0), parseFloat(senderId))
        .input('senderName', sql.NVarChar(255), senderName || null)
        .input('content', sql.NVarChar(sql.MAX), content.trim())
        .query(`
          INSERT INTO [dbo].[MESSAGES] (
            IDVIAGEM, SENDER_TYPE, SENDER_ID, SENDER_NAME, CONTENT,
            READ_BY_SENDER, READ_BY_RECEIVER, SYNCED
          )
          VALUES (
            @idviagem, @senderType, @senderId, @senderName, @content,
            1, -- Remetente já leu (ele mesmo enviou)
            0, -- Destinatário ainda não leu
            1  -- Já sincronizado (está no servidor)
          );
          
          SELECT SCOPE_IDENTITY() AS ID;
        `);

      const messageId = result.recordset[0].ID;

      // Buscar mensagem completa
      const messageResult = await pool.request()
        .input('id', sql.Int, messageId)
        .query(`
          SELECT 
            ID, IDVIAGEM, SENDER_TYPE, SENDER_ID, SENDER_NAME,
            CONTENT, READ_BY_SENDER, READ_BY_RECEIVER,
            CREATED_AT, SYNCED
          FROM [dbo].[MESSAGES]
          WHERE ID = @id
        `);

      const message = messageResult.recordset[0];

      // Emitir via WebSocket (se disponível)
      const app = require('../app');
      const io = app.get('io');
      if (io) {
        io.to(`viagem-${idviagem}`).emit('nova-mensagem', message);
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
            ID, IDVIAGEM, SENDER_TYPE, SENDER_ID, SENDER_NAME,
            CONTENT, READ_BY_SENDER, READ_BY_RECEIVER,
            CREATED_AT, SYNCED
          FROM [dbo].[MESSAGES]
          WHERE IDVIAGEM = @idviagem
          ORDER BY CREATED_AT DESC
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
          SET READ_BY_RECEIVER = 1
          WHERE IDVIAGEM = @idviagem
            AND (SENDER_ID != @senderId OR SENDER_TYPE != @senderType)
            AND READ_BY_RECEIVER = 0
        `);

      res.json({ success: true, message: 'Mensagens marcadas como lidas' });
    } catch (err) {
      console.error('Erro ao marcar como lidas:', err);
      res.status(500).json({ error: 'Erro ao marcar mensagens como lidas.' });
    }
  }
};

module.exports = messageController;
