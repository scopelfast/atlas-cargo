'use strict';

const { pool } = require('../config/db');
const { usuarioTemPrograma } = require('../utils/wms-supervisor-auth');
const {
  FIN_PERMISSOES,
  FIN_PERFIS_BASE,
  mergeEffective,
  canGrantPerms,
  canGrantProfile,
  isFinPermCode,
  decideBootstrapAdmin,
} = require('../constants/financeiro-permissoes');

const PROGRAMA_MODULO = 'atlas-pay';
/** Namespace advisory lock bootstrap P1 (evita duas primeiras atribuições). */
const BOOTSTRAP_LOCK_NS = 81420126;

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function deny(message, code) {
  const e = new Error(message || 'Sem permissão financeira.');
  e.statusCode = 403;
  e.code = code || 'FIN_SEM_PERMISSAO';
  return e;
}

function badRequest(message, code) {
  const e = new Error(message);
  e.statusCode = 400;
  e.code = code || 'FIN_BAD_REQUEST';
  return e;
}

async function tablesReady(client) {
  const q = client || pool;
  try {
    const r = await q.query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'FIN_PERM_CATALOGO' LIMIT 1`
    );
    return r.rowCount > 0;
  } catch (e) {
    if (schemaMissing(e)) return false;
    throw e;
  }
}

async function tenantTemAtribuicoes(tenantId, client) {
  const q = client || pool;
  const tid = String(tenantId || '').trim();
  const r = await q.query(
    `SELECT (
        EXISTS (SELECT 1 FROM "FIN_USUARIO_PERFIL" WHERE "TENANT_ID" = $1 LIMIT 1)
        OR EXISTS (SELECT 1 FROM "FIN_USUARIO_PERMISSAO" WHERE "TENANT_ID" = $1 LIMIT 1)
      ) AS tem`,
    [tid]
  );
  return !!(r.rows[0] && r.rows[0].tem);
}

async function audit(client, row) {
  const q = client || pool;
  await q.query(
    `INSERT INTO "FIN_PERM_AUDIT"
      ("TENANT_ID","SGUSUARIO_ALVO","SGUSUARIO_ATOR","OPERACAO","DETALHE","CODIGO_PERFIL","CODIGO_PERM","IP")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      row.tenantId,
      row.alvo || null,
      row.ator,
      row.operacao,
      row.detalhe || null,
      row.perfil || null,
      row.perm || null,
      row.ip || null,
    ]
  );
}

async function auditSafe(client, row) {
  try {
    await audit(client, row);
  } catch (e) {
    if (!schemaMissing(e)) console.error('[fin-perm audit]', e.message || e);
  }
}

async function assertUsuarioNoTenant(tenantId, login, client) {
  const q = client || pool;
  const tid = String(tenantId || '').trim();
  const lg = String(login || '').trim();
  const r = await q.query(
    `SELECT u."SGUSUARIO", u."FGACTIVE",
            COALESCE(NULLIF(TRIM(u."TENANT_ID"::text), ''), 'default') AS tid
       FROM "USUARIO" u
      WHERE u."SGUSUARIO" = $1
      LIMIT 1`,
    [lg]
  );
  if (!r.rowCount) return { ok: false, reason: 'Usuario inexistente' };
  const u = r.rows[0];
  if (String(u.tid) !== tid) return { ok: false, reason: 'Usuario de outro tenant' };
  if (String(u.FGACTIVE || '').toUpperCase() !== 'S') return { ok: false, reason: 'Usuario inativo' };
  return { ok: true, login: u.SGUSUARIO };
}

