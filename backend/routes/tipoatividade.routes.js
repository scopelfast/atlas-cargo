// backend/routes/tipoatividade.routes.js
const express = require('express');
const router = express.Router();
const tipoAtividadeController = require('../controllers/tipoatividade.controller');

// Rotas de CRUD
router.get('/tipos-atividade', tipoAtividadeController.listar);
router.get('/tipos-atividade/:codigo', tipoAtividadeController.buscarPorCodigo);
router.post('/tipos-atividade', tipoAtividadeController.criar);
router.put('/tipos-atividade/:codigo', tipoAtividadeController.atualizar);
router.delete('/tipos-atividade/:codigo', tipoAtividadeController.alterarStatus);

// Executar init.sql
router.post('/tipos-atividade/executar-init-sql', tipoAtividadeController.executarInitSQL);

module.exports = router;

