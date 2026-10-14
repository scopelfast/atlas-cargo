'use strict';

const bcrypt = require('bcrypt');
const { pool } = require('../config/db');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const { tipoRowVisibleForUserClause } = require('./tipoatividade-catalog-scope.sql.js');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

async function validarAutorizadorComSenha(login, senha, tenantId) {
  const lg = String(login || '').trim();
  const pw = String(senha || '');
  if (!lg || !pw) {
    return { ok: false, error: 'Informe usuário autorizador e senha.' };
  }
  const r = await pool.query(
    `SELECT "SGUSUARIO", "NMUSUARIO", "SENHA", "FGACTIVE", "TENANT_ID"
       FROM "USUARIO"
      WHERE "SGUSUARIO" = $1
      LIMIT 1`,
    [lg]
  );
  if (!r.rowCount) return { ok: false, error: 'Usuário autorizador não encontrado.' };
  const u = r.rows[0];
  if (String(u.FGACTIVE || '').toUpperCase() !== 'S') {
    return { ok: false, error: 'Usuário autorizador está inativo.' };
  }
  const userTid =
    u.TENANT_ID != null && String(u.TENANT_ID).trim() !== ''
      ? String(u.TENANT_ID).trim()
      : getDefaultTenantId();
  if (String(userTid) !== String(tenantId || getDefaultTenantId())) {
    return { ok: false, error: 'Usuário autorizador não pertence a este tenant.' };
  }
  const senhaBanco = String(u.SENHA || '');
  let senhaValida = false;
  if (
    senhaBanco &&
    (senhaBanco.startsWith('$2a$') || senhaBanco.startsWith('$2b$') || senhaBanco.startsWith('$2y$'))
  ) {
    senhaValida = await bcrypt.compare(pw, senhaBanco);
  } else {
    senhaValida = senhaBanco === pw;
  }
  if (!senhaValida) return { ok: false, error: 'Senha do autorizador inválida.' };
  return {
    ok: true,
    usuario: {
      login: String(u.SGUSUARIO || '').trim(),
      nome: String(u.NMUSUARIO || '').trim(),
    },
  };
}

/**
 * Verifica se o login possui tipo de atividade com DSPROGRAMA igual a dsprograma (tenant-aware quando possível).
 */
async function usuarioTemPrograma(login, tenantId, dsprograma) {
  const prog = String(dsprograma || '').trim();
  if (!login || !prog) return false;
  try {
    const vis = await tipoRowVisibleForUserClause(pool, 't', 'u', '$3');
    const r = await pool.query(
      `SELECT 1
         FROM "USUARIOATIVIDADE" ua
         JOIN "USUARIO" u ON u."SGUSUARIO" = ua."SGUSUARIO"
         JOIN "TIPOATIVIDADE" t ON t."CDTIPOATIVIDADE" = ua."CDTIPOATIVIDADE"
        WHERE u."SGUSUARIO" = $1
          AND t."FGACTIVE" = 'S'
          AND ${vis}
          AND TRIM(COALESCE(t."DSPROGRAMA", '')) = $2
        LIMIT 1`,
      [String(login).trim(), prog, tenantId]
    );
    return r.rowCount > 0;
  } catch (e) {
    if (!schemaMissing(e)) throw e;
    const r2 = await pool.query(
      `SELECT 1
         FROM "USUARIOATIVIDADE" ua
         JOIN "TIPOATIVIDADE" t ON t."CDTIPOATIVIDADE" = ua."CDTIPOATIVIDADE"
        WHERE ua."SGUSUARIO" = $1
          AND t."FGACTIVE" = 'S'
          AND TRIM(COALESCE(t."DSPROGRAMA", '')) = $2
        LIMIT 1`,
      [String(login).trim(), prog]
    );
    return r2.rowCount > 0;
  }
}

module.exports = {
  validarAutorizadorComSenha,
  usuarioTemPrograma,
};
