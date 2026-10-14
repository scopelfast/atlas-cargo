'use strict';

const { pool } = require('../config/db');

const SQL_EXPR_XPED_NF = `LPAD(regexp_replace(trim(COALESCE(ln->>'xPed', ln->>'xped', '')), '[^0-9]', '', 'g'), 10, '0')`;

function schemaMissing(err) {
  const c = err && (err.code || '');
  return c === '42P01' || c === '42703';
}

async function restaurarItensPendentesEspelho(client, cdArq, dryRun) {
  const rCnt = await client.query(
    `SELECT COUNT(*)::int AS n
       FROM "WMS_OPL_ITEM" i
       JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_PEDIDO" = i."CD_OPL_PEDIDO"
      WHERE p."CD_OPL_ARQUIVO" = $1::integer
        AND i."QT_COLETADA" IS NULL`,
    [cdArq]
  );
  const n = Number(rCnt.rows[0]?.n) || 0;
  if (!dryRun && n > 0) {
    await client.query(
      `UPDATE "WMS_OPL_ITEM" i
          SET "QT_COLETADA" = i."QT_PEDIDA"
         FROM "WMS_OPL_PEDIDO" p
        WHERE i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
          AND p."CD_OPL_ARQUIVO" = $1::integer
          AND i."QT_COLETADA" IS NULL`,
      [cdArq]
    );
  }
  return n;
}

/**
 * Restaura picking nos espelhos ligados a cargas em montagem (RASCUNHO/CONFIRMADA).
 */
async function restaurarPickingMontagem(tenantId, opts = {}) {
  const dryRun = opts.dryRun !== false;
  const filtroIds = Array.isArray(opts.cdEspelhos) && opts.cdEspelhos.length ? opts.cdEspelhos : null;

  let sqlEspelhos = `
    SELECT DISTINCT a."CD_OPL_ARQUIVO", a."NM_ARQUIVO"
      FROM "WMS_OPL_ARQUIVO" a
     WHERE a."TENANT_ID" = $1
       AND EXISTS (
         SELECT 1
           FROM "WMS_CARGA_PROGRAMADA" c
           JOIN "WMS_CARGA_PROGRAMADA_NFE" j ON j."CD_CARGA" = c."CD_CARGA"
           JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
           JOIN LATERAL jsonb_array_elements(COALESCE(n."LINHAS_JSON", '[]'::jsonb)) ln ON true
           JOIN "WMS_OPL_PEDIDO" p2 ON p2."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
             AND LPAD(regexp_replace(trim(COALESCE(p2."NUM_PEDIDO", '')), '[^0-9]', '', 'g'), 10, '0') = ${SQL_EXPR_XPED_NF}
          WHERE c."TENANT_ID" = a."TENANT_ID"
            AND UPPER(TRIM(COALESCE(c."ST_CARGA", ''))) IN ('RASCUNHO', 'CONFIRMADA')
            AND trim(COALESCE(ln->>'xPed', ln->>'xped', '')) <> ''
       )`;
  const params = [tenantId];
  if (filtroIds) {
    sqlEspelhos += ` AND a."CD_OPL_ARQUIVO" = ANY($2::int[])`;
    params.push(filtroIds);
  }
  sqlEspelhos += ' ORDER BY a."CD_OPL_ARQUIVO"';

  const rEsp = await pool.query(sqlEspelhos, params);
  const resumo = { dryRun, tenantId, modo: 'montagem', espelhos: [], itensRestaurados: 0 };

  const client = await pool.connect();
  try {
    if (!dryRun) await client.query('BEGIN');
    for (const esp of rEsp.rows) {
      const n = await restaurarItensPendentesEspelho(client, esp.CD_OPL_ARQUIVO, dryRun);
      resumo.itensRestaurados += n;
      if (n > 0) resumo.espelhos.push({ CD_OPL_ARQUIVO: esp.CD_OPL_ARQUIVO, NM_ARQUIVO: esp.NM_ARQUIVO, itens: n });
    }
    if (!dryRun) await client.query('COMMIT');
  } catch (e) {
    if (!dryRun) await client.query('ROLLBACK');
    if (schemaMissing(e)) {
      resumo.erro = 'Estrutura WMS ausente.';
      return resumo;
    }
    throw e;
  } finally {
    client.release();
  }
  return resumo;
}

/**
 * Restaura picking zerado pela migração corrigir-picking-indevido em espelhos com
 * picking incompleto (0/N ou parcial). Espelhos já 100% concluídos são ignorados.
 *
 * @param {string} tenantId
 * @param {{ dryRun?: boolean, desde?: string, excluirCd?: number[] }} opts
 */
async function restaurarPickingPosMigracao(tenantId, opts = {}) {
  const dryRun = opts.dryRun !== false;
  const desde = opts.desde || '2026-05-18';
  const excluir = Array.isArray(opts.excluirCd) ? opts.excluirCd.map(Number).filter(Number.isFinite) : [];

  const params = [tenantId, desde];
  let sql = `
    SELECT a."CD_OPL_ARQUIVO", a."NM_ARQUIVO", a."DH_IMPORT",
           stats.tot::int AS tot,
           stats.com::int AS com
      FROM "WMS_OPL_ARQUIVO" a
      JOIN LATERAL (
        SELECT COUNT(i."CD_OPL_ITEM") AS tot,
               COUNT(i."CD_OPL_ITEM") FILTER (WHERE i."QT_COLETADA" IS NOT NULL) AS com
          FROM "WMS_OPL_PEDIDO" p
          JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
         WHERE p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
      ) stats ON true
     WHERE a."TENANT_ID" = $1
       AND a."DH_IMPORT" >= $2::date
       AND stats.tot > 0
       AND stats.com < stats.tot`;
  if (excluir.length) {
    params.push(excluir);
    sql += ` AND NOT (a."CD_OPL_ARQUIVO" = ANY($${params.length}::int[]))`;
  }
  sql += ' ORDER BY a."CD_OPL_ARQUIVO"';

  const rEsp = await pool.query(sql, params);
  const resumo = {
    dryRun,
    tenantId,
    modo: 'pos-migracao',
    desde,
    excluirCd: excluir,
    espelhos: [],
    itensRestaurados: 0,
    espelhosAfetados: 0,
  };

  const client = await pool.connect();
  try {
    if (!dryRun) await client.query('BEGIN');
    for (const esp of rEsp.rows) {
      const n = await restaurarItensPendentesEspelho(client, esp.CD_OPL_ARQUIVO, dryRun);
      if (n > 0) {
        resumo.espelhosAfetados += 1;
        resumo.itensRestaurados += n;
        resumo.espelhos.push({
          CD_OPL_ARQUIVO: esp.CD_OPL_ARQUIVO,
          NM_ARQUIVO: esp.NM_ARQUIVO,
          DH_IMPORT: esp.DH_IMPORT,
          antes: `${esp.com}/${esp.tot}`,
          itens: n,
        });
      }
    }
    if (!dryRun) await client.query('COMMIT');
  } catch (e) {
    if (!dryRun) await client.query('ROLLBACK');
    if (schemaMissing(e)) {
      resumo.erro = 'Estrutura WMS ausente.';
      return resumo;
    }
    throw e;
  } finally {
    client.release();
  }
  return resumo;
}

module.exports = { restaurarPickingMontagem, restaurarPickingPosMigracao };