async function resolverEfetivas(login, tenantId, opts) {
  const lg = String(login || '').trim();
  const tid = String(tenantId || '').trim();
  const client = (opts && opts.client) || pool;
  const ready = await tablesReady(client);
  const temModulo = await usuarioTemPrograma(lg, tid, PROGRAMA_MODULO);

  if (!ready) {
    return {
      modo: 'LEGADO_SEM_TABELA',
      temModulo,
      efetivas: temModulo ? FIN_PERMISSOES.slice() : [],
      perfis: [],
      overrides: [],
      strict: false,
    };
  }

  const strict = await tenantTemAtribuicoes(tid, client);
  const perfisR = await client.query(
    `SELECT "CODIGO_PERFIL" FROM "FIN_USUARIO_PERFIL"
      WHERE "TENANT_ID" = $1 AND "SGUSUARIO" = $2`,
    [tid, lg]
  );
  const ovR = await client.query(
    `SELECT "CODIGO_PERM" AS codigo, "EFEITO" AS efeito
       FROM "FIN_USUARIO_PERMISSAO"
      WHERE "TENANT_ID" = $1 AND "SGUSUARIO" = $2`,
    [tid, lg]
  );
  const perfis = perfisR.rows.map((x) => x.CODIGO_PERFIL);
  const overrides = ovR.rows;

  let fromProfiles = [];
  if (perfis.length) {
    const pr = await client.query(
      `SELECT DISTINCT "CODIGO_PERM" FROM "FIN_PERFIL_PERMISSAO"
        WHERE "CODIGO_PERFIL" = ANY($1::text[])`,
      [perfis]
    );
    fromProfiles = pr.rows.map((x) => x.CODIGO_PERM);
  }

  let efetivas = mergeEffective(fromProfiles, overrides);

  if (!strict && temModulo && efetivas.length === 0) {
    return {
      modo: 'LEGADO_TRANSICAO',
      temModulo,
      efetivas: FIN_PERMISSOES.slice(),
      perfis,
      overrides,
      strict: false,
    };
  }

  if (!temModulo && efetivas.length === 0) {
    return { modo: 'STRICT', temModulo: false, efetivas: [], perfis, overrides, strict };
  }

  if (temModulo && efetivas.length === 0 && strict) {
    return { modo: 'STRICT_SEM_PERM', temModulo: true, efetivas: [], perfis, overrides, strict: true };
  }

  return {
    modo: strict ? 'STRICT' : 'LEGADO_TRANSICAO',
    temModulo: temModulo || efetivas.length > 0,
    efetivas,
    perfis,
    overrides,
    strict,
  };
}

async function usuarioTemFinPerm(login, tenantId, codes, opts) {
  const need = Array.isArray(codes) ? codes : [codes];
  const r = await resolverEfetivas(login, tenantId, opts);
  if (!r.temModulo && r.efetivas.length === 0) return { ok: false, ...r };
  const set = new Set(r.efetivas);
  const ok = need.some((c) => set.has(c));
  if (!ok && opts && opts.auditNegado) {
    await auditSafe(null, {
      tenantId,
      alvo: login,
      ator: login,
      operacao: 'NEGADO',
      detalhe: 'Faltou: ' + need.join(','),
      perm: need[0],
      ip: opts.ip,
    });
  }
  return { ok, ...r };
}

async function assertFinPerm(login, tenantId, codes, opts) {
  const r = await usuarioTemFinPerm(login, tenantId, codes, {
    ...(opts || {}),
    auditNegado: true,
  });
  if (!r.ok) throw deny('Sem permissão financeira para esta operação.', 'FIN_SEM_PERMISSAO');
  return r;
}

async function listarCatalogo() {
  if (!(await tablesReady())) {
    return FIN_PERMISSOES.map((c) => ({
      CODIGO: c,
      GRUPO: c.split('_')[1] || 'GERAL',
      DESCRICAO: c,
      FGACTIVE: 'S',
    }));
  }
  const r = await pool.query(
    `SELECT "CODIGO","GRUPO","DESCRICAO","FGACTIVE" FROM "FIN_PERM_CATALOGO"
      WHERE "FGACTIVE" = 'S' ORDER BY "GRUPO","CODIGO"`
  );
  return r.rows;
}

async function listarPerfis() {
  if (!(await tablesReady())) {
    return Object.keys(FIN_PERFIS_BASE).map((c) => ({
      CODIGO: c,
      NM_PERFIL: c,
      perms: FIN_PERFIS_BASE[c],
    }));
  }
  const r = await pool.query(
    `SELECT p."CODIGO", p."NM_PERFIL", p."DESCRICAO",
            COALESCE(array_agg(pp."CODIGO_PERM" ORDER BY pp."CODIGO_PERM")
              FILTER (WHERE pp."CODIGO_PERM" IS NOT NULL), '{}') AS perms
       FROM "FIN_PERFIL" p
       LEFT JOIN "FIN_PERFIL_PERMISSAO" pp ON pp."CODIGO_PERFIL" = p."CODIGO"
      WHERE p."FGACTIVE" = 'S'
      GROUP BY p."CODIGO", p."NM_PERFIL", p."DESCRICAO"
      ORDER BY p."CODIGO"`
  );
  return r.rows;
}

