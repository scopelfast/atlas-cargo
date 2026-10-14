// backend/routes/viagemmestre.routes.js
// Gerenciamento de Viagens - API
// Versão: 1.0
// Atlas Cargo
// Data: 2026-04-05

const express = require('express');
const router = express.Router();
const viagemController = require('../controllers/viagemmestre.controller');
const { cacheComboMiddleware, cacheMiddleware } = require('../middleware/cache.middleware');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');
const { tenantIdForRequest } = require('../utils/tenant-context');

/**
 * Caminho após /api ou /cargas/api (req.path varia entre Express/mount: às vezes '/paises', às vezes '/api/paises').
 */
function pathRelativoApi(req) {
  let u = String(req.originalUrl || req.url || req.path || '').split('?')[0];
  if (!u) return '/';
  const lower = u.toLowerCase();
  if (lower.startsWith('/cargas/api')) u = u.slice('/cargas/api'.length);
  else if (lower.startsWith('/api/')) u = u.slice('/api'.length);
  else if (lower === '/api') u = '/';
  if (!u.startsWith('/')) u = '/' + u;
  return u;
}

/** Convocação pública, URL base, webhooks Meta/Switch — sem JWT de torre */
function viagemPublicSkip(req) {
  const trimSlash = (s) => {
    const t = String(s || '').split('?')[0];
    if (t.length > 1 && t.endsWith('/')) return t.slice(0, -1);
    return t || '/';
  };
  const origLower = String(req.originalUrl || req.url || '').split('?')[0].toLowerCase();
  if (origLower.includes('/public/convocacao')) return true;
  if (origLower.includes('/motivos-recusa-combo')) return true;

  const p = trimSlash(req.path);
  const rel = trimSlash(pathRelativoApi(req));
  if (p.startsWith('/public/') || rel.startsWith('/public/')) return true;
  if (p === '/public-url') return true;
  if (p === '/webhook-meta-callback') return true;
  if (p === '/viagens/webhook/switch-digital' && req.method === 'POST') return true;
  if (p === '/logs-webhook-meta' && req.method === 'POST') return true;
  // Combo usado na página pública de convocação (resposta sem login)
  if (p === '/motivos-recusa-combo' && req.method === 'GET') return true;
  // Logos na tela de login / motorista público (config.routes GET sem towerAuth)
  if (p === '/configuracoes/identidade' && req.method === 'GET') return true;
  // Contexto/i18n e mapa no app motorista carregam sem JWT obrigatório
  if (p === '/contexto' && req.method === 'GET') return true;
  if (p === '/configuracoes/mapa' && req.method === 'GET') return true;
  // Link público de oportunidades (campanhas) não exige JWT de torre
  if (p.startsWith('/oportunidades-publicas/') && (req.method === 'GET' || req.method === 'POST')) return true;
  // Catálogos do cadastro motorista (cidades/estado) — comparar p e rel (path absoluto vs relativo)
  if (req.method === 'GET') {
    const hit = (x) =>
      x === '/paises' ||
      x === '/estados-brasil' ||
      x === '/estados' ||
      (x.startsWith('/estado-cduf/')) ||
      /^\/mesorregioes\/\d+$/.test(x);
    if (hit(p) || hit(rel)) return true;
  }
  return false;
}

router.use((req, res, next) => {
  if (viagemPublicSkip(req)) return next();
  return towerAuthAndTenant(req, res, next);
});

// Cache para roteiros-combo: chave inclui query (origem/destino/país/estado) para filtro progressivo
const CACHE_TTL_COMBO = 10 * 60 * 1000;
const cacheRoteirosCombo = () =>
  cacheMiddleware(CACHE_TTL_COMBO, (req) => `COMBO:${req.path}:${tenantIdForRequest(req)}:${JSON.stringify(req.query || {})}`);
const cacheClassesFrotaCombo = () =>
  cacheMiddleware(CACHE_TTL_COMBO, (req) => `COMBO:${req.path}:${tenantIdForRequest(req)}`);
const cacheSituacoesViagemCombo = () =>
  cacheMiddleware(CACHE_TTL_COMBO, (req) => `COMBO:${req.path}:${tenantIdForRequest(req)}`);
const cacheTiposViagemCombo = () =>
  cacheMiddleware(CACHE_TTL_COMBO, (req) => `COMBO:${req.path}:${tenantIdForRequest(req)}`);

// 🔍 ROTA DE DEBUG - Listar todas as rotas registradas
router.get('/debug-rotas', (req, res) => {
  const rotas = [];
  router.stack.forEach(r => {
    if (r.route) {
      rotas.push({
        path: r.route.path,
        methods: Object.keys(r.route.methods)
      });
    }
  });
  res.json({ total: rotas.length, rotas });
});

// Rotas principais
router.get('/viagens', viagemController.listar);
router.post('/viagens', viagemController.criar);
// PUT /viagens/regras-compatibilidade DEVE vir ANTES de PUT /viagens/:id
router.put('/viagens/regras-compatibilidade', viagemController.salvarRegrasCompatibilidade);
router.put('/viagens/:id', viagemController.atualizar);
router.delete('/viagens/:id', viagemController.excluir);

