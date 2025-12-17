// backend/routes/sos.routes.js
// Rotas para Alertas SOS (Emergência)
// Versão: 1.0
// Data: 2025-01-16

const express = require('express');
const router = express.Router();
const sosController = require('../controllers/sos.controller');
const { requireAuth } = require('../middleware/auth.middleware');

// Rota para motorista criar alerta SOS (pode funcionar sem auth em caso de emergência offline)
router.post('/motorista/sos', sosController.criar);

// Rota para motorista ver histórico
router.get('/motorista/sos/historico', requireAuth, sosController.historico);

// Rota para admin listar alertas ativos (requer autenticação)
router.get('/sos/ativos', requireAuth, sosController.listarAtivos);

// Rota para admin resolver alerta (requer autenticação)
router.put('/sos/:id/resolver', requireAuth, sosController.resolver);

module.exports = router;
