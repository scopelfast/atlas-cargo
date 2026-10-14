'use strict';

const svc = require('../services/wms-auditoria-saude.service');
const { buildAuditoriaSaudeHtml } = require('../services/wms-auditoria-saude-html.service');
const { tenantIdForRequest } = require('../utils/tenant-context');
const { pool } = require('../config/db');

function detalheErro(e) {
  if (!e) return '';
  const code = e.code ? '[' + e.code + '] ' : '';
  const msg = String(e.message || e).split('\n')[0].slice(0, 240);
  return code + msg;
}

/** GET /api/wms/auditoria-saude
 *  Query: cdDono? (filtra um dono específico), dias? (corte de NF aberta antiga).
 *  Retorna JSON estruturado com as 5 listas.
 */
async function auditarJson(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cdDono = req.query.cdDono !== undefined && req.query.cdDono !== '' ? req.query.cdDono : null;
    const dias = req.query.dias ? parseInt(req.query.dias, 10) : 7;
    const r = await svc.auditarSaudeEstoque(tid, cdDono, dias);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS auditoria-saude]:', e);
    res.status(500).json({ error: 'Erro na auditoria: ' + detalheErro(e) });
  }
}

/** GET /api/wms/auditoria-saude.html
 *  Mesmos filtros, mas renderiza um HTML imprimível.
 */
async function auditarHtml(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cdDono = req.query.cdDono !== undefined && req.query.cdDono !== '' ? req.query.cdDono : null;
    const dias = req.query.dias ? parseInt(req.query.dias, 10) : 7;
    const r = await svc.auditarSaudeEstoque(tid, cdDono, dias);
    if (r.err) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(r.status || 400).send(
        '<html><body style="font-family:sans-serif;padding:24px"><h2>Erro</h2><p>' +
          String(r.err).replace(/</g, '&lt;') +
          '</p></body></html>'
      );
    }

    let filtroDonoLabel = null;
    if (cdDono != null) {
      try {
        const q = await pool.query(
          'SELECT "NOME" FROM "WMS_DONO_ESTOQUE" WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer LIMIT 1',
          [tid, parseInt(cdDono, 10)]
        );
        const nm = q.rows[0] && q.rows[0].NOME ? q.rows[0].NOME : null;
        filtroDonoLabel = nm ? cdDono + ' — ' + nm : 'Dono ' + cdDono;
      } catch (_) {
        filtroDonoLabel = 'Dono ' + cdDono;
      }
    }

    const html = buildAuditoriaSaudeHtml({
      geradoEm: new Date().toISOString(),
      filtroDonoLabel,
      cdDonoFiltro: cdDono,
      diasFiltro: dias,
      dados: r.ok,
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    console.error('[WMS auditoria-saude html]:', e);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(500).send(
      '<html><body style="font-family:sans-serif;padding:24px;color:#b91c1c"><h2>Erro</h2><p>' +
        detalheErro(e).replace(/</g, '&lt;') +
        '</p></body></html>'
    );
  }
}

module.exports = { auditarJson, auditarHtml };
