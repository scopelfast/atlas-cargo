'use strict';

const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/wms-dashboard.controller');
const biCtrl = require('../controllers/wms-bi-volume-pr-sc.controller');
const biCenarioCtrl = require('../controllers/wms-bi-cenario-base.controller');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');

router.use(towerAuthAndTenant);

/** BI operacional PR/SC (Mana+Nutriville) — ao vivo */
router.get('/wms/bi/volume-pr-sc.html', biCtrl.obterHtml);
router.get('/wms/bi/volume-pr-sc', biCtrl.obterJson);

/** BI cenário de base Colombo → SC (pauta reunião — separado do volume) */
router.get('/wms/bi/cenario-base.html', biCenarioCtrl.obterHtml);

router.get('/wms/dashboard/resumo', ctrl.obterResumo);
router.get('/wms/dashboard/valor-estoque', ctrl.obterValorEstoque);
router.get('/wms/dashboard/valor-estoque/auditoria-um', ctrl.auditarPrecoUm);
router.get('/wms/dashboard/valor-estoque/posicao', ctrl.obterPosicaoValorizada);
router.get('/wms/dashboard/valor-estoque/posicao.csv', ctrl.exportarPosicaoValorizadaCsv);
router.post('/wms/dashboard/valor-estoque/snapshot', ctrl.gerarSnapshotValorHoje);
router.post('/wms/dashboard/valor-estoque/snapshot/backfill', ctrl.gerarBackfillSnapshots);
router.post('/wms/dashboard/valor-estoque/importar-valor-referencia', ctrl.importarValorReferenciaPlanilha);
router.get('/wms/dashboard/cobranca-operacional', ctrl.obterCobrancaOperacional);
router.get('/wms/dashboard/cobranca-operacional/resumo.csv', ctrl.exportarCobrancaOperacionalResumoCsv);
router.get('/wms/dashboard/cobranca-operacional/expedicao.csv', ctrl.exportarCobrancaExpedicaoCsv);

module.exports = router;
