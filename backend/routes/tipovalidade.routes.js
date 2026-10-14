// Rotas para Tipos de Validade
const express = require('express');
const router = express.Router();
const tipoValidadeController = require('../controllers/tipovalidade.controller');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');

router.use(towerAuthAndTenant);

router.get('/tipos-validade', tipoValidadeController.listar);
router.get('/tipos-validade/:id', tipoValidadeController.buscarPorId);
router.post('/tipos-validade', tipoValidadeController.criar);
router.put('/tipos-validade/:id', tipoValidadeController.atualizar);
router.delete('/tipos-validade/:id', tipoValidadeController.excluir);
router.post('/tipos-validade/executar-init-sql', tipoValidadeController.executarInitSQL);

module.exports = router;

