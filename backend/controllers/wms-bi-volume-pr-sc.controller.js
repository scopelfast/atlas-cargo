'use strict';

const { getSgUser } = require('../utils/audit');
const { tenantIdForRequest } = require('../utils/tenant-context');
const { montarBiVolumePrSc } = require('../services/wms-bi-volume-pr-sc.service');
const { buildBiVolumePrScHtml } = require('../services/wms-bi-volume-pr-sc-html.service');

/**
 * GET /api/wms/bi/volume-pr-sc
 * Query: refresh=1 para forçar recálculo (ignora cache 60s)
 */
async function obterJson(req, res) {
  try {
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado. Faça login no Atlas Cargo.' });
    const tid = tenantIdForRequest(req);
    const forceRefresh = String(req.query.refresh || '') === '1';
    const dados = await montarBiVolumePrSc(tid, { forceRefresh });
    res.json(dados);
  } catch (e) {
    console.error('[WMS BI volume PR/SC] json:', e);
    res.status(500).json({ error: 'Erro ao montar BI: ' + String(e.message || e).slice(0, 200) });
  }
}

/**
 * GET /api/wms/bi/volume-pr-sc.html
 * Página BI que busca o JSON ao vivo (precisa token no localStorage ou ?token=)
 */
async function obterHtml(req, res) {
  try {
    const sg = getSgUser(req);
    if (!sg) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(401).send(
        '<!DOCTYPE html><html><body style="font-family:Segoe UI,sans-serif;background:#0b1220;color:#e2e8f0;padding:40px">' +
          '<h2>Login necessário</h2><p>Abra o Atlas Cargo, faça login e acesse de novo o BI, ou use a URL com <code>?token=SEU_JWT</code>.</p>' +
          '</body></html>'
      );
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buildBiVolumePrScHtml());
  } catch (e) {
    console.error('[WMS BI volume PR/SC] html:', e);
    res.status(500).type('html').send('<p>Erro ao abrir BI.</p>');
  }
}

module.exports = { obterJson, obterHtml };
