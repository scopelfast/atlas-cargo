// backend/routes/mapa-viagem.routes.js
const express = require('express');
const router = express.Router();
const mapaViagemController = require('../controllers/mapa-viagem.controller');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');
const { requireTenantModule } = require('../middleware/tenant-module.middleware');

router.use(towerAuthAndTenant);
router.use(requireTenantModule('mapa_viagem'));

// Rotas
router.get('/veiculos', mapaViagemController.listarVeiculos);
router.get('/resumo', mapaViagemController.resumoMapa);
router.post('/executar-init-sql', mapaViagemController.executarInitSQL);

module.exports = router;

