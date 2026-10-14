// Chave OpenAI: prioridade CONFIGURACAO.openai_api_key, depois OPENAI_API_KEY no .env
const { poolPromise } = require('../config/db');
const sql = require('../config/mssql-compat');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');

const CHAVE_OPENAI_API_KEY = 'openai_api_key';

function maskApiKey(key) {
  const s = String(key || '').trim();
  if (!s) return '';
  if (s.length <= 12) return '••••••••';
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

async function loadOpenAiApiKeyFromDb(tenantId) {
  const tid =
    tenantId != null && String(tenantId).trim() !== '' ? String(tenantId).trim() : getDefaultTenantId();
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('tenantId', sql.NVarChar(64), tid)
      .input('k', CHAVE_OPENAI_API_KEY)
      .query(`SELECT "VALOR" FROM "CONFIGURACAO" WHERE "TENANT_ID" = @tenantId AND "CHAVE" = @k`);
    const row = result.recordset && result.recordset[0];
    const v = row && (row.VALOR != null ? row.VALOR : row.valor);
    return v != null ? String(v).trim() : '';
  } catch (e) {
    return '';
  }
}

/** Chave efetiva para chamadas Whisper (banco primeiro, depois env). */
async function getOpenAiApiKeyForRequest(opts) {
  const tenantId = opts && opts.tenantId;
  const db = await loadOpenAiApiKeyFromDb(tenantId);
  if (db) return db;
  const env = process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim();
  return env || '';
}

module.exports = {
  CHAVE_OPENAI_API_KEY,
  maskApiKey,
  loadOpenAiApiKeyFromDb,
  getOpenAiApiKeyForRequest,
};
