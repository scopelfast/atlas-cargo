// backend/routes/auth.routes.js
const express = require('express');
const { login, alterarSenha, logout } = require('../controllers/auth.controller');

const router = express.Router();

router.post('/login', login);
router.post('/alterar-senha', alterarSenha);
router.post('/logout', logout);

module.exports = router;