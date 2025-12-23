// backend/routes/motorista-app.routes.js
// Rotas para APP do Motorista
// Versão: 1.0 - Inicial
// Data: 02/01/2025

const express = require('express');
const router = express.Router();
const motoristaAppController = require('../controllers/motorista-app.controller');
const sincronizarRastreamentoController = require('../controllers/sincronizar-rastreamento-integra.controller');
const deliveryProofRoutes = require('./delivery-proof.routes');
const sosController = require('../controllers/sos.controller');

// ==========================================
// ROTAS PÚBLICAS (sem autenticação)
// ==========================================

// Login
router.post('/login', motoristaAppController.login);

// Cadastro (placeholder)
router.post('/cadastro', motoristaAppController.cadastro);

// Recuperar Senha
router.post('/recuperar-senha', motoristaAppController.recuperarSenha);

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

// Notificações
router.get('/notificacoes/:cdMotorista', motoristaAppController.notificacoesRecentes);

// Macros/Ocorrências
router.get('/macros', motoristaAppController.listarMacros);
router.post('/validar-macro', motoristaAppController.validarSequenciaMacro);
router.post('/macro', motoristaAppController.registrarMacro);
router.get('/historico-macros/:idViagem', motoristaAppController.historicoMacros);

// GPS
router.post('/gps', motoristaAppController.registrarGPS);
router.get('/posicoes/:idviagem', motoristaAppController.buscarPosicoesViagem);
router.get('/motorista-viagem/:idviagem', motoristaAppController.buscarMotoristaViagem);

// Sincronização de Rastreamento (INTEGRA_PRD -> DIVULGACARGA_PRD)
router.post('/sincronizar-rastreamento/:idViagem', sincronizarRastreamentoController.sincronizarRastreamento);

// Eventos
router.post('/evento', motoristaAppController.registrarEvento);

// Comprovantes de Entrega (POD)
router.use('/delivery-proof', deliveryProofRoutes);

// SOS (Emergência)
// Rota para motorista criar alerta SOS (pode funcionar sem auth em caso de emergência offline)
router.post('/sos', sosController.criar);

// Rota para motorista ver histórico de SOS
router.get('/sos/historico', sosController.historico);

// Alterar Senha
router.post('/alterar-senha', motoristaAppController.alterarSenha);

module.exports = router;