async function listarUsuariosTenant(tenantId) {
  const tid = String(tenantId || '').trim();
  const r = await pool.query(
    `SELECT u."SGUSUARIO", u."NMUSUARIO", u."FGACTIVE"
       FROM "USUARIO" u
      WHERE COALESCE(NULLIF(TRIM(u."TENANT_ID"::text), ''), 'default') = $1
      ORDER BY u."SGUSUARIO"`,
    [tid]
  );
  return r.rows;
}

async function resumoUsuario(tenantId, login, client) {
  const r = await resolverEfetivas(login, tenantId, { client });
  return {
    login,
    modo: r.modo,
    strict: !!r.strict,
    perfis: r.perfis,
    overrides: r.overrides,
    efetivas: r.efetivas,
  };
}

/**
 * Bootstrap: 1ª atribuição FINANCEIRO_ADMIN no tenant.
 * Transação + advisory lock; perfil + auditoria atômicos; STRICT imediato após COMMIT.
 */
async function bootstrapFinAdmin(tenantId, ator, alvo, ip) {
  if (!(await tablesReady())) throw deny('Tabelas P1 não instaladas. Execute o script P1.', 'FIN_P1_AUSENTE');

  const tid = String(tenantId || '').trim();
  const a = String(ator || '').trim();
  const b = String(alvo || '').trim();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [BOOTSTRAP_LOCK_NS, tid]);

    const ja = await tenantTemAtribuicoes(tid, client);
    const atorModulo = await usuarioTemPrograma(a, tid, PROGRAMA_MODULO);
    const alvoChk = await assertUsuarioNoTenant(tid, b, client);
    const atorChk = await assertUsuarioNoTenant(tid, a, client);
    if (!atorChk.ok) {
      await client.query('ROLLBACK');
      throw deny('Operador inválido neste tenant.', 'FIN_BOOTSTRAP_ATOR');
    }

    const decision = decideBootstrapAdmin({
      tenantTemAtribuicoes: ja,
      perfil: 'FINANCEIRO_ADMIN',
      ator: a,
      alvo: b,
      actorHasModule: atorModulo,
      alvoNoTenantAtivo: alvoChk.ok,
    });
    if (!decision.ok) {
      await audit(client, {
        tenantId: tid,
        alvo: b,
        ator: a,
        operacao: 'NEGADO',
        detalhe: decision.reason,
        perfil: 'FINANCEIRO_ADMIN',
        ip,
      });
      await client.query('COMMIT'); // só auditoria NEGADO; sem atribuição → permanece LEGADO
      throw deny(decision.reason, decision.code);
    }

    await client.query(
      `INSERT INTO "FIN_USUARIO_PERFIL" ("TENANT_ID","SGUSUARIO","CODIGO_PERFIL","SGUSER_INCLUSAO")
       VALUES ($1,$2,'FINANCEIRO_ADMIN',$3)`,
      [tid, b, a]
    );
    await audit(client, {
      tenantId: tid,
      alvo: b,
      ator: a,
      operacao: 'BOOTSTRAP_ADMIN',
      detalhe: 'Primeira atribuição FINANCEIRO_ADMIN; tenant entra em STRICT',
      perfil: 'FINANCEIRO_ADMIN',
      ip,
    });
    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    if (e && e.code === '23505') {
      throw deny('Bootstrap concorrente: tenant já possui atribuição.', 'FIN_BOOTSTRAP_CONCORRENCIA');
    }
    throw e;
  } finally {
    client.release();
  }

  const depois = await resumoUsuario(tid, b);
  if (!depois.strict && depois.modo !== 'STRICT' && depois.modo !== 'STRICT_SEM_PERM') {
    // Após 1ª atribuição, qualquer resolução no tenant deve ser STRICT
    const chk = await tenantTemAtribuicoes(tid);
    if (!chk) throw deny('Falha interna: STRICT não ativou após bootstrap.', 'FIN_BOOTSTRAP_STRICT');
  }
  return { ...depois, bootstrap: true, modoTenant: 'STRICT' };
}

