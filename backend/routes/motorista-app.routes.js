// backend/routes/motorista-app.routes.js
// Rotas para APP do Motorista
// Versão: 1.0 - Inicial
// Data: 02/01/2025

const express = require('express');
const router = express.Router();
const motoristaAppController = require('../controllers/motorista-app.controller');

// ==========================================
// ROTAS PÚBLICAS (sem autenticação)
// ==========================================

// Login
router.post('/login', motoristaAppController.login);

// Cadastro (placeholder)
router.post('/cadastro', motoristaAppController.cadastro);

// ==========================================
// ROTAS PROTEGIDAS (com autenticação JWT)
// TODO: Adicionar middleware de autenticação
// ==========================================

// Perfil
router.get('/perfil/:id', motoristaAppController.perfil);

// Convocações
router.get('/convocacoes/:idmotorista', motoristaAppController.minhasConvocacoes);
router.post('/aceitar-convocacao/:id', motoristaAppController.aceitarConvocacao);
router.post('/recusar-convocacao/:id', motoristaAppController.recusarConvocacao);

// Cargas Disponíveis
router.get('/cargas-disponiveis', motoristaAppController.cargasDisponiveis);
router.post('/aceitar-carga/:idviagem', motoristaAppController.aceitarCarga);

// Viagens
router.get('/viagens-andamento/:cdMotorista', motoristaAppController.listarViagensAndamento);
router.get('/viagem/:idViagem', motoristaAppController.detalhesViagem);

// Macros/Ocorrências
router.get('/macros', motoristaAppController.listarMacros);
router.post('/validar-macro', motoristaAppController.validarSequenciaMacro);
router.post('/macro', motoristaAppController.registrarMacro);
router.get('/historico-macros/:idViagem', motoristaAppController.historicoMacros);

// GPS
router.post('/gps', motoristaAppController.registrarGPS);

// Eventos
router.post('/evento', motoristaAppController.registrarEvento);

module.exports = router;

