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
const { requireAuth, requireMotoristaAuth, requireMotoristaOrTowerAuth } = require('../middleware/auth.middleware');
const { attachTenantContext } = require('../middleware/tenant.middleware');
const { createLoginRateLimiter } = require('../middleware/security-hardening.middleware');

const sosRateLimiter = createLoginRateLimiter({
  keyPrefix: 'motorista-sos',
  max: Math.max(5, parseInt(String(process.env.SOS_RATE_LIMIT_MAX || '30'), 10) || 30),
  windowMs: Math.max(60_000, parseInt(String(process.env.SOS_RATE_LIMIT_WINDOW_MS || '900000'), 10) || 900000)
});

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
const veicCrlvCadastroFields = Array.from({ length: 15 }, (_, i) => ({
  name: `veiculoCrlv_${i}`,
  maxCount: 1,
}));
/** Cadastro: CNH frente/verso + comprovante + CRLV por veículo (veiculoCrlv_0 … veiculoCrlv_14). */
const storageCadastroMixed = multer.diskStorage({
  destination: (req, file, cb) => {
    const fs = require('fs');
    if (String(file.fieldname || '').startsWith('veiculoCrlv_')) {
      fs.mkdirSync(uploadVeiculosDir, { recursive: true });
      cb(null, uploadVeiculosDir);
    } else {
      fs.mkdirSync(uploadMotoristasDir, { recursive: true });
      cb(null, uploadMotoristasDir);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.jpg';
    cb(null, `cad_${String(file.fieldname || 'f')}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}${ext}`);
  },
});
const uploadCadastroMotorista = multer({
  storage: storageCadastroMixed,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (String(file.fieldname || '').startsWith('veiculoCrlv_')) {
      const mime = (file.mimetype || '').toLowerCase();
      const name = (file.originalname || '').toLowerCase();
      const ok =
        mime === 'image/jpeg' ||
        mime === 'image/png' ||
        mime === 'image/webp' ||
        /\.(jpe?g|png|webp)$/.test(name);
      if (!ok) return cb(new Error('CRLV: use JPEG, PNG ou WebP (máx. 5 MB).'));
    }
    cb(null, true);
  },
}).fields([
  { name: 'documento', maxCount: 1 },
  { name: 'documentoVerso', maxCount: 1 },
  { name: 'comprovanteEndereco', maxCount: 1 },
  ...veicCrlvCadastroFields,
]);
const uploadPerfilMotorista = multer({ storage: storageMotorista }).fields([
  { name: 'documento', maxCount: 1 },
  { name: 'documentoVerso', maxCount: 1 },
  { name: 'comprovanteEndereco', maxCount: 1 },
]);

const uploadVeiculosDir = path.join(__dirname, '..', 'public', 'uploads', 'veiculos');
const storageVeiculo = multer.diskStorage({
  destination: (_req, _file, cb) => {
    require('fs').mkdirSync(uploadVeiculosDir, { recursive: true });
    cb(null, uploadVeiculosDir);
  },
  filename: (_req, file, cb) => {
    const ext = (file.originalname && path.extname(file.originalname)) || '.jpg';
    cb(null, `crlv_${Date.now()}${ext}`);
  }
});
const uploadCrlvVeiculo = multer({
  storage: storageVeiculo,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    const name = (file.originalname || '').toLowerCase();
    const ok =
      mime === 'image/jpeg' ||
      mime === 'image/png' ||
      mime === 'image/webp' ||
      /\.(jpe?g|png|webp)$/.test(name);
    if (!ok) return cb(new Error('Use imagem JPEG, PNG ou WebP (máx. 5 MB).'));
    cb(null, true);
  }
}).single('crlv');

// ==========================================
// ROTAS PÚBLICAS (sem autenticação)
// ==========================================

// Configurações do app (telefone suporte, etc.) - ler variável TELEFONE_SUPORTE no .env
router.get('/config', motoristaAppController.config);

// Combo de classes de frota (PostgreSQL) para a tela de cadastro
router.get('/classes-frota-combo', motoristaAppController.listarClassesFrotaCombo);

// Login
router.post('/login', createLoginRateLimiter({ keyPrefix: 'motorista-login' }), motoristaAppController.login);

