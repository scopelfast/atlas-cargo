// Exige módulo habilitado no contrato do tenant (CONFIGURACAO.SAAS_MODULOS_JSON).
// Usar depois de attachTenantContext / towerAuthAndTenant.

const { tenantIdForRequest } = require('../utils/tenant-context');
const { isModuleEnabledForTenant } = require('../services/tenant-entitlements.service');

/**
 * @param {string} moduleKey — ex.: 'alertas', 'ranking', 'chat', 'sos', 'mapa_viagem'
 */
function requireTenantModule(moduleKey) {
  return (req, res, next) => {
    (async () => {
      try {
        const tid = tenantIdForRequest(req);
        const ok = await isModuleEnabledForTenant(tid, moduleKey);
        if (!ok) {
          return res.status(403).json({
            error: 'Módulo não disponível para este contrato.',
            errorKey: 'saas.moduloNaoDisponivel',
            module: moduleKey,
          });
        }
        next();
      } catch (e) {
        next(e);
      }
    })();
  };
}

module.exports = { requireTenantModule };
