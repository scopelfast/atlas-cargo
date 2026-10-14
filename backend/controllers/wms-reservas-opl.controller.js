'use strict';

const svc = require('../services/wms-diagnostico-reserva-opl.service');
const { tenantIdForRequest } = require('../utils/tenant-context');

function detalheErro(e) {
  if (!e) return '';
  const code = e.code ? '[' + e.code + '] ' : '';
  const msg = String(e.message || e).split('\n')[0].slice(0, 240);
  return code + msg;
}

function getSgUser(req) {
  return (
    (req.headers && (req.headers['x-user-login'] || req.headers['user-login'])) ||
    (req.user && (req.user.SGUSUARIO || req.user.login)) ||
    null
  );
}

/** GET /api/wms/reservas-opl?cdDono=N&cdProduto=X — diagnóstico de um SKU. */
async function listarParaSku(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cdDono = parseInt(req.query.cdDono, 10);
    const cdProduto = parseInt(req.query.cdProduto, 10);
    if (!Number.isFinite(cdDono) || !Number.isFinite(cdProduto)) {
      return res.status(400).json({ error: 'cdDono e cdProduto são obrigatórios.' });
    }
    const r = await svc.listarReservasParaSku(tid, cdDono, cdProduto);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS reservas-opl sku]:', e);
    res.status(500).json({ error: 'Erro no diagnóstico de reservas: ' + detalheErro(e) });
  }
}

/** GET /api/wms/reservas-opl/orfas?cdDono= — varredura geral. */
async function listarOrfas(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const cdDono = req.query.cdDono != null && req.query.cdDono !== '' ? req.query.cdDono : null;
    const r = await svc.listarReservasOrfas(tid, cdDono);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    res.json(r.ok);
  } catch (e) {
    console.error('[WMS reservas-opl orfas]:', e);
    res.status(500).json({ error: 'Erro ao listar órfãs: ' + detalheErro(e) });
  }
}

/** POST /api/wms/reservas-opl/limpar-orfas?cdDono=&cdProduto= — limpa só órfãs.
 *  Operação segura: nunca apaga reserva de espelho com carga pendente.
 *  `cdProduto` opcional → limpeza cirúrgica de UM SKU (uso típico:
 *  botão "Limpar reservas órfãs deste SKU" na simulação OPL). */
async function limparOrfas(req, res) {
  try {
    const tid = tenantIdForRequest(req);
    const sg = getSgUser(req);
    if (!sg) return res.status(401).json({ error: 'Não autorizado.' });
    const cdDono = req.query.cdDono != null && req.query.cdDono !== '' ? req.query.cdDono : null;
    const cdProduto = req.query.cdProduto != null && req.query.cdProduto !== '' ? req.query.cdProduto : null;
    const r = await svc.limparReservasOrfas(tid, cdDono, sg, cdProduto);
    if (r.err) return res.status(r.status || 400).json({ error: r.err });
    const body = r.ok || {};
    if (process.env.NODE_ENV !== 'production') {
      console.info(
        '[WMS reservas-opl limpar] tenant=%s user=%s liberadas=%s espelhos=%s cdDono=%s',
        tid,
        sg,
        body.liberadas,
        body.espelhos,
        cdDono != null ? cdDono : '(todos)'
      );
    }
    res.json(body);
  } catch (e) {
    console.error('[WMS reservas-opl limpar]:', e);
    res.status(500).json({ error: 'Erro ao limpar órfãs: ' + detalheErro(e) });
  }
}

module.exports = { listarParaSku, listarOrfas, limparOrfas };
