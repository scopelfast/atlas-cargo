'use strict';

const express = require('express');
const ctrl = require('../controllers/wms-auditoria-saude.controller');

const router = express.Router();

/** Auditoria de saúde do estoque (varredura de todo o tenant).
 *
 *  JSON:  GET /api/wms/auditoria-saude
 *  HTML:  GET /api/wms/auditoria-saude.html
 *
 *  Filtros (querystring):
 *    - cdDono : número (opcional) — limita a um dono.
 *    - dias   : inteiro (default 7) — corte para "NF aberta antiga".
 */
router.get('/wms/auditoria-saude.html', ctrl.auditarHtml);
router.get('/wms/auditoria-saude', ctrl.auditarJson);

module.exports = router;
