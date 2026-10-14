'use strict';

const express = require('express');
const router = express.Router();
const rel = require('../controllers/wms-relatorios.controller');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');

router.use(towerAuthAndTenant);

router.get('/wms/relatorios/posicao-estoque', rel.listarPosicaoEstoqueRelatorio);
router.get('/wms/relatorios/movimentacao', rel.listarMovimentacaoRelatorio);
router.get(
  '/wms/relatorios/demonstrativo-movimentacao',
  rel.listarDemonstrativoMovimentacaoRelatorio
);
router.get('/wms/relatorios/separacao-opl', rel.listarSeparacaoOplRelatorio);
router.get('/wms/relatorios/comparativo-nf-opl', rel.listarComparativoNfOplRelatorio);
router.get('/wms/relatorios/conversao-embalagem', rel.listarConversaoEmbalagemRelatorio);
/** Subcaminhos de shelf-life ANTES da rota genérica (evita HTML do relatório no lugar de JSON). */
router.get('/wms/relatorios/shelf-life/envios', rel.listarHistoricoEnvioShelfLife);
router.get('/wms/relatorios/shelf-life/apontados', rel.listarShelfLifeApontados);
router.post('/wms/relatorios/shelf-life/apontados', rel.marcarShelfLifeApontados);
router.post('/wms/relatorios/shelf-life/apontados/desmarcar', rel.desmarcarShelfLifeApontados);
router.get('/wms/relatorios/shelf-life/baixas/motivos', rel.listarMotivosBaixaEstoque);
router.post('/wms/relatorios/shelf-life/baixas/preview', rel.previewBaixaShelfLife);
router.post('/wms/relatorios/shelf-life/baixas', rel.confirmarBaixaShelfLife);
router.get('/wms/relatorios/shelf-life/baixas', rel.listarHistoricoBaixasShelfLife);
router.get('/wms/relatorios/shelf-life/baixas/:cdBaixa/linhas', rel.listarDetalheBaixaShelfLife);
router.get('/wms/relatorios/shelf-life', rel.listarShelfLifeRelatorio);
router.get('/wms/relatorios/demanda-dia/rotas', rel.listarRotasDemandaDiaRelatorio);
router.get('/wms/relatorios/demanda-dia', rel.listarDemandaDiaRelatorio);

module.exports = router;
