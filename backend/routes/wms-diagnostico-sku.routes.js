'use strict';

const express = require('express');
const ctrl = require('../controllers/wms-diagnostico-sku.controller');

const router = express.Router();

/** Diagnóstico de SKU: por que esse produto não soma como NF encerrada.
 *  Espelha o script wms_diagnostico_nf_nao_soma_postgres.sql em JSON. */
router.get('/wms/diagnostico-sku', ctrl.diagnosticarSku);

module.exports = router;
