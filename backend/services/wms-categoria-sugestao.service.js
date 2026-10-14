'use strict';

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function normTipoArmazenagem(v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim().toUpperCase();
  if (['SECO', 'REFRIGERADO', 'CONGELADO'].includes(s)) return s;
  return null;
}

function normalizarModoSugestao(raw) {
  const m = String(raw || 'medio').trim().toLowerCase();
  if (m === 'alto' || m === 'alta') return 'alto';
  if (m === 'todos' || m === 'todas') return 'todos';
  return 'medio';
}

function sugestaoCategoriaWhereModoSql(modo) {
  if (modo === 'alto') return `WHERE confianca = 'alta'`;
  if (modo === 'medio') return `WHERE confianca = 'media'`;
  return '';
}

/** Bloqueia mistura explícita de conservação e hints no nome (resumo de carga). */
const SQL_WHERE_TIPO_SEGURO = `
         AND NOT (
           COALESCE(TRIM(f."TIPO_ARMAZENAGEM"), '') <> ''
           AND COALESCE(TRIM(b."TIPO_ARMAZENAGEM"), '') <> ''
           AND UPPER(TRIM(f."TIPO_ARMAZENAGEM")) <> UPPER(TRIM(b."TIPO_ARMAZENAGEM"))
         )
         AND NOT (
           f.nm_norm LIKE '%CONGEL%' AND UPPER(COALESCE(TRIM(b."TIPO_ARMAZENAGEM"), '')) <> 'CONGELADO'
         )
         AND NOT (
           (f.nm_norm LIKE '%REFRIG%' OR f.nm_norm LIKE '%RESFRI%')
           AND UPPER(COALESCE(TRIM(b."TIPO_ARMAZENAGEM"), '')) <> 'REFRIGERADO'
         )`;

/** UNION (nome exato + código exato) — evita JOIN com OR/prefixo que explode após importação em massa. */
const SQL_CTE_PARES = `
    pares AS (
      SELECT
        f."CD_PRODUTO" AS cd_produto,
        f."CD_DONO" AS cd_dono,
        f."CODIGO" AS codigo_produto,
        f."NOME" AS nome_produto,
        f."TIPO_ARMAZENAGEM" AS tipo_armazenagem,
        b."CD_CATEGORIA" AS cd_categoria_sugerida,
        UPPER(TRIM(b."TIPO_ARMAZENAGEM")) AS tipo_evidencia,
        (
          0.62 +
          CASE WHEN COALESCE(TRIM(f."TIPO_ARMAZENAGEM"), '') <> ''
                AND UPPER(TRIM(f."TIPO_ARMAZENAGEM")) = UPPER(TRIM(b."TIPO_ARMAZENAGEM")) THEN 0.12 ELSE 0 END
        )::numeric(10, 4) AS score
      FROM faltantes f
      INNER JOIN base b ON b."CD_DONO" = f."CD_DONO" AND f.nm_norm <> '' AND f.nm_norm = b.nm_norm
      ${SQL_WHERE_TIPO_SEGURO}
      UNION ALL
      SELECT
        f."CD_PRODUTO",
        f."CD_DONO",
        f."CODIGO",
        f."NOME",
        f."TIPO_ARMAZENAGEM",
        b."CD_CATEGORIA",
        UPPER(TRIM(b."TIPO_ARMAZENAGEM")),
        (
          0.80 +
          CASE WHEN COALESCE(TRIM(f."TIPO_ARMAZENAGEM"), '') <> ''
                AND UPPER(TRIM(f."TIPO_ARMAZENAGEM")) = UPPER(TRIM(b."TIPO_ARMAZENAGEM")) THEN 0.12 ELSE 0 END
        )::numeric(10, 4)
      FROM faltantes f
      INNER JOIN base b ON b."CD_DONO" = f."CD_DONO" AND f.cod_norm <> '' AND f.cod_norm = b.cod_norm
      ${SQL_WHERE_TIPO_SEGURO}
    ),`;

