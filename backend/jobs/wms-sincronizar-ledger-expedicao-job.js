'use strict';

const { poolPromise } = require('../config/db');
const {
  sincronizarMovimentosExpedicaoSaidaTodasCargas,
} = require('../services/wms-movimento-estoque.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

async function listarTenantsComCargasExpedidas(pool) {
  const r = await pool.query(
    `SELECT DISTINCT TRIM(e."TENANT_ID"::text) AS tid
       FROM "WMS_EXPEDICAO_CARGA" e
      WHERE e."TENANT_ID" IS NOT NULL
        AND TRIM(e."TENANT_ID"::text) <> ''
        AND UPPER(TRIM(COALESCE(e."ST_EXPEDICAO", ''))) = 'EXPEDIDA'`
  );
  return (r.rows || []).map((row) => String(row.tid ?? row.TID ?? '').trim()).filter(Boolean);
}

/**
 * Repara movimentos de saída faltantes (idempotência antiga) em todas as cargas expedidas.
 * @param {{ dryRun?: boolean, tenantId?: string, sgUser?: string }} opts
 */
async function executarCicloSincronizarLedgerExpedicao(opts) {
  opts = opts || {};
  const dryRun = !!opts.dryRun;
  const sgUser = opts.sgUser != null ? String(opts.sgUser).slice(0, 64) : 'WMS_SYNC_LEDGER_JOB';
  const pool = await poolPromise;
  const client = await pool.connect();

  let tenants;
  if (opts.tenantId) {
    tenants = [String(opts.tenantId).trim()];
  } else {
    try {
      tenants = await listarTenantsComCargasExpedidas(pool);
    } catch (e) {
      if (schemaMissing(e)) {
        return { ok: false, skipped: true, motivo: 'schema_ausente' };
      }
      throw e;
    }
  }

  const resumo = {
    ok: true,
    dryRun,
    tenants: tenants.length,
    cargasAnalisadas: 0,
    cargasComPendencia: 0,
    cargasReparadas: 0,
    registrosInseridos: 0,
    porTenant: [],
  };

  try {
    for (const tid of tenants) {
      if (dryRun) {
        const r = await sincronizarMovimentosExpedicaoSaidaTodasCargas(client, tid, sgUser, {
          dryRun: true,
          incluirDetalhes: true,
          maxDetalhes: 200,
        });
        resumo.cargasAnalisadas += r.cargasAnalisadas;
        resumo.cargasComPendencia += r.cargasComPendencia;
        resumo.porTenant.push({ tenantId: tid, ...r });
        continue;
      }

      await client.query('BEGIN');
      try {
        const r = await sincronizarMovimentosExpedicaoSaidaTodasCargas(client, tid, sgUser, {
          dryRun: false,
          incluirDetalhes: true,
          maxDetalhes: 200,
        });
        await client.query('COMMIT');
        resumo.cargasAnalisadas += r.cargasAnalisadas;
        resumo.cargasComPendencia += r.cargasComPendencia;
        resumo.cargasReparadas += r.cargasReparadas;
        resumo.registrosInseridos += r.registrosInseridos;
        resumo.porTenant.push({ tenantId: tid, ...r });
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    client.release();
  }

  console.log(
    `[WMS sync ledger expedição] ${dryRun ? 'diagnóstico' : 'reparo'}: tenants=${resumo.tenants} cargas=${resumo.cargasAnalisadas} pendentes=${resumo.cargasComPendencia} reparadas=${resumo.cargasReparadas} movimentos=${resumo.registrosInseridos}`
  );
  return resumo;
}

let startupTimeout = null;

function syncOnStartAtivo() {
  const v = String(process.env.WMS_SYNC_LEDGER_EXPEDICAO_ON_START || 'S').trim().toUpperCase();
  return v !== 'N' && v !== '0' && v !== 'FALSE';
}

function delayStartMs() {
  const n = parseInt(process.env.WMS_SYNC_LEDGER_EXPEDICAO_START_DELAY_SEC || '45', 10);
  if (!Number.isFinite(n) || n < 5) return 45;
  if (n > 600) return 600;
  return n * 1000;
}

/** Uma execução após subir o servidor (repara histórico sem ação manual). */
function agendarSincronizarLedgerExpedicaoOnStart() {
  if (!syncOnStartAtivo()) return;
  if (startupTimeout) clearTimeout(startupTimeout);
  const ms = delayStartMs();
  startupTimeout = setTimeout(() => {
    executarCicloSincronizarLedgerExpedicao({ dryRun: false, sgUser: 'WMS_SYNC_ON_START' }).catch((e) => {
      console.error('[WMS sync ledger expedição] falha no startup:', e.message);
    });
  }, ms);
  console.log(`[WMS sync ledger expedição] reparo automático agendado em ${ms / 1000}s (WMS_SYNC_LEDGER_EXPEDICAO_ON_START)`);
}

module.exports = {
  executarCicloSincronizarLedgerExpedicao,
  agendarSincronizarLedgerExpedicaoOnStart,
};
