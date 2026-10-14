'use strict';

const { getDefaultTenantId } = require('../middleware/tenant.middleware');

/** Duração da sessão torre (horas), alinhada ao JWT em auth.controller. Env: TOWER_SESSION_TTL_HOURS */
function getTowerSessionTtlHours() {
  const n = parseFloat(process.env.TOWER_SESSION_TTL_HOURS || '8');
  return Number.isFinite(n) && n > 0 && n <= 168 ? n : 8;
}

function normalizeTenantKey(tenantId) {
  const def = getDefaultTenantId();
  if (tenantId == null || String(tenantId).trim() === '') return def;
  return String(tenantId).trim();
}

/** Uma sessão torre por login (mesmo usuário em dois navegadores). Desligar: TOWER_PERMITIR_MULTIPLAS_SESSOES_MESMO_USUARIO=S */
function permitirMultiplasSessoesMesmoUsuario() {
  const v = String(process.env.TOWER_PERMITIR_MULTIPLAS_SESSOES_MESMO_USUARIO || '').trim().toUpperCase();
  return v === 'S' || v === 'SIM' || v === '1' || v === 'TRUE' || v === 'YES';
}

/**
 * Limite efetivo de logins simultâneos ao painel (torre). NULL = ilimitado.
 * Exige linha em SAAS_CLIENTE_CONTRATANTE ativa; sem linha → ilimitado.
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 * @returns {Promise<number|null>}
 */
async function getEffectiveMaxConcurrentTowerSessions(pool, tenantId) {
  const tid = normalizeTenantKey(tenantId);
  try {
    const r = await pool.query(
      `SELECT c."MAX_SESSOES_SIMULTANEAS_OVR" AS ovr, p."MAX_SESSOES_SIMULTANEAS" AS plan_max
       FROM "SAAS_CLIENTE_CONTRATANTE" c
       INNER JOIN "SAAS_PLANO" p ON p."CD_PLANO" = c."CD_PLANO"
       WHERE c."TENANT_ID" = $1
         AND COALESCE(c."FGACTIVE", 'S') = 'S'
       LIMIT 1`,
      [tid]
    );
    if (!r.rows.length) return null;
    const row = r.rows[0];
    const ovr = row.ovr ?? row.MAX_SESSOES_SIMULTANEAS_OVR;
    const pm = row.plan_max ?? row.MAX_SESSOES_SIMULTANEAS;
    const raw = ovr != null && ovr !== '' ? ovr : pm;
    if (raw == null || raw === '') return null;
    const n = typeof raw === 'number' ? raw : parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < 1) return null;
    return Math.floor(n);
  } catch (e) {
    if (e.code === '42703' || e.code === '42P01') return null;
    throw e;
  }
}

/**
 * Sessões “abertas” para o limite: sem logout registrado e login recente (TTL).
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 * @param {number} [ttlHours]
 */
async function countOpenTowerSessions(pool, tenantId, ttlHours, sgUsuario) {
  const def = getDefaultTenantId();
  const tid = normalizeTenantKey(tenantId);
  const h = ttlHours != null ? ttlHours : getTowerSessionTtlHours();
  const sg = sgUsuario != null && String(sgUsuario).trim() !== '' ? String(sgUsuario).trim() : null;
  if (sg) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS c
       FROM "USUARIOLOGACESSO" l
       WHERE l."DHLOGOUT" IS NULL
         AND l."DHLOGIN" >= CURRENT_TIMESTAMP - ($1::double precision * INTERVAL '1 hour')
         AND COALESCE(NULLIF(TRIM(l."TENANT_ID"), ''), $2) = $3
         AND l."SGUSUARIO" = $4`,
      [h, def, tid, sg]
    );
    return r.rows[0]?.c ?? r.rows[0]?.C ?? 0;
  }
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c
     FROM "USUARIOLOGACESSO" l
     WHERE l."DHLOGOUT" IS NULL
       AND l."DHLOGIN" >= CURRENT_TIMESTAMP - ($1::double precision * INTERVAL '1 hour')
       AND COALESCE(NULLIF(TRIM(l."TENANT_ID"), ''), $2) = $3`,
    [h, def, tid]
  );
  return r.rows[0]?.c ?? r.rows[0]?.C ?? 0;
}

/**
 * Encerra as sessões torre mais antigas (USUARIOLOGACESSO abertas dentro do TTL).
 * @returns {Promise<number>} linhas atualizadas
 */
