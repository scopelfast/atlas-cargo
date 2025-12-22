// backend/routes/message.routes.js
// Rotas para Chat Motorista ↔ Operador
// Versão: 2.0 - Módulo separado
// Data: 2025-01-16

const express = require('express');
const router = express.Router();
const messageController = require('../controllers/message.controller');
const { getUsuarioLogado } = require('../middleware/auth.middleware');

// Middleware opcional (não bloqueia se não autenticado para permitir offline)
router.use(getUsuarioLogado);

// ============================================
// Rotas do módulo separado (novas)
// ============================================
// Nota: Estas rotas funcionam quando registradas como /api/chat no app.js

// Listar conversas
router.get('/conversas', messageController.listarConversas);

// Buscar mensagens de uma conversa
router.get('/conversas/:id', messageController.buscarMensagensConversa);

// Criar nova conversa
router.post('/conversas', messageController.criarConversa);

// Atualizar conversa
router.put('/conversas/:id', messageController.atualizarConversa);

// Buscar conversas/mensagens
router.get('/buscar', messageController.buscar);

// Contador de não lidas
router.get('/nao-lidas', messageController.contadorNaoLidas);

// ============================================
// Rotas legadas (mantidas para compatibilidade)
// ============================================

// Enviar mensagem
router.post('/', messageController.enviar);
router.post('/mensagens', messageController.enviar); // Alias para módulo

// Buscar mensagens de uma viagem
router.get('/viagem/:idviagem', messageController.buscarPorViagem);

// Marcar mensagens como lidas
router.put('/marcar-lidas', messageController.marcarComoLidas);
router.put('/mensagens/:id/ler', messageController.marcarComoLidas); // Alias para módulo

// Buscar nome do operador/motorista
router.get('/operador/:id', messageController.buscarNomeOperador);

module.exports = router;