async function concederPerfil(tenantId, ator, alvo, codigoPerfil, ip, opts) {
  if (!(await tablesReady())) throw deny('Tabelas P1 não instaladas. Execute o script P1.', 'FIN_P1_AUSENTE');

  const tid = String(tenantId || '').trim();
  const perfil = String(codigoPerfil || '').trim();
  const a = String(ator || '').trim();
  const b = String(alvo || '').trim();
  const bootstrapFlag = !!(opts && opts.bootstrap);

  const ja = await tenantTemAtribuicoes(tid);
  if (!ja && bootstrapFlag && perfil === 'FINANCEIRO_ADMIN') {
    return bootstrapFinAdmin(tid, a, b, ip);
  }
  if (!ja && perfil === 'FINANCEIRO_ADMIN') {
    // Atalho seguro: 1ª concessão ADMIN sem flag explícita também usa bootstrap
    return bootstrapFinAdmin(tid, a, b, ip);
  }
  if (!ja) {
    throw deny(
      'Tenant em LEGADO_TRANSICAO: a primeira atribuição deve ser FINANCEIRO_ADMIN (bootstrap).',
      'FIN_BOOTSTRAP_SO_ADMIN'
    );
  }

  const alvoChk = await assertUsuarioNoTenant(tid, b);
  if (!alvoChk.ok) throw deny('Alvo inválido neste tenant.', 'FIN_ALVO_INVALIDO');

  const actor = await resolverEfetivas(a, tid);
  const permsPerfil =
    FIN_PERFIS_BASE[perfil] ||
    (
      await pool.query(`SELECT "CODIGO_PERM" FROM "FIN_PERFIL_PERMISSAO" WHERE "CODIGO_PERFIL" = $1`, [perfil])
    ).rows.map((x) => x.CODIGO_PERM);

  // Autoelevação: conceder a si perfil com perms que não possui
  if (!canGrantProfile(actor.efetivas, perfil, permsPerfil)) {
    await auditSafe(null, {
      tenantId: tid,
      alvo: b,
      ator: a,
      operacao: 'NEGADO',
      detalhe: 'Conceder perfil sem autoridade: ' + perfil,
      perfil,
      ip,
    });
    throw deny('Não é permitido conceder este perfil (privilégio superior ou sem FIN_GERENCIAR_PERMISSOES).');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO "FIN_USUARIO_PERFIL" ("TENANT_ID","SGUSUARIO","CODIGO_PERFIL","SGUSER_INCLUSAO")
       VALUES ($1,$2,$3,$4)
       ON CONFLICT ("TENANT_ID","SGUSUARIO","CODIGO_PERFIL") DO NOTHING`,
      [tid, b, perfil, a]
    );
    await audit(client, {
      tenantId: tid,
      alvo: b,
      ator: a,
      operacao: 'PERFIL_CONCEDER',
      detalhe: 'Perfil ' + perfil,
      perfil,
      ip,
    });
    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
  return resumoUsuario(tid, b);
}

async function revogarPerfil(tenantId, ator, alvo, codigoPerfil, ip) {
  if (!(await tablesReady())) throw deny('Tabelas P1 não instaladas.', 'FIN_P1_AUSENTE');
  const actor = await assertFinPerm(ator, tenantId, 'FIN_GERENCIAR_PERMISSOES', { ip });
  const perfil = String(codigoPerfil || '').trim();
  if (!canGrantProfile(actor.efetivas, perfil, FIN_PERFIS_BASE[perfil] || [])) {
    throw deny('Não é permitido revogar este perfil sem posse equivalente.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM "FIN_USUARIO_PERFIL"
        WHERE "TENANT_ID" = $1 AND "SGUSUARIO" = $2 AND "CODIGO_PERFIL" = $3`,
      [tenantId, alvo, perfil]
    );
    await audit(client, {
      tenantId,
      alvo,
      ator,
      operacao: 'PERFIL_REVOGAR',
      detalhe: 'Perfil ' + perfil,
      perfil,
      ip,
    });
    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
  return resumoUsuario(tenantId, alvo);
}

