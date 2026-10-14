'use strict';

const express = require('express');
const router = express.Router();
const exp = require('../controllers/wms-expedicao.controller');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');

router.use(towerAuthAndTenant);

router.get('/wms/expedicao/cargas', exp.listarCargas);
router.get('/wms/expedicao/cargas/:cdCarga/validacao', exp.detalharValidacaoCarga);
router.get('/wms/expedicao/cargas/:cdCarga', exp.detalharCarga);
router.post('/wms/expedicao/cargas/:cdCarga/iniciar', exp.iniciarExpedicao);
router.post('/wms/expedicao/cargas/:cdCarga/confirmar-saida', exp.confirmarSaida);
router.post('/wms/expedicao/cargas/:cdCarga/sincronizar-movimentos', exp.sincronizarMovimentosLedger);
router.get('/wms/expedicao/diagnostico-movimentos', exp.diagnosticoMovimentosLedger);
router.post('/wms/expedicao/sincronizar-movimentos-todas', exp.sincronizarMovimentosLedgerTodas);
router.post('/wms/expedicao/cargas/:cdCarga/reabrir', exp.reabrirExpedicao);
router.post('/wms/expedicao/cargas/:cdCarga/voltar-montagem', exp.voltarMontagemExpedicao);

// Relatório de divergências (validação NF-e × separação física).
// Use ?dataIni=YYYY-MM-DD&dataFim=YYYY-MM-DD&conferente=...&status=EXPEDIDA|EM_EXPEDICAO
router.get('/wms/expedicao/cargas/:cdCarga/relatorio-divergencias', exp.relatorioDivergenciasCargaHtml);
router.get('/wms/expedicao/cargas/:cdCarga/relatorio-divergencias.csv', exp.relatorioDivergenciasCsv);
router.get('/wms/expedicao/cargas/:cdCarga/relatorio-divergencias-sku.csv', exp.relatorioDivergenciasSkuCsv);
router.get('/wms/expedicao/relatorio-divergencias', exp.relatorioDivergenciasConsolidadoHtml);
router.get('/wms/expedicao/relatorio-divergencias.csv', exp.relatorioDivergenciasCsv);
router.get('/wms/expedicao/relatorio-divergencias-sku.csv', exp.relatorioDivergenciasSkuCsv);

module.exports = router;

