// backend/routes/alert.routes.js
// Rotas para gerenciar alertas inteligentes
// Versão: 2.0 - Módulo separado
// Data: 2026-01-16

const express = require('express');
const router = express.Router();
const alertController = require('../controllers/alert.controller');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');
const { requireTenantModule } = require('../middleware/tenant-module.middleware');

// Todas as rotas: JWT torre + tenant + licença do módulo
router.use(towerAuthAndTenant);
router.use(requireTenantModule('alertas'));

// ============================================
// Rotas do módulo separado (novas)
// ============================================
// Nota: Estas rotas funcionam quando registradas como /api/alertas no app.js
// IMPORTANTE: Rotas específicas devem vir ANTES de rotas com parâmetros dinâmicos (/:id)

// Contador de pendentes (para badge) - DEVE VIR ANTES DE /:id
router.get('/contador', alertController.contador);

// Listar alertas com filtros
router.get('/', alertController.listar);

// Criar alerta de teste (para validar se a lista exibe)
router.post('/criar-teste', alertController.criarAlertaTeste);

// Listar apenas pendentes
router.get('/pendentes', alertController.listarPendentes);

// Buscar todos os alertas ativos (dashboard) - DEVE VIR ANTES DE /:id
router.get('/ativos', alertController.buscarAtivos);

// Buscar alertas de uma viagem - DEVE VIR ANTES DE /:id
router.get('/viagem/:idviagem', alertController.buscarPorViagem);

// Logs de notificação WhatsApp dos alertas
router.get('/notificacoes-log', alertController.listarLogsNotificacao);

// Buscar detalhes de um alerta (rota com parâmetro dinâmico - DEVE VIR POR ÚLTIMO)
router.get('/:id', alertController.buscarPorId);

// Buscar histórico de ações
router.get('/:id/historico', alertController.buscarHistorico);

// Marcar como lido
router.post('/:id/ler', alertController.marcarComoLido);

// Tratar alerta (mudar status)
router.post('/:id/tratar', alertController.tratar);

// Atualizar alerta
router.put('/:id', alertController.atualizar);

// Cancelar alerta
router.delete('/:id', alertController.cancelar);

// ============================================
// Rotas legadas (mantidas para compatibilidade)
// ============================================

// Verificar alertas de uma viagem (força verificação)
router.post('/verificar/:idviagem', alertController.verificar);

// Resolver alerta
router.put('/:id/resolver', alertController.resolver);

module.exports = router;
