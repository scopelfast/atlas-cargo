// backend/routes/sos.routes.js
// Rotas para Alertas SOS (Emergência)
// Versão: 2.0 - Módulo separado
// Data: 2026-01-16

const express = require('express');
const router = express.Router();
const sosController = require('../controllers/sos.controller');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');
const { requireTenantModule } = require('../middleware/tenant-module.middleware');

/** Legado: POST /api/sos/motorista/sos sem JWT (uso raro; app usa /api/motorista/sos) */
function sosLegacyPublicSkip(req) {
  const p = (req.path || '').split('?')[0];
  return p === '/motorista/sos' && req.method === 'POST';
}

router.use((req, res, next) => {
  if (sosLegacyPublicSkip(req)) return next();
  return towerAuthAndTenant(req, res, next);
});

router.use((req, res, next) => {
  if (sosLegacyPublicSkip(req)) return next();
  return requireTenantModule('sos')(req, res, next);
});

// ============================================
// Rotas legadas (mantidas para compatibilidade)
// DEVEM VIR ANTES DAS ROTAS DINÂMICAS
// ============================================

// Rota para motorista criar alerta SOS (pode funcionar sem auth em caso de emergência offline)
router.post('/motorista/sos', sosController.criar);

// Rota para motorista ver histórico
router.get('/motorista/sos/historico', sosController.historico);

// Rota para admin listar alertas ativos (requer autenticação)
router.get('/ativos', sosController.listarAtivos);

// Rota para admin resolver alerta (requer autenticação)
router.put('/resolver/:id', sosController.resolver);

// ============================================
// Rotas do módulo separado (novas)
// ============================================
// Nota: Estas rotas funcionam quando registradas como /api/sos no app.js

// Contador de pendentes (para badge) - DEVE VIR ANTES DE /:id
router.get('/contador', sosController.contador);

// Listar SOS com filtros
router.get('/', sosController.listar);

// Listar apenas pendentes
router.get('/pendentes', sosController.listarPendentes);

// Buscar endereço via geocodificação reversa (Nominatim)
router.get('/geocodificar/:lat/:lon', sosController.geocodificar);

// Buscar histórico de ações
router.get('/:id/historico', sosController.buscarHistorico);

// Marcar como lido
router.post('/:id/ler', sosController.marcarComoLido);

// Tratar SOS (mudar status)
router.post('/:id/tratar', sosController.tratar);

// Buscar detalhes de um SOS (rota com parâmetro dinâmico - DEVE VIR POR ÚLTIMO)
router.get('/:id', sosController.buscarPorId);

// Atualizar SOS
router.put('/:id', sosController.atualizar);

module.exports = router;
