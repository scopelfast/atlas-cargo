// Painel operacional SaaS: catálogo, planos, clientes, overrides por tenant.
const express = require('express');
const router = express.Router();
const { poolPromise } = require('../config/db');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');
const { requireSaaSAdmin, isSaaSAdminLogin } = require('../middleware/saas-admin.middleware');
const {
  getModuleKeys,
  invalidateModuleKeysCache,
  getEntitlementsForTenant,
  saveSaasModulesForTenant,
  invalidateTenantEntitlementsCache,
} = require('../services/tenant-entitlements.service');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const { getTowerSessionTtlHours } = require('../services/tenant-concurrent-sessions.service');

function parseMaxAssentos(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1 || n > 999999) {
    return { error: 'Limite deve ser um inteiro entre 1 e 999999, ou vazio para ilimitado.' };
  }
  return { value: n };
}

router.use(towerAuthAndTenant);

router.get('/whoami', async (req, res, next) => {
  try {
    const login = req.user && (req.user.login ?? req.user.email);
    const saasAdmin = await isSaaSAdminLogin(login);
    res.json({ saasAdmin });
  } catch (e) {
    next(e);
  }
});

/** Catálogo de módulos de licença (SAAS_MODULO) — cadastro aqui. */
router.get('/modulos-catalogo', requireSaaSAdmin, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.query(
      `SELECT m."CODIGO", m."NM_EXIBICAO", m."ORDEM", m."FGACTIVE"
       FROM "SAAS_MODULO" m
       ORDER BY m."ORDEM", m."CODIGO"`
    );
    res.json({ success: true, modulos: result.rows || [] });
  } catch (err) {
    if (err.code === '42P01') {
      return res.json({ success: true, modulos: [], legado: true });
    }
    console.error('[SaaS admin] modulos-catalogo:', err);
    res.status(500).json({ error: 'Erro ao listar catálogo de módulos.' });
  }
});

const CODIGO_MODULO_RE = /^[a-z][a-z0-9_]{0,39}$/i;

