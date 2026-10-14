// Torre (dashboard): exige JWT válido e repõe req.tenantId após requireAuth.
// Usar em routers de CRUD; fluxos públicos (convocação, webhook) devem usar skip dedicado.

const { requireAuth } = require('./auth.middleware');
const { attachTenantContext } = require('./tenant.middleware');

function towerAuthAndTenant(req, res, next) {
  requireAuth(req, res, () => attachTenantContext(req, res, next));
}

module.exports = { towerAuthAndTenant };
