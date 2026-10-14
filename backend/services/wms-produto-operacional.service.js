'use strict';

const { pool } = require('../config/db');
const { inferirUnidadeDaDescricaoOl } = require('./wms-opl-relatorio-romaneio.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function normUnidade(v) {
  const s = v != null ? String(v).trim().toUpperCase() : '';
  if (!s || s.length > 10) return null;
  return s;
}

/**
 * Sugere unidade operacional quando SGUNIDADE não veio na importação OL.
 * @param {{ UNIDADE?: string|null, UNIDADE_ESTOQUE?: string|null, FATOR_CONVERSAO?: number|null, NM_PRODUTO?: string|null, NOME?: string|null }} row
 * @returns {string|null}
 */
function sugerirUnidadeOperacional(row) {
  const atual = normUnidade(row.UNIDADE);
  if (atual) return null;

  const nome = String(row.NM_PRODUTO || row.NOME || '').trim();
  const daDesc = inferirUnidadeDaDescricaoOl(nome);
  if (daDesc) return daDesc;

  const unEst = normUnidade(row.UNIDADE_ESTOQUE);
  const fator = Number(row.FATOR_CONVERSAO);
  if (Number.isFinite(fator) && fator > 1 && (!unEst || unEst === 'PC' || unEst === 'UN')) {
    return 'CX';
  }
  if (unEst) return unEst;
  return null;
}

/**
 * @param {string} tenantId
 * @param {{ cdDono?: number|string, codigoOperacional?: string, codigoEstoque?: string, nome?: string, fgactive?: string, semUnidade?: boolean }} filtros
 */
async function listarProdutosOperacionais(tenantId, filtros = {}) {
  const params = [tenantId];
  let i = 2;
  let sql = `
    SELECT o."CD_OPERACIONAL", o."TENANT_ID", o."CD_DONO", o."CD_PRODUTO",
           o."CODIGO_OPERACIONAL", o."CODIGO_ESTOQUE", o."UNIDADE", o."FATOR_CONVERSAO",
           o."INDICE_ARRED", o."FGACTIVE", o."DH_MAINTENANCE", o."SG_USER",
           d."NOME" AS "NM_DONO",
           p."NOME" AS "NM_PRODUTO", p."UNIDADE" AS "UNIDADE_ESTOQUE"
      FROM "WMS_PRODUTO_OPERACIONAL" o
      INNER JOIN "WMS_DONO_ESTOQUE" d
        ON d."CD_DONO" = o."CD_DONO" AND d."TENANT_ID" = o."TENANT_ID"
      LEFT JOIN "WMS_PRODUTO_DONO" p
        ON p."CD_PRODUTO" = o."CD_PRODUTO"
       AND p."TENANT_ID" = o."TENANT_ID"
       AND p."CD_DONO" = o."CD_DONO"
     WHERE o."TENANT_ID" = $1`;

  if (filtros.cdDono != null && String(filtros.cdDono).trim() !== '') {
    sql += ` AND o."CD_DONO" = $${i}::integer`;
    params.push(parseInt(filtros.cdDono, 10));
    i++;
  }
  if (filtros.fgactive === 'S' || filtros.fgactive === 'N') {
    sql += ` AND o."FGACTIVE" = $${i}`;
    params.push(filtros.fgactive);
    i++;
  }
  if (filtros.semUnidade) {
    sql += ` AND (o."UNIDADE" IS NULL OR TRIM(o."UNIDADE") = '')`;
  }
  if (filtros.codigoOperacional) {
    const raw = String(filtros.codigoOperacional).trim();
    const dig = raw.replace(/[^0-9A-Za-z]/g, '');
    sql += ` AND (
      UPPER(TRIM(o."CODIGO_OPERACIONAL")) LIKE UPPER($${i})
      OR LOWER(regexp_replace(TRIM(o."CODIGO_OPERACIONAL"), '[^0-9A-Za-z]', '', 'g')) LIKE $${i + 1}
    )`;
    params.push(`%${raw}%`, `%${dig}%`);
    i += 2;
  }
  if (filtros.codigoEstoque) {
    const raw = String(filtros.codigoEstoque).trim();
    const dig = raw.replace(/[^0-9A-Za-z]/g, '');
    sql += ` AND (
      UPPER(TRIM(o."CODIGO_ESTOQUE")) LIKE UPPER($${i})
      OR LOWER(regexp_replace(TRIM(o."CODIGO_ESTOQUE"), '[^0-9A-Za-z]', '', 'g')) LIKE $${i + 1}
    )`;
    params.push(`%${raw}%`, `%${dig}%`);
    i += 2;
  }
  if (filtros.nome) {
    sql += ` AND UPPER(COALESCE(p."NOME", '')) LIKE UPPER($${i})`;
    params.push(`%${String(filtros.nome).trim()}%`);
    i++;
  }

  sql += ` ORDER BY d."NOME", o."CODIGO_OPERACIONAL"`;
  const r = await pool.query(sql, params);
  return (r.rows || []).map((row) => {
    const semUm = !normUnidade(row.UNIDADE);
    const sugerida = semUm ? sugerirUnidadeOperacional(row) : null;
    return {
      ...row,
      SEM_UNIDADE: semUm,
      UNIDADE_SUGERIDA: sugerida,
    };
  });
}

