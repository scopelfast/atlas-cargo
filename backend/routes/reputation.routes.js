// backend/routes/reputation.routes.js
// Rotas para Reputação de Motoristas e Ranking
// Versão: 2.0 - Módulo separado
// Data: 2025-01-16

const express = require('express');
const router = express.Router();
const reputationController = require('../controllers/reputation.controller');
const { requireAuth } = require('../middleware/auth.middleware');

// ============================================
// Rotas do módulo separado (novas)
// ============================================
// Nota: Estas rotas funcionam quando registradas como /api/ranking no app.js

// Listar ranking completo
router.get('/', requireAuth, reputationController.listar);

// Top 10 motoristas
router.get('/top10', requireAuth, reputationController.top10);

// Dados para gráficos
router.get('/graficos', requireAuth, reputationController.graficos);

// Detalhes de um motorista
router.get('/motorista/:id', requireAuth, reputationController.detalhesMotorista);

// Calcular/Recalcular rankings (admin)
router.post('/calcular', requireAuth, reputationController.calcular);

// ============================================
// Rotas legadas (mantidas para compatibilidade)
// ============================================

// Buscar reputação de um motorista
router.get('/motorista/:cdmotorista', requireAuth, reputationController.buscarPorMotorista);

// Buscar ranking de motoristas
router.get('/ranking', requireAuth, reputationController.buscarRanking);

// Recalcular reputação de um motorista
router.post('/recalcular/:cdmotorista', requireAuth, reputationController.recalcular);

// Recalcular todas as reputações (admin)
router.post('/recalcular-todos', requireAuth, reputationController.recalcularTodos);

module.exports = router;
