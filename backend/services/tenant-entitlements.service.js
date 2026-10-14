// Licença SaaS por tenant:
// 1) SAAS_TENANT_MODULO (override explícito)
// 2) SAAS_CLIENTE_CONTRATANTE + SAAS_PLANO + SAAS_PLANO_MODULO
// 3) CONFIGURACAO.SAAS_MODULOS_JSON (legado / espelho)
// Chaves de licença: **fonte da verdade = SAAS_MODULO** (cadastrado em Operação SaaS → Catálogo).
// Fallback MODULE_KEYS só se a tabela não existir (instalação legada antes do SaaS).

const sql = require('../config/mssql-compat');
const { pool, poolPromise } = require('../config/db');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');

const CHAVE_SAAS_MODULOS = 'SAAS_MODULOS_JSON';

/** Último recurso: tabela SAAS_MODULO ainda não criada. Não é lista “oficial” de produto. */
const MODULE_KEYS = Object.freeze([
  'alertas',
  'ranking',
  'sos',
  'chat',
  'mapa_viagem',
  'convocacoes',
]);

const CACHE_TTL_MS = 60_000;
const cache = new Map();

let moduleKeysCache = { keys: null, exp: 0 };
const MODULE_KEYS_CACHE_TTL_MS = 30_000;

function invalidateModuleKeysCache() {
  moduleKeysCache = { keys: null, exp: 0 };
}

/**
 * Códigos ativos cadastrados em SAAS_MODULO (Operação SaaS).
 * Se a tabela existir e estiver vazia → [] (nada “fixo” misturado).
 * Só usa MODULE_KEYS se a tabela não existir (erro 42P01 / coluna).
 * @returns {Promise<string[]>}
 */
async function getModuleKeys() {
  const now = Date.now();
  if (moduleKeysCache.keys && moduleKeysCache.exp > now) {
    return moduleKeysCache.keys;
  }
  try {
    const pgPool = await poolPromise;
    const r = await pgPool.query(
      `SELECT "CODIGO" FROM "SAAS_MODULO" WHERE "FGACTIVE" = 'S' ORDER BY "ORDEM", "CODIGO"`
    );
    const keys = (r.rows || [])
      .map((row) => String(row.CODIGO ?? row.codigo).trim())
      .filter(Boolean);
    moduleKeysCache = { keys: keys, exp: now + MODULE_KEYS_CACHE_TTL_MS };
    return keys;
  } catch (e) {
    if (e.code !== '42P01' && e.code !== '42703') {
      console.warn('[SAAS_MODULOS] getModuleKeys:', e.message);
    }
    moduleKeysCache = { keys: [...MODULE_KEYS], exp: now + MODULE_KEYS_CACHE_TTL_MS };
    return moduleKeysCache.keys;
  }
}

function buildAllEnabled(keys) {
  const o = {};
  keys.forEach((k) => {
    o[k] = true;
  });
  return o;
}

function mergeWithDefaults(parsed, keys) {
  const base = buildAllEnabled(keys);
  if (!parsed || typeof parsed !== 'object') return base;
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(parsed, k)) {
      base[k] = Boolean(parsed[k]);
    }
  }
  return base;
}

/**
 * @param {import('pg').Pool} pgPool
 * @param {string[]} keys
 * @returns {Promise<Record<string, boolean>|null>}
 */
async function tryLoadRelationalEntitlements(pgPool, tid, keys) {
  try {
    const r1 = await pgPool.query(
      `SELECT "CODIGO_MODULO", "FG_HABILITADO" FROM "SAAS_TENANT_MODULO" WHERE "TENANT_ID" = $1`,
      [tid]
    );
    if (r1.rows && r1.rows.length > 0) {
      const o = {};
      keys.forEach((k) => {
        o[k] = false;
      });
      r1.rows.forEach((row) => {
        const cod = row.CODIGO_MODULO ?? row.codigo_modulo;
        const v = row.FG_HABILITADO ?? row.fg_habilitado;
        if (keys.includes(cod)) o[cod] = v === 'S';
      });
      return mergeWithDefaults(o, keys);
    }

    const r2 = await pgPool.query(
      `SELECT pm."CODIGO_MODULO"
       FROM "SAAS_CLIENTE_CONTRATANTE" c
       INNER JOIN "SAAS_PLANO_MODULO" pm ON pm."CD_PLANO" = c."CD_PLANO"
       INNER JOIN "SAAS_MODULO" m ON m."CODIGO" = pm."CODIGO_MODULO"
       WHERE c."TENANT_ID" = $1 AND c."FGACTIVE" = 'S' AND m."FGACTIVE" = 'S'`,
      [tid]
    );
    if (r2.rows && r2.rows.length > 0) {
      const o = {};
      keys.forEach((k) => {
        o[k] = false;
      });
      r2.rows.forEach((row) => {
        const cod = row.CODIGO_MODULO ?? row.codigo_modulo;
        if (keys.includes(cod)) o[cod] = true;
      });
      return mergeWithDefaults(o, keys);
    }
  } catch (e) {
    if (e.code !== '42P01' && e.code !== '42703') {
      console.warn('[SAAS_MODULOS] Leitura relacional:', e.message);
    }
  }
  return null;
}