const SQL_CTE_PARES_BULK = `
    pares AS (
      SELECT
        f."CD_PRODUTO" AS cd_produto,
        f."CD_DONO" AS cd_dono,
        f."TIPO_ARMAZENAGEM" AS tipo_armazenagem,
        b."CD_CATEGORIA" AS cd_categoria_sugerida,
        UPPER(TRIM(b."TIPO_ARMAZENAGEM")) AS tipo_evidencia,
        (
          0.62 +
          CASE WHEN COALESCE(TRIM(f."TIPO_ARMAZENAGEM"), '') <> ''
                AND UPPER(TRIM(f."TIPO_ARMAZENAGEM")) = UPPER(TRIM(b."TIPO_ARMAZENAGEM")) THEN 0.12 ELSE 0 END
        )::numeric(10, 4) AS score
      FROM faltantes f
      INNER JOIN base b ON b."CD_DONO" = f."CD_DONO" AND f.nm_norm <> '' AND f.nm_norm = b.nm_norm
      ${SQL_WHERE_TIPO_SEGURO}
      UNION ALL
      SELECT
        f."CD_PRODUTO",
        f."CD_DONO",
        f."TIPO_ARMAZENAGEM",
        b."CD_CATEGORIA",
        UPPER(TRIM(b."TIPO_ARMAZENAGEM")),
        (
          0.80 +
          CASE WHEN COALESCE(TRIM(f."TIPO_ARMAZENAGEM"), '') <> ''
                AND UPPER(TRIM(f."TIPO_ARMAZENAGEM")) = UPPER(TRIM(b."TIPO_ARMAZENAGEM")) THEN 0.12 ELSE 0 END
        )::numeric(10, 4)
      FROM faltantes f
      INNER JOIN base b ON b."CD_DONO" = f."CD_DONO" AND f.cod_norm <> '' AND f.cod_norm = b.cod_norm
      ${SQL_WHERE_TIPO_SEGURO}
    ),`;

const QUERY_TIMEOUT_MS = Math.min(
  120000,
  Math.max(5000, parseInt(process.env.WMS_CATEGORIA_SUGESTAO_QUERY_MS || '45000', 10) || 45000)
);