router.post('/modulos-catalogo', requireSaaSAdmin, async (req, res) => {
  try {
    const { codigo, nm_exibicao, ordem } = req.body || {};
    const c = codigo != null ? String(codigo).trim() : '';
    const nm = nm_exibicao != null ? String(nm_exibicao).trim() : '';
    if (!CODIGO_MODULO_RE.test(c)) {
      return res.status(400).json({
        error: 'Código inválido. Use apenas letras, números e underscore (ex.: alertas, meu_modulo).',
      });
    }
    if (!nm) {
      return res.status(400).json({ error: 'Nome de exibição é obrigatório.' });
    }
    const ord = ordem != null && ordem !== '' ? parseInt(ordem, 10) : 0;
    const pool = await poolPromise;
    const row = await pool.query(
      `INSERT INTO "SAAS_MODULO" ("CODIGO", "NM_EXIBICAO", "ORDEM", "FGACTIVE")
       VALUES ($1, $2, $3, 'S')
       ON CONFLICT ("CODIGO") DO UPDATE SET
         "NM_EXIBICAO" = EXCLUDED."NM_EXIBICAO",
         "ORDEM" = EXCLUDED."ORDEM",
         "DHMAINTENANCE" = CURRENT_TIMESTAMP
       RETURNING "CODIGO", "NM_EXIBICAO", "ORDEM", "FGACTIVE"`,
      [c, nm, Number.isFinite(ord) ? ord : 0]
    );
    invalidateModuleKeysCache();
    invalidateTenantEntitlementsCache(null);
    res.json({ success: true, modulo: row.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Código já cadastrado.' });
    }
    console.error('[SaaS admin] post modulo:', err);
    res.status(500).json({ error: 'Erro ao cadastrar módulo.' });
  }
});

router.put('/modulos-catalogo/:codigo', requireSaaSAdmin, async (req, res) => {
  try {
    const codigo = req.params.codigo != null ? String(req.params.codigo).trim() : '';
    const { nm_exibicao, ordem, fgactive } = req.body || {};
    if (!codigo) {
      return res.status(400).json({ error: 'Código obrigatório.' });
    }
    const pool = await poolPromise;
    const ex = await pool.query(`SELECT 1 FROM "SAAS_MODULO" WHERE "CODIGO" = $1`, [codigo]);
    if (!ex.rows.length) {
      return res.status(404).json({ error: 'Módulo não encontrado.' });
    }
    const sets = [];
    const vals = [];
    let i = 1;
    if (nm_exibicao != null) {
      sets.push(`"NM_EXIBICAO" = $${i++}`);
      vals.push(String(nm_exibicao).trim());
    }
    if (ordem != null && ordem !== '') {
      const o = parseInt(ordem, 10);
      sets.push(`"ORDEM" = $${i++}`);
      vals.push(Number.isFinite(o) ? o : 0);
    }
    if (fgactive === 'S' || fgactive === 'N') {
      sets.push(`"FGACTIVE" = $${i++}`);
      vals.push(fgactive);
    }
    sets.push(`"DHMAINTENANCE" = CURRENT_TIMESTAMP`);
    vals.push(codigo);
    await pool.query(
      `UPDATE "SAAS_MODULO" SET ${sets.join(', ')} WHERE "CODIGO" = $${i}`,
      vals
    );
    invalidateModuleKeysCache();
    invalidateTenantEntitlementsCache(null);
    const row = await pool.query(
      `SELECT "CODIGO", "NM_EXIBICAO", "ORDEM", "FGACTIVE" FROM "SAAS_MODULO" WHERE "CODIGO" = $1`,
      [codigo]
    );
    res.json({ success: true, modulo: row.rows[0] });
  } catch (err) {
    console.error('[SaaS admin] put modulo:', err);
    res.status(500).json({ error: 'Erro ao atualizar módulo.' });
  }
});

router.delete('/modulos-catalogo/:codigo', requireSaaSAdmin, async (req, res) => {
  const codigo = req.params.codigo != null ? String(req.params.codigo).trim() : '';
  if (!codigo) {
    return res.status(400).json({ error: 'Código obrigatório.' });
  }
  if (!CODIGO_MODULO_RE.test(codigo)) {
    return res.status(400).json({ error: 'Código inválido.' });
  }
  const pool = await poolPromise;
  const client = await pool.connect();

  let savepointSeq = 0;
  /** Passo opcional: não aborta a transação inteira (ex.: coluna/tabela ausente). Nome único — PG não permite redefinir o mesmo SAVEPOINT. */
  async function passoOpcional(label, sql, params) {
    const sp = 'sp_saas_dm_' + ++savepointSeq;
    await client.query(`SAVEPOINT ${sp}`);
    try {
      await client.query(sql, params);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
    } catch (stepErr) {
      try {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      } catch (rbErr) {
        /* ignore */
      }
      try {
        await client.query(`RELEASE SAVEPOINT ${sp}`);
      } catch (relErr) {
        /* ignore */
      }
      if (stepErr.code === '42P01' || stepErr.code === '42703') {
        console.warn(`[SaaS admin] delete modulo — ${label} ignorado:`, stepErr.message);
        return;
      }
      throw stepErr;
    }
  }

  try {
    await client.query('BEGIN');

    // Remove vínculos explícitos (cobre FK sem ON DELETE CASCADE em bases antigas).
    await passoOpcional(
      'SAAS_PLANO_MODULO',
      `DELETE FROM "SAAS_PLANO_MODULO" WHERE "CODIGO_MODULO" = $1`,
      [codigo]
    );
    await passoOpcional(
      'SAAS_TENANT_MODULO',
      `DELETE FROM "SAAS_TENANT_MODULO" WHERE "CODIGO_MODULO" = $1`,
      [codigo]
    );
    await passoOpcional(
      'TIPOATIVIDADE.CODIGO_MODULO_LICENCA',
      `UPDATE "TIPOATIVIDADE" SET "CODIGO_MODULO_LICENCA" = NULL WHERE "CODIGO_MODULO_LICENCA" = $1`,
      [codigo]
    );

    const del = await client.query(`DELETE FROM "SAAS_MODULO" WHERE "CODIGO" = $1 RETURNING "CODIGO"`, [
      codigo,
    ]);
    const removed = del.rowCount != null ? del.rowCount : (del.rows && del.rows.length) || 0;
    if (!removed) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Módulo não encontrado.' });
    }
    await client.query('COMMIT');
    invalidateModuleKeysCache();
    invalidateTenantEntitlementsCache(null);
    res.json({ success: true, codigo });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (e2) {
      /* ignore */
    }
    if (err.code === '23503') {
      const det = err.detail ? String(err.detail) : '';
      return res.status(409).json({
        error:
          'Não foi possível excluir: ainda há referências a este código no banco. Remova ou ajuste o vínculo e tente de novo.' +
          (det ? ` (${det})` : ''),
      });
    }
    if (err.code === '42P01') {
      return res.status(503).json({
        error: 'Tabelas SaaS não encontradas no banco. Rode o script saas_estrutura_plano_cliente_modulo_postgres.sql.',
      });
    }
    console.error('[SaaS admin] delete modulo:', err.code, err.message, err.detail || '');
    res.status(500).json({
      error:
        process.env.NODE_ENV === 'development'
          ? `Erro ao excluir módulo: ${err.message || err}`
          : 'Erro ao excluir módulo. Verifique o log do servidor.',
    });
  } finally {
    client.release();
  }
});

router.get('/planos', requireSaaSAdmin, async (req, res) => {
  try {
    const pool = await poolPromise;
    let result;
    try {
      result = await pool.query(
        `SELECT p."CD_PLANO", p."NM_PLANO", p."DS_PLANO", p."FGACTIVE",
                p."MAX_ASSENTOS_USUARIOS", p."MAX_SESSOES_SIMULTANEAS"
         FROM "SAAS_PLANO" p
         ORDER BY p."CD_PLANO"`
      );
    } catch (e) {
      if (e.code === '42703') {
        try {
          result = await pool.query(
            `SELECT p."CD_PLANO", p."NM_PLANO", p."DS_PLANO", p."FGACTIVE", p."MAX_ASSENTOS_USUARIOS"
             FROM "SAAS_PLANO" p
             ORDER BY p."CD_PLANO"`
          );
        } catch (e2) {
          if (e2.code === '42703') {
            result = await pool.query(
              `SELECT p."CD_PLANO", p."NM_PLANO", p."DS_PLANO", p."FGACTIVE"
               FROM "SAAS_PLANO" p
               ORDER BY p."CD_PLANO"`
            );
          } else throw e2;
        }
      } else throw e;
    }
    res.json({ success: true, planos: result.rows || [] });
  } catch (err) {
    if (err.code === '42P01') {
      return res.json({ success: true, planos: [], legado: true });
    }
    console.error('[SaaS admin] planos:', err);
    res.status(500).json({ error: 'Erro ao listar planos.' });
  }
});

