'use strict';

const express = require('express');
const router = express.Router();
const wms = require('../controllers/wms-recebimento.controller');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');

router.use(towerAuthAndTenant);

router.post('/wms/recebimento/importar-xml', wms.importarXml);
router.get('/wms/recebimento/relatorio-vencimento', wms.listarRelatorioVencimentoRecebimento);
router.get('/wms/recebimento/relatorio-posicao-estoque', wms.listarRelatorioPosicaoEstoqueRecebimento);
router.get('/wms/recebimento/relatorio-vencimento-envios', wms.listarHistoricoRelatorioVencimentoEnvios);
router.get('/wms/recebimento/resolver-codigo', wms.resolverCodigoEstoqueRecebimento);
router.get('/wms/recebimento/produtos-sugestao', wms.buscarProdutosSugestaoRecebimento);
router.get('/wms/recebimento/documentos', wms.listarDocumentos);
router.get('/wms/recebimento/documentos/exportacao', wms.exportarDocumentosRecebimento);
router.get('/wms/recebimento/documentos/por-chave/:chave', wms.buscarDocumentoPorChave);
router.get('/wms/recebimento/documentos/:cdNfe', wms.buscarDocumento);
router.delete('/wms/recebimento/documentos/:cdNfe', wms.excluirDocumento);
router.put('/wms/recebimento/documentos/:cdNfe/dono', wms.trocarDonoDocumento);
router.put('/wms/recebimento/documentos/:cdNfe/conferencia', wms.salvarConferencia);
router.put('/wms/recebimento/documentos/:cdNfe/encerrar', wms.encerrarRecebimento);
router.put('/wms/recebimento/documentos/:cdNfe/reabrir', wms.reabrirRecebimento);
router.post('/wms/recebimento/crossdock/lotes', wms.criarLoteCrossdock);
router.get('/wms/recebimento/crossdock/lotes', wms.listarLotesCrossdock);
router.put('/wms/recebimento/crossdock/lotes/:cdLote/vincular-nfes', wms.vincularNfesLote);
router.put('/wms/recebimento/crossdock/lotes/:cdLote/fase', wms.mudarFaseLote);

module.exports = router;
