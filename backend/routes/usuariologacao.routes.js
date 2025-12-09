// backend/routes/usuariologacao.routes.js
const express = require('express');
const { registrarAcaoUsuario, listarLogs } = require('../controllers/usuariologacao.controller');

const router = express.Router();

// Registrar ação do usuário
router.post('/registrar', registrarAcaoUsuario);

// Listar logs de um usuário
router.get('/listar', listarLogs);

module.exports = router;

