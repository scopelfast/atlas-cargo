// Torre (dashboard): exige JWT válido e repõe req.tenantId após requireAuth.
// Usar em routers de CRUD; fluxos públicos (convocação, webhook) devem usar skip dedicado.

const { requireAuth } = require('./auth.middleware');
const { attachTenantContext } = require('./tenant.middleware');

function torrePodePularAuth(req) {
  const raw = String(req.originalUrl || req.url || req.path || '').split('?')[0].toLowerCase();
  return (req.method === 'GET' || req.method === 'POST') && raw.includes('/oportunidades-publicas/');
}

function towerAuthAndTenant(req, res, next) {
  if (torrePodePularAuth(req)) return next();
  requireAuth(req, res, () => attachTenantContext(req, res, next));
}

module.exports = { towerAuthAndTenant };
