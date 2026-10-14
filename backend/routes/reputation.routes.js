// backend/routes/reputation.routes.js
// Rotas para Reputação de Motoristas e Ranking
// Versão: 2.0 - Módulo separado
// Data: 2026-01-16

const express = require('express');
const router = express.Router();
const reputationController = require('../controllers/reputation.controller');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');
const { requireTenantModule } = require('../middleware/tenant-module.middleware');

router.use(towerAuthAndTenant);
router.use(requireTenantModule('ranking'));

// ============================================
// Rotas do módulo separado (novas)
// ============================================
// Nota: Estas rotas funcionam quando registradas como /api/ranking no app.js

// Listar ranking completo
router.get('/', reputationController.listar);

// Top 10 motoristas
router.get('/top10', reputationController.top10);

// Dados para gráficos
router.get('/graficos', reputationController.graficos);

// Detalhes de um motorista
router.get('/motorista/:id', reputationController.detalhesMotorista);

// Calcular/Recalcular rankings (admin)
router.post('/calcular', reputationController.calcular);

// ============================================
// Rotas legadas (mantidas para compatibilidade)
// ============================================

// Buscar reputação de um motorista
router.get('/motorista/:cdmotorista', reputationController.buscarPorMotorista);

// Buscar ranking de motoristas
router.get('/ranking', reputationController.buscarRanking);

// Recalcular reputação de um motorista
router.post('/recalcular/:cdmotorista', reputationController.recalcular);

// Recalcular todas as reputações (admin)
router.post('/recalcular-todos', reputationController.recalcularTodos);

module.exports = router;
