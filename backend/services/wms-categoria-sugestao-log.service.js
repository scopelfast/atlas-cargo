'use strict';

const { schemaMissing } = require('./wms-categoria-sugestao.service');

/**
 * @param {import('pg').Pool} pool
 */
async function registrarExecucaoJobCategoria(pool, row) {
  const tid = String(row.tenantId || '').trim();
  if (!tid) return;
  const cdDono = row.cdDono != null && Number.isFinite(Number(row.cdDono)) ? Number(row.cdDono) : null;
  const candidatos = Math.max(0, parseInt(row.candidatos, 10) || 0);
  const atualizados = Math.max(0, parseInt(row.atualizados, 10) || 0);
  const stDry = row.dryRun ? 'S' : 'N';
  const ds = row.dsDetalhe != null ? String(row.dsDetalhe).slice(0, 800) : null;
  const resumo = row.resumoJson != null ? row.resumoJson : null;
  try {
    await pool.query(
      `INSERT INTO "WMS_CATEGORIA_SUGESTAO_JOB_LOG"
        ("TENANT_ID", "CD_DONO", "NU_CANDIDATOS", "NU_ATUALIZADOS", "ST_DRY_RUN", "DS_DETALHE", "DS_RESUMO_JSON")
       VALUES ($1, $2::integer, $3, $4, $5, $6, $7::jsonb)`,
      [tid, cdDono, candidatos, atualizados, stDry, ds || null, resumo ? JSON.stringify(resumo) : null]
    );
  } catch (e) {
    if (schemaMissing(e)) return;
    throw e;
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} tenantId
 * @param {number} limit
 */
async function listarHistoricoJobCategoria(pool, tenantId, limit) {
  const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  try {
    const r = await pool.query(
      `SELECT
         l."CD_LOG",
         l."DH_EXECUCAO",
         l."TENANT_ID",
         l."CD_DONO",
         o."NOME" AS "NM_DONO",
         l."NU_CANDIDATOS",
         l."NU_ATUALIZADOS",
         l."ST_DRY_RUN",
         l."DS_DETALHE",
         l."DS_RESUMO_JSON"
       FROM "WMS_CATEGORIA_SUGESTAO_JOB_LOG" l
       LEFT JOIN "WMS_DONO_ESTOQUE" o
         ON o."TENANT_ID" = l."TENANT_ID" AND o."CD_DONO" = l."CD_DONO"
       WHERE l."TENANT_ID" = $1
       ORDER BY l."DH_EXECUCAO" DESC, l."CD_LOG" DESC
       LIMIT $2`,
      [tenantId, lim]
    );
    return { rows: r.rows || [], ok: true };
  } catch (e) {
    if (schemaMissing(e)) {
      return {
        rows: [],
        ok: false,
        aviso: 'Tabela de log não instalada. Execute backend/scripts/adicionar_wms_categoria_sugestao_job_log_postgres.sql.',
      };
    }
    throw e;
  }
}

module.exports = {
  registrarExecucaoJobCategoria,
  listarHistoricoJobCategoria,
};
