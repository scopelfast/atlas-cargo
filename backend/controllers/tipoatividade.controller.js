// backend/controllers/tipoatividade.controller.js
// Controller para Gerenciar Tipos de Atividade
// Versão: 1.0
// Atlas Cargo

const { poolPromise, pool } = require('../config/db');
const { getSgUser } = require('../utils/audit');
const { isMissingColumnError } = require('../utils/db-errors');
const { getModuleKeys } = require('../services/tenant-entitlements.service');
const { tenantIdForRequest } = require('../utils/tenant-context');

/** Leitura segura pós-save quando a coluna de licença pode não existir na instalação. */
async function snapshotTipoAtividadeRow(pool, cdVal) {
  try {
    const r = await pool.query(
      `SELECT "CDTIPOATIVIDADE","CODIGO_MODULO_LICENCA","CD_MODULO_PRODUTO" FROM "TIPOATIVIDADE" WHERE "CDTIPOATIVIDADE"=$1`,
      [cdVal]
    );
    return r.rows?.[0] ?? null;
  } catch (e) {
    if (!isMissingColumnError(e)) throw e;
    try {
      const r2 = await pool.query(
        `SELECT "CDTIPOATIVIDADE","CD_MODULO_PRODUTO" FROM "TIPOATIVIDADE" WHERE "CDTIPOATIVIDADE"=$1`,
        [cdVal]
      );
      return r2.rows?.[0] ?? null;
    } catch (e2) {
      if (!isMissingColumnError(e2)) throw e2;
      const r3 = await pool.query(`SELECT "CDTIPOATIVIDADE" FROM "TIPOATIVIDADE" WHERE "CDTIPOATIVIDADE"=$1`, [cdVal]);
      return r3.rows?.[0] ?? null;
    }
  }
}

/** Aceita UPPER_SNAKE do front ou snake_case (proxies / clientes). */
function bodyTipoAtividade(req) {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  return {
    CDTIPOATIVIDADE: b.CDTIPOATIVIDADE ?? b.cdtipoatividade,
    DSTIPOATIVIDADE: b.DSTIPOATIVIDADE ?? b.dstipoatividade,
    DSPROGRAMA: b.DSPROGRAMA ?? b.dsprograma,
    FGACTIVE: b.FGACTIVE ?? b.fgactive,
    FGGRUPO: b.FGGRUPO ?? b.fggrupo,
    CODIGO_MODULO_LICENCA: b.CODIGO_MODULO_LICENCA ?? b.codigo_modulo_licenca,
    CD_MODULO_PRODUTO: b.CD_MODULO_PRODUTO ?? b.cd_modulo_produto,
  };
}

async function normalizeCodigoModuloLicenca(pool, raw) {
  const c = raw != null ? String(raw).trim() : '';
  if (!c) return { ok: null };
  const rowCodigo = (row) => String(row.CODIGO ?? row.codigo ?? '').trim();
  try {
    let r = await pool.query(
      `SELECT "CODIGO" FROM "SAAS_MODULO" WHERE "CODIGO" = $1 AND "FGACTIVE" = 'S'`,
      [c]
    );
    if (r.rows && r.rows.length > 0) return { ok: rowCodigo(r.rows[0]) };

    r = await pool.query(
      `SELECT "CODIGO" FROM "SAAS_MODULO" WHERE LOWER(TRIM("CODIGO")) = LOWER(TRIM($1)) AND "FGACTIVE" = 'S'`,
      [c]
    );
    if (r.rows && r.rows.length > 0) return { ok: rowCodigo(r.rows[0]) };

    r = await pool.query(`SELECT "CODIGO" FROM "SAAS_MODULO" WHERE "CODIGO" = $1`, [c]);
    if (r.rows && r.rows.length > 0) return { ok: rowCodigo(r.rows[0]) };

    r = await pool.query(
      `SELECT "CODIGO" FROM "SAAS_MODULO" WHERE LOWER(TRIM("CODIGO")) = LOWER(TRIM($1))`,
      [c]
    );
    if (r.rows && r.rows.length > 0) return { ok: rowCodigo(r.rows[0]) };

    return { err: 'Código de módulo de licença inválido ou inexistente no catálogo SaaS.' };
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return { ok: c };
    throw e;
  }
}

