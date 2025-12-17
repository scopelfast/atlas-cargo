// backend/routes/reputation.routes.js
// Rotas para Reputação de Motoristas
// Versão: 1.0
// Data: 2025-01-16

const express = require('express');
const router = express.Router();
const reputationController = require('../controllers/reputation.controller');
const { requireAuth } = require('../middleware/auth.middleware');

// Buscar reputação de um motorista
router.get('/motorista/:cdmotorista', requireAuth, reputationController.buscarPorMotorista);

// Buscar ranking de motoristas
router.get('/ranking', requireAuth, reputationController.buscarRanking);

// Recalcular reputação de um motorista
router.post('/recalcular/:cdmotorista', requireAuth, reputationController.recalcular);

// Recalcular todas as reputações (admin)
router.post('/recalcular-todos', requireAuth, reputationController.recalcularTodos);

module.exports = router;
