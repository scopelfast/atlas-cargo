// backend/routes/alert.routes.js
// Rotas para gerenciar alertas inteligentes
// Versão: 1.0
// Data: 2025-01-16

const express = require('express');
const router = express.Router();
const alertController = require('../controllers/alert.controller');
const { requireAuth } = require('../middleware/auth.middleware');

// Todas as rotas requerem autenticação
router.use(requireAuth);

// Buscar alertas de uma viagem
router.get('/viagem/:idviagem', alertController.buscarPorViagem);

// Verificar alertas de uma viagem (força verificação)
router.post('/verificar/:idviagem', alertController.verificar);

// Resolver alerta
router.put('/:id/resolver', alertController.resolver);

// Buscar todos os alertas ativos (dashboard)
router.get('/ativos', alertController.buscarAtivos);

module.exports = router;