async function queryComTimeout(db, sql, params) {
  const client = await db.connect();
  try {
    await client.query(`SET statement_timeout = ${QUERY_TIMEOUT_MS}`);
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

/**
 * Lista sugestões de categoria (sem pg_trgm; escopo dono + conservação).
 */
async function listarSugestoesCategoria(db, opts) {
  const tenantId = String(opts.tenantId || '').trim();
  const modo = normalizarModoSugestao(opts.modo);
  const lim = Math.min(5000, Math.max(1, parseInt(opts.limit, 10) || 150));
  const cdDono =
    opts.cdDono != null && String(opts.cdDono).trim() !== '' ? parseInt(String(opts.cdDono), 10) : null;
  const tipoArm = normTipoArmazenagem(opts.tipoArmazenagem);
  if (opts.tipoArmazenagem != null && String(opts.tipoArmazenagem).trim() !== '' && !tipoArm) {
    const err = new Error('tipoArmazenagem inválido. Use SECO, REFRIGERADO ou CONGELADO.');
    err.code = 'VALID';
    throw err;
  }
  if (cdDono != null && !Number.isFinite(cdDono)) {
    const err = new Error('cdDono inválido.');
    err.code = 'VALID';
    throw err;
  }

  const whereModo = sugestaoCategoriaWhereModoSql(modo);
  const params = [tenantId, lim];
  let i = 3;
  let filtroFaltantes = '';
  let filtroBase = '';
  if (cdDono != null) {
    filtroFaltantes += ` AND p."CD_DONO" = $${i}::integer`;
    filtroBase += ` AND c."CD_DONO" = $${i}::integer`;
    params.push(cdDono);
    i++;
  }
  if (tipoArm) {
    filtroFaltantes += ` AND COALESCE(UPPER(p."TIPO_ARMAZENAGEM"), '') = $${i}`;
    filtroBase += ` AND COALESCE(UPPER(c."TIPO_ARMAZENAGEM"), '') = $${i}`;
    params.push(tipoArm);
    i++;
  }

  const sql = `
    WITH faltantes AS (
      SELECT
        p."CD_PRODUTO",
        p."CD_DONO",
        p."CODIGO",
        p."NOME",
        p."TIPO_ARMAZENAGEM",
        UPPER(regexp_replace(translate(COALESCE(p."NOME", ''), 'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇ', 'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcC'), '[^A-Z0-9 ]', '', 'g')) AS nm_norm,
        regexp_replace(COALESCE(p."CODIGO", ''), '[^0-9A-Za-z]', '', 'g') AS cod_norm
      FROM "WMS_PRODUTO_DONO" p
      WHERE p."TENANT_ID" = $1
        AND p."CD_CATEGORIA" IS NULL
        AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
        ${filtroFaltantes}
    ),
    base AS (
      SELECT
        c."CD_PRODUTO",
        c."CD_DONO",
        c."CD_CATEGORIA",
        c."CODIGO",
        c."NOME",
        c."TIPO_ARMAZENAGEM",
        UPPER(regexp_replace(translate(COALESCE(c."NOME", ''), 'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇ', 'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcC'), '[^A-Z0-9 ]', '', 'g')) AS nm_norm,
        regexp_replace(COALESCE(c."CODIGO", ''), '[^0-9A-Za-z]', '', 'g') AS cod_norm
      FROM "WMS_PRODUTO_DONO" c
      WHERE c."TENANT_ID" = $1
        AND c."CD_CATEGORIA" IS NOT NULL
        AND COALESCE(c."FG_FORNECEDOR_REF", 'N') = 'N'
        ${filtroBase}
    ),
    ${SQL_CTE_PARES}
    por_categoria AS (
      SELECT
        p.cd_produto,
        p.cd_dono,
        p.codigo_produto,
        p.nome_produto,
        p.tipo_armazenagem,
        p.cd_categoria_sugerida,
        MAX(p.score) AS score_categoria,
        COUNT(*) AS qtd_evidencias,
        COUNT(DISTINCT NULLIF(UPPER(TRIM(p.tipo_evidencia)), '')) AS qtd_tipos_evidencia
      FROM pares p
      WHERE p.score >= 0.45
      GROUP BY p.cd_produto, p.cd_dono, p.codigo_produto, p.nome_produto, p.tipo_armazenagem, p.cd_categoria_sugerida
      HAVING COUNT(DISTINCT NULLIF(UPPER(TRIM(p.tipo_evidencia)), '')) <= 1
    ),
    ranking AS (
      SELECT
        pc.*,
        ROW_NUMBER() OVER (PARTITION BY pc.cd_produto ORDER BY pc.score_categoria DESC, pc.qtd_evidencias DESC, pc.cd_categoria_sugerida) AS rn,
        LEAD(pc.score_categoria) OVER (PARTITION BY pc.cd_produto ORDER BY pc.score_categoria DESC, pc.qtd_evidencias DESC, pc.cd_categoria_sugerida) AS prox_score
      FROM por_categoria pc
    ),
    final AS (
      SELECT
        r.cd_produto,
        r.cd_dono,
        r.codigo_produto,
        r.nome_produto,
        r.tipo_armazenagem,
        r.cd_categoria_sugerida,
        r.score_categoria AS score,
        r.qtd_evidencias,
        CASE
          WHEN r.score_categoria >= 0.86 AND COALESCE(r.score_categoria - r.prox_score, 0.99) >= 0.08 THEN 'alta'
          WHEN r.score_categoria >= 0.66 AND COALESCE(r.score_categoria - r.prox_score, 0.99) >= 0.03 THEN 'media'
          ELSE 'baixa'
        END AS confianca
      FROM ranking r
      WHERE r.rn = 1
    )
    SELECT
      f.cd_produto AS "CD_PRODUTO",
      f.cd_dono AS "CD_DONO",
      f.codigo_produto AS "CODIGO",
      f.nome_produto AS "NOME",
      f.tipo_armazenagem AS "TIPO_ARMAZENAGEM",
      f.cd_categoria_sugerida AS "CD_CATEGORIA_SUGERIDA",
      c."CODIGO" AS "CODIGO_CATEGORIA",
      c."NOME" AS "NM_CATEGORIA",
      g."NOME" AS "NM_GRUPO",
      f.score AS "SCORE",
      f.qtd_evidencias AS "QTD_EVIDENCIAS",
      f.confianca AS "CONFIANCA"
    FROM final f
    INNER JOIN "WMS_CATEGORIA_PRODUTO" c
      ON c."TENANT_ID" = $1 AND c."CD_CATEGORIA" = f.cd_categoria_sugerida
    LEFT JOIN "WMS_GRUPO_PRODUTO" g
      ON g."TENANT_ID" = c."TENANT_ID" AND g."CD_GRUPO" = c."CD_GRUPO"
    ${whereModo}
    ORDER BY
      CASE f.confianca WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
      f.score DESC,
      f.cd_produto
    LIMIT $2::integer
  `;

  let r;
  try {
    r = await queryComTimeout(db, sql, params);
  } catch (e) {
    if (e.code === '57014') {
      const err = new Error(
        'Consulta de sugestões excedeu o tempo limite. Use filtro por dono e confiança "Altas", ou tente novamente.'
      );
      err.code = 'TIMEOUT';
      throw err;
    }
    throw e;
  }

  let meta = null;
  if (cdDono != null) {
    const rMeta = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE p."CD_CATEGORIA" IS NULL)::integer AS sem_categoria,
         COUNT(*) FILTER (
           WHERE p."CD_CATEGORIA" IS NULL
             AND COALESCE(TRIM(p."TIPO_ARMAZENAGEM"), '') = ''
         )::integer AS sem_categoria_sem_conservacao,
         COUNT(*) FILTER (WHERE p."CD_CATEGORIA" IS NOT NULL)::integer AS com_categoria
       FROM "WMS_PRODUTO_DONO" p
       WHERE p."TENANT_ID" = $1
         AND p."CD_DONO" = $2::integer
         AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
         AND COALESCE(TRIM(UPPER(p."FGACTIVE")), 'S') = 'S'`,
      [tenantId, cdDono]
    );
    meta = rMeta.rows[0] || null;
  }

  return { rows: r.rows || [], modo, limit: lim, meta };
}

async function assertCategoriaTenant(db, tenantId, cdCategoria) {
  const r = await db.query(
    `SELECT 1 FROM "WMS_CATEGORIA_PRODUTO" WHERE "CD_CATEGORIA" = $1::integer AND "TENANT_ID" = $2 LIMIT 1`,
    [cdCategoria, tenantId]
  );
  return r.rowCount > 0;
}

/**
 * Aplica lista manual de { cdProduto, cdCategoria } com validações de conservação.
 */
async function aplicarItensCategoria(db, opts) {
  const tenantId = String(opts.tenantId || '').trim();
  const sgUser = String(opts.sgUser || 'SISTEMA').slice(0, 32);
  const itens = Array.isArray(opts.itens) ? opts.itens : [];
  const client = opts.useTransaction === false ? db : await db.connect();
  const ownedClient = opts.useTransaction !== false;

  try {
    if (ownedClient) await client.query('BEGIN');
    let atualizados = 0;
    const ignorados = [];

    for (const raw of itens) {
      const cdProduto = parseInt(raw.cdProduto ?? raw.CD_PRODUTO, 10);
      const cdCategoria = parseInt(raw.cdCategoria ?? raw.CD_CATEGORIA, 10);
      if (!Number.isFinite(cdProduto) || !Number.isFinite(cdCategoria)) continue;

      const okCat = await assertCategoriaTenant(client, tenantId, cdCategoria);
      if (!okCat) {
        ignorados.push({ cdProduto, motivo: 'Categoria inválida para este tenant.' });
        continue;
      }

      const rProd = await client.query(
        `SELECT "CD_PRODUTO", "CD_DONO", "TIPO_ARMAZENAGEM", "FG_FORNECEDOR_REF", "CD_CATEGORIA"
           FROM "WMS_PRODUTO_DONO"
          WHERE "TENANT_ID" = $1 AND "CD_PRODUTO" = $2::integer
          LIMIT 1`,
        [tenantId, cdProduto]
      );
      if (!rProd.rowCount) {
        ignorados.push({ cdProduto, motivo: 'Produto não encontrado.' });
        continue;
      }
      const prod = rProd.rows[0];
      if (String(prod.FG_FORNECEDOR_REF || 'N') === 'S') {
        ignorados.push({ cdProduto, motivo: 'Produto de fornecedor (não aplicável).' });
        continue;
      }
      if (prod.CD_CATEGORIA != null) {
        ignorados.push({ cdProduto, motivo: 'Produto já categorizado.' });
        continue;
      }

      const rCat = await client.query(
        `SELECT "CD_CATEGORIA"
           FROM "WMS_PRODUTO_DONO"
          WHERE "TENANT_ID" = $1
            AND "CD_DONO" = $2::integer
            AND "CD_CATEGORIA" = $3::integer
            AND COALESCE(UPPER("TIPO_ARMAZENAGEM"), '') = COALESCE(UPPER($4::text), '')
            AND COALESCE("FG_FORNECEDOR_REF", 'N') = 'N'
          LIMIT 1`,
        [tenantId, prod.CD_DONO, cdCategoria, prod.TIPO_ARMAZENAGEM]
      );
      if (!rCat.rowCount) {
        ignorados.push({
          cdProduto,
          motivo: 'Categoria sem base no mesmo dono + conservação (proteção SECO/REFRIGERADO/CONGELADO).',
        });
        continue;
      }

      const rUp = await client.query(
        `UPDATE "WMS_PRODUTO_DONO"
            SET "CD_CATEGORIA" = $3::integer,
                "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
                "SG_USER" = $4::text
          WHERE "TENANT_ID" = $1
            AND "CD_PRODUTO" = $2::integer
            AND "CD_CATEGORIA" IS NULL
            AND COALESCE("FG_FORNECEDOR_REF", 'N') = 'N'`,
        [tenantId, cdProduto, cdCategoria, sgUser]
      );
      if (rUp.rowCount > 0) atualizados++;
    }

    if (ownedClient) await client.query('COMMIT');
    return { recebidos: itens.length, atualizados, ignorados };
  } catch (e) {
    if (ownedClient) {
      try {
        await client.query('ROLLBACK');
      } catch (_) {}
    }
    throw e;
  } finally {
    if (ownedClient) client.release();
  }
}

/**
 * Conta sugestões alta confiança e aplica em lote (mesma regra da simulação SQL).
 */
async function aplicarCategoriaAltaConfiancaEmLote(db, opts) {
  const tenantId = String(opts.tenantId || '').trim();
  const sgUser = String(opts.sgUser || 'JOB_CATEGORIA_AUTO').slice(0, 32);
  const dryRun = opts.dryRun === true || String(opts.dryRun || '').toUpperCase() === 'S';
  const cdDono =
    opts.cdDono != null && String(opts.cdDono).trim() !== '' ? parseInt(String(opts.cdDono), 10) : null;
  if (cdDono != null && !Number.isFinite(cdDono)) {
    const err = new Error('cdDono inválido.');
    err.code = 'VALID';
    throw err;
  }

  const params = [tenantId];
  let filtroFaltantes = '';
  let filtroBase = '';
  if (cdDono != null) {
    filtroFaltantes = ` AND p."CD_DONO" = $2::integer`;
    filtroBase = ` AND c."CD_DONO" = $2::integer`;
    params.push(cdDono);
  }

  const countSql = `
    WITH faltantes AS (
      SELECT
        p."CD_PRODUTO",
        p."CD_DONO",
        p."TIPO_ARMAZENAGEM",
        UPPER(regexp_replace(translate(COALESCE(p."NOME", ''), 'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇ', 'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcC'), '[^A-Z0-9 ]', '', 'g')) AS nm_norm,
        regexp_replace(COALESCE(p."CODIGO", ''), '[^0-9A-Za-z]', '', 'g') AS cod_norm
      FROM "WMS_PRODUTO_DONO" p
      WHERE p."TENANT_ID" = $1
        AND p."CD_CATEGORIA" IS NULL
        AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
        ${filtroFaltantes}
    ),
    base AS (
      SELECT
        c."CD_DONO",
        c."CD_CATEGORIA",
        c."TIPO_ARMAZENAGEM",
        UPPER(regexp_replace(translate(COALESCE(c."NOME", ''), 'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇ', 'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcC'), '[^A-Z0-9 ]', '', 'g')) AS nm_norm,
        regexp_replace(COALESCE(c."CODIGO", ''), '[^0-9A-Za-z]', '', 'g') AS cod_norm
      FROM "WMS_PRODUTO_DONO" c
      WHERE c."TENANT_ID" = $1
        AND c."CD_CATEGORIA" IS NOT NULL
        AND COALESCE(c."FG_FORNECEDOR_REF", 'N') = 'N'
        ${filtroBase}
    ),
    ${SQL_CTE_PARES_BULK}
    por_categoria AS (
      SELECT
        p.cd_produto,
        p.cd_dono,
        p.tipo_armazenagem,
        p.cd_categoria_sugerida,
        MAX(p.score) AS score_categoria,
        COUNT(*) AS qtd_evidencias
      FROM pares p
      WHERE p.score >= 0.45
      GROUP BY p.cd_produto, p.cd_dono, p.tipo_armazenagem, p.cd_categoria_sugerida
      HAVING COUNT(DISTINCT NULLIF(UPPER(TRIM(p.tipo_evidencia)), '')) <= 1
    ),
    ranking AS (
      SELECT
        pc.*,
        ROW_NUMBER() OVER (PARTITION BY pc.cd_produto ORDER BY pc.score_categoria DESC, pc.qtd_evidencias DESC, pc.cd_categoria_sugerida) AS rn,
        LEAD(pc.score_categoria) OVER (PARTITION BY pc.cd_produto ORDER BY pc.score_categoria DESC, pc.qtd_evidencias DESC, pc.cd_categoria_sugerida) AS prox_score
      FROM por_categoria pc
    ),
    final AS (
      SELECT
        r.cd_produto,
        r.cd_dono,
        r.tipo_armazenagem,
        r.cd_categoria_sugerida,
        r.score_categoria
      FROM ranking r
      WHERE r.rn = 1
        AND r.score_categoria >= 0.86
        AND COALESCE(r.score_categoria - r.prox_score, 0.99) >= 0.08
    )
    SELECT
      (SELECT COUNT(*)::integer FROM final) AS candidatos,
      (
        SELECT COALESCE(
          jsonb_object_agg(COALESCE(s.tipo_armazenagem, '(vazio)'), s.qtd),
          '{}'::jsonb
        )
        FROM (
          SELECT tipo_armazenagem, COUNT(*)::integer AS qtd
          FROM final
          GROUP BY tipo_armazenagem
        ) s
      ) AS por_conservacao
  `;

  let rCount;
  try {
    rCount = await queryComTimeout(db, countSql, params);
  } catch (e) {
    if (e.code === '57014') {
      const err = new Error('Lote de categoria excedeu o tempo limite no banco.');
      err.code = 'TIMEOUT';
      throw err;
    }
    throw e;
  }
  const candidatos = Number(rCount.rows[0]?.candidatos || 0);
  const porConservacao = rCount.rows[0]?.por_conservacao || {};

  if (dryRun || candidatos === 0) {
    return { dryRun, candidatos, atualizados: 0, porConservacao };
  }

  const updateSql = `
    WITH faltantes AS (
      SELECT
        p."CD_PRODUTO",
        p."CD_DONO",
        p."TIPO_ARMAZENAGEM",
        UPPER(regexp_replace(translate(COALESCE(p."NOME", ''), 'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇ', 'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcC'), '[^A-Z0-9 ]', '', 'g')) AS nm_norm,
        regexp_replace(COALESCE(p."CODIGO", ''), '[^0-9A-Za-z]', '', 'g') AS cod_norm
      FROM "WMS_PRODUTO_DONO" p
      WHERE p."TENANT_ID" = $1
        AND p."CD_CATEGORIA" IS NULL
        AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
        ${filtroFaltantes}
    ),
    base AS (
      SELECT
        c."CD_DONO",
        c."CD_CATEGORIA",
        c."TIPO_ARMAZENAGEM",
        UPPER(regexp_replace(translate(COALESCE(c."NOME", ''), 'áàâãäÁÀÂÃÄéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜçÇ', 'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUcC'), '[^A-Z0-9 ]', '', 'g')) AS nm_norm,
        regexp_replace(COALESCE(c."CODIGO", ''), '[^0-9A-Za-z]', '', 'g') AS cod_norm
      FROM "WMS_PRODUTO_DONO" c
      WHERE c."TENANT_ID" = $1
        AND c."CD_CATEGORIA" IS NOT NULL
        AND COALESCE(c."FG_FORNECEDOR_REF", 'N') = 'N'
        ${filtroBase}
    ),
    ${SQL_CTE_PARES_BULK}
    por_categoria AS (
      SELECT
        p.cd_produto,
        p.cd_dono,
        p.tipo_armazenagem,
        p.cd_categoria_sugerida,
        MAX(p.score) AS score_categoria,
        COUNT(*) AS qtd_evidencias
      FROM pares p
      WHERE p.score >= 0.45
      GROUP BY p.cd_produto, p.cd_dono, p.tipo_armazenagem, p.cd_categoria_sugerida
      HAVING COUNT(DISTINCT NULLIF(UPPER(TRIM(p.tipo_evidencia)), '')) <= 1
    ),
    ranking AS (
      SELECT
        pc.*,
        ROW_NUMBER() OVER (PARTITION BY pc.cd_produto ORDER BY pc.score_categoria DESC, pc.qtd_evidencias DESC, pc.cd_categoria_sugerida) AS rn,
        LEAD(pc.score_categoria) OVER (PARTITION BY pc.cd_produto ORDER BY pc.score_categoria DESC, pc.qtd_evidencias DESC, pc.cd_categoria_sugerida) AS prox_score
      FROM por_categoria pc
    ),
    final AS (
      SELECT
        r.cd_produto,
        r.cd_dono,
        r.tipo_armazenagem,
        r.cd_categoria_sugerida
      FROM ranking r
      WHERE r.rn = 1
        AND r.score_categoria >= 0.86
        AND COALESCE(r.score_categoria - r.prox_score, 0.99) >= 0.08
    )
    UPDATE "WMS_PRODUTO_DONO" p
       SET "CD_CATEGORIA" = f.cd_categoria_sugerida,
           "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
           "SG_USER" = $${cdDono != null ? 3 : 2}::text
      FROM final f
     WHERE p."TENANT_ID" = $1
       AND p."CD_PRODUTO" = f.cd_produto
       AND p."CD_DONO" = f.cd_dono
       AND COALESCE(UPPER(p."TIPO_ARMAZENAGEM"), '') = COALESCE(UPPER(f.tipo_armazenagem), '')
       AND p."CD_CATEGORIA" IS NULL
       AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
  `;

  const updateParams = cdDono != null ? [tenantId, cdDono, sgUser] : [tenantId, sgUser];
  const rUp = await db.query(updateSql, updateParams);

  return {
    dryRun: false,
    candidatos,
    atualizados: rUp.rowCount || 0,
    porConservacao,
  };
}

async function listarDonosComProdutoSemCategoria(db, tenantId) {
  const r = await db.query(
    `SELECT DISTINCT p."CD_DONO" AS "CD_DONO", o."NOME" AS "NM_DONO"
       FROM "WMS_PRODUTO_DONO" p
       INNER JOIN "WMS_DONO_ESTOQUE" o
         ON o."TENANT_ID" = p."TENANT_ID" AND o."CD_DONO" = p."CD_DONO"
      WHERE p."TENANT_ID" = $1
        AND p."CD_CATEGORIA" IS NULL
        AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
      ORDER BY o."NOME", p."CD_DONO"`,
    [tenantId]
  );
  return r.rows || [];
}

module.exports = {
  schemaMissing,
  normTipoArmazenagem,
  normalizarModoSugestao,
  listarSugestoesCategoria,
  aplicarItensCategoria,
  aplicarCategoriaAltaConfiancaEmLote,
  listarDonosComProdutoSemCategoria,
};
