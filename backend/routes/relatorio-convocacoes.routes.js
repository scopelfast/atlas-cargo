// backend/routes/relatorio-convocacoes.routes.js
// Rotas para Relatório de Convocações
// Versão: 1.0
// Autor: Sistema DivulgaCarga

const express = require('express');
const router = express.Router();
const relatorioController = require('../controllers/relatorio-convocacoes.controller');

// Rotas
router.get('/relatorio', relatorioController.buscarRelatorio);
router.get('/estatisticas', relatorioController.buscarEstatisticas);

module.exports = router;

