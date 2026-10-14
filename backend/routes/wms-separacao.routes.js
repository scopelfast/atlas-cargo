'use strict';

const express = require('express');
const router = express.Router();
const sep = require('../controllers/wms-separacao.controller');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');

router.use(towerAuthAndTenant);

router.get('/wms/separacao/opl/validar-pedidos', sep.validarPedidosEntreArquivosHandler);
router.post('/wms/separacao/opl/validar-pedidos', sep.validarPedidosEntreArquivosHandler);
router.post('/wms/separacao/opl/importar', sep.uploadOpl, sep.importarOplTxt);
router.get('/wms/separacao/opl/programacao-antecipada', sep.programacaoAntecipadaOpl);
router.get('/wms/separacao/opl/importacoes', sep.listarImportacoes);
router.get('/wms/separacao/opl/importacoes/:cdOplArquivo', sep.buscarImportacao);
router.get('/wms/separacao/opl/importacoes/:cdOplArquivo/auditoria-cadastro', sep.auditoriaCadastroImportacao);
router.get('/wms/separacao/opl/importacoes/:cdOplArquivo/cadastro-automatico/preview', sep.previewCadastroAutomaticoOpl);
router.post('/wms/separacao/opl/importacoes/:cdOplArquivo/cadastro-automatico/aplicar', sep.aplicarCadastroAutomaticoOplHandler);
router.get('/wms/separacao/opl/importacoes/:cdOplArquivo/cobertura-estoque/exportacao', sep.exportarCoberturaEstoqueOpl);
router.get('/wms/separacao/opl/importacoes/:cdOplArquivo/romaneio', sep.romaneioSeparacaoHtml);
router.delete('/wms/separacao/opl/importacoes/:cdOplArquivo', sep.excluirImportacao);
router.patch('/wms/separacao/opl/importacoes/:cdOplArquivo/dono', sep.atualizarDonoEspelho);
router.post('/wms/separacao/opl/importacoes/:cdOplArquivo/aplicar-reservas', sep.aplicarReservasEspelho);
router.post('/wms/separacao/opl/importacoes/:cdOplArquivo/reabrir-picking', sep.reabrirPickingHandler);
router.put('/wms/separacao/opl/importacoes/:cdOplArquivo/picking', sep.salvarPicking);
router.post(
  '/wms/separacao/opl/importacoes/:cdOplArquivo/itens/:cdOplItem/substituir',
  sep.substituirItemPicking
);
router.post('/wms/separacao/opl/corrigir-picking-indevido', sep.corrigirPickingIndevidoHandler);

module.exports = router;
