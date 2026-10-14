'use strict';

const express = require('express');
const ctrl = require('../controllers/wms-baixa-estoque.controller');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');

const router = express.Router();

router.use(towerAuthAndTenant);

router.get('/wms/baixas/motivos', ctrl.listarMotivos);
router.get('/wms/baixas/resolver-produto', ctrl.resolverProduto);
router.get('/wms/baixas', ctrl.listar);
router.post('/wms/baixas/preview', ctrl.preview);
router.post('/wms/baixas/importar-shelf', ctrl.importarShelf);
router.post('/wms/baixas', ctrl.confirmar);
router.get('/wms/baixas/:cdBaixa/imprimir', ctrl.imprimir);
router.get('/wms/baixas/:cdBaixa', ctrl.obter);
router.post('/wms/baixas/:cdBaixa/estornar', ctrl.estornar);

module.exports = router;
