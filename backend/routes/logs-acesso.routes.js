// backend/routes/logs-acesso.routes.js
// Logs de Acesso - API
// Versão: 1.0
// Atlas Cargo

const express = require('express');
const sql = require('../config/mssql-compat');
const router = express.Router();
const { poolPromise } = require('../config/db');
const { listarLogsAcesso, listarLogsAcoes, listarOperadores, executarInitSQL } = require('../controllers/logs-acesso.controller');
const fs = require('fs');
const path = require('path');

// Listar logs de acesso
router.get('/', listarLogsAcesso);

// Listar logs de ações
router.get('/acoes', listarLogsAcoes);

// Listar operadores (para combo)
router.get('/operadores', listarOperadores);

// Executar init.sql
router.post('/executar-init-sql', executarInitSQL);

module.exports = router;

