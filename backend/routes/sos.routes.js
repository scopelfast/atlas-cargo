// backend/routes/sos.routes.js
// Rotas para Alertas SOS (Emergência)
// Versão: 2.0 - Módulo separado
// Data: 2025-01-16

const express = require('express');
const router = express.Router();
const sosController = require('../controllers/sos.controller');
const { requireAuth } = require('../middleware/auth.middleware');

// ============================================
// Rotas legadas (mantidas para compatibilidade)
// DEVEM VIR ANTES DAS ROTAS DINÂMICAS
// ============================================

// Rota para motorista criar alerta SOS (pode funcionar sem auth em caso de emergência offline)
router.post('/motorista/sos', sosController.criar);

// Rota para motorista ver histórico
router.get('/motorista/sos/historico', requireAuth, sosController.historico);

// Rota para admin listar alertas ativos (requer autenticação)
router.get('/ativos', requireAuth, sosController.listarAtivos);

// Rota para admin resolver alerta (requer autenticação)
router.put('/resolver/:id', requireAuth, sosController.resolver);

// ============================================
// Rotas do módulo separado (novas)
// ============================================
// Nota: Estas rotas funcionam quando registradas como /api/sos no app.js

// Contador de pendentes (para badge) - DEVE VIR ANTES DE /:id
router.get('/contador', requireAuth, sosController.contador);

// Listar SOS com filtros
router.get('/', requireAuth, sosController.listar);

// Listar apenas pendentes
router.get('/pendentes', requireAuth, sosController.listarPendentes);

// Buscar endereço via geocodificação reversa (Nominatim)
router.get('/geocodificar/:lat/:lon', requireAuth, sosController.geocodificar);

// Buscar histórico de ações
router.get('/:id/historico', requireAuth, sosController.buscarHistorico);

// Marcar como lido
router.post('/:id/ler', requireAuth, sosController.marcarComoLido);

// Tratar SOS (mudar status)
router.post('/:id/tratar', requireAuth, sosController.tratar);

// Buscar detalhes de um SOS (rota com parâmetro dinâmico - DEVE VIR POR ÚLTIMO)
router.get('/:id', requireAuth, sosController.buscarPorId);

// Atualizar SOS
router.put('/:id', requireAuth, sosController.atualizar);

module.exports = router;
