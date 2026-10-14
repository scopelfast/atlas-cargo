// Resolve tenant da requisição (JWT + attachTenantContext) ou DEFAULT_TENANT_ID.
// Usar em queries que filtram por "TENANT_ID".

const { getDefaultTenantId } = require('../middleware/tenant.middleware');

function tenantIdForRequest(req) {
  if (req && req.tenantId != null && String(req.tenantId).trim() !== '') {
    return String(req.tenantId).trim();
  }
  // Motorista (requireMotoristaAuth) e outros fluxos só com req.user — sem attachTenantContext
  if (req && req.user) {
    const t = req.user.tenantId ?? req.user.tenant_id;
    if (t != null && String(t).trim() !== '') return String(t).trim();
  }
  return getDefaultTenantId();
}

module.exports = { tenantIdForRequest };