router.post('/planos', requireSaaSAdmin, async (req, res) => {
  try {
    const { nm_plano, ds_plano, max_assentos_usuarios, max_sessoes_simultaneas } = req.body || {};
    const nm = nm_plano != null ? String(nm_plano).trim() : '';
    if (!nm) {
      return res.status(400).json({ error: 'Nome do plano é obrigatório.' });
    }
    const parsedMax = parseMaxAssentos(max_assentos_usuarios);
    if (parsedMax && parsedMax.error) {
      return res.status(400).json({ error: parsedMax.error });
    }
    const maxIns = parsedMax && 'value' in parsedMax ? parsedMax.value : null;
    const parsedSess = parseMaxAssentos(max_sessoes_simultaneas);
    if (parsedSess && parsedSess.error) {
      return res.status(400).json({ error: parsedSess.error });
    }
    const maxSessIns = parsedSess && 'value' in parsedSess ? parsedSess.value : null;
    const pool = await poolPromise;
    const maxR = await pool.query(`SELECT COALESCE(MAX("CD_PLANO"), 0) + 1 AS n FROM "SAAS_PLANO"`);
    const nextId = maxR.rows[0].n ?? maxR.rows[0].N ?? 1;
    try {
      await pool.query(
        `INSERT INTO "SAAS_PLANO" ("CD_PLANO", "NM_PLANO", "DS_PLANO", "FGACTIVE", "MAX_ASSENTOS_USUARIOS", "MAX_SESSOES_SIMULTANEAS")
         VALUES ($1, $2, $3, 'S', $4, $5)`,
        [nextId, nm, ds_plano != null ? String(ds_plano).trim() : null, maxIns, maxSessIns]
      );
    } catch (ie) {
      if (ie.code === '42703') {
        try {
          await pool.query(
            `INSERT INTO "SAAS_PLANO" ("CD_PLANO", "NM_PLANO", "DS_PLANO", "FGACTIVE", "MAX_ASSENTOS_USUARIOS")
             VALUES ($1, $2, $3, 'S', $4)`,
            [nextId, nm, ds_plano != null ? String(ds_plano).trim() : null, maxIns]
          );
        } catch (ie2) {
          if (ie2.code === '42703') {
            await pool.query(
              `INSERT INTO "SAAS_PLANO" ("CD_PLANO", "NM_PLANO", "DS_PLANO", "FGACTIVE")
               VALUES ($1, $2, $3, 'S')`,
              [nextId, nm, ds_plano != null ? String(ds_plano).trim() : null]
            );
          } else throw ie2;
        }
      } else throw ie;
    }
    res.status(201).json({
      success: true,
      plano: {
        CD_PLANO: nextId,
        NM_PLANO: nm,
        DS_PLANO: ds_plano || null,
        FGACTIVE: 'S',
        MAX_ASSENTOS_USUARIOS: maxIns,
        MAX_SESSOES_SIMULTANEAS: maxSessIns,
      },
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Já existe plano com este nome.' });
    }
    console.error('[SaaS admin] post plano:', err);
    res.status(500).json({ error: 'Erro ao criar plano.' });
  }
});

/** Atualiza metadados do plano (nome, descrição, limites de assentos e sessões torre). */
router.put('/planos/:cdPlano', requireSaaSAdmin, async (req, res) => {
  try {
    const cd = parseInt(req.params.cdPlano, 10);
    if (!Number.isFinite(cd)) {
      return res.status(400).json({ error: 'Plano inválido.' });
    }
    const { nm_plano, ds_plano, max_assentos_usuarios, max_sessoes_simultaneas, fgactive } = req.body || {};
    const pool = await poolPromise;
    const ex = await pool.query(`SELECT 1 FROM "SAAS_PLANO" WHERE "CD_PLANO" = $1`, [cd]);
    if (!ex.rows.length) {
      return res.status(404).json({ error: 'Plano não encontrado.' });
    }
    const sets = [];
    const vals = [];
    let i = 1;
    if (nm_plano != null) {
      sets.push(`"NM_PLANO" = $${i++}`);
      vals.push(String(nm_plano).trim());
    }
    if (ds_plano !== undefined) {
      sets.push(`"DS_PLANO" = $${i++}`);
      vals.push(ds_plano != null && String(ds_plano).trim() !== '' ? String(ds_plano).trim() : null);
    }
    if (max_assentos_usuarios !== undefined) {
      const parsedMax = parseMaxAssentos(max_assentos_usuarios);
      if (parsedMax && parsedMax.error) {
        return res.status(400).json({ error: parsedMax.error });
      }
      sets.push(`"MAX_ASSENTOS_USUARIOS" = $${i++}`);
      vals.push(parsedMax && 'value' in parsedMax ? parsedMax.value : null);
    }
    if (max_sessoes_simultaneas !== undefined) {
      const parsedS = parseMaxAssentos(max_sessoes_simultaneas);
      if (parsedS && parsedS.error) {
        return res.status(400).json({ error: parsedS.error });
      }
      sets.push(`"MAX_SESSOES_SIMULTANEAS" = $${i++}`);
      vals.push(parsedS && 'value' in parsedS ? parsedS.value : null);
    }
    if (fgactive === 'S' || fgactive === 'N') {
      sets.push(`"FGACTIVE" = $${i++}`);
      vals.push(fgactive);
    }
    if (!sets.length) {
      return res.status(400).json({ error: 'Nenhum campo para atualizar.' });
    }
    sets.push(`"DHMAINTENANCE" = CURRENT_TIMESTAMP`);
    vals.push(cd);
    try {
      await pool.query(
        `UPDATE "SAAS_PLANO" SET ${sets.join(', ')} WHERE "CD_PLANO" = $${i}`,
        vals
      );
    } catch (ue) {
      if (
        ue.code === '42703' &&
        (max_assentos_usuarios !== undefined || max_sessoes_simultaneas !== undefined)
      ) {
        return res.status(503).json({
          error:
            'Colunas de limite ausentes. Execute backend/scripts/saas_assentos_usuarios_postgres.sql e saas_sessoes_simultaneas_postgres.sql',
        });
      }
      throw ue;
    }
    invalidateTenantEntitlementsCache(null);
    let row;
    try {
      row = await pool.query(
        `SELECT "CD_PLANO", "NM_PLANO", "DS_PLANO", "FGACTIVE", "MAX_ASSENTOS_USUARIOS", "MAX_SESSOES_SIMULTANEAS"
         FROM "SAAS_PLANO" WHERE "CD_PLANO" = $1`,
        [cd]
      );
    } catch (e2) {
      try {
        row = await pool.query(
          `SELECT "CD_PLANO", "NM_PLANO", "DS_PLANO", "FGACTIVE", "MAX_ASSENTOS_USUARIOS"
           FROM "SAAS_PLANO" WHERE "CD_PLANO" = $1`,
          [cd]
        );
      } catch (e3) {
        row = await pool.query(
          `SELECT "CD_PLANO", "NM_PLANO", "DS_PLANO", "FGACTIVE" FROM "SAAS_PLANO" WHERE "CD_PLANO" = $1`,
          [cd]
        );
      }
    }
    res.json({ success: true, plano: row.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Já existe plano com este nome.' });
    }
    console.error('[SaaS admin] put plano:', err);
    res.status(500).json({ error: 'Erro ao atualizar plano.' });
  }
});

router.get('/planos/:cdPlano/modulos', requireSaaSAdmin, async (req, res) => {
  try {
    const cd = parseInt(req.params.cdPlano, 10);
    if (!Number.isFinite(cd)) {
      return res.status(400).json({ error: 'Plano inválido.' });
    }
    const pool = await poolPromise;
    const result = await pool.query(
      `SELECT pm."CODIGO_MODULO", m."NM_EXIBICAO"
       FROM "SAAS_PLANO_MODULO" pm
       INNER JOIN "SAAS_MODULO" m ON m."CODIGO" = pm."CODIGO_MODULO"
       WHERE pm."CD_PLANO" = $1
       ORDER BY m."ORDEM", pm."CODIGO_MODULO"`,
      [cd]
    );
    res.json({ success: true, cdPlano: cd, modulos: result.rows || [] });
  } catch (err) {
    if (err.code === '42P01') {
      return res.json({ success: true, modulos: [], legado: true });
    }
    console.error('[SaaS admin] plano modulos:', err);
    res.status(500).json({ error: 'Erro ao listar módulos do plano.' });
  }
});

router.put('/planos/:cdPlano/modulos', requireSaaSAdmin, async (req, res) => {
  try {
    const cd = parseInt(req.params.cdPlano, 10);
    const codigos = req.body && Array.isArray(req.body.codigos) ? req.body.codigos : null;
    if (!Number.isFinite(cd) || !codigos) {
      return res.status(400).json({ error: 'Envie { "codigos": ["alertas", ...] } com códigos do catálogo.' });
    }
    const pool = await poolPromise;
    const ex = await pool.query(`SELECT 1 FROM "SAAS_PLANO" WHERE "CD_PLANO" = $1`, [cd]);
    if (!ex.rows.length) {
      return res.status(404).json({ error: 'Plano não encontrado.' });
    }
    const clean = [...new Set(codigos.map((c) => String(c || '').trim()).filter(Boolean))];
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM "SAAS_PLANO_MODULO" WHERE "CD_PLANO" = $1`, [cd]);
      for (const cod of clean) {
        const ok = await client.query(`SELECT 1 FROM "SAAS_MODULO" WHERE "CODIGO" = $1 AND "FGACTIVE" = 'S'`, [
          cod,
        ]);
        if (ok.rows.length) {
          await client.query(
            `INSERT INTO "SAAS_PLANO_MODULO" ("CD_PLANO", "CODIGO_MODULO") VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [cd, cod]
          );
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      try {
        await client.query('ROLLBACK');
      } catch (e2) {}
      throw e;
    } finally {
      client.release();
    }
    invalidateTenantEntitlementsCache(null);
    const list = await pool.query(
      `SELECT pm."CODIGO_MODULO" FROM "SAAS_PLANO_MODULO" pm WHERE pm."CD_PLANO" = $1 ORDER BY 1`,
      [cd]
    );
    res.json({ success: true, cdPlano: cd, codigos: (list.rows || []).map((r) => r.CODIGO_MODULO || r.codigo_modulo) });
  } catch (err) {
    console.error('[SaaS admin] put plano modulos:', err);
    res.status(500).json({ error: 'Erro ao salvar módulos do plano.' });
  }
});

