'use strict';

/**
 * Escopo Atlas Pay:
 * - Sessão: tenant do JWT (permissões FIN_* / menu).
 * - Dados: mesmo da sessão, exceto quando sessão = default e header X-Atlas-Pay-Tenant
 *   aponta para outro agente (SAAS_CLIENTE) — operação Atlas sem login tenant a tenant.
 */

const { tenantIdForRequest } = require('./tenant-context');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const { poolPromise } = require('../config/db');

function sessionTenantId(req) {
  return tenantIdForRequest(req);
}

function lerTenantAlvoHeader(req) {
  const h = req && req.headers ? req.headers : {};
  const q = req && req.query ? req.query : {};
  return String(
    h['x-atlas-pay-tenant'] ||
      h['x-fin-tenant-id'] ||
      q.tenantAlvo ||
      q.tenant_id ||
      ''
  ).trim();
}

/**
 * Middleware: define req.finSessionTenantId e req.finDataTenantId.
 * Deve rodar após towerAuthAndTenant + requireAtlasPay (login já validado).
 */
function resolveFinTenantAlvo(req, res, next) {
  (async () => {
    const session = sessionTenantId(req);
    const defaultId = getDefaultTenantId();
    req.finSessionTenantId = session;
    req.finDataTenantId = session;

    const alvo = lerTenantAlvoHeader(req);
    if (!alvo || alvo === session) {
      return next();
    }

    if (String(session).trim() !== String(defaultId).trim()) {
      return res.status(403).json({
        error: 'Somente a instalação padrão (Atlas) pode operar outro agente.',
        code: 'FIN_TENANT_ALVO_NEGADO',
      });
    }

    const pool = await poolPromise;
    let ok = false;
    try {
      const r = await pool.query(
        `SELECT 1 FROM "SAAS_CLIENTE_CONTRATANTE" WHERE TRIM("TENANT_ID") = $1 LIMIT 1`,
        [alvo]
      );
      ok = !!(r.rows && r.rows.length);
    } catch (e) {
      if (e.code !== '42P01') throw e;
    }
    if (!ok) {
      return res.status(404).json({
        error: 'Agente (tenant) não encontrado: ' + alvo,
        code: 'FIN_TENANT_ALVO_INVALIDO',
      });
    }

    req.finDataTenantId = alvo;
    next();
  })().catch((e) => {
    console.error('[atlas-pay tenant-alvo]', e);
    res.status(500).json({ error: 'Erro ao resolver tenant operacional.' });
  });
}

/** Tenant para dados (contratos, cobranças, fechamentos, perms do agente). */
function dataTenantId(req) {
  if (req && req.finDataTenantId != null && String(req.finDataTenantId).trim() !== '') {
    return String(req.finDataTenantId).trim();
  }
  return sessionTenantId(req);
}

async function listarAgentesOperaveis() {
  const pool = await poolPromise;
  const def = getDefaultTenantId();
  try {
    const r = await pool.query(
      `SELECT c."TENANT_ID" AS tenant_id,
              c."NM_CLIENTE" AS nm_cliente,
              c."FGACTIVE" AS fgactive
         FROM "SAAS_CLIENTE_CONTRATANTE" c
        ORDER BY
          CASE WHEN TRIM(c."TENANT_ID") = $1 THEN 0 ELSE 1 END,
          c."NM_CLIENTE" NULLS LAST,
          c."TENANT_ID"`,
      [def]
    );
    return r.rows || [];
  } catch (e) {
    if (e.code === '42P01') return [];
    throw e;
  }
}

module.exports = {
  sessionTenantId,
  dataTenantId,
  resolveFinTenantAlvo,
  listarAgentesOperaveis,
  lerTenantAlvoHeader,
};
