// Rotas para Controle de Validades
const express = require('express');
const router = express.Router();
const controleValidadeController = require('../controllers/controlevalidade.controller');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');

router.use(towerAuthAndTenant);

// Combos (DEVEM vir ANTES das rotas com parâmetros)
router.get('/validades/tipos-combo/:tpCadastro', controleValidadeController.listarTiposParaCombo);
router.get('/validades/certificadoras-combo', controleValidadeController.listarCertificadorasCombo);

// Rotas para validades de um cadastro específico
router.get('/validades/:tpCadastro/:cdCadastro', controleValidadeController.listarPorCadastro);
router.post('/validades/:tpCadastro/:cdCadastro', controleValidadeController.criar);
router.put('/validades/:tpCadastro/:cdCadastro/:sequencia', controleValidadeController.atualizar);
router.delete('/validades/:tpCadastro/:cdCadastro/:sequencia', controleValidadeController.excluir);

module.exports = router;

