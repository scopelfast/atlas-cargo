'use strict';

const { pool } = require('../config/db');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function normLote(v) {
  return String(v == null ? '' : v).trim();
}

function isoValidade(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

function parseApontadoModo(raw) {
  const s = String(raw == null ? 'todos' : raw).trim().toLowerCase();
  if (s === 'nao' || s === 'n' || s === 'novos' || s === 'nao-apontados') return 'nao';
  if (s === 'sim' || s === 's' || s === 'apontados' || s === 'ja') return 'sim';
  return 'todos';
}

/**
 * Chave estável: dono|produto|lote|validade (ISO).
 * @returns {string|null}
 */
function chaveLinhaShelf(r) {
  if (!r) return null;
  const cdDono = parseInt(r.CD_DONO, 10);
  const cdProd = parseInt(r.CD_PRODUTO, 10);
  const val = isoValidade(r.VALIDADE || r.DT_VALIDADE);
  if (!Number.isFinite(cdDono) || !Number.isFinite(cdProd) || !val) return null;
  return `${cdDono}|${cdProd}|${normLote(r.LOTE)}|${val}`;
}

function parseLinhaParaPersistir(r) {
  const chave = chaveLinhaShelf(r);
  if (!chave) return null;
  const [cdDono, cdProd, lote, validade] = chave.split('|');
  return {
    cdDono: parseInt(cdDono, 10),
    cdProduto: parseInt(cdProd, 10),
    lote,
    validade,
    codigoProduto: String(r.CODIGO_PRODUTO || r.codigo_prod || '').trim().slice(0, 80) || null,
    nmProduto: String(r.NM_PRODUTO || '').trim().slice(0, 200) || null,
  };
}

async function carregarChavesApontadasAtivas(tenantId, cdDonoOpt) {
  const tid = String(tenantId || '').trim();
  if (!tid) return new Set();
  const params = [tid];
  let clause = '';
  if (cdDonoOpt != null && String(cdDonoOpt).trim() !== '') {
    const n = parseInt(cdDonoOpt, 10);
    if (Number.isFinite(n)) {
      params.push(n);
      clause = ` AND "CD_DONO" = $${params.length}::integer`;
    }
  }
  try {
    const r = await pool.query(
      `SELECT "CD_DONO", "CD_PRODUTO", "LOTE", to_char("VALIDADE", 'YYYY-MM-DD') AS val
         FROM "WMS_SHELF_APONTADO"
        WHERE "TENANT_ID" = $1
          AND "FG_ATIVO" = 'S'${clause}`,
      params
    );
    const set = new Set();
    for (const row of r.rows || []) {
      set.add(`${row.CD_DONO}|${row.CD_PRODUTO}|${normLote(row.LOTE)}|${row.val}`);
    }
    return set;
  } catch (e) {
    if (schemaMissing(e)) return new Set();
    throw e;
  }
}

/**
 * Enriquece FG_APONTADO e filtra.
 * @param {object[]} linhas
 * @param {Set<string>} chavesAtivas
 * @param {'todos'|'nao'|'sim'} modo
 */
function filtrarLinhasPorApontado(linhas, chavesAtivas, modo) {
  const set = chavesAtivas instanceof Set ? chavesAtivas : new Set();
  const m = parseApontadoModo(modo);
  const out = [];
  for (const r of linhas || []) {
    const k = chaveLinhaShelf(r);
    const apontado = !!(k && set.has(k));
    const row = { ...r, FG_APONTADO: apontado ? 'S' : 'N' };
    if (m === 'nao' && apontado) continue;
    if (m === 'sim' && !apontado) continue;
    out.push(row);
  }
  return out;
}

function avisoFiltroApontado(modo) {
  const m = parseApontadoModo(modo);
  if (m === 'nao') {
    return 'Filtro apontamento: só linhas ainda não passadas ao cliente.';
  }
  if (m === 'sim') {
    return 'Filtro apontamento: só linhas já apontadas.';
  }
  return null;
}

/**
 * Marca (insere ou reativa) as linhas. Ignora as que não têm chave completa.
 */
async function marcarLinhasApontadas(tenantId, sgUser, linhas, origem) {
  const tid = String(tenantId || '').trim();
  const user = String(sgUser || '').trim().slice(0, 64) || null;
  const orig = String(origem || 'MANUAL').toUpperCase() === 'JOB' ? 'JOB' : 'MANUAL';
  const stats = { inseridas: 0, reativadas: 0, jaAtivas: 0, ignoradas: 0 };
  if (!tid) return stats;

  const vistos = new Set();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of linhas || []) {
      const p = parseLinhaParaPersistir(r);
      if (!p) {
        stats.ignoradas += 1;
        continue;
      }
      const k = `${p.cdDono}|${p.cdProduto}|${p.lote}|${p.validade}`;
      if (vistos.has(k)) {
        stats.ignoradas += 1;
        continue;
      }
      vistos.add(k);

      const reativ = await client.query(
        `UPDATE "WMS_SHELF_APONTADO"
            SET "FG_ATIVO" = 'S',
                "DH_APONTADO" = CURRENT_TIMESTAMP,
                "SG_USER" = $6,
                "ORIGEM" = $7,
                "CODIGO_PRODUTO" = COALESCE($8, "CODIGO_PRODUTO"),
                "NM_PRODUTO" = COALESCE($9, "NM_PRODUTO"),
                "DH_DESAPONTADO" = NULL,
                "SG_USER_DESAPONTADO" = NULL
          WHERE "TENANT_ID" = $1::varchar
            AND "CD_DONO" = $2::integer
            AND "CD_PRODUTO" = $3::integer
            AND "LOTE" = $4::varchar
            AND "VALIDADE" = $5::date
            AND "FG_ATIVO" = 'N'
          RETURNING "CD_APONTADO"`,
        [tid, p.cdDono, p.cdProduto, p.lote, p.validade, user, orig, p.codigoProduto, p.nmProduto]
      );
      if (reativ.rowCount) {
        stats.reativadas += 1;
        continue;
      }

      try {
        const ins = await client.query(
          `INSERT INTO "WMS_SHELF_APONTADO"
            ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "LOTE", "VALIDADE",
             "CODIGO_PRODUTO", "NM_PRODUTO", "SG_USER", "ORIGEM", "FG_ATIVO")
           SELECT $1::varchar, $2::integer, $3::integer, $4::varchar, $5::date,
                  $6::varchar, $7::varchar, $8::varchar, $9::varchar, 'S'
            WHERE NOT EXISTS (
              SELECT 1 FROM "WMS_SHELF_APONTADO" x
               WHERE x."TENANT_ID" = $1::varchar
                 AND x."CD_DONO" = $2::integer
                 AND x."CD_PRODUTO" = $3::integer
                 AND x."LOTE" = $4::varchar
                 AND x."VALIDADE" = $5::date
                 AND x."FG_ATIVO" = 'S'
            )
           RETURNING "CD_APONTADO"`,
          [tid, p.cdDono, p.cdProduto, p.lote, p.validade, p.codigoProduto, p.nmProduto, user, orig]
        );
        if (ins.rowCount) stats.inseridas += 1;
        else stats.jaAtivas += 1;
      } catch (e) {
        if (e && e.code === '23505') {
          stats.jaAtivas += 1;
          continue;
        }
        throw e;
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {
      /* ignore */
    }
    if (schemaMissing(e)) {
      const err = new Error(
        'Tabela de apontados ausente. Execute backend/scripts/adicionar_wms_shelf_apontado_postgres.sql.'
      );
      err.code = 'SCHEMA';
      throw err;
    }
    throw e;
  } finally {
    client.release();
  }
  stats.marcadas = stats.inseridas + stats.reativadas;
  return stats;
}

async function desapontarPorIds(tenantId, sgUser, ids) {
  const tid = String(tenantId || '').trim();
  const user = String(sgUser || '').trim().slice(0, 64) || null;
  const lista = (Array.isArray(ids) ? ids : [])
    .map((x) => parseInt(x, 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!tid || !lista.length) return { desmarcadas: 0 };
  try {
    const r = await pool.query(
      `UPDATE "WMS_SHELF_APONTADO"
          SET "FG_ATIVO" = 'N',
              "DH_DESAPONTADO" = CURRENT_TIMESTAMP,
              "SG_USER_DESAPONTADO" = $3
        WHERE "TENANT_ID" = $1
          AND "FG_ATIVO" = 'S'
          AND "CD_APONTADO" = ANY($2::bigint[])
        RETURNING "CD_APONTADO"`,
      [tid, lista, user]
    );
    return { desmarcadas: r.rowCount || 0 };
  } catch (e) {
    if (schemaMissing(e)) {
      const err = new Error(
        'Tabela de apontados ausente. Execute backend/scripts/adicionar_wms_shelf_apontado_postgres.sql.'
      );
      err.code = 'SCHEMA';
      throw err;
    }
    throw e;
  }
}

async function desapontarPorChaves(tenantId, sgUser, linhas) {
  const tid = String(tenantId || '').trim();
  const user = String(sgUser || '').trim().slice(0, 64) || null;
  if (!tid) return { desmarcadas: 0 };
  let n = 0;
  try {
    for (const r of linhas || []) {
      const p = parseLinhaParaPersistir(r);
      if (!p) continue;
      const upd = await pool.query(
        `UPDATE "WMS_SHELF_APONTADO"
            SET "FG_ATIVO" = 'N',
                "DH_DESAPONTADO" = CURRENT_TIMESTAMP,
                "SG_USER_DESAPONTADO" = $6
          WHERE "TENANT_ID" = $1
            AND "CD_DONO" = $2::integer
            AND "CD_PRODUTO" = $3::integer
            AND "LOTE" = $4
            AND "VALIDADE" = $5::date
            AND "FG_ATIVO" = 'S'`,
        [tid, p.cdDono, p.cdProduto, p.lote, p.validade, user]
      );
      n += upd.rowCount || 0;
    }
    return { desmarcadas: n };
  } catch (e) {
    if (schemaMissing(e)) {
      const err = new Error(
        'Tabela de apontados ausente. Execute backend/scripts/adicionar_wms_shelf_apontado_postgres.sql.'
      );
      err.code = 'SCHEMA';
      throw err;
    }
    throw e;
  }
}

async function listarApontados(tenantId, opts = {}) {
  const tid = String(tenantId || '').trim();
  const lim = Math.min(500, Math.max(1, parseInt(opts.limit, 10) || 200));
  const params = [tid];
  let clause = '';
  if (opts.cdDono != null && String(opts.cdDono).trim() !== '') {
    const n = parseInt(opts.cdDono, 10);
    if (Number.isFinite(n)) {
      params.push(n);
      clause = ` AND a."CD_DONO" = $${params.length}::integer`;
    }
  }
  params.push(lim);
  try {
    const r = await pool.query(
      `SELECT a."CD_APONTADO", a."CD_DONO", d."NOME" AS "NM_DONO",
              a."CD_PRODUTO", a."CODIGO_PRODUTO", a."NM_PRODUTO",
              a."LOTE", to_char(a."VALIDADE", 'YYYY-MM-DD') AS "VALIDADE",
              a."DH_APONTADO", a."SG_USER", a."ORIGEM", a."FG_ATIVO"
         FROM "WMS_SHELF_APONTADO" a
         LEFT JOIN "WMS_DONO_ESTOQUE" d
           ON d."CD_DONO" = a."CD_DONO" AND d."TENANT_ID" = a."TENANT_ID"
        WHERE a."TENANT_ID" = $1
          AND a."FG_ATIVO" = 'S'${clause}
        ORDER BY a."DH_APONTADO" DESC, a."CD_APONTADO" DESC
        LIMIT $${params.length}`,
      params
    );
    return { rows: r.rows || [], ok: true };
  } catch (e) {
    if (schemaMissing(e)) {
      return {
        rows: [],
        ok: false,
        aviso: 'Tabela de apontados ausente. Execute backend/scripts/adicionar_wms_shelf_apontado_postgres.sql.',
      };
    }
    throw e;
  }
}

module.exports = {
  schemaMissing,
  normLote,
  isoValidade,
  parseApontadoModo,
  chaveLinhaShelf,
  carregarChavesApontadasAtivas,
  filtrarLinhasPorApontado,
  avisoFiltroApontado,
  marcarLinhasApontadas,
  desapontarPorIds,
  desapontarPorChaves,
  listarApontados,
};
