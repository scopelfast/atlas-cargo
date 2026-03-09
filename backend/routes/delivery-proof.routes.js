// backend/routes/delivery-proof.routes.js
// Rotas para comprovantes de entrega (POD)
// Versão: 1.0
// Data: 2026-01-16

const express = require('express');
const router = express.Router();
const deliveryProofController = require('../controllers/delivery-proof.controller');
const { getUsuarioLogado } = require('../middleware/auth.middleware'); // Não requer autenticação obrigatória (pode vir offline)

// Middleware opcional (não bloqueia se não autenticado)
router.use(getUsuarioLogado);

// Salvar comprovante de entrega
router.post('/', deliveryProofController.salvar);

// Buscar comprovantes de uma viagem
router.get('/viagem/:idviagem', deliveryProofController.buscarPorViagem);

// Buscar foto do comprovante
router.get('/:id/photo', deliveryProofController.buscarFoto);

module.exports = router;
