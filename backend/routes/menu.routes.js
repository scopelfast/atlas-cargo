// backend/routes/menu.routes.js - PostgreSQL
// Menu por usuário + módulos de produto (Divulga Cargas / Torre Logística, etc.)
const express = require('express');
const router = express.Router();
const { poolPromise } = require('../config/db');
const { enrichTipoAtividadeRow } = require('../utils/tipo-atividade-grupo');
const { getCodigoLicencaFromRow, passesTenantModuleLicense } = require('../utils/tipo-atividade-licenca');
const { getEntitlementsForTenant } = require('../services/tenant-entitlements.service');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const { getSgUser } = require('../utils/audit');
const { isSaaSAdminLogin } = require('../middleware/saas-admin.middleware');
const { tipoRowVisibleForUserClause } = require('../utils/tipoatividade-catalog-scope.sql.js');

/** Códigos legados / SaaS do mesmo produto “Torre Logística” (um item no combo). */
const CODIGOS_MODULO_TORRE = new Set(['divulga', 'divulga_cargas_torre']);
const NOME_EXIBICAO_TORRE = 'Torre Logística';

function mergeModulosProdutoTorreLista(modulos) {
  if (!Array.isArray(modulos) || modulos.length === 0) return modulos;
  const rest = [];
  const torre = [];
  for (const m of modulos) {
    const c = String(m.codigo || '').trim().toLowerCase();
    if (CODIGOS_MODULO_TORRE.has(c)) torre.push(m);
    else rest.push(m);
  }
  if (torre.length === 0) return modulos;
  const prefer =
    torre.find((t) => String(t.codigo || '').trim().toLowerCase() === 'divulga_cargas_torre') || torre[0];
  const ordem = Math.min(
    ...torre.map((t) => {
      const n = Number(t.ordem);
      return Number.isFinite(n) ? n : 99;
    })
  );
  rest.push({
    cdModulo: prefer.cdModulo,
    codigo: 'divulga_cargas_torre',
    nome: NOME_EXIBICAO_TORRE,
    ordem,
  });
  rest.sort((a, b) => {
    const oa = Number(a.ordem) || 0;
    const ob = Number(b.ordem) || 0;
    if (oa !== ob) return oa - ob;
    return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt', { sensitivity: 'base' });
  });
  return rest;
}

function isProgramaOcultoNoMenu(programa) {
  const p = String(programa || '').trim().toLowerCase();
  if (!p) return false;
  if (p === 'wms-expedicao-liberar-divergencia') return true;
  if (p === 'wms-recebimento-liberar-validade-min') return true;
  if (p === 'wms-separacao-liberar-cobertura-picking') return true;
  if (p.startsWith('perm:')) return true;
  return false;
}

async function resolveMenuTenantId(req, userLogin) {
  if (req.tenantId != null && String(req.tenantId).trim() !== '') {
    return String(req.tenantId).trim();
  }
  try {
    const pool = await poolPromise;
    const r = await pool.query(
      `SELECT "TENANT_ID" FROM "USUARIO" WHERE "SGUSUARIO" = $1 LIMIT 1`,
      [userLogin]
    );
    const row = r.rows?.[0];
    const raw = row?.TENANT_ID ?? row?.tenant_id;
    if (raw != null && String(raw).trim() !== '') return String(raw).trim();
  } catch (e) {
    /* ignore */
  }
  return getDefaultTenantId();
}