/** Remove todos os módulos vinculados ao plano (composição vazia). O plano continua existindo. */
router.delete('/planos/:cdPlano/modulos', requireSaaSAdmin, async (req, res) => {
  try {
    const cd = parseInt(req.params.cdPlano, 10);
    if (!Number.isFinite(cd)) {
      return res.status(400).json({ error: 'Plano inválido.' });
    }
    const pool = await poolPromise;
    const ex = await pool.query(`SELECT 1 FROM "SAAS_PLANO" WHERE "CD_PLANO" = $1`, [cd]);
    if (!ex.rows.length) {
      return res.status(404).json({ error: 'Plano não encontrado.' });
    }
    await pool.query(`DELETE FROM "SAAS_PLANO_MODULO" WHERE "CD_PLANO" = $1`, [cd]);
    invalidateTenantEntitlementsCache(null);
    res.json({ success: true, cdPlano: cd, message: 'Composição do plano removida.' });
  } catch (err) {
    if (err.code === '42P01') {
      return res.status(503).json({ error: 'Tabelas SaaS não encontradas.' });
    }
    console.error('[SaaS admin] delete plano modulos:', err);
    res.status(500).json({ error: 'Erro ao limpar composição do plano.' });
  }
});

router.get('/clientes', requireSaaSAdmin, async (req, res) => {
  try {
    const pool = await poolPromise;
    const defT = getDefaultTenantId();
    const ttlH = getTowerSessionTtlHours();
    let result;
    try {
      result = await pool.query(
        `SELECT c."TENANT_ID", c."NM_CLIENTE", c."CD_PLANO", c."CDEMPRESA", c."FGACTIVE",
                p."NM_PLANO" AS nm_plano,
                c."MAX_ASSENTOS_USUARIOS_OVR" AS max_assentos_usuarios_ovr,
                p."MAX_ASSENTOS_USUARIOS" AS max_assentos_plano,
                c."MAX_SESSOES_SIMULTANEAS_OVR" AS max_sessoes_simultaneas_ovr,
                p."MAX_SESSOES_SIMULTANEAS" AS max_sessoes_plano,
                (
                  SELECT COUNT(*)::int FROM "USUARIO" u
                  WHERE u."FGACTIVE" = 'S'
                    AND COALESCE(NULLIF(TRIM(u."TENANT_ID"), ''), $1) = c."TENANT_ID"
                ) AS qtd_usuarios_ativos,
                (
                  SELECT COUNT(*)::int FROM "USUARIOLOGACESSO" l
                  WHERE l."DHLOGOUT" IS NULL
                    AND l."DHLOGIN" >= CURRENT_TIMESTAMP - ($2::double precision * INTERVAL '1 hour')
                    AND COALESCE(NULLIF(TRIM(l."TENANT_ID"), ''), $1) = c."TENANT_ID"
                ) AS qtd_sessoes_torre_abertas
         FROM "SAAS_CLIENTE_CONTRATANTE" c
         LEFT JOIN "SAAS_PLANO" p ON p."CD_PLANO" = c."CD_PLANO"
         ORDER BY c."NM_CLIENTE"`,
        [defT, ttlH]
      );
    } catch (e) {
      if (e.code === '42703') {
        try {
          result = await pool.query(
            `SELECT c."TENANT_ID", c."NM_CLIENTE", c."CD_PLANO", c."CDEMPRESA", c."FGACTIVE",
                    p."NM_PLANO" AS nm_plano,
                    c."MAX_ASSENTOS_USUARIOS_OVR" AS max_assentos_usuarios_ovr,
                    p."MAX_ASSENTOS_USUARIOS" AS max_assentos_plano,
                    (
                      SELECT COUNT(*)::int FROM "USUARIO" u
                      WHERE u."FGACTIVE" = 'S'
                        AND COALESCE(NULLIF(TRIM(u."TENANT_ID"), ''), $1) = c."TENANT_ID"
                    ) AS qtd_usuarios_ativos
             FROM "SAAS_CLIENTE_CONTRATANTE" c
             LEFT JOIN "SAAS_PLANO" p ON p."CD_PLANO" = c."CD_PLANO"
             ORDER BY c."NM_CLIENTE"`,
            [defT]
          );
        } catch (e2) {
          if (e2.code === '42703') {
            result = await pool.query(
              `SELECT c."TENANT_ID", c."NM_CLIENTE", c."CD_PLANO", c."CDEMPRESA", c."FGACTIVE",
                      p."NM_PLANO" AS nm_plano
               FROM "SAAS_CLIENTE_CONTRATANTE" c
               LEFT JOIN "SAAS_PLANO" p ON p."CD_PLANO" = c."CD_PLANO"
               ORDER BY c."NM_CLIENTE"`
            );
          } else throw e2;
        }
      } else throw e;
    }
    res.json({ success: true, clientes: result.rows || [] });
  } catch (err) {
    if (err.code === '42P01') {
      return res.json({ success: true, clientes: [], legado: true });
    }
    console.error('[SaaS admin] clientes:', err);
    res.status(500).json({ error: 'Erro ao listar clientes contratantes.' });
  }
});