async function closeOldestOpenTowerSessions(pool, tenantId, ttlHours, howMany, sgUsuario) {
  const n = Math.floor(Number(howMany));
  if (!Number.isFinite(n) || n < 1) return 0;
  const def = getDefaultTenantId();
  const tid = normalizeTenantKey(tenantId);
  const h = ttlHours != null ? ttlHours : getTowerSessionTtlHours();
  const sg = sgUsuario != null && String(sgUsuario).trim() !== '' ? String(sgUsuario).trim() : null;
  if (sg) {
    const r = await pool.query(
      `WITH oldest AS (
         SELECT l."ID"
         FROM "USUARIOLOGACESSO" l
         WHERE l."DHLOGOUT" IS NULL
           AND l."DHLOGIN" >= CURRENT_TIMESTAMP - ($1::double precision * INTERVAL '1 hour')
           AND COALESCE(NULLIF(TRIM(l."TENANT_ID"), ''), $2) = $3
           AND l."SGUSUARIO" = $4
         ORDER BY l."DHLOGIN" ASC
         LIMIT $5
       )
       UPDATE "USUARIOLOGACESSO" u
       SET "DHLOGOUT" = CURRENT_TIMESTAMP,
           "TEMPOSESSAO" = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - u."DHLOGIN")) / 60,
           "DHMAINTENANCE" = CURRENT_TIMESTAMP
       FROM oldest o
       WHERE u."ID" = o."ID"`,
      [h, def, tid, sg, n]
    );
    return r.rowCount ?? 0;
  }
  const r = await pool.query(
    `WITH oldest AS (
       SELECT l."ID"
       FROM "USUARIOLOGACESSO" l
       WHERE l."DHLOGOUT" IS NULL
         AND l."DHLOGIN" >= CURRENT_TIMESTAMP - ($1::double precision * INTERVAL '1 hour')
         AND COALESCE(NULLIF(TRIM(l."TENANT_ID"), ''), $2) = $3
       ORDER BY l."DHLOGIN" ASC
       LIMIT $4
     )
     UPDATE "USUARIOLOGACESSO" u
     SET "DHLOGOUT" = CURRENT_TIMESTAMP,
         "TEMPOSESSAO" = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - u."DHLOGIN")) / 60,
         "DHMAINTENANCE" = CURRENT_TIMESTAMP
     FROM oldest o
     WHERE u."ID" = o."ID"`,
    [h, def, tid, n]
  );
  return r.rowCount ?? 0;
}

/**
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
async function assertTowerConcurrentSessionAllowed(pool, tenantId) {
  const r = await resolveTowerSessionSlotForLogin(pool, tenantId, false, null);
  if (r.ok) return { ok: true };
  return { ok: false, message: r.message };
}

/**
 * Garante vaga para novo login torre: 1) no máx. 1 sessão por SGUSUARIO+tenant (salvo env); 2) limite do plano SaaS no tenant.
 * @param {string|null|undefined} sgUsuario — login (SGUSUARIO) para regra por usuário
 * @returns {Promise<{ ok: true } | { ok: false, code: string, message: string, maxConcurrentSessions?: number, openSessions?: number }>}
 */
async function resolveTowerSessionSlotForLogin(pool, tenantId, kickOldestSession, sgUsuario) {
  const max = await getEffectiveMaxConcurrentTowerSessions(pool, tenantId);
  const ttl = getTowerSessionTtlHours();
  const sg = sgUsuario != null && String(sgUsuario).trim() !== '' ? String(sgUsuario).trim() : '';

  async function snapshot() {
    const ct = await countOpenTowerSessions(pool, tenantId, ttl, null);
    const cu = sg ? await countOpenTowerSessions(pool, tenantId, ttl, sg) : 0;
    return { ct, cu };
  }

  let { ct, cu } = await snapshot();

  const msgMesmoUsuario =
    'Você já está conectado em outro navegador ou aba. Você pode cancelar ou encerrar a sessão mais antiga para abrir aqui.';

  if (!permitirMultiplasSessoesMesmoUsuario() && sg && cu >= 1) {
    if (!kickOldestSession) {
      return {
        ok: false,
        code: 'CONCURRENT_SESSION_LIMIT',
        message: msgMesmoUsuario,
        maxConcurrentSessions: max != null ? max : 1,
        openSessions: ct,
      };
    }
    const closedU = await closeOldestOpenTowerSessions(pool, tenantId, ttl, cu, sg);
    if (process.env.NODE_ENV === 'development') {
      console.log('[SESSAO-TORRE] kick sessões do usuário fechadas=', closedU, 'sg=', sg);
    }
    ({ ct, cu } = await snapshot());
    if (cu >= 1) {
      return {
        ok: false,
        code: 'CONCURRENT_SESSION_KICK_FAILED',
        message: 'Não foi possível encerrar a sessão anterior. Tente novamente em instantes.',
        maxConcurrentSessions: max != null ? max : 1,
        openSessions: ct,
      };
    }
  }

  if (max == null) return { ok: true };

  if (ct < max) return { ok: true };

  const message = `O número máximo de acessos simultâneos ao painel foi atingido (${max}). Você pode cancelar ou encerrar a sessão mais antiga registrada para abrir vaga.`;

  if (!kickOldestSession) {
    return {
      ok: false,
      code: 'CONCURRENT_SESSION_LIMIT',
      message,
      maxConcurrentSessions: max,
      openSessions: ct,
    };
  }

  const toClose = ct - max + 1;
  const closed = await closeOldestOpenTowerSessions(pool, tenantId, ttl, toClose, null);
  if (process.env.NODE_ENV === 'development') {
    console.log('[SESSAO-TORRE] kick tenant: fechadas', closed, 'de', toClose, 'tenant=', tenantId);
  }
  ct = await countOpenTowerSessions(pool, tenantId, ttl, null);
  if (ct >= max) {
    return {
      ok: false,
      code: 'CONCURRENT_SESSION_KICK_FAILED',
      message: 'Não foi possível liberar uma vaga de sessão. Tente novamente em instantes.',
      maxConcurrentSessions: max,
      openSessions: ct,
    };
  }
  return { ok: true };
}

module.exports = {
  getTowerSessionTtlHours,
  getEffectiveMaxConcurrentTowerSessions,
  countOpenTowerSessions,
  closeOldestOpenTowerSessions,
  assertTowerConcurrentSessionAllowed,
  resolveTowerSessionSlotForLogin,
};