// Rota para Histórico de Viagens por Roteiro (DEVE vir ANTES de /viagens/:id)
router.get('/viagens/historico-roteiro', viagemController.buscarHistoricoRoteiro);

// Rotas de busca (DEVEM vir ANTES de /viagens/:id para não serem capturadas como :id)
router.get('/viagens/equipamentos/buscar', viagemController.buscarEquipamento);
router.get('/viagens/cadastros-gerais/buscar', viagemController.buscarCadastroGeral);

// GET /viagens/regras-compatibilidade DEVE vir ANTES de GET /viagens/:id
router.get('/viagens/regras-compatibilidade', viagemController.obterRegrasCompatibilidade);

router.get('/viagens/contador-divergencia-placas-convocacoes', viagemController.contadorDivergenciaPlacasConvocacoes);

router.get('/viagens/:id', viagemController.buscarPorId);

// Rotas de combos (com cache de 10 minutos)
router.get('/tipos-viagem-combo', cacheTiposViagemCombo(), viagemController.listarTiposViagem);
router.get('/situacoes-viagem-combo', cacheSituacoesViagemCombo(), viagemController.listarSituacoesViagem);
router.get('/classes-frota-combo', cacheClassesFrotaCombo(), viagemController.listarClassesFrota);
router.get('/contratadores-combo', cacheComboMiddleware(), viagemController.listarContratadores);
router.get('/roteiros-combo', cacheRoteirosCombo(), viagemController.listarRoteiros);
router.get('/motivos-reabertura-combo', cacheComboMiddleware(), viagemController.listarMotivosReabertura);

// Rota para estados brasileiros (com cache de 10 minutos)
router.get('/estados-brasil', cacheComboMiddleware(), viagemController.listarEstadosBrasil);

// Rota para cidades por estado (com cache de 10 minutos)
router.get('/cidades-por-estado/:estado', cacheComboMiddleware(), viagemController.listarCidadesPorEstado);

// Rotas para convocações e motoristas compatíveis
router.get('/viagens-pendentes', viagemController.listarViagensPendentes);
router.get('/viagens/:idViagem/motoristas-compativel', viagemController.buscarMotoristasCompatíveis);
router.post('/convocacoes', viagemController.criarConvocacoes);
router.get('/convocacoes', viagemController.listarConvocacoes);

// Rotas com parâmetros (devem vir DEPOIS das rotas específicas)
router.get('/convocacoes/:id', viagemController.buscarConvocacaoPorId);
router.put('/convocacoes/:id', viagemController.atualizarConvocacao);
router.put('/convocacoes/:id/status', viagemController.atualizarStatusConvocacao);
router.put('/convocacoes/:id/atualizar-envio-meta', viagemController.atualizarEnvioMeta);

// Rotas para logs do webhook Meta
router.post('/logs-webhook-meta', viagemController.salvarLogWebhookMeta);
router.get('/logs-webhook-meta', viagemController.listarLogsWebhookMeta);

// Rota para o Webhook da Switch Digital
router.post('/viagens/webhook/switch-digital/health', viagemController.verificarSaudeSwitchDigital);
router.post('/viagens/webhook/switch-digital', viagemController.enviarWebhookSwitchDigital);

// Rota para receber retorno do webhook Meta (callback)
router.post('/webhook-meta-callback', viagemController.receberRetornoWebhookMeta);
router.post('/convocacoes/:id/confirmar', viagemController.confirmarConvocacao);
router.post('/convocacoes/:id/reativar', viagemController.reativarConvocacao);
router.get('/convocacoes/:id/historico-reabertura', viagemController.listarHistoricoReabertura);

// Rotas públicas de convocação → backend/routes/viagem-public.routes.js (montadas antes na app.js, sem towerAuth)

// Rota para executar query SQL personalizada (apenas SELECT)
router.post('/executar-query', viagemController.executarQuery);

// Rota para executar SQL de inicialização (permite procedures)
router.post('/viagens/executar-init-sql', viagemController.executarInitSQL);

// Rotas para Veículo da Viagem
router.get('/viagens/:id/veiculo', viagemController.buscarVeiculoViagem);
router.post('/viagens/:id/veiculo', viagemController.salvarVeiculoViagem);
router.delete('/viagens/:id/veiculo/:idequipamento', viagemController.removerVeiculoViagem);

// Rotas para Motorista da Viagem
router.get('/viagens/:id/motorista', viagemController.buscarMotoristaViagem);
router.post('/viagens/:id/motorista', viagemController.salvarMotoristaViagem);
router.delete('/viagens/:id/motorista/:cdmotorista', viagemController.removerMotoristaViagem);

// Rota Switch Digital Webhook
router.post('/viagens/webhook/switch-digital', viagemController.enviarWebhookSwitchDigital);

module.exports = router;
