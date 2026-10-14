// Rotas públicas de viagem/convocação — SEM towerAuth (motorista sem login na página /convocacao/:id).
// Montadas em app.js como primeiro router em /api para não depender de viagemPublicSkip no viagemmestre.routes.

const express = require('express');
const router = express.Router();
const viagemController = require('../controllers/viagemmestre.controller');
const { cacheComboMiddleware } = require('../middleware/cache.middleware');

router.get('/motivos-recusa-combo', cacheComboMiddleware(), viagemController.listarMotivosRecusa);

router.get('/public/convocacao/:id', viagemController.buscarConvocacaoPublica);
router.get('/public/convocacao/:id/roteiro-pontos', viagemController.listarPontosRoteiroConvocacaoPublica);
router.post('/public/convocacao/:id/responder', viagemController.responderConvocacao);
router.post('/public/convocacao/:id/acesso', viagemController.registrarAcessoConvocacao);
router.post('/public/convocacao/:id/atualizar-localizacao', viagemController.atualizarLocalizacaoConvocacao);

router.get('/public-url', viagemController.obterUrlPublica);

module.exports = router;