async function loadJsonEntitlements(pgPool, tid, keys) {
  const r = await pgPool
    .request()
    .input('tenantId', sql.NVarChar(64), tid)
    .input('chave', sql.NVarChar(100), CHAVE_SAAS_MODULOS)
    .query(
      `SELECT "VALOR" AS v FROM "CONFIGURACAO" WHERE "TENANT_ID" = @tenantId AND "CHAVE" = @chave`
    );
  const row = r.recordset && r.recordset[0];
  const raw = row && (row.v ?? row.V);
  if (raw != null && String(raw).trim() !== '') {
    const parsed = JSON.parse(String(raw));
    return mergeWithDefaults(parsed, keys);
  }
  return buildAllEnabled(keys);
}

/**
 * @param {string} tenantId
 * @returns {Promise<Record<string, boolean>>}
 */
async function getEntitlementsForTenant(tenantId) {
  const tid =
    tenantId != null && String(tenantId).trim() !== ''
      ? String(tenantId).trim()
      : getDefaultTenantId();
  const now = Date.now();
  const hit = cache.get(tid);
  if (hit && hit.exp > now) return hit.data;

  const keys = await getModuleKeys();
  let data = buildAllEnabled(keys);
  try {
    const pgPool = await poolPromise;
    const rel = await tryLoadRelationalEntitlements(pgPool, tid, keys);
    if (rel != null) {
      data = rel;
    } else {
      data = await loadJsonEntitlements(pgPool, tid, keys);
    }
  } catch (e) {
    console.warn('[SAAS_MODULOS] Falha ao ler licença; usando defaults:', e.message);
    data = buildAllEnabled(keys);
  }

  cache.set(tid, { data, exp: now + CACHE_TTL_MS });
  return data;
}

/**
 * @param {string} tenantId
 * @param {string} moduleKey ex.: 'alertas', 'ranking'
 * @returns {Promise<boolean>}
 */
async function isModuleEnabledForTenant(tenantId, moduleKey) {
  const k = String(moduleKey || '').trim();
  if (!k) return true;
  const keys = await getModuleKeys();
  if (!keys.includes(k)) return true;
  const ent = await getEntitlementsForTenant(tenantId);
  return ent[k] !== false;
}

function invalidateTenantEntitlementsCache(tenantId) {
  if (tenantId == null) {
    cache.clear();
    return;
  }
  cache.delete(String(tenantId).trim());
}

const UPSERT_SAAS_MODULOS_SQL = `
  INSERT INTO "CONFIGURACAO" ("TENANT_ID", "CHAVE", "VALOR", "DESCRICAO", "DHMAINTENANCE")
  VALUES (@tenantId, @chave, @valor, @desc, CURRENT_TIMESTAMP)
  ON CONFLICT ("TENANT_ID", "CHAVE") DO UPDATE SET
    "VALOR" = EXCLUDED."VALOR",
    "DESCRICAO" = EXCLUDED."DESCRICAO",
    "DHMAINTENANCE" = CURRENT_TIMESTAMP
`;

async function persistSaasTenantModuloTable(tid, merged, keys) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM "SAAS_TENANT_MODULO" WHERE "TENANT_ID" = $1`, [tid]);
    for (const k of keys) {
      const on = merged[k] !== false;
      await client.query(
        `INSERT INTO "SAAS_TENANT_MODULO" ("TENANT_ID", "CODIGO_MODULO", "FG_HABILITADO") VALUES ($1, $2, $3)`,
        [tid, k, on ? 'S' : 'N']
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (e2) {}
    if (e.code !== '42P01' && e.code !== '42703') {
      console.warn('[SAAS_MODULOS] Persistência SAAS_TENANT_MODULO:', e.message);
    }
  } finally {
    client.release();
  }
}

/**
 * @param {string} tenantId
 * @param {Record<string, boolean>} partial — só chaves enviadas são alteradas
 */
async function saveSaasModulesForTenant(tenantId, partial) {
  const tid =
    tenantId != null && String(tenantId).trim() !== ''
      ? String(tenantId).trim()
      : getDefaultTenantId();
  invalidateTenantEntitlementsCache(tid);
  const keys = await getModuleKeys();
  const current = await getEntitlementsForTenant(tid);
  const merged = { ...current };
  if (partial && typeof partial === 'object') {
    keys.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(partial, k)) {
        merged[k] = Boolean(partial[k]);
      }
    });
  }
  const pgPool = await poolPromise;
  await pgPool
    .request()
    .input('tenantId', sql.NVarChar(64), tid)
    .input('chave', sql.NVarChar(100), CHAVE_SAAS_MODULOS)
    .input('valor', sql.NVarChar(sql.MAX), JSON.stringify(merged))
    .input('desc', sql.NVarChar(500), 'SaaS: espelho legado (API / painel)')
    .query(UPSERT_SAAS_MODULOS_SQL);

  await persistSaasTenantModuloTable(tid, merged, keys);
  invalidateTenantEntitlementsCache(tid);
  return merged;
}

async function defaultEntitlementsSnapshot() {
  return buildAllEnabled(await getModuleKeys());
}

module.exports = {
  CHAVE_SAAS_MODULOS,
  MODULE_KEYS,
  getModuleKeys,
  invalidateModuleKeysCache,
  getEntitlementsForTenant,
  isModuleEnabledForTenant,
  invalidateTenantEntitlementsCache,
  defaultEntitlements: defaultEntitlementsSnapshot,
  saveSaasModulesForTenant,
};
