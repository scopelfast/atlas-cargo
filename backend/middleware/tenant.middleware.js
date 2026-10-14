// Fase 1 multi-tenant: expõe req.tenantId para requisições autenticadas sem alterar SQL ainda.
// Ver: docs/PLANO_SAAS_MULTITENANT_SEGURANCA.md

/**
 * Identificador lógico do tenant padrão (instalação single-tenant ou legado).
 * Mesmo valor deve ir no JWT até existir coluna de tenant no usuário/motorista.
 */
function getDefaultTenantId() {
  const v = process.env.DEFAULT_TENANT_ID;
  if (v != null && String(v).trim() !== '') return String(v).trim();
  return 'default';
}

/**
 * Extrai tenant do payload JWT (quando existir).
 */
function tenantIdFromDecoded(decoded) {
  if (!decoded || typeof decoded !== 'object') return null;
  const t = decoded.tenantId ?? decoded.tenant_id;
  if (t == null) return null;
  const s = String(t).trim();
  return s === '' ? null : s;
}

/**
 * Após getUsuarioLogado: se houver req.user, define req.tenantId.
 * Sem usuário autenticado, não define req.tenantId (rotas públicas).
 */
function attachTenantContext(req, res, next) {
  try {
    if (req.user) {
      const fromToken = req.user.tenantId ?? req.user.tenant_id;
      const t =
        fromToken != null && String(fromToken).trim() !== ''
          ? String(fromToken).trim()
          : getDefaultTenantId();
      req.tenantId = t;
      req.user.tenantId = t;
    }
    next();
  } catch (e) {
    next(e);
  }
}

module.exports = {
  getDefaultTenantId,
  tenantIdFromDecoded,
  attachTenantContext,
};
