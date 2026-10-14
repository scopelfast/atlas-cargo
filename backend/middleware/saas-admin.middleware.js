// Acesso ao painel operacional SaaS: mesmo critério do menu — USUARIOATIVIDADE + TIPOATIVIDADE
// com DSPROGRAMA = 'gerenciar-tenants-saas' (cadastrado em Gerenciar Tipos de Atividade e vinculado ao usuário).

const { poolPromise } = require('../config/db');
const { getDefaultTenantId } = require('./tenant.middleware');
const { tipoRowVisibleForUserClause } = require('../utils/tipoatividade-catalog-scope.sql.js');

/** Deve coincidir com o campo DSPROGRAMA do tipo de atividade e com a pasta do módulo em /modulos/. */
const PROGRAMA_SAAS_TENANTS = 'gerenciar-tenants-saas';

/**
 * @param {import('pg').Pool} pool
 * @param {string|null|undefined} login — normalmente o mesmo valor de USUARIO.SGUSUARIO (JWT login)
 */
async function userHasSaasTenantsProgram(pool, login) {
  const l = login != null ? String(login).trim() : '';
  if (!l) return false;
  const defTid = getDefaultTenantId();
  const vis = await tipoRowVisibleForUserClause(pool, 't', 'u', '$3');
  const r = await pool.query(
    `SELECT 1
     FROM "USUARIOATIVIDADE" ua
     INNER JOIN "USUARIO" u ON ua."SGUSUARIO" = u."SGUSUARIO"
     INNER JOIN "TIPOATIVIDADE" t ON ua."CDTIPOATIVIDADE" = t."CDTIPOATIVIDADE"
     WHERE u."SGUSUARIO" = $1
       AND u."FGACTIVE" = 'S'
       AND t."FGACTIVE" = 'S'
       AND ${vis}
       AND TRIM(COALESCE(t."DSPROGRAMA", '')) = $2
     LIMIT 1`,
    [l, PROGRAMA_SAAS_TENANTS, defTid]
  );
  return !!(r.rows && r.rows.length > 0);
}

async function isSaaSAdminLogin(login) {
  const pool = await poolPromise;
  return userHasSaasTenantsProgram(pool, login);
}

async function requireSaaSAdmin(req, res, next) {
  try {
    const login = req.user && (req.user.login ?? req.user.email);
    if (!login) {
      return res.status(401).json({ error: 'Não autenticado.' });
    }
    const pool = await poolPromise;
    const ok = await userHasSaasTenantsProgram(pool, login);
    if (!ok) {
      return res.status(403).json({
        error: 'Sem permissão para o painel de tenants SaaS.',
        errorKey: 'saas.adminNegado',
        hint:
          'Conceda ao usuário o tipo de atividade cujo programa é «gerenciar-tenants-saas» (Gerenciar Tipos de Atividade + vínculo em Usuário).',
      });
    }
    next();
  } catch (err) {
    console.error('[SaaS admin] requireSaaSAdmin:', err);
    res.status(500).json({ error: 'Erro ao verificar permissão.' });
  }
}

module.exports = {
  PROGRAMA_SAAS_TENANTS,
  userHasSaasTenantsProgram,
  isSaaSAdminLogin,
  requireSaaSAdmin,
};