// SOS: público (fila offline) + rate limit; tenant vem do cadastro do motorista (sos.controller)
router.post('/sos', sosRateLimiter, sosController.criar);

// Cadastro (multipart: CNH frente/verso opcional + comprovante de endereço obrigatório)
router.post('/cadastro', (req, res, next) => {
  uploadCadastroMotorista(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'Erro no envio dos arquivos.', errorKey: 'cadastro.uploadErro' });
    next();
  });
}, motoristaAppController.cadastro);

// Recuperar Senha (envia código por SMS/email - ver implementação)
router.post('/recuperar-senha', motoristaAppController.recuperarSenha);
// Redefinir Senha (com código recebido)
router.post('/redefinir-senha', motoristaAppController.redefinirSenha);

// Rotas de admin (dashboard web) – JWT genérico, sem sessão única do motorista
router.post('/definir-senha-admin', requireAuth, motoristaAppController.definirSenhaAdmin);
router.post('/aprovar-admin', requireAuth, motoristaAppController.aprovarMotoristaAdmin);

// POD: GET com JWT torre ou motorista; POST com sessão motorista (definido nas rotas)
router.use('/delivery-proof', deliveryProofRoutes);

// Leituras usadas pelo dashboard da torre (Gerenciar Viagens: mapa, rastreamento, macros)
router.get('/motorista-viagem/:idviagem', requireMotoristaOrTowerAuth, attachTenantContext, motoristaAppController.buscarMotoristaViagem);
router.get('/posicoes/:idviagem', requireMotoristaOrTowerAuth, attachTenantContext, motoristaAppController.buscarPosicoesViagem);
router.get('/historico-macros/:idViagem', requireMotoristaOrTowerAuth, attachTenantContext, motoristaAppController.historicoMacros);

// ==========================================
// ROTAS PROTEGIDAS (uma sessão por motorista)
// ==========================================
router.use(requireMotoristaAuth);
router.use(attachTenantContext);

// Perfil (GET sem id = JWT; PUT sem id = JWT)
router.get('/perfil', motoristaAppController.perfilMe);
router.put(
  '/perfil',
  (req, res, next) => {
    uploadPerfilMotorista(req, res, (err) => {
      if (err) return res.status(400).json({ error: 'Erro no envio dos arquivos.', errorKey: 'cadastro.uploadErro' });
      next();
    });
  },
  motoristaAppController.atualizarPerfil
);
router.put(
  '/perfil/:id',
  (req, res, next) => {
    uploadPerfilMotorista(req, res, (err) => {
      if (err) return res.status(400).json({ error: 'Erro no envio dos arquivos.', errorKey: 'cadastro.uploadErro' });
      next();
    });
  },
  motoristaAppController.atualizarPerfil
);
router.get('/perfil/:id', motoristaAppController.perfil);

router.get('/veiculos', motoristaAppController.listarVeiculosMotorista);
router.post(
  '/veiculos',
  (req, res, next) => {
    uploadCrlvVeiculo(req, res, (err) => {
      if (err) {
        return res.status(400).json({
          error: err.message || 'Erro no upload do CRLV.',
          errorKey: 'veiculos.uploadErro',
        });
      }
      next();
    });
  },
  motoristaAppController.criarVeiculoMotorista
);

// Convocações
router.get('/convocacoes/:idmotorista', motoristaAppController.minhasConvocacoes);
router.post('/confirmar-placas-convocacao/:id', motoristaAppController.confirmarPlacasConvocacao);
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

// GPS
router.post('/gps', motoristaAppController.registrarGPS);

// Sincronização de Rastreamento (rota descontinuada; INTEGRA_PRD não existe mais)
router.post('/sincronizar-rastreamento/:idViagem', sincronizarRastreamentoController.sincronizarRastreamento);

// Eventos
router.post('/evento', motoristaAppController.registrarEvento);

// SOS — histórico exige sessão motorista (rota /sos POST está na seção pública acima)

// Rota para motorista ver histórico de SOS
router.get('/sos/historico', sosController.historico);

// Alterar Senha
router.post('/alterar-senha', motoristaAppController.alterarSenha);

module.exports = router;

