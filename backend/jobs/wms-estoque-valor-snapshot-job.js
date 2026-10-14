'use strict';

const { poolPromise } = require('../config/db');
const { executarSnapshotsTenant, hojeIsoTz } = require('../services/wms-estoque-valor.service');

let intervalHandle = null;
let firstRunTimeout = null;

function jobAtivo() {
  const v = String(process.env.WMS_VALOR_ESTOQUE_JOB_ATIVO || 'S').trim().toUpperCase();
  return v !== 'N' && v !== '0' && v !== 'FALSE';
}

/** Hora local do servidor para o snapshot (padrão 23:55). */
function horaSnapshot() {
  const h = parseInt(process.env.WMS_VALOR_ESTOQUE_JOB_HORA || '23', 10);
  const m = parseInt(process.env.WMS_VALOR_ESTOQUE_JOB_MINUTO || '55', 10);
  return {
    h: Number.isFinite(h) && h >= 0 && h <= 23 ? h : 23,
    m: Number.isFinite(m) && m >= 0 && m <= 59 ? m : 55,
  };
}

function msAteProximaExecucao() {
  const { h, m } = horaSnapshot();
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return Math.max(60000, next.getTime() - now.getTime());
}

async function listarTenantsComDonoWms(pool) {
  const r = await pool.query(
    `SELECT DISTINCT TRIM(d."TENANT_ID"::text) AS tid
       FROM "WMS_DONO_ESTOQUE" d
      WHERE COALESCE(TRIM(UPPER(d."FGACTIVE")), 'S') = 'S'
        AND d."TENANT_ID" IS NOT NULL
        AND TRIM(d."TENANT_ID"::text) <> ''`
  );
  return (r.rows || []).map((row) => String(row.tid ?? row.TID ?? '').trim()).filter(Boolean);
}

async function executarCicloSnapshotValorEstoque(dtReferencia) {
  const pool = await poolPromise;
  const dt = dtReferencia || hojeIsoTz();
  let tenants;
  try {
    tenants = await listarTenantsComDonoWms(pool);
  } catch (e) {
    console.warn('[WMS valor estoque job] não foi possível listar tenants:', e.message);
    return { tenants: 0, snapshots: 0 };
  }
  let snapshots = 0;
  for (const tid of tenants) {
    try {
      const gravados = await executarSnapshotsTenant(tid, dt);
      snapshots += gravados.length;
    } catch (e) {
      if (e && (e.code === '42P01' || e.code === '42703')) {
        console.warn(`[WMS valor estoque job] tenant=${tid} tabela ausente — execute adicionar_wms_estoque_valor_snapshot_postgres.sql`);
      } else {
        console.error(`[WMS valor estoque job] tenant=${tid}:`, e.message);
      }
    }
  }
  console.log(`[WMS valor estoque job] dt=${dt} tenants=${tenants.length} snapshots=${snapshots}`);
  return { tenants: tenants.length, snapshots, dt };
}

function agendarProximoCiclo() {
  const ms = msAteProximaExecucao();
  const { h, m } = horaSnapshot();
  console.log(
    `[WMS valor estoque job] próxima execução em ~${Math.round(ms / 60000)} min (${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')})`
  );
  firstRunTimeout = setTimeout(async () => {
    try {
      await executarCicloSnapshotValorEstoque();
    } catch (err) {
      console.error('[WMS valor estoque job] erro no ciclo:', err.message);
    }
    intervalHandle = setInterval(async () => {
      try {
        await executarCicloSnapshotValorEstoque();
      } catch (err) {
        console.error('[WMS valor estoque job] erro no ciclo:', err.message);
      }
    }, 24 * 60 * 60 * 1000);
  }, ms);
}

function startWmsEstoqueValorSnapshotJob() {
  stopWmsEstoqueValorSnapshotJob();
  if (!jobAtivo()) {
    console.log('[WMS valor estoque job] desativado (WMS_VALOR_ESTOQUE_JOB_ATIVO=N)');
    return;
  }
  console.log('[WMS valor estoque job] agendado (snapshot diário de valor de estoque para pico / cobrança %)');
  agendarProximoCiclo();
}

function stopWmsEstoqueValorSnapshotJob() {
  if (firstRunTimeout) {
    clearTimeout(firstRunTimeout);
    firstRunTimeout = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = {
  startWmsEstoqueValorSnapshotJob,
  stopWmsEstoqueValorSnapshotJob,
  executarCicloSnapshotValorEstoque,
};
