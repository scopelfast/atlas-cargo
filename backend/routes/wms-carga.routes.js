'use strict';

const express = require('express');
const router = express.Router();
const carga = require('../controllers/wms-carga.controller');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');

router.use(towerAuthAndTenant);

router.post('/wms/cargas/nfes-saida/importar-xml', carga.importarNfeSaidaXml);
router.get('/wms/cargas/nfes-saida/export.csv', carga.exportarNfesSaidaCsv);
router.get('/wms/cargas/nfes-saida', carga.listarNfesSaida);
router.get('/wms/cargas/nfes-saida/disponiveis', carga.listarNfesSaidaDisponiveis);
router.delete('/wms/cargas/nfes-saida/:cdNfeSaida', carga.excluirNfeSaida);
router.get('/wms/cargas/nfes-saida/:cdNfeSaida', carga.buscarNfeSaida);
router.get('/wms/cargas/programadas', carga.listarCargas);
router.get('/wms/cargas/programadas/export-nf.csv', carga.exportarNfCargasCsv);
router.get('/wms/cargas/programadas/resumo-programacao', carga.resumoProgramacaoCargas);
router.get('/wms/cargas/programadas/unidades-embarque', carga.listarUnidadesEmbarqueWms);
router.post('/wms/cargas/programadas', carga.criarCarga);
router.post('/wms/cargas/programadas/mesclar', carga.mesclarCargas);
router.get('/wms/cargas/programadas/distribuir-nf-rota/preview', carga.previewDistribuirNfPorRota);
router.post('/wms/cargas/programadas/distribuir-nf-rota', carga.aplicarDistribuirNfPorRotaHandler);
router.put('/wms/cargas/programadas/:cdCarga', carga.atualizarCarga);
router.delete('/wms/cargas/programadas/:cdCarga', carga.excluirCarga);
router.get('/wms/cargas/programadas/:cdCarga/resumo-logistico', carga.resumoLogisticoCarga);
router.get('/wms/cargas/programadas/:cdCarga', carga.buscarCarga);
router.get('/wms/cargas/programadas/:cdCarga/romaneio', carga.gerarRomaneioCarga);
router.get('/wms/cargas/programadas/:cdCarga/relatorios/frios', carga.relatorioFriosCargaHtml);
router.post('/wms/cargas/programadas/:cdCarga/separacao/importar', carga.importarSeparacaoCarga);
router.get('/wms/cargas/programadas/:cdCarga/validacao', carga.validarCargaProgramadaController);
router.post('/wms/cargas/programadas/:cdCarga/validar', carga.validarCargaProgramadaController);
router.post('/wms/cargas/programadas/:cdCarga/revalidar', carga.revalidarCargaProgramadaController);
router.post('/wms/cargas/programadas/:cdCarga/nfes', carga.adicionarNfeCarga);
router.post('/wms/cargas/programadas/:cdCarga/transferir-destino', carga.transferirDestinoParaCarga);
router.delete('/wms/cargas/programadas/:cdCarga/nfes/:cdNfeSaida', carga.removerNfeCarga);
router.get('/wms/cargas/programadas/:cdCarga/rota-operacional', carga.obterUltimaRotaOperacionalCarga);
router.post('/wms/cargas/programadas/:cdCarga/rota-operacional/planejar-paradas', carga.planejarParadasCarga);
router.post('/wms/cargas/programadas/:cdCarga/rota-operacional/calcular', carga.calcularSalvarRotaOperacionalCarga);
router.post('/wms/cargas/programadas/:cdCarga/viagem-rascunho', carga.criarViagemRascunhoDeCarga);

module.exports = router;