async function contarSemUnidade(tenantId, cdDonoOpt) {
  const params = [tenantId];
  let sql = `
    SELECT COUNT(*)::integer AS total
      FROM "WMS_PRODUTO_OPERACIONAL" o
     WHERE o."TENANT_ID" = $1
       AND COALESCE(o."FGACTIVE", 'S') = 'S'
       AND (o."UNIDADE" IS NULL OR TRIM(o."UNIDADE") = '')`;
  if (cdDonoOpt != null && Number.isFinite(Number(cdDonoOpt))) {
    sql += ` AND o."CD_DONO" = $2::integer`;
    params.push(Number(cdDonoOpt));
  }
  const r = await pool.query(sql, params);
  return r.rows[0] ? Number(r.rows[0].total) || 0 : 0;
}

/**
 * Preenche UNIDADE vazia no catálogo operacional (heurística + UM estoque).
 * @param {string} tenantId
 * @param {{ cdDono?: number, dryRun?: boolean, sgUser?: string }} opts
 */
async function preencherUnidadesFaltantes(tenantId, opts = {}) {
  const cdDono = opts.cdDono != null && Number.isFinite(Number(opts.cdDono)) ? Number(opts.cdDono) : null;
  const dryRun = !!opts.dryRun;
  const sgUser = opts.sgUser || 'wms_cadastro';

  const params = [tenantId];
  let sql = `
    SELECT o."CD_OPERACIONAL", o."CODIGO_OPERACIONAL", o."CODIGO_ESTOQUE",
           o."UNIDADE", o."FATOR_CONVERSAO", p."NOME" AS "NM_PRODUTO", p."UNIDADE" AS "UNIDADE_ESTOQUE"
      FROM "WMS_PRODUTO_OPERACIONAL" o
      LEFT JOIN "WMS_PRODUTO_DONO" p
        ON p."CD_PRODUTO" = o."CD_PRODUTO"
       AND p."TENANT_ID" = o."TENANT_ID"
       AND p."CD_DONO" = o."CD_DONO"
     WHERE o."TENANT_ID" = $1
       AND COALESCE(o."FGACTIVE", 'S') = 'S'
       AND (o."UNIDADE" IS NULL OR TRIM(o."UNIDADE") = '')`;
  if (cdDono != null) {
    sql += ` AND o."CD_DONO" = $2::integer`;
    params.push(cdDono);
  }
  sql += ` ORDER BY o."CODIGO_OPERACIONAL"`;

  const r = await pool.query(sql, params);
  const plano = [];
  const semSugestao = [];

  for (const row of r.rows || []) {
    const sugerida = sugerirUnidadeOperacional(row);
    if (!sugerida) {
      semSugestao.push({
        CD_OPERACIONAL: row.CD_OPERACIONAL,
        CODIGO_OPERACIONAL: row.CODIGO_OPERACIONAL,
        CODIGO_ESTOQUE: row.CODIGO_ESTOQUE,
        NM_PRODUTO: row.NM_PRODUTO,
      });
      continue;
    }
    plano.push({
      CD_OPERACIONAL: row.CD_OPERACIONAL,
      CODIGO_OPERACIONAL: row.CODIGO_OPERACIONAL,
      UNIDADE_NOVA: sugerida,
      NM_PRODUTO: row.NM_PRODUTO,
    });
  }

  if (dryRun || !plano.length) {
    return {
      dryRun,
      totalSemUnidade: (r.rows || []).length,
      atualizados: 0,
      comSugestao: plano.length,
      semSugestao: semSugestao.length,
      amostra: plano.slice(0, 25),
      pendencias: semSugestao.slice(0, 25),
    };
  }

  const client = await pool.connect();
  let atualizados = 0;
  try {
    await client.query('BEGIN');
    for (const item of plano) {
      const up = await client.query(
        `UPDATE "WMS_PRODUTO_OPERACIONAL"
            SET "UNIDADE" = $3,
                "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
                "SG_USER" = $4
          WHERE "CD_OPERACIONAL" = $1::integer
            AND "TENANT_ID" = $2
            AND ( "UNIDADE" IS NULL OR TRIM("UNIDADE") = '' )`,
        [item.CD_OPERACIONAL, tenantId, item.UNIDADE_NOVA, sgUser]
      );
      atualizados += up.rowCount || 0;
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return {
    dryRun: false,
    totalSemUnidade: (r.rows || []).length,
    atualizados,
    comSugestao: plano.length,
    semSugestao: semSugestao.length,
    amostra: plano.slice(0, 25),
    pendencias: semSugestao.slice(0, 25),
  };
}

module.exports = {
  listarProdutosOperacionais,
  contarSemUnidade,
  preencherUnidadesFaltantes,
  sugerirUnidadeOperacional,
  normUnidade,
  schemaMissing,
};
