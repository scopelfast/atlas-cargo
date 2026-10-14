'use strict';

const express = require('express');
const router = express.Router();
const inv = require('../controllers/wms-inventario.controller');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');

router.use(towerAuthAndTenant);

router.get('/wms/inventario/orientacao', inv.obterOrientacao);
router.get('/wms/inventario/manual-operador', inv.obterManualOperador);
router.get('/wms/inventario/planilha-modelo.csv', inv.downloadPlanilhaModelo);

router.get('/wms/inventario', inv.listar);
router.get('/wms/inventario/consulta-itens', inv.consultarItens);
router.post('/wms/inventario', inv.criar);
router.post('/wms/inventario/lista-ciclica', inv.previewListaCiclica);
router.post('/wms/inventario/ciclico', inv.criarCiclico);
router.get('/wms/inventario/:cdInventario/relatorio', inv.relatorioAta);
router.get('/wms/inventario/:cdInventario', inv.obterDetalhe);
router.post('/wms/inventario/:cdInventario/snapshot', inv.gerarSnapshot);
router.post('/wms/inventario/:cdInventario/importar-csv', inv.importarCsv);
router.post('/wms/inventario/:cdInventario/importar-linhas', inv.importarLinhas);
router.post('/wms/inventario/:cdInventario/encerrar', inv.encerrar);
router.post('/wms/inventario/:cdInventario/cancelar', inv.cancelar);
/** Reabre um inventário que foi CANCELADO sem querer (ENCERRADO não é permitido). */
router.post('/wms/inventario/:cdInventario/reativar', inv.reativar);
router.patch('/wms/inventario/:cdInventario/tolerancia', inv.definirTolerancia);
router.post('/wms/inventario/:cdInventario/linhas/:cdLinha/recontar', inv.recontarLinha);
router.post('/wms/inventario/:cdInventario/linhas/:cdLinha/aprovar', inv.aprovarLinha);
/** Edição inline da contagem direto na tabela do detalhe (sem CSV). */
router.patch('/wms/inventario/:cdInventario/linhas/:cdLinha/contagem', inv.registrarContagem);
/** Edição inline de lote/validade da linha (parcial — só envia o que mudou). */
router.patch('/wms/inventario/:cdInventario/linhas/:cdLinha', inv.atualizarLoteValidade);
/** Divide uma linha em outra com mesmo SKU mas lote/validade diferentes
 *  (operador descobriu múltiplas validades em campo). */
router.post('/wms/inventario/:cdInventario/linhas/:cdLinha/dividir', inv.dividirLinha);
/** Exclui uma linha (ex.: descarta "linha-fantasma" pendente que sobrou
 *  depois do operador desmembrar o SKU em múltiplas validades reais). */
router.delete('/wms/inventario/:cdInventario/linhas/:cdLinha', inv.excluirLinha);
/** Sugere validade/lote (mais curta) ao digitar código no Adicionar SKU. */
router.get('/wms/inventario/:cdInventario/sugerir-validade', inv.sugerirValidade);
/** Adiciona uma linha NOVA ao inventário (manual, fora do snapshot/CSV).
 *  Útil quando o operador encontra um SKU em campo que não estava listado. */
router.post('/wms/inventario/:cdInventario/linhas', inv.adicionarLinhaManual);

module.exports = router;
