// backend/routes/motorista-app.routes.js
// Rotas para APP do Motorista
// Versão: 1.0 - Inicial
// Data: 02/01/2026

const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const motoristaAppController = require('../controllers/motorista-app.controller');
const sincronizarRastreamentoController = require('../controllers/sincronizar-rastreamento-integra.controller');
const deliveryProofRoutes = require('./delivery-proof.routes');
const sosController = require('../controllers/sos.controller');

const uploadMotoristasDir = path.join(__dirname, '..', 'public', 'uploads', 'motoristas');
const storageMotorista = multer.diskStorage({
  destination: (_req, _file, cb) => {
    require('fs').mkdirSync(uploadMotoristasDir, { recursive: true });
    cb(null, uploadMotoristasDir);
  },
  filename: (_req, file, cb) => {
    const ext = (file.originalname && path.extname(file.originalname)) || '.jpg';
    cb(null, `doc_${Date.now()}${ext}`);
  }
});
const uploadDocMotorista = multer({ storage: storageMotorista }).single('documento');

// ==========================================
// ROTAS PÚBLICAS (sem autenticação)
// ==========================================

// Configurações do app (telefone suporte, etc.) - ler variável TELEFONE_SUPORTE no .env
router.get('/config', motoristaAppController.config);

// Combo de classes de frota (PostgreSQL) para a tela de cadastro
router.get('/classes-frota-combo', motoristaAppController.listarClassesFrotaCombo);

// Login
router.post('/login', motoristaAppController.login);

// Cadastro (multipart: campos + foto documento)
router.post('/cadastro', (req, res, next) => {
  uploadDocMotorista(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'Erro no upload da foto do documento.', errorKey: 'cadastro.uploadErro' });
    next();
  });
}, motoristaAppController.cadastro);

// Recuperar Senha (envia código por SMS/email - ver implementação)
router.post('/recuperar-senha', motoristaAppController.recuperarSenha);
// Redefinir Senha (com código recebido)
router.post('/redefinir-senha', motoristaAppController.redefinirSenha);

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

// Sincronização de Rastreamento (rota descontinuada; INTEGRA_PRD não existe mais)
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

// Definir senha do app motorista (pela web, ao editar cadastro)
router.post('/definir-senha-admin', motoristaAppController.definirSenhaAdmin);

// Aprovar/rejeitar motorista (pela web, ao editar cadastro)
router.post('/aprovar-admin', motoristaAppController.aprovarMotoristaAdmin);

module.exports = router;

