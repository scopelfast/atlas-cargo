'use strict';

const { poolPromise } = require('../config/db');
const {
  aplicarCategoriaAltaConfiancaEmLote,
  listarDonosComProdutoSemCategoria,
  schemaMissing,
} = require('../services/wms-categoria-sugestao.service');
const { registrarExecucaoJobCategoria } = require('../services/wms-categoria-sugestao-log.service');

let intervalHandle = null;
let firstRunTimeout = null;

const SG_JOB = 'JOB_CATEGORIA_AUTO';

function jobAtivo() {
  const v = String(process.env.WMS_CATEGORIA_JOB_ATIVO || 'N').trim().toUpperCase();
  return v === 'S' || v === '1' || v === 'TRUE';
}

function dryRunAtivo() {
  const v = String(process.env.WMS_CATEGORIA_JOB_DRY_RUN || 'N').trim().toUpperCase();
  return v === 'S' || v === '1' || v === 'TRUE';
}

function intervaloHoras() {
  const n = parseFloat(process.env.WMS_CATEGORIA_JOB_INTERVALO_HORAS || '24');
  if (!Number.isFinite(n) || n < 1) return 24;
  if (n > 168) return 168;
  return n;
}

function primeiraExecucaoMinutos() {
  const n = parseInt(process.env.WMS_CATEGORIA_JOB_PRIMEIRA_EXEC_MIN || '240', 10);
  if (!Number.isFinite(n) || n < 1) return 240;
  if (n > 24 * 60) return 24 * 60;
  return n;
}

function tenantFiltroEnv() {
  const v = String(process.env.WMS_CATEGORIA_JOB_TENANT_ID || '').trim();
  return v || null;
}

/** Lista de CD_DONO (ex.: "1" para Mana piloto, ou "1,2"). Vazio = todos com pendência. */
function donosFiltroEnv() {
  const raw = String(process.env.WMS_CATEGORIA_JOB_CD_DONOS || process.env.WMS_CATEGORIA_JOB_CD_DONO || '').trim();
  if (!raw) return null;
  const out = raw
    .split(/[,;]+/)
    .map((x) => parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n));
  return out.length ? out : null;
}

async function listarTenantsComDonoWms(pool) {
  const tidFiltro = tenantFiltroEnv();
  const params = [];
  let sql = `
    SELECT DISTINCT TRIM(d."TENANT_ID"::text) AS tid
      FROM "WMS_DONO_ESTOQUE" d
     WHERE COALESCE(TRIM(UPPER(d."FGACTIVE")), 'S') = 'S'
       AND d."TENANT_ID" IS NOT NULL
       AND TRIM(d."TENANT_ID"::text) <> ''`;
  if (tidFiltro) {
    sql += ` AND TRIM(d."TENANT_ID"::text) = $1`;
    params.push(tidFiltro);
  }
  const r = await pool.query(sql, params);
  return (r.rows || []).map((row) => String(row.tid ?? row.TID ?? '').trim()).filter(Boolean);
}

/**
 * Um ciclo: por tenant/dono, aplica somente sugestões de confiança alta.
 * @returns {Promise<{ tenants: number; donos: number; candidatos: number; atualizados: number; dryRun: boolean }>}
 */
