// backend/routes/viagemmestre.routes.js
// Gerenciamento de Viagens - API
// Versão: 1.0
// Autor: Sistema DivulgaCarga
// Data: 2025-04-05

const express = require('express');
const router = express.Router();
const viagemController = require('../controllers/viagemmestre.controller');

// Rotas principais
router.get('/viagens', viagemController.listar);
router.post('/viagens', viagemController.criar);
router.put('/viagens/:id', viagemController.atualizar);
router.delete('/viagens/:id', viagemController.excluir);
router.get('/viagens/:id', viagemController.buscarPorId);

// Rotas de combos
router.get('/tipos-viagem-combo', viagemController.listarTiposViagem);
router.get('/situacoes-viagem-combo', viagemController.listarSituacoesViagem);
router.get('/classes-frota-combo', viagemController.listarClassesFrota);
router.get('/contratadores-combo', viagemController.listarContratadores);
router.get('/roteiros-combo', viagemController.listarRoteiros);
router.get('/motivos-recusa-combo', viagemController.listarMotivosRecusa);
router.get('/motivos-reabertura-combo', viagemController.listarMotivosReabertura);

// Rota para estados brasileiros
router.get('/estados-brasil', viagemController.listarEstadosBrasil);

// Rota para cidades por estado
router.get('/cidades-por-estado/:estado', viagemController.listarCidadesPorEstado);

// Rotas para convocações e motoristas compatíveis
router.get('/viagens-pendentes', viagemController.listarViagensPendentes);
router.get('/viagens/:idViagem/motoristas-compativel', viagemController.buscarMotoristasCompatíveis);
router.post('/convocacoes', viagemController.criarConvocacoes);
router.get('/convocacoes', viagemController.listarConvocacoes);

// Rotas com parâmetros (devem vir DEPOIS das rotas específicas)
router.get('/convocacoes/:id', viagemController.buscarConvocacaoPorId);
router.put('/convocacoes/:id', viagemController.atualizarConvocacao);
router.put('/convocacoes/:id/status', viagemController.atualizarStatusConvocacao);
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
