// backend/routes/viagemmestre.routes.js
// Gerenciamento de Viagens - API
// Versão: 1.0
// Autor: Sistema DivulgaCarga
// Data: 2025-04-05

const express = require('express');
const router = express.Router();
const viagemController = require('../controllers/viagemmestre.controller');
const { cacheComboMiddleware } = require('../middleware/cache.middleware');

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
router.put('/viagens/:id', viagemController.atualizar);
router.delete('/viagens/:id', viagemController.excluir);

// Rota para Histórico de Viagens por Roteiro (DEVE vir ANTES de /viagens/:id)
router.get('/viagens/historico-roteiro', viagemController.buscarHistoricoRoteiro);

router.get('/viagens/:id', viagemController.buscarPorId);

// Rotas de combos (com cache de 10 minutos)
router.get('/tipos-viagem-combo', cacheComboMiddleware(), viagemController.listarTiposViagem);
router.get('/situacoes-viagem-combo', cacheComboMiddleware(), viagemController.listarSituacoesViagem);
router.get('/classes-frota-combo', cacheComboMiddleware(), viagemController.listarClassesFrota);
router.get('/contratadores-combo', cacheComboMiddleware(), viagemController.listarContratadores);
router.get('/roteiros-combo', cacheComboMiddleware(), viagemController.listarRoteiros);
router.get('/motivos-recusa-combo', cacheComboMiddleware(), viagemController.listarMotivosRecusa);
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

// Rota para receber retorno do webhook Meta (callback)
router.post('/webhook-meta-callback', viagemController.receberRetornoWebhookMeta);
router.post('/convocacoes/:id/confirmar', viagemController.confirmarConvocacao);
router.post('/convocacoes/:id/reativar', viagemController.reativarConvocacao);
router.get('/convocacoes/:id/historico-reabertura', viagemController.listarHistoricoReabertura);

// Rotas públicas para motorista responder convocação
router.get('/public/convocacao/:id', viagemController.buscarConvocacaoPublica);
router.post('/public/convocacao/:id/responder', viagemController.responderConvocacao);
router.post('/public/convocacao/:id/acesso', viagemController.registrarAcessoConvocacao);
router.post('/public/convocacao/:id/atualizar-localizacao', viagemController.atualizarLocalizacaoConvocacao);

// Rota para obter URL base pública (para links de convocação)
router.get('/public-url', viagemController.obterUrlPublica);

// Rota para executar query SQL personalizada (apenas SELECT)
router.post('/executar-query', viagemController.executarQuery);

// Rota para executar SQL de inicialização (permite procedures)
router.post('/viagens/executar-init-sql', viagemController.executarInitSQL);

// Rotas para Veículo da Viagem
router.get('/viagens/:id/veiculo', viagemController.buscarVeiculoViagem);
router.post('/viagens/:id/veiculo', viagemController.salvarVeiculoViagem);
router.delete('/viagens/:id/veiculo/:idequipamento', viagemController.removerVeiculoViagem);
router.get('/viagens/equipamentos/buscar', viagemController.buscarEquipamento);

// Rotas para Motorista da Viagem
router.get('/viagens/:id/motorista', viagemController.buscarMotoristaViagem);
router.post('/viagens/:id/motorista', viagemController.salvarMotoristaViagem);
router.delete('/viagens/:id/motorista/:cdmotorista', viagemController.removerMotoristaViagem);
router.get('/viagens/cadastros-gerais/buscar', viagemController.buscarCadastroGeral);

module.exports = router;