router.post('/clientes', requireSaaSAdmin, async (req, res) => {
  try {
    const {
      tenant_id,
      nm_cliente,
      cd_plano,
      cdempresa,
      max_assentos_usuarios_ovr,
      max_sessoes_simultaneas_ovr,
    } = req.body || {};
    const tid = tenant_id != null ? String(tenant_id).trim() : '';
    const nm = nm_cliente != null ? String(nm_cliente).trim() : '';
    if (!tid || !nm) {
      return res.status(400).json({ error: 'tenant_id e nm_cliente são obrigatórios.' });
    }
    const cp = cd_plano != null && cd_plano !== '' ? parseInt(cd_plano, 10) : 1;
    if (!Number.isFinite(cp)) {
      return res.status(400).json({ error: 'cd_plano inválido.' });
    }
    const pool = await poolPromise;
    const p = await pool.query(`SELECT 1 FROM "SAAS_PLANO" WHERE "CD_PLANO" = $1`, [cp]);
    if (!p.rows.length) {
      return res.status(400).json({ error: 'Plano não existe.' });
    }
    let ce = null;
    if (cdempresa != null && cdempresa !== '') {
      ce = parseInt(cdempresa, 10);
      if (!Number.isFinite(ce)) {
        return res.status(400).json({ error: 'cdempresa inválido.' });
      }
      const e = await pool.query(`SELECT 1 FROM "EMPRESA" WHERE "CDEMPRESA" = $1`, [ce]);
      if (!e.rows.length) {
        return res.status(400).json({ error: 'Empresa não encontrada.' });
      }
    }
    let maxOvr = null;
    if (max_assentos_usuarios_ovr !== undefined && max_assentos_usuarios_ovr !== null && max_assentos_usuarios_ovr !== '') {
      const pm = parseMaxAssentos(max_assentos_usuarios_ovr);
      if (pm && pm.error) return res.status(400).json({ error: pm.error });
      maxOvr = pm.value;
    }
    let maxSessOvr = null;
    if (
      max_sessoes_simultaneas_ovr !== undefined &&
      max_sessoes_simultaneas_ovr !== null &&
      max_sessoes_simultaneas_ovr !== ''
    ) {
      const ps = parseMaxAssentos(max_sessoes_simultaneas_ovr);
      if (ps && ps.error) return res.status(400).json({ error: ps.error });
      maxSessOvr = ps.value;
    }
    try {
      await pool.query(
        `INSERT INTO "SAAS_CLIENTE_CONTRATANTE" ("TENANT_ID", "NM_CLIENTE", "CD_PLANO", "CDEMPRESA", "MAX_ASSENTOS_USUARIOS_OVR", "MAX_SESSOES_SIMULTANEAS_OVR", "FGACTIVE")
         VALUES ($1, $2, $3, $4, $5, $6, 'S')`,
        [tid, nm, cp, ce, maxOvr, maxSessOvr]
      );
    } catch (ie) {
      if (ie.code === '42703') {
        try {
          await pool.query(
            `INSERT INTO "SAAS_CLIENTE_CONTRATANTE" ("TENANT_ID", "NM_CLIENTE", "CD_PLANO", "CDEMPRESA", "MAX_ASSENTOS_USUARIOS_OVR", "FGACTIVE")
             VALUES ($1, $2, $3, $4, $5, 'S')`,
            [tid, nm, cp, ce, maxOvr]
          );
        } catch (ie2) {
          if (ie2.code === '42703') {
            await pool.query(
              `INSERT INTO "SAAS_CLIENTE_CONTRATANTE" ("TENANT_ID", "NM_CLIENTE", "CD_PLANO", "CDEMPRESA", "FGACTIVE")
               VALUES ($1, $2, $3, $4, 'S')`,
              [tid, nm, cp, ce]
            );
          } else if (ie2.code === '23505') {
            return res.status(409).json({ error: 'Já existe cliente para este tenant_id.' });
          } else throw ie2;
        }
      } else if (ie.code === '23505') {
        return res.status(409).json({ error: 'Já existe cliente para este tenant_id.' });
      } else throw ie;
    }
    invalidateTenantEntitlementsCache(tid);
    const row = await pool.query(
      `SELECT c."TENANT_ID", c."NM_CLIENTE", c."CD_PLANO", c."CDEMPRESA", c."FGACTIVE", p."NM_PLANO" AS nm_plano
       FROM "SAAS_CLIENTE_CONTRATANTE" c
       LEFT JOIN "SAAS_PLANO" p ON p."CD_PLANO" = c."CD_PLANO"
       WHERE c."TENANT_ID" = $1`,
      [tid]
    );
    res.status(201).json({ success: true, cliente: row.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Tenant já cadastrado.' });
    }
    console.error('[SaaS admin] post cliente:', err);
    res.status(500).json({ error: 'Erro ao cadastrar cliente.' });
  }
});

router.put('/clientes/:tenantId', requireSaaSAdmin, async (req, res) => {
  try {
    const tenantId = decodeURIComponent(req.params.tenantId || '').trim();
    if (!tenantId) {
      return res.status(400).json({ error: 'tenantId obrigatório.' });
    }
    const {
      nm_cliente,
      cd_plano,
      cdempresa,
      fgactive,
      max_assentos_usuarios_ovr,
      max_sessoes_simultaneas_ovr,
    } = req.body || {};
    const pool = await poolPromise;
    const ex = await pool.query(`SELECT 1 FROM "SAAS_CLIENTE_CONTRATANTE" WHERE "TENANT_ID" = $1`, [tenantId]);
    if (!ex.rows.length) {
      return res.status(404).json({ error: 'Cliente não encontrado. Crie o registro via SQL ou expansão futura.' });
    }
    const sets = [];
    const vals = [];
    let i = 1;
    if (nm_cliente != null) {
      sets.push(`"NM_CLIENTE" = $${i++}`);
      vals.push(String(nm_cliente).trim());
    }
    if (cd_plano != null && cd_plano !== '') {
      const cp = parseInt(cd_plano, 10);
      if (!Number.isFinite(cp)) {
        return res.status(400).json({ error: 'cd_plano inválido.' });
      }
      const p = await pool.query(`SELECT 1 FROM "SAAS_PLANO" WHERE "CD_PLANO" = $1`, [cp]);
      if (!p.rows.length) {
        return res.status(400).json({ error: 'Plano não existe.' });
      }
      sets.push(`"CD_PLANO" = $${i++}`);
      vals.push(cp);
    }
    if (cdempresa !== undefined) {
      if (cdempresa === null || cdempresa === '') {
        sets.push(`"CDEMPRESA" = NULL`);
      } else {
        const ce = parseInt(cdempresa, 10);
        if (!Number.isFinite(ce)) {
          return res.status(400).json({ error: 'cdempresa inválido.' });
        }
        const e = await pool.query(`SELECT 1 FROM "EMPRESA" WHERE "CDEMPRESA" = $1`, [ce]);
        if (!e.rows.length) {
          return res.status(400).json({ error: 'Empresa não encontrada.' });
        }
        sets.push(`"CDEMPRESA" = $${i++}`);
        vals.push(ce);
      }
    }
    if (fgactive === 'S' || fgactive === 'N') {
      sets.push(`"FGACTIVE" = $${i++}`);
      vals.push(fgactive);
    }
    if (max_assentos_usuarios_ovr !== undefined) {
      if (max_assentos_usuarios_ovr === null || max_assentos_usuarios_ovr === '') {
        sets.push(`"MAX_ASSENTOS_USUARIOS_OVR" = NULL`);
      } else {
        const pm = parseMaxAssentos(max_assentos_usuarios_ovr);
        if (pm && pm.error) return res.status(400).json({ error: pm.error });
        sets.push(`"MAX_ASSENTOS_USUARIOS_OVR" = $${i++}`);
        vals.push(pm.value);
      }
    }
    if (max_sessoes_simultaneas_ovr !== undefined) {
      if (max_sessoes_simultaneas_ovr === null || max_sessoes_simultaneas_ovr === '') {
        sets.push(`"MAX_SESSOES_SIMULTANEAS_OVR" = NULL`);
      } else {
        const ps = parseMaxAssentos(max_sessoes_simultaneas_ovr);
        if (ps && ps.error) return res.status(400).json({ error: ps.error });
        sets.push(`"MAX_SESSOES_SIMULTANEAS_OVR" = $${i++}`);
        vals.push(ps.value);
      }
    }
    sets.push(`"DHMAINTENANCE" = CURRENT_TIMESTAMP`);
    vals.push(tenantId);
    try {
      await pool.query(
        `UPDATE "SAAS_CLIENTE_CONTRATANTE" SET ${sets.join(', ')} WHERE "TENANT_ID" = $${i}`,
        vals
      );
    } catch (ue) {
      if (ue.code === '42703' && (max_assentos_usuarios_ovr !== undefined || max_sessoes_simultaneas_ovr !== undefined)) {
        return res.status(503).json({
          error:
            'Colunas de override ausentes. Execute backend/scripts/saas_assentos_usuarios_postgres.sql e saas_sessoes_simultaneas_postgres.sql',
        });
      }
      throw ue;
    }
    invalidateTenantEntitlementsCache(tenantId);
    let row;
    try {
      row = await pool.query(
        `SELECT c."TENANT_ID", c."NM_CLIENTE", c."CD_PLANO", c."CDEMPRESA", c."FGACTIVE",
                c."MAX_ASSENTOS_USUARIOS_OVR" AS max_assentos_usuarios_ovr,
                c."MAX_SESSOES_SIMULTANEAS_OVR" AS max_sessoes_simultaneas_ovr,
                p."NM_PLANO" AS nm_plano, p."MAX_ASSENTOS_USUARIOS" AS max_assentos_plano,
                p."MAX_SESSOES_SIMULTANEAS" AS max_sessoes_plano
         FROM "SAAS_CLIENTE_CONTRATANTE" c
         LEFT JOIN "SAAS_PLANO" p ON p."CD_PLANO" = c."CD_PLANO"
         WHERE c."TENANT_ID" = $1`,
        [tenantId]
      );
    } catch (e2) {
      try {
        row = await pool.query(
          `SELECT c."TENANT_ID", c."NM_CLIENTE", c."CD_PLANO", c."CDEMPRESA", c."FGACTIVE",
                  c."MAX_ASSENTOS_USUARIOS_OVR" AS max_assentos_usuarios_ovr,
                  p."NM_PLANO" AS nm_plano, p."MAX_ASSENTOS_USUARIOS" AS max_assentos_plano
           FROM "SAAS_CLIENTE_CONTRATANTE" c
           LEFT JOIN "SAAS_PLANO" p ON p."CD_PLANO" = c."CD_PLANO"
           WHERE c."TENANT_ID" = $1`,
          [tenantId]
        );
      } catch (e3) {
        row = await pool.query(
          `SELECT c."TENANT_ID", c."NM_CLIENTE", c."CD_PLANO", c."CDEMPRESA", c."FGACTIVE", p."NM_PLANO" AS nm_plano
           FROM "SAAS_CLIENTE_CONTRATANTE" c
           LEFT JOIN "SAAS_PLANO" p ON p."CD_PLANO" = c."CD_PLANO"
           WHERE c."TENANT_ID" = $1`,
          [tenantId]
        );
      }
    }
    res.json({ success: true, cliente: row.rows[0] });
  } catch (err) {
    console.error('[SaaS admin] put cliente:', err);
    res.status(500).json({ error: 'Erro ao atualizar cliente.' });
  }
});

router.delete('/clientes/:tenantId', requireSaaSAdmin, async (req, res) => {
  const tenantId = decodeURIComponent(req.params.tenantId || '').trim();
  if (!tenantId) {
    return res.status(400).json({ error: 'tenantId obrigatório.' });
  }
  if (tenantId === 'default') {
    return res.status(403).json({
      error: 'O tenant "default" não pode ser excluído (base da instalação).',
    });
  }
  const pool = await poolPromise;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const sp = 'sp_saas_del_cli';
    await client.query(`SAVEPOINT ${sp}`);
    try {
      await client.query(`DELETE FROM "SAAS_TENANT_MODULO" WHERE "TENANT_ID" = $1`, [tenantId]);
      await client.query(`RELEASE SAVEPOINT ${sp}`);
    } catch (e1) {
      try {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      } catch (rb) {
        /* ignore */
      }
      try {
        await client.query(`RELEASE SAVEPOINT ${sp}`);
      } catch (rel) {
        /* ignore */
      }
      if (e1.code !== '42P01') throw e1;
    }
    const del = await client.query(
      `DELETE FROM "SAAS_CLIENTE_CONTRATANTE" WHERE "TENANT_ID" = $1 RETURNING "TENANT_ID"`,
      [tenantId]
    );
    const removed = del.rowCount != null ? del.rowCount : (del.rows && del.rows.length) || 0;
    if (!removed) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }
    await client.query('COMMIT');
    invalidateTenantEntitlementsCache(tenantId);
    invalidateTenantEntitlementsCache(null);
    res.json({ success: true, tenant_id: tenantId });
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (e2) {
      /* ignore */
    }
    if (err.code === '23503') {
      return res.status(409).json({
        error: 'Não foi possível excluir: ainda há referências a este tenant no banco.',
      });
    }
    console.error('[SaaS admin] delete cliente:', err);
    res.status(500).json({ error: 'Erro ao excluir cliente.' });
  } finally {
    client.release();
  }
});