async function setOverride(tenantId, ator, alvo, codigoPerm, efeito, ip) {
  if (!(await tablesReady())) throw deny('Tabelas P1 não instaladas.', 'FIN_P1_AUSENTE');
  if (!isFinPermCode(codigoPerm)) throw deny('Permissão inválida.', 'FIN_PERM_INVALIDA');
  const e = String(efeito || '').toUpperCase();
  if (e !== 'C' && e !== 'R') throw badRequest('Efeito inválido (C|R).', 'FIN_EFEITO_INVALIDO');
  if (!(await tenantTemAtribuicoes(tenantId))) {
    throw deny('Conclua o bootstrap FINANCEIRO_ADMIN antes de overrides.', 'FIN_BOOTSTRAP_PENDENTE');
  }
  const alvoChk = await assertUsuarioNoTenant(tenantId, alvo);
  if (!alvoChk.ok) throw deny('Alvo inválido neste tenant.', 'FIN_ALVO_INVALIDO');
  const actor = await assertFinPerm(ator, tenantId, 'FIN_GERENCIAR_PERMISSOES', { ip });
  if (e === 'C' && !canGrantPerms(actor.efetivas, [codigoPerm])) {
    await auditSafe(null, {
      tenantId,
      alvo,
      ator,
      operacao: 'NEGADO',
      detalhe: 'Conceder perm superior: ' + codigoPerm,
      perm: codigoPerm,
      ip,
    });
    throw deny('Não é permitido conceder permissão que você não possui.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO "FIN_USUARIO_PERMISSAO"
        ("TENANT_ID","SGUSUARIO","CODIGO_PERM","EFEITO","SGUSER_INCLUSAO")
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT ("TENANT_ID","SGUSUARIO","CODIGO_PERM")
       DO UPDATE SET "EFEITO" = EXCLUDED."EFEITO",
                     "DH_INCLUSAO" = CURRENT_TIMESTAMP,
                     "SGUSER_INCLUSAO" = EXCLUDED."SGUSER_INCLUSAO"`,
      [tenantId, alvo, codigoPerm, e, ator]
    );
    await audit(client, {
      tenantId,
      alvo,
      ator,
      operacao: e === 'C' ? 'PERM_CONCEDER' : 'PERM_REVOGAR',
      detalhe: e + ' ' + codigoPerm,
      perm: codigoPerm,
      ip,
    });
    await client.query('COMMIT');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    throw err;
  } finally {
    client.release();
  }
  return resumoUsuario(tenantId, alvo);
}

async function limparOverride(tenantId, ator, alvo, codigoPerm, ip) {
  if (!(await tablesReady())) throw deny('Tabelas P1 não instaladas.', 'FIN_P1_AUSENTE');
  await assertFinPerm(ator, tenantId, 'FIN_GERENCIAR_PERMISSOES', { ip });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM "FIN_USUARIO_PERMISSAO"
        WHERE "TENANT_ID" = $1 AND "SGUSUARIO" = $2 AND "CODIGO_PERM" = $3`,
      [tenantId, alvo, codigoPerm]
    );
    await audit(client, {
      tenantId,
      alvo,
      ator,
      operacao: 'PERM_REVOGAR',
      detalhe: 'Remover override ' + codigoPerm,
      perm: codigoPerm,
      ip,
    });
    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    throw e;
  } finally {
    client.release();
  }
  return resumoUsuario(tenantId, alvo);
}

async function listarAudit(tenantId, limit) {
  if (!(await tablesReady())) return [];
  const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
  const r = await pool.query(
    `SELECT "ID","TENANT_ID","SGUSUARIO_ALVO","SGUSUARIO_ATOR","OPERACAO","DETALHE",
            "CODIGO_PERFIL","CODIGO_PERM","IP","DH_EVENTO"
       FROM "FIN_PERM_AUDIT"
      WHERE "TENANT_ID" = $1
      ORDER BY "DH_EVENTO" DESC
      LIMIT $2`,
    [tenantId, lim]
  );
  return r.rows;
}

module.exports = {
  PROGRAMA_MODULO,
  BOOTSTRAP_LOCK_NS,
  tablesReady,
  tenantTemAtribuicoes,
  resolverEfetivas,
  usuarioTemFinPerm,
  assertFinPerm,
  assertUsuarioNoTenant,
  listarCatalogo,
  listarPerfis,
  listarUsuariosTenant,
  resumoUsuario,
  bootstrapFinAdmin,
  concederPerfil,
  revogarPerfil,
  setOverride,
  limparOverride,
  listarAudit,
  audit,
  auditSafe,
  deny,
};
