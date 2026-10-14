'use strict';

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ tenantId: string; nuLinhas: number; stEmail: 'S'|'N'|'E'; dsDetalhe?: string|null; nmAnexo?: string|null; emailMessageId?: string|null }} row
 */
async function registrarEnvioRelatorioVencimento(pool, row) {
  const tid = String(row.tenantId || '').trim();
  if (!tid) return;
  const n = Math.max(0, parseInt(row.nuLinhas, 10) || 0);
  const st = row.stEmail === 'S' || row.stEmail === 'E' ? row.stEmail : 'N';
  const ds = row.dsDetalhe != null ? String(row.dsDetalhe).slice(0, 500) : null;
  const nm = row.nmAnexo != null ? String(row.nmAnexo).slice(0, 200) : null;
  const mid = row.emailMessageId != null ? String(row.emailMessageId).slice(0, 300) : null;
  try {
    await pool.query(
      `INSERT INTO "WMS_RELATORIO_VENCIMENTO_ENVIO"
        ("TENANT_ID", "NU_LINHAS", "ST_EMAIL", "DS_DETALHE", "NM_ANEXO", "EMAIL_MESSAGE_ID")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tid, n, st, ds || null, nm || null, mid || null]
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
async function listarHistoricoEnvioRelatorioVencimento(pool, tenantId, limit) {
  const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  try {
    const r = await pool.query(
      `SELECT "CD_ENVIO", "DH_ENVIO", "NU_LINHAS", "ST_EMAIL", "DS_DETALHE", "NM_ANEXO", "EMAIL_MESSAGE_ID"
         FROM "WMS_RELATORIO_VENCIMENTO_ENVIO"
        WHERE "TENANT_ID" = $1
        ORDER BY "DH_ENVIO" DESC, "CD_ENVIO" DESC
        LIMIT $2`,
      [tenantId, lim]
    );
    return { rows: r.rows || [], ok: true };
  } catch (e) {
    if (schemaMissing(e)) {
      return { rows: [], ok: false, aviso: 'Tabela de histórico não instalada. Execute backend/scripts/adicionar_wms_relatorio_vencimento_envio_log_postgres.sql.' };
    }
    throw e;
  }
}

module.exports = {
  registrarEnvioRelatorioVencimento,
  listarHistoricoEnvioRelatorioVencimento,
};
