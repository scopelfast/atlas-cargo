// backend/routes/relatorio-convocacoes.routes.js
// Rotas para Relatório de Convocações
// Versão: 1.0
// Atlas Cargo

const express = require('express');
const router = express.Router();
const relatorioController = require('../controllers/relatorio-convocacoes.controller');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');
const { requireTenantModule } = require('../middleware/tenant-module.middleware');

router.use(towerAuthAndTenant);
router.use(requireTenantModule('convocacoes'));

// Rotas
router.get('/relatorio', relatorioController.buscarRelatorio);
router.get('/estatisticas', relatorioController.buscarEstatisticas);

module.exports = router;