/** null = sem módulo; número = FK MODULO_PRODUTO.CD_MODULO */
async function normalizeCdModuloProduto(pool, raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: null };
  const n = typeof raw === 'number' ? raw : parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 0) {
    return { err: 'Módulo de produto inválido.' };
  }
  try {
    let r = await pool.query(
      `SELECT "CD_MODULO" FROM "MODULO_PRODUTO" WHERE "CD_MODULO" = $1::smallint AND "FGACTIVE" = 'S'`,
      [n]
    );
    if (!r.rows || r.rows.length === 0) {
      try {
        r = await pool.query(`SELECT "CD_MODULO" FROM "MODULO_PRODUTO" WHERE "CD_MODULO" = $1::smallint`, [n]);
      } catch (e2) {
        if (e2.code === '42P01' || e2.code === '42703') return { ok: null };
        throw e2;
      }
      if (!r.rows || r.rows.length === 0) {
        return { err: 'Módulo de produto não encontrado ou inativo.' };
      }
    }
    return { ok: n };
  } catch (e) {
    if (e.code === '42703') {
      try {
        const r2 = await pool.query(`SELECT "CD_MODULO" FROM "MODULO_PRODUTO" WHERE "CD_MODULO" = $1::smallint`, [
          n,
        ]);
        if (r2.rows && r2.rows.length > 0) return { ok: n };
        return { err: 'Módulo de produto não encontrado ou inativo.' };
      } catch (e3) {
        if (e3.code === '42P01' || e3.code === '42703') return { ok: null };
        throw e3;
      }
    }
    if (e.code === '42P01') return { ok: null };
    throw e;
  }
}

/** Garante uma linha em MODULO_PRODUTO para cada registro em SAAS_MODULO (mesmo CODIGO). */
async function syncModuloProdutoFromSaas(pgPool) {
  try {
    await pgPool.query(`
      WITH missing AS (
        SELECT
          s."CODIGO",
          COALESCE(NULLIF(TRIM(s."NM_EXIBICAO"), ''), s."CODIGO") AS nome,
          COALESCE(s."ORDEM", 99)::smallint AS ordem
        FROM "SAAS_MODULO" s
        WHERE NOT EXISTS (
            SELECT 1 FROM "MODULO_PRODUTO" mp WHERE mp."CODIGO" = s."CODIGO"
          )
      ),
      nums AS (
        SELECT
          m.*,
          ((SELECT COALESCE(MAX(mp."CD_MODULO"), 0) FROM "MODULO_PRODUTO" mp)::int
            + ROW_NUMBER() OVER (ORDER BY m.ordem, m."CODIGO"))::smallint AS cd_novo
        FROM missing m
      )
      INSERT INTO "MODULO_PRODUTO" ("CD_MODULO", "CODIGO", "NOME", "DESCRICAO", "ORDEM", "FGACTIVE")
      SELECT m.cd_novo, m."CODIGO", m.nome, NULL, m.ordem, COALESCE(s2."FGACTIVE", 'S')
      FROM nums m
      INNER JOIN "SAAS_MODULO" s2 ON s2."CODIGO" = m."CODIGO"
    `);
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') return;
    throw e;
  }
}

const catalogoModulosLicenca = async (req, res) => {
  try {
    let produtoPrincipal = null;
    let produtos = [];
    let codigos = [];
    try {
      const pool = await poolPromise;
      await syncModuloProdutoFromSaas(pool);
      try {
        const rc = await pool.query(`SELECT "CODIGO" FROM "SAAS_MODULO" ORDER BY "ORDEM", "CODIGO"`);
        codigos = (rc.rows || [])
          .map((row) => String(row.CODIGO ?? row.codigo).trim())
          .filter(Boolean);
      } catch (e) {
        codigos = await getModuleKeys();
      }
      const r = await pool.query(`
        SELECT
          mp."CD_MODULO",
          mp."CODIGO",
          mp."NOME",
          mp."DESCRICAO",
          mp."FGACTIVE",
          COALESCE(NULLIF(TRIM(s."NM_EXIBICAO"), ''), mp."NOME") AS nome_exibicao
        FROM "MODULO_PRODUTO" mp
        INNER JOIN "SAAS_MODULO" s ON s."CODIGO" = mp."CODIGO"
        ORDER BY s."ORDEM", mp."CODIGO"
      `);
      const rows = r.rows || [];
      produtos = rows.map((row) => {
        const nm =
          row.nome_exibicao ?? row.NOME_EXIBICAO ?? row.NOME ?? row.nome ?? '';
        return {
          cd_modulo: row.CD_MODULO ?? row.cd_modulo,
          codigo: row.CODIGO ?? row.codigo,
          nome: nm,
          descricao: row.DESCRICAO ?? row.descricao,
          fgactive: row.FGACTIVE ?? row.fgactive,
        };
      });
      produtoPrincipal = produtos.length ? produtos[0] : null;
    } catch (e) {
      /* MODULO_PRODUTO ausente em instalações antigas */
      try {
        codigos = await getModuleKeys();
      } catch (_) {
        codigos = [];
      }
    }
    res.json({ codigos, produtoPrincipal, produtos });
  } catch (err) {
    console.error('Erro catálogo módulos licença:', err);
    res.status(500).json({ error: 'Erro ao carregar catálogo de módulos.' });
  }
};

