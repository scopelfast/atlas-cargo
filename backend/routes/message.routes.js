// backend/routes/message.routes.js
// Rotas para Chat Motorista ↔ Operador
// Versão: 1.0
// Data: 2025-01-16

const express = require('express');
const router = express.Router();
const messageController = require('../controllers/message.controller');
const { getUsuarioLogado } = require('../middleware/auth.middleware');

// Middleware opcional (não bloqueia se não autenticado para permitir offline)
router.use(getUsuarioLogado);

// Enviar mensagem
router.post('/', messageController.enviar);

// Buscar mensagens de uma viagem
router.get('/viagem/:idviagem', messageController.buscarPorViagem);

// Marcar mensagens como lidas
router.put('/marcar-lidas', messageController.marcarComoLidas);

module.exports = router;
