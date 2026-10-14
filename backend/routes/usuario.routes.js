// backend/routes/usuario.routes.js
const express = require('express');
const router = express.Router();
const usuarioController = require('../controllers/usuario.controller');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');

router.use(towerAuthAndTenant);

// Rotas de CRUD (contexto antes de :login para não capturar "contexto" como login)
router.get('/usuarios/contexto', usuarioController.contexto);
router.get('/usuarios', usuarioController.listar);
router.get('/usuarios/:login', usuarioController.buscarPorLogin);
router.post('/usuarios', usuarioController.criar);
router.put('/usuarios/:login', usuarioController.atualizar);
router.delete('/usuarios/:login', usuarioController.alterarStatus);

// Rotas de atividades
router.get('/usuarios/:login/atividades', usuarioController.listarAtividades);
router.post('/usuarios/:login/atividades', usuarioController.salvarAtividades);
router.get('/atividades', usuarioController.listarTodasAtividades);

// Rotas de empresas
router.get('/usuarios/:login/empresas', usuarioController.listarEmpresas);
router.post('/usuarios/:login/empresas', usuarioController.adicionarEmpresa);
router.delete('/usuarios/:login/empresas/:empresa', usuarioController.removerEmpresa);

// Rotas de filiais
router.get('/usuarios/:login/filiais', usuarioController.listarFiliais);
router.post('/usuarios/:login/filiais', usuarioController.adicionarFilial);
router.delete('/usuarios/:login/filiais/:empresa/:filial', usuarioController.removerFilial);

// Executar init.sql
router.post('/usuarios/executar-init-sql', usuarioController.executarInitSQL);

module.exports = router;

