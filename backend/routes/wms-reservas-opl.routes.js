'use strict';

const express = require('express');
const ctrl = require('../controllers/wms-reservas-opl.controller');

const router = express.Router();

/** Diagnóstico e saneamento de reservas OPL.
 *
 *  - GET  /api/wms/reservas-opl?cdDono=&cdProduto=  → reservas de um SKU.
 *  - GET  /api/wms/reservas-opl/orfas?cdDono=       → órfãs do tenant (ou dono).
 *  - POST /api/wms/reservas-opl/limpar-orfas?cdDono=→ apaga só órfãs (seguro).
 */
router.get('/wms/reservas-opl', ctrl.listarParaSku);
router.get('/wms/reservas-opl/orfas', ctrl.listarOrfas);
router.post('/wms/reservas-opl/limpar-orfas', ctrl.limparOrfas);

module.exports = router;
