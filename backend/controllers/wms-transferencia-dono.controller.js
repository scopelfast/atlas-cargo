'use strict';

/**
 * Controller: transferência de estoque entre donos.
 *
 * Endpoints:
 *   POST /api/wms/transferencias/preview  → valida e devolve "vai dar / não vai"
 *                                            sem gravar nada.
 *   POST /api/wms/transferencias          → cria a transferência (2 movimentos
 *                                            no ledger + 1 documento).
 *   GET  /api/wms/transferencias          → lista as últimas (filtros: cdDono,
 *                                            dataInicio, dataFim, limite).
 *
 * Erros: o service devolve { err, status } com mensagens já amigáveis. A
 * camada controller apenas repassa, anexando detalhe técnico do PostgreSQL
 * (`detalheErro`) em caso de exceção inesperada (500) para facilitar suporte.
 */

const svc = require('../services/wms-transferencia-dono.service');
const { buildComprovanteTransferenciaHtml } = require('../services/wms-transferencia-comprovante-html.service');
const { getSgUser } = require('../utils/audit');
const { tenantIdForRequest } = require('../utils/tenant-context');

function detalheErro(e) {
  if (!e) return '';
  const code = e.code ? '[' + e.code + '] ' : '';
  const msg = String(e.message || e).split('\n')[0].slice(0, 240);
  return code + msg;
}

async function preview(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const r = await svc.previewTransferencia(tid, req.body || {});
    if (r.err) return res.status(r.status || 400).json(r);
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS transf] preview:', e);
    res.status(500).json({ error: 'Erro ao validar transferência: ' + detalheErro(e) });
  }
}

async function criar(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const r = await svc.criarTransferencia(tid, req.body || {}, sg);
    if (r.err) return res.status(r.status || 400).json(r);
    res.status(201).json(r.ok);
  } catch (e) {
    console.error('[WMS transf] criar:', e);
    res.status(500).json({ error: 'Erro ao criar transferência: ' + detalheErro(e) });
  }
}

async function obter(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const id = parseInt(req.params.cdTransferencia, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido.' });
    const r = await svc.obterTransferencia(tid, id);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS transf] obter:', e);
    res.status(500).json({ error: 'Erro ao obter transferência: ' + detalheErro(e) });
  }
}

async function cancelar(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const id = parseInt(req.params.cdTransferencia, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'ID inválido.' });
    const body = req.body || {};
    const r = await svc.cancelarTransferencia(tid, id, sg, {
      motivoCancel: body.motivoCancel,
      permitirNegativar: body.permitirNegativar === true,
    });
    if (r.err) return res.status(r.status || 400).json(r);
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS transf] cancelar:', e);
    res.status(500).json({ error: 'Erro ao cancelar transferência: ' + detalheErro(e) });
  }
}

async function comprovanteHtml(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    const id = parseInt(req.params.cdTransferencia, 10);
    if (!Number.isFinite(id)) return res.status(400).send('ID inválido.');
    const r = await svc.obterTransferencia(tid, id);
    if (r.err) return res.status(r.status || 400).send(r.err);
    const html = buildComprovanteTransferenciaHtml(r.ok, {
      usuarioEmitente: sg,
      geradoEm: new Date().toISOString(),
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error('[WMS transf] comprovanteHtml:', e);
    res.status(500).send('Erro ao gerar comprovante: ' + detalheErro(e));
  }
}

async function listar(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const r = await svc.listarTransferencias(tid, {
      cdDono: req.query.cdDono,
      dataInicio: req.query.dataInicio,
      dataFim: req.query.dataFim,
      limite: req.query.limite,
    });
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS transf] listar:', e);
    res.status(500).json({ error: 'Erro ao listar transferências: ' + detalheErro(e) });
  }
}

module.exports = { preview, criar, obter, cancelar, comprovanteHtml, listar };
