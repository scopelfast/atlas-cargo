// backend/routes/auth.routes.js
const express = require('express');
const { login, alterarSenha, logout, recuperarSenhaTorre, redefinirSenhaTorre } = require('../controllers/auth.controller');
const { createLoginRateLimiter } = require('../middleware/security-hardening.middleware');

const router = express.Router();

router.post('/login', createLoginRateLimiter({ keyPrefix: 'auth-login' }), login);
router.post('/alterar-senha', alterarSenha);
router.post('/recuperar-senha', recuperarSenhaTorre);
router.post('/redefinir-senha', redefinirSenhaTorre);
router.post('/logout', logout);

module.exports = router;