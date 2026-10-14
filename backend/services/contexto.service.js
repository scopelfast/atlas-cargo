// backend/services/contexto.service.js
// Contexto multimoeda/multilíngua: país, locale, moeda, tipo de documento (Fase 0)
// Atlas Cargo - Plano Multimoeda/Multilíngua

const { poolPromise } = require('../config/db');
const sql = require('../config/mssql-compat');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');

const CHAVES = {
  PAIS_PADRAO: 'pais_padrao',
  IDIOMA_PADRAO: 'idioma_padrao',
  MOEDA_PADRAO: 'moeda_padrao',
  TIPO_DOC_FISICA: 'tipo_doc_fisica',
  TIPO_DOC_JURIDICA: 'tipo_doc_juridica',
  TIMEZONE: 'timezone'
};

const DEFAULTS = {
  pais: 'BR',
  locale: 'pt-BR',
  moeda: 'BRL',
  tipoDocFisica: 'CPF',
  tipoDocJuridica: 'CNPJ',
  timezone: 'America/Sao_Paulo'
};

/** @type {Map<string, { data: object, ts: number }>} */
const cacheContextoPorTenant = new Map();
const CACHE_TTL_MS = 60 * 1000; // 1 minuto

function ctxTenantKey(tenantId) {
  if (tenantId != null && String(tenantId).trim() !== '') return String(tenantId).trim();
  return getDefaultTenantId();
}

/**
 * Retorna o contexto atual (país, locale, moeda, tipo de documento).
 * Lê de CONFIGURACAO quando existir; senão usa defaults (Brasil, pt-BR, BRL, CPF/CNPJ).
 * @param {string} [tenantId] — default: DEFAULT_TENANT_ID
 * @returns {Promise<{ pais: string, locale: string, moeda: string, tipoDocFisica: string, tipoDocJuridica: string }>}
 */
async function getContexto(tenantId) {
  const tkey = ctxTenantKey(tenantId);
  const now = Date.now();
  const slot = cacheContextoPorTenant.get(tkey);
  if (slot && slot.data && (now - slot.ts) < CACHE_TTL_MS) {
    return slot.data;
  }
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('tenantId', sql.NVarChar(64), tkey)
      .input('k1', CHAVES.PAIS_PADRAO)
      .input('k2', CHAVES.IDIOMA_PADRAO)
      .input('k3', CHAVES.MOEDA_PADRAO)
      .input('k4', CHAVES.TIPO_DOC_FISICA)
      .input('k5', CHAVES.TIPO_DOC_JURIDICA)
      .input('k6', CHAVES.TIMEZONE)
      .query(`
        SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO"
        WHERE "TENANT_ID" = @tenantId
          AND "CHAVE" IN (@k1, @k2, @k3, @k4, @k5, @k6)
      `);
    const rows = result.recordset || [];
    const getVal = (chave) => {
      const r = rows.find(x => (x.CHAVE || x.chave) === chave);
      return (r && (r.VALOR != null ? r.VALOR : r.valor)) ? String(r.VALOR || r.valor).trim() : null;
    };
    const data = {
      pais: getVal(CHAVES.PAIS_PADRAO) || DEFAULTS.pais,
      locale: getVal(CHAVES.IDIOMA_PADRAO) || DEFAULTS.locale,
      moeda: getVal(CHAVES.MOEDA_PADRAO) || DEFAULTS.moeda,
      tipoDocFisica: getVal(CHAVES.TIPO_DOC_FISICA) || DEFAULTS.tipoDocFisica,
      tipoDocJuridica: getVal(CHAVES.TIPO_DOC_JURIDICA) || DEFAULTS.tipoDocJuridica,
      timezone: getVal(CHAVES.TIMEZONE) || DEFAULTS.timezone
    };
    cacheContextoPorTenant.set(tkey, { data, ts: now });
    return data;
  } catch (err) {
    console.error('[contexto.service] Erro ao ler CONFIGURACAO, usando defaults:', err.message);
    const data = { ...DEFAULTS };
    cacheContextoPorTenant.set(tkey, { data, ts: now });
    return data;
  }
}

/**
 * Invalida o cache (útil após alterar configuração).
 */
function invalidateCache(tenantId) {
  if (tenantId != null && String(tenantId).trim() !== '') {
    cacheContextoPorTenant.delete(ctxTenantKey(tenantId));
  } else {
    cacheContextoPorTenant.clear();
  }
}

module.exports = {
  getContexto,
  invalidateCache,
  CHAVES,
  DEFAULTS
};
