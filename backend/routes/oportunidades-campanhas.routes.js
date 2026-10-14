const express = require('express');
const router = express.Router();
const controller = require('../controllers/oportunidades-campanhas.controller');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');

// Público (link mágico)
router.get('/oportunidades-publicas/:token', controller.publicoDetalhes);
router.post('/oportunidades-publicas/:token/interesse', controller.publicoInteresse);

// Torre (protegido)
router.use(towerAuthAndTenant);
router.get('/oportunidades-campanhas/elegiveis/viagens', controller.listarViagensElegiveis);
router.get('/oportunidades-campanhas/elegiveis/motoristas', controller.listarMotoristasElegiveis);
router.get('/oportunidades-campanhas', controller.listarCampanhas);
router.get('/oportunidades-campanhas/:id', controller.obterCampanha);
router.post('/oportunidades-campanhas', controller.criarCampanha);
router.post('/oportunidades-campanhas/:id/disparar', controller.dispararCampanha);
router.post('/oportunidades-campanhas/:id/pausar', controller.pausarCampanha);
router.post('/oportunidades-campanhas/:id/retomar', controller.retomarCampanha);
router.post('/oportunidades-campanhas/:id/reprocessar-falhas', controller.reprocessarFalhas);

module.exports = router;
