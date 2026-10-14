'use strict';

/**
 * @param {unknown} codigoLicenca — coluna CODIGO_MODULO_LICENCA (nullable)
 * @param {Record<string, boolean>} entitlements — resultado de getEntitlementsForTenant
 * @returns {boolean}
 */
function passesTenantModuleLicense(codigoLicenca, entitlements) {
  const c = codigoLicenca != null ? String(codigoLicenca).trim() : '';
  if (!c) return true;
  if (!entitlements || typeof entitlements !== 'object') return true;
  return entitlements[c] !== false;
}

/**
 * @param {object[]} rows
 * @param {Record<string, boolean>} entitlements
 * @param {boolean} bypassLicenca — ex.: operador SaaS admin
 */
function filterRowsByTenantLicense(rows, entitlements, bypassLicenca) {
  if (bypassLicenca || !Array.isArray(rows)) return rows || [];
  return rows.filter((row) =>
    passesTenantModuleLicense(row.CODIGO_MODULO_LICENCA ?? row.codigo_modulo_licenca, entitlements)
  );
}

function getCodigoLicencaFromRow(row) {
  return row.CODIGO_MODULO_LICENCA ?? row.codigo_modulo_licenca ?? row.codigoModuloLicenca ?? null;
}

module.exports = {
  passesTenantModuleLicense,
  filterRowsByTenantLicense,
  getCodigoLicencaFromRow
};
