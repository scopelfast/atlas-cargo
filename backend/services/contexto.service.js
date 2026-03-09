// backend/services/contexto.service.js
// Contexto multimoeda/multilíngua: país, locale, moeda, tipo de documento (Fase 0)
// Atlas Cargo - Plano Multimoeda/Multilíngua

const { poolPromise } = require('../config/db');

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

let cacheContexto = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 minuto

/**
 * Retorna o contexto atual (país, locale, moeda, tipo de documento).
 * Lê de CONFIGURACAO quando existir; senão usa defaults (Brasil, pt-BR, BRL, CPF/CNPJ).
 * @returns {Promise<{ pais: string, locale: string, moeda: string, tipoDocFisica: string, tipoDocJuridica: string }>}
 */
async function getContexto() {
  const now = Date.now();
  if (cacheContexto && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cacheContexto;
  }
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('k1', CHAVES.PAIS_PADRAO)
      .input('k2', CHAVES.IDIOMA_PADRAO)
      .input('k3', CHAVES.MOEDA_PADRAO)
      .input('k4', CHAVES.TIPO_DOC_FISICA)
      .input('k5', CHAVES.TIPO_DOC_JURIDICA)
      .input('k6', CHAVES.TIMEZONE)
      .query(`
        SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO"
        WHERE "CHAVE" IN (@k1, @k2, @k3, @k4, @k5, @k6)
      `);
    const rows = result.recordset || [];
    const getVal = (chave) => {
      const r = rows.find(x => (x.CHAVE || x.chave) === chave);
      return (r && (r.VALOR != null ? r.VALOR : r.valor)) ? String(r.VALOR || r.valor).trim() : null;
    };
    cacheContexto = {
      pais: getVal(CHAVES.PAIS_PADRAO) || DEFAULTS.pais,
      locale: getVal(CHAVES.IDIOMA_PADRAO) || DEFAULTS.locale,
      moeda: getVal(CHAVES.MOEDA_PADRAO) || DEFAULTS.moeda,
      tipoDocFisica: getVal(CHAVES.TIPO_DOC_FISICA) || DEFAULTS.tipoDocFisica,
      tipoDocJuridica: getVal(CHAVES.TIPO_DOC_JURIDICA) || DEFAULTS.tipoDocJuridica,
      timezone: getVal(CHAVES.TIMEZONE) || DEFAULTS.timezone
    };
    cacheTimestamp = now;
    return cacheContexto;
  } catch (err) {
    console.error('[contexto.service] Erro ao ler CONFIGURACAO, usando defaults:', err.message);
    cacheContexto = { ...DEFAULTS };
    cacheTimestamp = now;
    return cacheContexto;
  }
}

/**
 * Invalida o cache (útil após alterar configuração).
 */
function invalidateCache() {
  cacheContexto = null;
  cacheTimestamp = 0;
}

module.exports = {
  getContexto,
  invalidateCache,
  CHAVES,
  DEFAULTS
};
