'use strict';

const express = require('express');
const ctrl = require('../controllers/wms-transferencia-dono.controller');

const router = express.Router();

/** Preview (não grava). Valida payload, donos, produto, saldo e diz se
 *  precisa cadastrar o SKU no destino. */
router.post('/wms/transferencias/preview', ctrl.preview);

/** Cria a transferência: 2 movimentos no ledger + documento em
 *  WMS_TRANSFERENCIA_DONO. Transacional. */
router.post('/wms/transferencias', ctrl.criar);

/** Lista as últimas transferências (filtros: cdDono, dataInicio, dataFim,
 *  limite). Default: 100 mais recentes. */
router.get('/wms/transferencias', ctrl.listar);

/** Obtém uma transferência específica com dados dos donos e produtos. */
router.get('/wms/transferencias/:cdTransferencia', ctrl.obter);

/** Cancela uma transferência EFETIVADA: gera 2 movimentos inversos
 *  (estorno) e marca o documento como CANCELADA. */
router.post('/wms/transferencias/:cdTransferencia/cancelar', ctrl.cancelar);

/** Comprovante HTML imprimível (A4) — abre em nova aba e imprime/PDF. */
router.get('/wms/transferencias/:cdTransferencia/comprovante.html', ctrl.comprovanteHtml);

module.exports = router;
