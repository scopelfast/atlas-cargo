'use strict';

const express = require('express');
const router = express.Router();
const wms = require('../controllers/wms-cadastro.controller');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');

router.use(towerAuthAndTenant);

router.get('/wms/donos-estoque', wms.listarDonos);
router.post('/wms/donos-estoque', wms.criarDono);
router.put('/wms/donos-estoque/:cdDono', wms.atualizarDono);

router.get('/wms/armazens', wms.listarArmazens);
router.post('/wms/armazens', wms.criarArmazem);
router.put('/wms/armazens/:cdArmazem', wms.atualizarArmazem);

router.get('/wms/areas', wms.listarAreas);
router.post('/wms/areas', wms.criarArea);
router.put('/wms/areas/:cdArea', wms.atualizarArea);

router.get('/wms/docas', wms.listarDocas);
router.post('/wms/docas', wms.criarDoca);
router.put('/wms/docas/:cdDoca', wms.atualizarDoca);

router.get('/wms/grupos-produto', wms.listarGruposProduto);
router.post('/wms/grupos-produto', wms.criarGrupoProduto);
router.put('/wms/grupos-produto/:cdGrupo', wms.atualizarGrupoProduto);

router.get('/wms/categorias-produto', wms.listarCategoriasProduto);
router.post('/wms/categorias-produto', wms.criarCategoriaProduto);
router.put('/wms/categorias-produto/:cdCategoria', wms.atualizarCategoriaProduto);

router.get('/wms/produtos-dono', wms.listarProdutosDono);
router.get('/wms/produtos-dono/sugestoes-categoria', wms.listarSugestoesCategoriaProduto);
router.post('/wms/produtos-dono/sugestoes-categoria/aplicar', wms.aplicarSugestoesCategoriaProduto);
router.post('/wms/produtos-dono/sugestoes-categoria/job-run', wms.executarJobCategoriaSugestaoProduto);
router.get('/wms/produtos-dono/sugestoes-categoria/job-log', wms.listarLogJobCategoriaSugestaoProduto);
router.get('/wms/produtos-dono/pendencias-cadastro', wms.listarPendenciasCadastroProduto);
router.post(
  '/wms/produtos-dono/classificacao-ol/simular',
  wms.middlewareUploadOlXlsx,
  wms.simularClassificacaoOlProduto
);
router.post(
  '/wms/produtos-dono/classificacao-ol/aplicar',
  wms.middlewareUploadOlXlsx,
  wms.aplicarClassificacaoOlProduto
);
router.get('/wms/produtos-dono/:cdProduto', wms.obterProdutoDono);
// Rota específica antes do POST genérico /produtos-dono (evita ambiguidade em stacks/proxies).
router.post('/wms/produtos-dono/importar-xml', wms.importarProdutosXml);
router.post('/wms/produtos-dono', wms.criarProdutoDono);
router.put('/wms/produtos-dono/:cdProduto', wms.atualizarProdutoDono);
router.patch('/wms/produtos-dono/:cdProduto/cadastro-operacional', wms.patchCadastroOperacionalProdutoDono);

router.get('/wms/de-para-produto', wms.listarDepara);
router.post('/wms/de-para-produto', wms.criarDepara);
router.put('/wms/de-para-produto/:cdDepara', wms.atualizarDepara);

router.get('/wms/produtos-operacionais', wms.listarProdutosOperacionais);
router.post('/wms/produtos-operacionais/preencher-unidades-faltantes', wms.preencherUnidadesOperacionaisFaltantes);
router.put('/wms/produtos-operacionais/:cdOperacional', wms.atualizarProdutoOperacional);

module.exports = router;