router.get('/tenants', requireSaaSAdmin, async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.query(
      `SELECT DISTINCT x.tenant_id
       FROM (
         SELECT COALESCE(NULLIF(TRIM("TENANT_ID"::text), ''), 'default') AS tenant_id FROM "USUARIO"
         UNION
         SELECT COALESCE(NULLIF(TRIM("TENANT_ID"::text), ''), 'default') AS tenant_id FROM "CONFIGURACAO"
       ) x
       ORDER BY 1`
    );
    const tenants = (result.rows || []).map((r) => ({
      tenantId: r.tenant_id ?? r.TENANT_ID,
    }));
    res.json({ success: true, tenants });
  } catch (err) {
    console.error('[SaaS admin] tenants:', err);
    res.status(500).json({ error: 'Erro ao listar tenants.' });
  }
});

router.get('/tenants/:tenantId/modules', requireSaaSAdmin, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const tid = decodeURIComponent(tenantId || '').trim() || 'default';
    const modules = await getEntitlementsForTenant(tid);
    res.json({ success: true, tenantId: tid, modules });
  } catch (err) {
    console.error('[SaaS admin] get modules:', err);
    res.status(500).json({ error: 'Erro ao carregar módulos do tenant.' });
  }
});

router.put('/tenants/:tenantId/modules', requireSaaSAdmin, async (req, res) => {
  try {
    const { tenantId } = req.params;
    const tid = decodeURIComponent(tenantId || '').trim() || 'default';
    const body = req.body && req.body.modules;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Envie { "modules": { "alertas": true, ... } }' });
    }
    const keys = await getModuleKeys();
    const clean = {};
    keys.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        clean[k] = Boolean(body[k]);
      }
    });
    const modules = await saveSaasModulesForTenant(tid, clean);
    res.json({ success: true, tenantId: tid, modules });
  } catch (err) {
    console.error('[SaaS admin] put modules:', err);
    res.status(500).json({ error: 'Erro ao salvar módulos.' });
  }
});

module.exports = router;