/** Módulos de produto que o usuário tem pelo menos uma atividade liberada */
router.get('/modulos', async (req, res) => {
  try {
    const userLogin = req.headers['user-login'];
    if (!userLogin) {
      return res.status(400).json({ error: 'Login do usuário não fornecido.' });
    }
    const pool = await poolPromise;
    let result;
    const defTid = getDefaultTenantId();
    const tipoVisMod = await tipoRowVisibleForUserClause(pool, 't', 'u', '$2');
    try {
      result = await pool.query(
        `SELECT DISTINCT m."CD_MODULO", m."CODIGO",
                COALESCE(NULLIF(TRIM(s."NM_EXIBICAO"), ''), m."NOME") AS "NOME",
                m."ORDEM"
         FROM "MODULO_PRODUTO" m
         LEFT JOIN "SAAS_MODULO" s ON s."CODIGO" = m."CODIGO"
         INNER JOIN "TIPOATIVIDADE" t ON t."CD_MODULO_PRODUTO" = m."CD_MODULO"
         INNER JOIN "USUARIOATIVIDADE" ua ON ua."CDTIPOATIVIDADE" = t."CDTIPOATIVIDADE"
         INNER JOIN "USUARIO" u ON ua."SGUSUARIO" = u."SGUSUARIO"
         WHERE u."SGUSUARIO" = $1
           AND u."FGACTIVE" = 'S'
           AND m."FGACTIVE" = 'S'
           AND t."FGACTIVE" = 'S'
           AND ${tipoVisMod}
         ORDER BY m."ORDEM", "NOME"`,
        [userLogin, defTid]
      );
    } catch (e) {
      if (e.code !== '42P01' && e.code !== '42703') throw e;
      result = await pool.query(
        `SELECT DISTINCT m."CD_MODULO", m."CODIGO", m."NOME", m."ORDEM"
         FROM "MODULO_PRODUTO" m
         INNER JOIN "TIPOATIVIDADE" t ON t."CD_MODULO_PRODUTO" = m."CD_MODULO"
         INNER JOIN "USUARIOATIVIDADE" ua ON ua."CDTIPOATIVIDADE" = t."CDTIPOATIVIDADE"
         INNER JOIN "USUARIO" u ON ua."SGUSUARIO" = u."SGUSUARIO"
         WHERE u."SGUSUARIO" = $1
           AND u."FGACTIVE" = 'S'
           AND m."FGACTIVE" = 'S'
           AND t."FGACTIVE" = 'S'
           AND ${tipoVisMod}
         ORDER BY m."ORDEM", m."NOME"`,
        [userLogin, defTid]
      );
    }
    const rows = result.rows || [];
    const modulos = mergeModulosProdutoTorreLista(
      rows.map((r) => ({
        cdModulo: r.cd_modulo ?? r.CD_MODULO,
        codigo: r.codigo ?? r.CODIGO,
        nome: r.nome ?? r.NOME,
        ordem: r.ordem ?? r.ORDEM,
      }))
    );
    res.json({ modulos });
  } catch (err) {
    if (err.code === '42P01' || err.code === '42703') {
      return res.json({ modulos: [], legado: true });
    }
    console.error('Erro ao listar módulos:', err);
    res.status(500).json({ error: 'Erro ao listar módulos.' });
  }
});

