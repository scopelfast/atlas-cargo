// backend/routes/delivery-proof.routes.js
// Rotas para comprovantes de entrega (POD)
// Versão: 1.0
// Data: 2026-01-16

const express = require('express');
const router = express.Router();
const deliveryProofController = require('../controllers/delivery-proof.controller');
const {
  requireMotoristaAuth,
  requireMotoristaOrTowerAuth
} = require('../middleware/auth.middleware');
const { attachTenantContext } = require('../middleware/tenant.middleware');

// POST: apenas app motorista (sessão ativa)
router.post('/', requireMotoristaAuth, attachTenantContext, deliveryProofController.salvar);

// GET: torre (dashboard) ou motorista — exige JWT válido
router.get('/viagem/:idviagem', requireMotoristaOrTowerAuth, attachTenantContext, deliveryProofController.buscarPorViagem);
router.get('/:id/photo', requireMotoristaOrTowerAuth, attachTenantContext, deliveryProofController.buscarFoto);

module.exports = router;
