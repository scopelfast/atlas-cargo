'use strict';

const { getSgUser } = require('../utils/audit');
const { buildBiCenarioBaseHtml } = require('../services/wms-bi-cenario-base-html.service');

/**
 * GET /api/wms/bi/cenario-base.html
 * BI dedicado: Colombo/PR → Joinville ou Araquari/SC (pauta reunião)
 */
async function obterHtml(req, res) {
  try {
    const sg = getSgUser(req);
    if (!sg) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(401).send(
        '<!DOCTYPE html><html><body style="font-family:Segoe UI,sans-serif;background:#04140f;color:#e8f5ef;padding:40px">' +
          '<h2>Login necessário</h2><p>Abra o Atlas Cargo, faça login e acesse de novo, ou use <code>?token=SEU_JWT</code>.</p>' +
          '</body></html>'
      );
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buildBiCenarioBaseHtml());
  } catch (e) {
    console.error('[WMS BI cenário base] html:', e);
    res.status(500).type('html').send('<p>Erro ao abrir BI cenário de base.</p>');
  }
}

module.exports = { obterHtml };