async function executarCicloCategoriaAltaConfianca(opts) {
  opts = opts || {};
  const dryRun = opts.dryRun != null ? !!opts.dryRun : dryRunAtivo();
  const pool = await poolPromise;
  let tenants;
  const tidManual = opts.tenantId != null ? String(opts.tenantId).trim() : '';
  try {
    tenants = tidManual ? [tidManual] : await listarTenantsComDonoWms(pool);
  } catch (e) {
    console.warn('[WMS categoria job] não foi possível listar tenants:', e.message);
    return { tenants: 0, donos: 0, candidatos: 0, atualizados: 0, dryRun };
  }

  if (!tenants.length) {
    console.log('[WMS categoria job] nenhum tenant com dono WMS ativo');
    return { tenants: 0, donos: 0, candidatos: 0, atualizados: 0, dryRun };
  }

  const donosEnv = opts.cdDonos != null ? opts.cdDonos : donosFiltroEnv();
  let donosTotal = 0;
  let candidatosTotal = 0;
  let atualizadosTotal = 0;

  for (const tid of tenants) {
    let donos;
    if (Array.isArray(donosEnv) && donosEnv.length) {
      donos = donosEnv.map((cd) => ({ CD_DONO: cd, NM_DONO: String(cd) }));
    } else {
      try {
        donos = await listarDonosComProdutoSemCategoria(pool, tid);
      } catch (e) {
        if (schemaMissing(e)) {
          console.warn(`[WMS categoria job] tenant=${tid} estrutura incompleta`);
        } else {
          console.error(`[WMS categoria job] tenant=${tid} erro ao listar donos:`, e.message);
        }
        continue;
      }
    }

    if (!donos.length) {
      console.log(`[WMS categoria job] tenant=${tid} — nenhum dono com produto sem categoria`);
      continue;
    }

    for (const d of donos) {
      const cdDono = d.CD_DONO ?? d.cd_dono;
      if (cdDono == null) continue;
      donosTotal += 1;
      const nmDono = d.NM_DONO || d.nm_dono || cdDono;

      try {
        const out = await aplicarCategoriaAltaConfiancaEmLote(pool, {
          tenantId: tid,
          cdDono,
          sgUser: SG_JOB,
          dryRun,
        });

        candidatosTotal += out.candidatos || 0;
        atualizadosTotal += out.atualizados || 0;

        const msg =
          `[WMS categoria job] tenant=${tid} dono=${cdDono} (${nmDono})` +
          ` — candidatos=${out.candidatos} atualizados=${out.atualizados}` +
          (dryRun ? ' [DRY-RUN]' : '') +
          ` — conservação: ${JSON.stringify(out.porConservacao || {})}`;

        console.log(msg);

        try {
          await registrarExecucaoJobCategoria(pool, {
            tenantId: tid,
            cdDono,
            candidatos: out.candidatos,
            atualizados: out.atualizados,
            dryRun,
            dsDetalhe: dryRun ? 'Simulação (sem UPDATE)' : 'Aplicação alta confiança',
            resumoJson: { porConservacao: out.porConservacao || {} },
          });
        } catch (logErr) {
          console.warn('[WMS categoria job] falha ao gravar log:', logErr.message);
        }
      } catch (e) {
        if (schemaMissing(e)) {
          console.warn(`[WMS categoria job] tenant=${tid} dono=${cdDono} — schema ausente`);
        } else {
          console.error(`[WMS categoria job] tenant=${tid} dono=${cdDono} erro:`, e.message);
        }
      }
    }
  }

  return {
    tenants: tenants.length,
    donos: donosTotal,
    candidatos: candidatosTotal,
    atualizados: atualizadosTotal,
    dryRun,
  };
}

function startWmsCategoriaSugestaoJob() {
  stopWmsCategoriaSugestaoJob();
  if (!jobAtivo()) {
    console.log('[WMS categoria job] desativado (defina WMS_CATEGORIA_JOB_ATIVO=S para ligar)');
    return;
  }

  const horas = intervaloHoras();
  const ms = horas * 60 * 60 * 1000;
  const minPrimeira = primeiraExecucaoMinutos();
  const dry = dryRunAtivo();
  const donos = donosFiltroEnv();
  const tid = tenantFiltroEnv();

  console.log(
    `[WMS categoria job] agendado a cada ${horas} h; primeira execução em ~${minPrimeira} min` +
      (dry ? '; DRY-RUN ativo' : '') +
      (tid ? `; tenant=${tid}` : '') +
      (donos ? `; donos=${donos.join(',')}` : '; todos os donos com pendência')
  );

  firstRunTimeout = setTimeout(async () => {
    try {
      await executarCicloCategoriaAltaConfianca();
    } catch (err) {
      console.error('[WMS categoria job] erro na primeira execução:', err.message);
    }
  }, minPrimeira * 60 * 1000);

  intervalHandle = setInterval(async () => {
    try {
      await executarCicloCategoriaAltaConfianca();
    } catch (err) {
      console.error('[WMS categoria job] erro no ciclo:', err.message);
    }
  }, ms);
}

function stopWmsCategoriaSugestaoJob() {
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
  startWmsCategoriaSugestaoJob,
  stopWmsCategoriaSugestaoJob,
  executarCicloCategoriaAltaConfianca,
};
