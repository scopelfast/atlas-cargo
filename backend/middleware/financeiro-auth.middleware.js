'use strict';

const { tenantIdForRequest } = require('../utils/tenant-context');
const finPerm = require('../services/financeiro-permissoes.service');
const { ROTA_PERMISSOES } = require('../constants/financeiro-permissoes');

const PROGRAMA_FINANCEIRO = finPerm.PROGRAMA_MODULO;

function loginReq(req) {
  const u = req.user || {};
  const h = req.headers || {};
  return String(h['user-login'] || u.login || u.SGUSUARIO || u.email || '').trim();
}

function ipReq(req) {
  return String(
    (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) ||
      req.ip ||
      ''
  )
    .split(',')[0]
    .trim()
    .slice(0, 64);
}

/**
 * Abre o módulo Atlas Pay: precisa de atlas-pay (menu) ou qualquer FIN_* efetiva.
 * Tenant sempre via tenantIdForRequest (JWT) — ignora empresa_id do body.
 */
function requireAtlasPay(req, res, next) {
  (async () => {
    const login = loginReq(req);
    if (!login) return res.status(401).json({ error: 'Não autorizado.' });
    const tid = tenantIdForRequest(req);
    // Recusa tenant forjado no body
    if (req.body && req.body.empresa_id != null) {
      const forged = String(req.body.empresa_id).trim();
      if (forged && forged !== tid) {
        await finPerm.audit(null, {
          tenantId: tid,
          alvo: login,
          ator: login,
          operacao: 'NEGADO',
          detalhe: 'Tentativa empresa_id=' + forged,
          ip: ipReq(req),
        });
        return res.status(403).json({
          error: 'Tenant da sessão prevalece; empresa_id do cliente é ignorado.',
          code: 'FIN_TENANT_FORJADO',
        });
      }
    }
    const resolved = await finPerm.resolverEfetivas(login, tid, { ip: ipReq(req) });
    if (!resolved.temModulo && resolved.efetivas.length === 0) {
      return res.status(403).json({
        error: 'Sem permissão para o Atlas Pay.',
        code: 'FIN_SEM_PERMISSAO',
        programa: PROGRAMA_FINANCEIRO,
      });
    }
    req.atlasPayLogin = login;
    req.finPerms = resolved.efetivas;
    req.finPermModo = resolved.modo;
    next();
  })().catch((e) => {
    console.error('[atlas-pay auth]', e);
    res.status(500).json({ error: 'Erro ao validar permissão financeira.' });
  });
}

/** Exige ao menos uma das permissões FIN_*. */
function requireFinPerm(...codes) {
  const need = codes.flat();
  return function (req, res, next) {
    (async () => {
      const login = loginReq(req);
      const tid = tenantIdForRequest(req);
      await finPerm.assertFinPerm(login, tid, need, { ip: ipReq(req) });
      next();
    })().catch((e) => {
      if (e && e.statusCode) {
        return res.status(e.statusCode).json({ error: e.message, code: e.code || null });
      }
      console.error('[atlas-pay perm]', e);
      res.status(500).json({ error: 'Erro ao validar permissão.' });
    });
  };
}

/** Atalho: mapeia método+path express para ROTA_PERMISSOES. */
function requireFinPermForRoute(routeKey) {
  const need = ROTA_PERMISSOES[routeKey] || ['FIN_CONSULTAR'];
  return requireFinPerm(...need);
}

module.exports = {
  PROGRAMA_FINANCEIRO,
  requireAtlasPay,
  requireFinPerm,
  requireFinPermForRoute,
  loginReq,
  ipReq,
};
