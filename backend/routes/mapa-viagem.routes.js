// backend/routes/mapa-viagem.routes.js
const express = require('express');
const router = express.Router();
const mapaViagemController = require('../controllers/mapa-viagem.controller');

// Rotas
router.get('/veiculos', mapaViagemController.listarVeiculos);
router.post('/executar-init-sql', mapaViagemController.executarInitSQL);

module.exports = router;