router.get('/user-menu', async (req, res) => {
  try {
    const userLogin = req.headers['user-login'];
    const moduloCodigo = (req.query.modulo || req.headers['x-product-module'] || '').trim() || null;

    if (!userLogin) {
      return res.status(400).json({ error: 'Login do usuário não fornecido.' });
    }

    const pool = await poolPromise;

    const defTidMenu = getDefaultTenantId();
    const tipoVisMenu3 = await tipoRowVisibleForUserClause(pool, 't', 'u', '$3');
    const tipoVisMenu2 = await tipoRowVisibleForUserClause(pool, 't', 'u', '$2');

    const sqlComLicenca = `
        SELECT 
          t."CDTIPOATIVIDADE" AS id,
          t."DSTIPOATIVIDADE" AS nome,
          t."DSPROGRAMA" AS programa,
          COALESCE(TRIM(t."FGGRUPO"), 'OUTROS') AS grupo,
          NULLIF(TRIM(t."CODIGO_MODULO_LICENCA"), '') AS codigo_modulo_licenca,
          m."CODIGO" AS modulo_codigo
        FROM "USUARIOATIVIDADE" ua
        INNER JOIN "USUARIO" u ON ua."SGUSUARIO" = u."SGUSUARIO"
        INNER JOIN "TIPOATIVIDADE" t ON ua."CDTIPOATIVIDADE" = t."CDTIPOATIVIDADE"
        LEFT JOIN "MODULO_PRODUTO" m ON t."CD_MODULO_PRODUTO" = m."CD_MODULO"
        WHERE u."SGUSUARIO" = $1
          AND u."FGACTIVE" = 'S'
          AND t."FGACTIVE" = 'S'
          AND ${tipoVisMenu3}
          AND ($2::text IS NULL OR m."CODIGO" = $2
            OR ($2 IN ('divulga_cargas_torre', 'divulga') AND m."CODIGO" IN ('divulga_cargas_torre', 'divulga')))
        ORDER BY t."DSTIPOATIVIDADE"`;

    const sqlSemLicenca = `
        SELECT 
          t."CDTIPOATIVIDADE" AS id,
          t."DSTIPOATIVIDADE" AS nome,
          t."DSPROGRAMA" AS programa,
          COALESCE(TRIM(t."FGGRUPO"), 'OUTROS') AS grupo,
          m."CODIGO" AS modulo_codigo
        FROM "USUARIOATIVIDADE" ua
        INNER JOIN "USUARIO" u ON ua."SGUSUARIO" = u."SGUSUARIO"
        INNER JOIN "TIPOATIVIDADE" t ON ua."CDTIPOATIVIDADE" = t."CDTIPOATIVIDADE"
        LEFT JOIN "MODULO_PRODUTO" m ON t."CD_MODULO_PRODUTO" = m."CD_MODULO"
        WHERE u."SGUSUARIO" = $1
          AND u."FGACTIVE" = 'S'
          AND t."FGACTIVE" = 'S'
          AND ${tipoVisMenu3}
          AND ($2::text IS NULL OR m."CODIGO" = $2
            OR ($2 IN ('divulga_cargas_torre', 'divulga') AND m."CODIGO" IN ('divulga_cargas_torre', 'divulga')))
        ORDER BY t."DSTIPOATIVIDADE"`;

    const sqlLegado = `
          SELECT 
            t."CDTIPOATIVIDADE" AS id,
            t."DSTIPOATIVIDADE" AS nome,
            t."DSPROGRAMA" AS programa,
            COALESCE(TRIM(t."FGGRUPO"), 'OUTROS') AS grupo
          FROM "USUARIOATIVIDADE" ua
          INNER JOIN "USUARIO" u ON ua."SGUSUARIO" = u."SGUSUARIO"
          INNER JOIN "TIPOATIVIDADE" t ON ua."CDTIPOATIVIDADE" = t."CDTIPOATIVIDADE"
          WHERE u."SGUSUARIO" = $1
            AND u."FGACTIVE" = 'S'
            AND t."FGACTIVE" = 'S'
            AND ${tipoVisMenu2}
          ORDER BY t."DSTIPOATIVIDADE"`;

    let result;
    let temColunaLicenca = true;
    try {
      result = await pool.query(sqlComLicenca, [userLogin, moduloCodigo, defTidMenu]);
    } catch (e) {
      if (e.code === '42P01' || e.code === '42703') {
        temColunaLicenca = false;
        try {
          result = await pool.query(sqlSemLicenca, [userLogin, moduloCodigo, defTidMenu]);
        } catch (e2) {
          if (e2.code === '42P01' || e2.code === '42703') {
            result = await pool.query(sqlLegado, [userLogin, defTidMenu]);
          } else {
            throw e2;
          }
        }
      } else {
        throw e;
      }
    }

    const tenantIdMenu = await resolveMenuTenantId(req, userLogin);
    const actor = getSgUser(req);
    let bypassLicenca = false;
    if (actor) {
      try {
        bypassLicenca = await isSaaSAdminLogin(actor);
      } catch (e) {
        bypassLicenca = false;
      }
    }
    const entitlements = temColunaLicenca && !bypassLicenca ? await getEntitlementsForTenant(tenantIdMenu) : null;

    let menu = (result.rows || []).map((row) => {
      const fg =
        row.grupo && /^\d+$/.test(String(row.grupo).trim())
          ? 'OUTROS'
          : row.grupo || 'OUTROS';
      const enriched = enrichTipoAtividadeRow({
        CDTIPOATIVIDADE: row.id,
        FGGRUPO: fg,
        DSPROGRAMA: row.programa,
        CODIGO_MODULO_LICENCA: row.codigo_modulo_licenca
      });
      return {
        id: row.id,
        nome: row.nome,
        programa: row.programa,
        modulo_codigo: row.modulo_codigo,
        grupo: enriched.GRUPO_CHAVE,
        codigoModuloLicenca: getCodigoLicencaFromRow(row) || null,
        oculto_menu: isProgramaOcultoNoMenu(row.programa)
      };
    });

    if (entitlements) {
      menu = menu.filter((item) =>
        passesTenantModuleLicense(item.codigoModuloLicenca, entitlements)
      );
    }

    res.json({ menu, moduloFiltro: moduloCodigo || null });
  } catch (err) {
    console.error('Erro ao carregar menu:', err);
    res.status(500).json({ error: 'Erro interno ao carregar menu.' });
  }
});

module.exports = router;
