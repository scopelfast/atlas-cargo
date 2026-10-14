'use strict';

const svc = require('../services/wms-diagnostico-sku.service');
const { tenantIdForRequest } = require('../utils/tenant-context');

function detalheErro(e) {
  if (!e) return '';
  const code = e.code ? '[' + e.code + '] ' : '';
  const msg = String(e.message || e).split('\n')[0].slice(0, 240);
  return code + msg;
}

/** GET /api/wms/diagnostico-sku?cdDono=1&codigo=6.03.15.507.00
 *
 *  Retorna estrutura completa para o front renderizar modal de diagnóstico
 *  ("por que esse SKU não soma como NF encerrada"). Não altera dados.
 */
async function diagnosticarSku(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cdDono = parseInt(req.query.cdDono, 10);
    const codigo = String(req.query.codigo || '').trim();
    if (!Number.isFinite(cdDono)) return res.status(400).json({ error: 'cdDono é obrigatório.' });
    if (!codigo) return res.status(400).json({ error: 'codigo é obrigatório.' });
    const r = await svc.diagnosticarSku(tid, cdDono, codigo);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS diagnostico-sku]:', e);
    res.status(500).json({ error: 'Erro no diagnóstico: ' + detalheErro(e) });
  }
}

module.exports = { diagnosticarSku };
