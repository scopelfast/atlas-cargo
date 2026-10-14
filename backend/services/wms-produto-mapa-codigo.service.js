'use strict';

/**
 * Mapa código OL → cadastro WMS do dono.
 * Chave = dígitos + sufixo alfabético (60314529AK ≠ 60314529BE).
 * Fonte única para romaneio, resumo de carga, separação OPL e peso logístico.
 */

const { pool } = require('../config/db');
const {
  expandirChavesDigitosCodigoOl,
  digitosCodigoOl,
} = require('./wms-opl-relatorio-romaneio.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

/** Expressão SQL: mesma chave que digitosCodigoOl (alnum upper). */
const SQL_CHAVE_CODIGO_PRODUTO = `upper(regexp_replace(trim(pr."CODIGO"), '[^0-9A-Za-z]', '', 'g'))`;
const SQL_CHAVE_CODIGO_OPERACIONAL = `upper(regexp_replace(trim(o."CODIGO_OPERACIONAL"), '[^0-9A-Za-z]', '', 'g'))`;

function prepararConsultaDigitosOl(digitosList) {
  const uniq = (digitosList || [])
    .map((d) => digitosCodigoOl(d))
    .filter((d, idx, arr) => d && arr.indexOf(d) === idx);
  const toCanonical = new Map();
  const allQuery = new Set();
  for (const d of uniq) {
    const vars = expandirChavesDigitosCodigoOl(d);
    const canonical = vars.length ? vars.slice().sort((a, b) => b.length - a.length)[0] : d;
    for (const v of vars.length ? vars : [d]) {
      allQuery.add(v);
      toCanonical.set(v, canonical);
    }
  }
  return { uniq, allQuery: Array.from(allQuery), toCanonical };
}

function payloadMapaProduto(row) {
  return {
    TIPO_ARMAZENAGEM: row.TIPO_ARMAZENAGEM,
    NCM: row.NCM,
    NM_CATEGORIA: row.NM_CATEGORIA,
    NM_GRUPO: row.NM_GRUPO,
    PESO_KG: row.PESO_KG != null ? Number(row.PESO_KG) : null,
    CD_PRODUTO: row.CD_PRODUTO != null ? Number(row.CD_PRODUTO) : null,
    CODIGO: row.CODIGO,
    UNIDADE: row.UNIDADE || null,
  };
}

function mapaProdutosPorLinhasQuery(rows, toCanonical, uniq) {
  const out = {};
  /** 1) Chave exata do cadastro — .AK e .BE são entradas distintas. */
  for (const row of rows || []) {
    const d = String(row.d || '');
    if (!d) continue;
    out[d] = payloadMapaProduto(row);
  }
  /** 2) Aliases só para variantes numéricas OL (9↔10 pos.). */
  for (const u of uniq || []) {
    if (out[u]) continue;
    const vars = expandirChavesDigitosCodigoOl(u);
    for (const v of vars.length ? vars : [u]) {
      if (v !== u && out[v]) {
        out[u] = out[v];
        break;
      }
    }
  }
  return out;
}

/**
 * @param {string} tenantId
 * @param {number|null|undefined} cdDono
 * @param {string[]} digitosList — chaves canônicas (podem incluir sufixo AK/BE)
 * @returns {Promise<Record<string, object>>}
 */
async function carregarMapaProdutosDonoPorDigitos(tenantId, cdDono, digitosList) {
  const { uniq, allQuery, toCanonical } = prepararConsultaDigitosOl(digitosList);
  if (!uniq.length || !allQuery.length) return {};
  const cdDonoParam =
    cdDono != null && cdDono !== '' && Number.isFinite(Number(cdDono)) ? Number(cdDono) : null;
  try {
    const r = await pool.query(
      `SELECT DISTINCT ON (${SQL_CHAVE_CODIGO_PRODUTO})
              ${SQL_CHAVE_CODIGO_PRODUTO} AS d,
              pr."CD_PRODUTO",
              pr."CODIGO",
              pr."TIPO_ARMAZENAGEM",
              pr."NCM",
              pr."PESO_KG",
              cat."NOME" AS "NM_CATEGORIA",
              g."NOME" AS "NM_GRUPO"
         FROM "WMS_PRODUTO_DONO" pr
    LEFT JOIN "WMS_CATEGORIA_PRODUTO" cat
           ON cat."CD_CATEGORIA" = pr."CD_CATEGORIA" AND cat."TENANT_ID" = pr."TENANT_ID"
    LEFT JOIN "WMS_GRUPO_PRODUTO" g
           ON g."CD_GRUPO" = cat."CD_GRUPO" AND g."TENANT_ID" = cat."TENANT_ID"
        WHERE pr."TENANT_ID" = $1
          AND pr."FGACTIVE" = 'S'
          AND ($2::integer IS NULL OR pr."CD_DONO" = $2::integer)
          AND ${SQL_CHAVE_CODIGO_PRODUTO} = ANY($3::text[])
        ORDER BY ${SQL_CHAVE_CODIGO_PRODUTO},
                 CASE WHEN COALESCE(pr."FG_FORNECEDOR_REF", 'N') = 'S' THEN 1 ELSE 0 END,
                 (pr."CD_CATEGORIA" IS NULL),
                 length(trim(pr."CODIGO")) DESC,
                 pr."CD_DONO" NULLS LAST`,
      [tenantId, cdDonoParam, allQuery]
    );
    return mapaProdutosPorLinhasQuery(r.rows, toCanonical, uniq);
  } catch (e) {
    if (schemaMissing(e)) return {};
    throw e;
  }
}

/**
 * Mapa código OL → unidade operacional (catálogo OPL / WMS_PRODUTO_OPERACIONAL).
 * @returns {Promise<Record<string, { UNIDADE: string|null, FATOR_CONVERSAO: number|null }>>}
 */
async function carregarMapaUnidadeOperacionalOpl(tenantId, cdDono, digitosList) {
  const { uniq, allQuery } = prepararConsultaDigitosOl(digitosList);
  if (!uniq.length || !allQuery.length) return {};
  const cdDonoParam =
    cdDono != null && cdDono !== '' && Number.isFinite(Number(cdDono)) ? Number(cdDono) : null;
  try {
    const r = await pool.query(
      `SELECT DISTINCT ON (${SQL_CHAVE_CODIGO_OPERACIONAL})
              ${SQL_CHAVE_CODIGO_OPERACIONAL} AS d,
              o."UNIDADE",
              o."FATOR_CONVERSAO"
         FROM "WMS_PRODUTO_OPERACIONAL" o
        WHERE o."TENANT_ID" = $1
          AND COALESCE(o."FGACTIVE", 'S') = 'S'
          AND ($2::integer IS NULL OR o."CD_DONO" = $2::integer)
          AND ${SQL_CHAVE_CODIGO_OPERACIONAL} = ANY($3::text[])
        ORDER BY ${SQL_CHAVE_CODIGO_OPERACIONAL}, o."CD_DONO" NULLS LAST`,
      [tenantId, cdDonoParam, allQuery]
    );
    const out = {};
    for (const row of r.rows || []) {
      const d = String(row.d || '');
      if (!d) continue;
      out[d] = {
        UNIDADE: row.UNIDADE != null ? String(row.UNIDADE).trim() : null,
        FATOR_CONVERSAO: row.FATOR_CONVERSAO != null ? Number(row.FATOR_CONVERSAO) : null,
      };
    }
    for (const u of uniq) {
      if (out[u]) continue;
      const vars = expandirChavesDigitosCodigoOl(u);
      for (const v of vars.length ? vars : [u]) {
        if (v !== u && out[v]) {
          out[u] = out[v];
          break;
        }
      }
    }
    return out;
  } catch (e) {
    if (schemaMissing(e)) return {};
    throw e;
  }
}

module.exports = {
  carregarMapaProdutosDonoPorDigitos,
  carregarMapaUnidadeOperacionalOpl,
  prepararConsultaDigitosOl,
  mapaProdutosPorLinhasQuery,
  payloadMapaProduto,
};