// Listar tipos de atividade com filtros (SQL nativo PostgreSQL — evita bugs do conversor @ → $)
const listar = async (req, res) => {
  try {
    const tid = tenantIdForRequest(req);
    const { codigo, descricao, situacao } = req.query;
    const params = [tid];
    let extraWhere = ' AND t."TENANT_ID" = $1';
    if (codigo) {
      const n = parseInt(codigo, 10);
      if (Number.isFinite(n)) {
        params.push(n);
        extraWhere += ` AND t."CDTIPOATIVIDADE" = $${params.length}`;
      }
    }
    if (descricao) {
      params.push(`%${String(descricao)}%`);
      extraWhere += ` AND t."DSTIPOATIVIDADE" LIKE $${params.length}`;
    }
    if (situacao) {
      params.push(situacao);
      extraWhere += ` AND t."FGACTIVE" = $${params.length}`;
    }
    const orderBy = ' ORDER BY t."CDTIPOATIVIDADE" ASC';

    /* Não referenciar CODIGO_MODULO_LICENCA no SELECT: em instalações sem essa coluna o join quebrava e caía no legado sem CD_MODULO_PRODUTO. */
    const sqlJoin = `
      SELECT 
        t."CDTIPOATIVIDADE",
        t."DSTIPOATIVIDADE",
        t."DSPROGRAMA",
        t."FGACTIVE",
        COALESCE(t."FGGRUPO", 'OUTROS') AS "FGGRUPO",
        t."CD_MODULO_PRODUTO",
        COALESCE(NULLIF(TRIM(s."NM_EXIBICAO"), ''), m."NOME") AS "NM_MODULO_PRODUTO",
        m."CODIGO" AS "CODIGO_CATALOGO_MODULO",
        t."DHMAINTENANCE",
        t."SGUSER",
        t."SERVERORIG"
      FROM "TIPOATIVIDADE" t
      LEFT JOIN "MODULO_PRODUTO" m ON m."CD_MODULO" = t."CD_MODULO_PRODUTO"
      LEFT JOIN "SAAS_MODULO" s ON s."CODIGO" = m."CODIGO"
      WHERE 1=1 ${extraWhere}
      ${orderBy}
    `;
    const sqlMid = `
      SELECT 
        t."CDTIPOATIVIDADE",
        t."DSTIPOATIVIDADE",
        t."DSPROGRAMA",
        t."FGACTIVE",
        COALESCE(t."FGGRUPO", 'OUTROS') AS "FGGRUPO",
        t."CD_MODULO_PRODUTO",
        t."DHMAINTENANCE",
        t."SGUSER",
        t."SERVERORIG"
      FROM "TIPOATIVIDADE" t
      WHERE 1=1 ${extraWhere}
      ${orderBy}
    `;
    const sqlLegado = `
      SELECT 
        t."CDTIPOATIVIDADE",
        t."DSTIPOATIVIDADE",
        t."DSPROGRAMA",
        t."FGACTIVE",
        COALESCE(t."FGGRUPO", 'OUTROS') AS "FGGRUPO",
        t."DHMAINTENANCE",
        t."SGUSER",
        t."SERVERORIG"
      FROM "TIPOATIVIDADE" t
      WHERE 1=1 ${extraWhere}
      ${orderBy}
    `;

    let rows;
    try {
      const r = await pool.query(sqlJoin, params);
      rows = r.rows || [];
    } catch (qErr) {
      if (!isMissingColumnError(qErr)) throw qErr;
      try {
        const r2 = await pool.query(sqlMid, params);
        rows = r2.rows || [];
      } catch (qErr2) {
        if (!isMissingColumnError(qErr2)) throw qErr2;
        const r3 = await pool.query(sqlLegado, params);
        rows = r3.rows || [];
      }
    }
    let modByCd = new Map();
    const fillModByCd = (mr) => {
      for (const x of mr.rows || []) {
        const cd = x.CD_MODULO ?? x.cd_modulo;
        if (cd == null || cd === '') continue;
        modByCd.set(Number(cd), {
          nome: x.NOME ?? x.nome,
          codigo: x.CODIGO ?? x.codigo,
        });
      }
    };
    try {
      const mr = await pool.query(
        `SELECT "CD_MODULO", "NOME", "CODIGO" FROM "MODULO_PRODUTO" WHERE "FGACTIVE" = 'S'`
      );
      fillModByCd(mr);
    } catch (e) {
      if (e.code === '42703' || e.code === '42P01') {
        try {
          fillModByCd(await pool.query(`SELECT "CD_MODULO", "NOME", "CODIGO" FROM "MODULO_PRODUTO"`));
        } catch (_) {
          /* ignora */
        }
      }
    }

    const out = rows.map((r) => {
      const cdP = r.CD_MODULO_PRODUTO ?? r.cd_modulo_produto;
      const nome =
        r.nm_modulo_produto ??
        r.NM_MODULO_PRODUTO ??
        r.nm_modulo ??
        null;
      const codRef =
        r.codigo_catalogo_modulo ??
        r.CODIGO_CATALOGO_MODULO ??
        null;
      let nm =
        (nome != null && String(nome).trim() !== '' ? String(nome).trim() : null) ||
        (codRef != null && String(codRef).trim() !== '' ? String(codRef).trim() : null);
      if ((!nm || nm === '') && cdP != null && cdP !== '' && modByCd.size > 0) {
        const inf = modByCd.get(Number(cdP));
        if (inf) {
          const n = inf.nome != null ? String(inf.nome).trim() : '';
          const co = inf.codigo != null ? String(inf.codigo).trim() : '';
          nm = n || co || nm;
        }
      }
      const cdt = r.CDTIPOATIVIDADE ?? r.cdtipoatividade;
      return {
        ...r,
        CDTIPOATIVIDADE: cdt,
        DSTIPOATIVIDADE: r.DSTIPOATIVIDADE ?? r.dstipoatividade,
        DSPROGRAMA: r.DSPROGRAMA ?? r.dsprograma,
        FGACTIVE: r.FGACTIVE ?? r.fgactive,
        FGGRUPO: r.FGGRUPO ?? r.fggrupo,
        CODIGO_MODULO_LICENCA: r.CODIGO_MODULO_LICENCA ?? r.codigo_modulo_licenca ?? null,
        CD_MODULO_PRODUTO: r.CD_MODULO_PRODUTO ?? r.cd_modulo_produto ?? null,
        CODIGO_CATALOGO_MODULO: r.CODIGO_CATALOGO_MODULO ?? r.codigo_catalogo_modulo ?? null,
        nm_modulo_produto: nm,
        NM_MODULO_PRODUTO: nm,
      };
    });
    res.json(out);
  } catch (err) {
    console.error('Erro ao listar tipos de atividade:', err);
    res.status(500).json({ 
      error: 'Erro ao carregar tipos de atividade.',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

/** Normaliza chaves do pg (maiúsculas/minúsculas) para o front sempre preencher os selects. */
function rowTipoAtividadeParaApi(row) {
  if (!row || typeof row !== 'object') return row;
  const r = row;
  const nm =
    r.NM_SAAS_OU_MODULO ??
    r.nm_saas_ou_modulo ??
    r.NM_MODULO_PRODUTO_DET ??
    r.nm_modulo_produto_det ??
    r.NM_MODULO_PRODUTO ??
    r.nm_modulo_produto ??
    null;
  return {
    ...r,
    CDTIPOATIVIDADE: r.CDTIPOATIVIDADE ?? r.cdtipoatividade,
    DSTIPOATIVIDADE: r.DSTIPOATIVIDADE ?? r.dstipoatividade,
    DSPROGRAMA: r.DSPROGRAMA ?? r.dsprograma,
    FGACTIVE: r.FGACTIVE ?? r.fgactive,
    FGGRUPO: r.FGGRUPO ?? r.fggrupo,
    CODIGO_MODULO_LICENCA: r.CODIGO_MODULO_LICENCA ?? r.codigo_modulo_licenca ?? null,
    CD_MODULO_PRODUTO: r.CD_MODULO_PRODUTO ?? r.cd_modulo_produto ?? null,
    NM_MODULO_PRODUTO: nm,
    nm_modulo_produto: nm,
  };
}

// Buscar tipo de atividade por código
const buscarPorCodigo = async (req, res) => {
  try {
    const tid = tenantIdForRequest(req);
    const { codigo } = req.params;
    const cdVal = parseInt(codigo, 10);
    if (!Number.isFinite(cdVal)) {
      return res.status(400).json({ error: 'Código inválido.' });
    }

    const base = await pool.query(
      'SELECT * FROM "TIPOATIVIDADE" WHERE "CDTIPOATIVIDADE" = $1 AND "TENANT_ID" = $2',
      [cdVal, tid]
    );
    if (!base.rows || base.rows.length === 0) {
      return res.status(404).json({ error: 'Tipo de atividade não encontrado.' });
    }

    let extras = {};
    try {
      const enr = await pool.query(
        `SELECT
           m."NOME" AS "NM_MODULO_PRODUTO_DET",
           m."CODIGO" AS "CODIGO_CATALOGO_MODULO",
           COALESCE(NULLIF(TRIM(s."NM_EXIBICAO"), ''), m."NOME") AS "NM_SAAS_OU_MODULO"
         FROM "TIPOATIVIDADE" t
         LEFT JOIN "MODULO_PRODUTO" m ON m."CD_MODULO" = t."CD_MODULO_PRODUTO"
         LEFT JOIN "SAAS_MODULO" s ON s."CODIGO" = m."CODIGO"
         WHERE t."CDTIPOATIVIDADE" = $1 AND t."TENANT_ID" = $2`,
        [cdVal, tid]
      );
      if (enr.rows && enr.rows[0]) extras = enr.rows[0];
    } catch (e) {
      if (!isMissingColumnError(e)) throw e;
    }

    const merged = { ...base.rows[0], ...extras };
    res.json(rowTipoAtividadeParaApi(merged));
  } catch (err) {
    console.error('Erro ao buscar tipo de atividade:', err);
    res.status(500).json({ error: 'Erro ao buscar tipo de atividade.' });
  }
};

// Criar tipo de atividade
const criar = async (req, res) => {
  try {
    const body = bodyTipoAtividade(req);
    console.log('[TIPOATIVIDADE] POST entrada', body);
    const {
      CDTIPOATIVIDADE,
      DSTIPOATIVIDADE,
      DSPROGRAMA,
      FGACTIVE,
      FGGRUPO,
      CODIGO_MODULO_LICENCA,
      CD_MODULO_PRODUTO,
    } = body;

    if (!CDTIPOATIVIDADE || !DSTIPOATIVIDADE) {
      return res.status(400).json({ error: 'Código e descrição são obrigatórios.' });
    }

    const sgUser = getSgUser(req);
    if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

    const tid = tenantIdForRequest(req);

    const licNorm = await normalizeCodigoModuloLicenca(pool, CODIGO_MODULO_LICENCA);
    if (licNorm.err) return res.status(400).json({ error: licNorm.err });
    const modNorm = await normalizeCdModuloProduto(pool, CD_MODULO_PRODUTO);
    if (modNorm.err) return res.status(400).json({ error: modNorm.err });

    const cdVal = parseInt(CDTIPOATIVIDADE, 10);
    if (!Number.isFinite(cdVal)) {
      return res.status(400).json({ error: 'Código inválido.' });
    }

    const dup = await pool.query(
      `SELECT 1 FROM "TIPOATIVIDADE" WHERE "CDTIPOATIVIDADE" = $1 AND "TENANT_ID" = $2`,
      [cdVal, tid]
    );
    if (dup.rows && dup.rows.length > 0) {
      return res.status(400).json({ error: 'Código já existe neste tenant.' });
    }

    const licVal = licNorm.ok != null ? licNorm.ok : null;
    const modVal = modNorm.ok != null ? modNorm.ok : null;

    try {
      await pool.query(
        `INSERT INTO "TIPOATIVIDADE" (
          "CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGACTIVE", "FGGRUPO",
          "CODIGO_MODULO_LICENCA", "CD_MODULO_PRODUTO",
          "DHMAINTENANCE", "SGUSER", "SERVERORIG", "TENANT_ID"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::smallint, CURRENT_TIMESTAMP, $8, $9, $10)`,
        [
          cdVal,
          DSTIPOATIVIDADE,
          DSPROGRAMA ?? null,
          FGACTIVE || 'S',
          FGGRUPO ?? null,
          licVal,
          modVal,
          sgUser,
          'AppDVcargas',
          tid,
        ]
      );
    } catch (insErr) {
      if (!isMissingColumnError(insErr)) throw insErr;
      try {
        await pool.query(
          `INSERT INTO "TIPOATIVIDADE" (
            "CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGACTIVE", "FGGRUPO",
            "CD_MODULO_PRODUTO",
            "DHMAINTENANCE", "SGUSER", "SERVERORIG", "TENANT_ID"
          ) VALUES ($1, $2, $3, $4, $5, $6::smallint, CURRENT_TIMESTAMP, $7, $8, $9)`,
          [
            cdVal,
            DSTIPOATIVIDADE,
            DSPROGRAMA ?? null,
            FGACTIVE || 'S',
            FGGRUPO ?? null,
            modVal,
            sgUser,
            'AppDVcargas',
            tid,
          ]
        );
      } catch (ins2) {
        if (!isMissingColumnError(ins2)) throw ins2;
        try {
          await pool.query(
            `INSERT INTO "TIPOATIVIDADE" (
              "CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGACTIVE", "FGGRUPO",
              "CODIGO_MODULO_LICENCA",
              "DHMAINTENANCE", "SGUSER", "SERVERORIG", "TENANT_ID"
            ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, $7, $8, $9)`,
            [
              cdVal,
              DSTIPOATIVIDADE,
              DSPROGRAMA ?? null,
              FGACTIVE || 'S',
              FGGRUPO ?? null,
              licVal,
              sgUser,
              'AppDVcargas',
              tid,
            ]
          );
        } catch (ins3) {
          if (!isMissingColumnError(ins3)) throw ins3;
          await pool.query(
            `INSERT INTO "TIPOATIVIDADE" (
              "CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGACTIVE", "FGGRUPO",
              "DHMAINTENANCE", "SGUSER", "SERVERORIG", "TENANT_ID"
            ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, $7, $8)`,
            [cdVal, DSTIPOATIVIDADE, DSPROGRAMA ?? null, FGACTIVE || 'S', FGGRUPO ?? null, sgUser, 'AppDVcargas', tid]
          );
        }
      }
    }

    try {
      const snap = await snapshotTipoAtividadeRow(pool, cdVal);
      console.log('[TIPOATIVIDADE] POST salvo', {
        cd: cdVal,
        entrada: { lic: licVal, mod: modVal },
        banco: snap,
      });
    } catch (logE) {
      console.warn('[TIPOATIVIDADE] POST — log pós-insert:', logE.message);
    }

    res.status(201).json({ success: true, message: 'Tipo de atividade cadastrado com sucesso!' });
  } catch (err) {
    console.error('Erro ao criar tipo de atividade:', err);
    res.status(500).json({ error: 'Erro ao cadastrar tipo de atividade.' });
  }
};

// Atualizar tipo de atividade
const atualizar = async (req, res) => {
  try {
    const { codigo } = req.params;
    const body = bodyTipoAtividade(req);
    const {
      DSTIPOATIVIDADE,
      DSPROGRAMA,
      FGACTIVE,
      FGGRUPO,
      CODIGO_MODULO_LICENCA,
      CD_MODULO_PRODUTO,
    } = body;

    if (!DSTIPOATIVIDADE) {
      return res.status(400).json({ error: 'Descrição é obrigatória.' });
    }

    const sgUserUpd = getSgUser(req);
    if (!sgUserUpd) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

    const tid = tenantIdForRequest(req);

    const licNormUpd = await normalizeCodigoModuloLicenca(pool, CODIGO_MODULO_LICENCA);
    if (licNormUpd.err) return res.status(400).json({ error: licNormUpd.err });
    const modNormUpd = await normalizeCdModuloProduto(pool, CD_MODULO_PRODUTO);
    if (modNormUpd.err) return res.status(400).json({ error: modNormUpd.err });

    const cdVal = parseInt(codigo, 10);
    if (!Number.isFinite(cdVal)) {
      return res.status(400).json({ error: 'Código inválido.' });
    }

    const checkExist = await pool.query(
      `SELECT 1 FROM "TIPOATIVIDADE" WHERE "CDTIPOATIVIDADE" = $1 AND "TENANT_ID" = $2`,
      [cdVal, tid]
    );
    if (!checkExist.rows || checkExist.rows.length === 0) {
      return res.status(404).json({ error: 'Tipo de atividade não encontrado.' });
    }

    const licVal = licNormUpd.ok != null ? licNormUpd.ok : null;
    const modVal = modNormUpd.ok != null ? modNormUpd.ok : null;
    const desc = DSTIPOATIVIDADE;
    const prog = DSPROGRAMA ?? null;
    const sit = FGACTIVE || 'S';
    const grp = FGGRUPO ?? null;

    try {
      await pool.query(
        `UPDATE "TIPOATIVIDADE" SET
          "DSTIPOATIVIDADE" = $1,
          "DSPROGRAMA" = $2,
          "FGACTIVE" = $3,
          "FGGRUPO" = $4,
          "CODIGO_MODULO_LICENCA" = $5,
          "CD_MODULO_PRODUTO" = $6::smallint,
          "DHMAINTENANCE" = CURRENT_TIMESTAMP,
          "SGUSER" = $7,
          "SERVERORIG" = $8
        WHERE "CDTIPOATIVIDADE" = $9 AND "TENANT_ID" = $10`,
        [desc, prog, sit, grp, licVal, modVal, sgUserUpd, 'AppDVcargas', cdVal, tid]
      );
    } catch (updErr) {
      if (!isMissingColumnError(updErr)) throw updErr;
      try {
        await pool.query(
          `UPDATE "TIPOATIVIDADE" SET
            "DSTIPOATIVIDADE" = $1,
            "DSPROGRAMA" = $2,
            "FGACTIVE" = $3,
            "FGGRUPO" = $4,
            "CD_MODULO_PRODUTO" = $5::smallint,
            "DHMAINTENANCE" = CURRENT_TIMESTAMP,
            "SGUSER" = $6,
            "SERVERORIG" = $7
          WHERE "CDTIPOATIVIDADE" = $8 AND "TENANT_ID" = $9`,
          [desc, prog, sit, grp, modVal, sgUserUpd, 'AppDVcargas', cdVal, tid]
        );
      } catch (upd2) {
        if (!isMissingColumnError(upd2)) throw upd2;
        try {
          await pool.query(
            `UPDATE "TIPOATIVIDADE" SET
              "DSTIPOATIVIDADE" = $1,
              "DSPROGRAMA" = $2,
              "FGACTIVE" = $3,
              "FGGRUPO" = $4,
              "CODIGO_MODULO_LICENCA" = $5,
              "DHMAINTENANCE" = CURRENT_TIMESTAMP,
              "SGUSER" = $6,
              "SERVERORIG" = $7
            WHERE "CDTIPOATIVIDADE" = $8 AND "TENANT_ID" = $9`,
            [desc, prog, sit, grp, licVal, sgUserUpd, 'AppDVcargas', cdVal, tid]
          );
        } catch (upd3) {
          if (!isMissingColumnError(upd3)) throw upd3;
          await pool.query(
            `UPDATE "TIPOATIVIDADE" SET
              "DSTIPOATIVIDADE" = $1,
              "DSPROGRAMA" = $2,
              "FGACTIVE" = $3,
              "FGGRUPO" = $4,
              "DHMAINTENANCE" = CURRENT_TIMESTAMP,
              "SGUSER" = $5,
              "SERVERORIG" = $6
            WHERE "CDTIPOATIVIDADE" = $7 AND "TENANT_ID" = $8`,
            [desc, prog, sit, grp, sgUserUpd, 'AppDVcargas', cdVal, tid]
          );
        }
      }
    }

    try {
      const snap = await snapshotTipoAtividadeRow(pool, cdVal);
      console.log('[TIPOATIVIDADE] PUT salvo', {
        cd: cdVal,
        entrada: { lic: licVal, mod: modVal },
        banco: snap,
      });
    } catch (logE) {
      console.warn('[TIPOATIVIDADE] PUT — log pós-update:', logE.message);
    }

    res.json({ success: true, message: 'Tipo de atividade atualizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar tipo de atividade:', err);
    res.status(500).json({ error: 'Erro ao atualizar tipo de atividade.' });
  }
};

// Excluir/Alterar status tipo de atividade
const alterarStatus = async (req, res) => {
  try {
    const { codigo } = req.params;
    const cdVal = parseInt(codigo, 10);
    if (!Number.isFinite(cdVal)) {
      return res.status(400).json({ error: 'Código inválido.' });
    }

    const sgUserStatus = getSgUser(req);
    if (!sgUserStatus) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

    const tid = tenantIdForRequest(req);
    const pg = await poolPromise;

    const checkExist = await pg.query(
      'SELECT "FGACTIVE" FROM "TIPOATIVIDADE" WHERE "CDTIPOATIVIDADE" = $1 AND "TENANT_ID" = $2',
      [cdVal, tid]
    );

    if (!checkExist.rows || checkExist.rows.length === 0) {
      return res.status(404).json({ error: 'Tipo de atividade não encontrado.' });
    }

    const estaAtivo = checkExist.rows[0].FGACTIVE === 'S';
    const novaSituacao = estaAtivo ? 'N' : 'S';
    const mensagem = estaAtivo ? 'Tipo de atividade desativado com sucesso!' : 'Tipo de atividade ativado com sucesso!';

    await pg.query(
      `UPDATE "TIPOATIVIDADE"
        SET "FGACTIVE" = $1, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = $2, "SERVERORIG" = 'AppDVcargas'
        WHERE "CDTIPOATIVIDADE" = $3 AND "TENANT_ID" = $4`,
      [novaSituacao, sgUserStatus, cdVal, tid]
    );

    res.json({ success: true, message: mensagem, newStatus: novaSituacao });
  } catch (err) {
    console.error('Erro ao alterar status do tipo de atividade:', err);
    res.status(500).json({ error: 'Erro ao alterar status do tipo de atividade.' });
  }
};

// Executar init.sql
const executarInitSQL = async (req, res) => {
  try {
    const { sql: sqlContent } = req.body;

    if (!sqlContent || typeof sqlContent !== 'string') {
      return res.status(400).json({ error: 'SQL é obrigatório.' });
    }

    const sqlUpper = sqlContent.trim().toUpperCase();
    const comandosBloqueados = [
      'DROP DATABASE', 'DROP TABLE', 'TRUNCATE TABLE', 
      'ALTER DATABASE', 'CREATE DATABASE', 'BACKUP DATABASE',
      'RESTORE DATABASE', 'SHUTDOWN', 'KILL'
    ];

    for (const cmd of comandosBloqueados) {
      if (sqlUpper.includes(cmd)) {
        return res.status(400).json({ error: `Comando não permitido: ${cmd}.` });
      }
    }

    const pool = await poolPromise;
    const comandos = sqlContent.split(/\bGO\b/gi).filter(cmd => cmd.trim().length > 0);
    const resultados = [];

    for (const comando of comandos) {
      const cmdLimpo = comando.trim();
      if (!cmdLimpo) continue;

      try {
        const request = pool.request();
        request.timeout = 120000;
        const result = await request.query(cmdLimpo);

        if (result.recordset && result.recordset.length > 0) {
          const rows = result.recordset.map(row => {
            const obj = {};
            for (const key in row) {
              obj[key] = row[key];
            }
            return obj;
          });
          resultados.push({ tipo: 'SELECT', rows: rows, rowCount: rows.length });
        } else {
          resultados.push({ tipo: 'EXEC', message: 'Comando executado com sucesso.', rowsAffected: result.rowsAffected || [0] });
        }
      } catch (cmdErr) {
        let mensagemErro = cmdErr.message;
        if (mensagemErro.includes('timeout') || mensagemErro.includes('Timeout')) {
          mensagemErro = `Timeout: Comando demorou mais de 2 minutos para executar.`;
        }
        resultados.push({
          tipo: 'ERRO',
          error: mensagemErro,
          comando: cmdLimpo.substring(0, 200),
          detalhes: { nome: cmdErr.name, codigo: cmdErr.code, numero: cmdErr.number }
        });
      }
    }

    res.json({ success: true, resultados: resultados, totalComandos: comandos.length });
  } catch (err) {
    console.error('Erro ao executar init SQL:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Erro ao executar SQL de inicialização.' });
    }
  }
};

module.exports = {
  catalogoModulosLicenca,
  listar,
  buscarPorCodigo,
  criar,
  atualizar,
  alterarStatus,
  executarInitSQL
};

