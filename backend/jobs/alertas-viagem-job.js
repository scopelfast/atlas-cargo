// Job periódico: verifica viagens ativas e gera alertas (parada, desvio, offline, etc.)
// Deve ser iniciado em todo processo que sobe a API (server.js e server-https.js).

const { poolPromise } = require('../config/db');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');

let alertCheckerInterval = null;
let firstRunTimeout = null;

function normalizeSitLists(config) {
  const sitNumStr = (config.alert_situacoes_viagem || '').trim();
  const sitNumList = sitNumStr
    ? sitNumStr.split(',').map((c) => (c || '').trim()).filter(Boolean)
    : null;
  const fgsitStr = (config.alert_fgsitviagem || '').trim();
  const fgsitList = fgsitStr
    ? fgsitStr.split(',').map((c) => (c || '').trim().toUpperCase()).filter(Boolean)
    : null;
  return {
    sitNumList,
    fgsitList,
    hasSitNum: !!(sitNumList && sitNumList.length > 0),
    hasFgSit: !!(fgsitList && fgsitList.length > 0),
  };
}

const TENANT_MATCH_SQL = ` AND COALESCE(NULLIF(TRIM(v."TENANT_ID"::text), ''), $1::text) = $2 `;
const DATE_WINDOW_SQL = ` AND (v."DTPREVINICIO" IS NULL OR v."DTPREVINICIO" >= (CURRENT_TIMESTAMP - INTERVAL '15 days')) `;
/** Situação de viagem alinhada ao tenant da viagem (ou catálogo compartilhado default). */
const JOIN_SITUACAO_TENANT = ` AND (s."TENANT_ID" = COALESCE(NULLIF(TRIM(v."TENANT_ID"::text), ''), $1::text) OR s."TENANT_ID" = 'default') `;

/**
 * Viagens ativas a verificar para um tenant (filtros alert_situacoes_viagem / alert_fgsitviagem da config).
 */
async function listarViagensAtivasParaAlertas(pool, config, tenantTid) {
  const defTid = getDefaultTenantId();
  const { sitNumList, fgsitList, hasSitNum, hasFgSit } = normalizeSitLists(config);

  if (hasSitNum && hasFgSit) {
    const r = await pool.query(
      `SELECT DISTINCT v."IDVIAGEM"
         FROM "VIAGEMMESTRE" v
         INNER JOIN "SITUACAOVIAGEM" s ON v."CDSITUACAOVIAGEM" = s."CDSITUACAOVIAGEM"
           ${JOIN_SITUACAO_TENANT}
         WHERE v."FGACTIVE" = 'A'
           AND TRIM(COALESCE(v."CDSITUACAOVIAGEM"::text, '')) = ANY($3::text[])
           AND TRIM(UPPER(COALESCE(s."FGSITVIAGEM", ''))) = ANY($4::text[])
           ${DATE_WINDOW_SQL}
           ${TENANT_MATCH_SQL}`,
      [defTid, tenantTid, sitNumList, fgsitList]
    );
    return r.rows || [];
  }
  if (hasSitNum) {
    const r = await pool.query(
      `SELECT DISTINCT v."IDVIAGEM"
         FROM "VIAGEMMESTRE" v
         INNER JOIN "SITUACAOVIAGEM" s ON v."CDSITUACAOVIAGEM" = s."CDSITUACAOVIAGEM"
           ${JOIN_SITUACAO_TENANT}
         WHERE v."FGACTIVE" = 'A'
           AND TRIM(COALESCE(v."CDSITUACAOVIAGEM"::text, '')) = ANY($3::text[])
           ${DATE_WINDOW_SQL}
           ${TENANT_MATCH_SQL}`,
      [defTid, tenantTid, sitNumList]
    );
    return r.rows || [];
  }
  if (hasFgSit) {
    const r = await pool.query(
      `SELECT DISTINCT v."IDVIAGEM"
         FROM "VIAGEMMESTRE" v
         INNER JOIN "SITUACAOVIAGEM" s ON v."CDSITUACAOVIAGEM" = s."CDSITUACAOVIAGEM"
           ${JOIN_SITUACAO_TENANT}
         WHERE v."FGACTIVE" = 'A'
           AND TRIM(UPPER(COALESCE(s."FGSITVIAGEM", ''))) = ANY($3::text[])
           ${DATE_WINDOW_SQL}
           ${TENANT_MATCH_SQL}`,
      [defTid, tenantTid, fgsitList]
    );
    return r.rows || [];
  }
  const r = await pool.query(
    `SELECT DISTINCT v."IDVIAGEM"
       FROM "VIAGEMMESTRE" v
       INNER JOIN "SITUACAOVIAGEM" s ON v."CDSITUACAOVIAGEM" = s."CDSITUACAOVIAGEM"
         ${JOIN_SITUACAO_TENANT}
       WHERE v."FGACTIVE" = 'A'
         AND COALESCE(TRIM(UPPER(s."FGSITVIAGEM")), '') NOT IN ('D', 'E', 'F', 'C')
         ${DATE_WINDOW_SQL}
         ${TENANT_MATCH_SQL}`,
    [defTid, tenantTid]
  );
  return r.rows || [];
}

async function listarTenantsComViagensCandidatas(pool) {
  const defTid = getDefaultTenantId();
  const r = await pool.query(
    `SELECT DISTINCT COALESCE(NULLIF(TRIM(v."TENANT_ID"::text), ''), $1::text) AS tid
     FROM "VIAGEMMESTRE" v
     INNER JOIN "SITUACAOVIAGEM" s ON v."CDSITUACAOVIAGEM" = s."CDSITUACAOVIAGEM"
       ${JOIN_SITUACAO_TENANT}
     WHERE v."FGACTIVE" = 'A'
       AND COALESCE(TRIM(UPPER(s."FGSITVIAGEM")), '') NOT IN ('D', 'E', 'F', 'C')
       AND (v."DTPREVINICIO" IS NULL OR v."DTPREVINICIO" >= (CURRENT_TIMESTAMP - INTERVAL '15 days'))`,
    [defTid]
  );
  return r.rows || [];
}

/**
 * @param {import('express').Application} app - Express app (para app.get('websocketTorre'))
 */
function startAlertJob(app) {
  stopAlertJob();

  const alertService = require('../services/alert-service');

  let INTERVALO_MINUTOS = 5;
  poolPromise
    .then(async (pool) => {
      const config = await alertService.getAlertConfig(pool, false, getDefaultTenantId());
      const n = Number(config.alert_job_intervalo_minutos);
      if (!isNaN(n) && n >= 1 && n <= 60) INTERVALO_MINUTOS = n;
    })
    .catch(() => {})
    .finally(() => {
      const INTERVALO_MS = INTERVALO_MINUTOS * 60 * 1000;
      console.log(`🔄 Job de alertas iniciado (verificação a cada ${INTERVALO_MINUTOS} minutos)`);

      firstRunTimeout = setTimeout(async () => {
        try {
          await verificarAlertasViagensAtivas(app);
        } catch (err) {
          console.error('Erro na primeira verificação de alertas:', err.message);
        }
      }, 30000);

      alertCheckerInterval = setInterval(async () => {
        try {
          await verificarAlertasViagensAtivas(app);
        } catch (err) {
          console.error('Erro ao verificar alertas:', err.message);
        }
      }, INTERVALO_MS);
    });
}

function stopAlertJob() {
  if (firstRunTimeout) {
    clearTimeout(firstRunTimeout);
    firstRunTimeout = null;
  }
  if (alertCheckerInterval) {
    clearInterval(alertCheckerInterval);
    alertCheckerInterval = null;
  }
}

async function verificarAlertasViagensAtivas(app) {
  const alertService = require('../services/alert-service');
  const pool = await poolPromise;
  const tenants = await listarTenantsComViagensCandidatas(pool);
  if (!tenants.length) {
    console.log('ℹ️  Nenhuma viagem ativa encontrada para verificação de alertas');
    return;
  }

  let totalAlertas = 0;
  let totalViagensVerificadas = 0;
  const websocketTorre = app && typeof app.get === 'function' ? app.get('websocketTorre') : null;

  for (const row of tenants) {
    const tid = String(row.tid ?? row.TID ?? '').trim() || getDefaultTenantId();
    const config = await alertService.getAlertConfig(pool, false, tid);
    if (config.alert_job_ativo === 'N') {
      continue;
    }

    const sitNumStr = (config.alert_situacoes_viagem || '').trim();
    const fgsitStr = (config.alert_fgsitviagem || '').trim();
    const sitNumList = sitNumStr
      ? sitNumStr.split(',').map((c) => (c || '').trim()).filter(Boolean)
      : null;
    const fgsitList = fgsitStr
      ? fgsitStr.split(',').map((c) => (c || '').trim().toUpperCase()).filter(Boolean)
      : null;
    const hasSitNum = !!(sitNumList && sitNumList.length > 0);
    const hasFgSit = !!(fgsitList && fgsitList.length > 0);
    const hbTipos = String(config.alert_heartbeat_tipos || '')
      .split(',')
      .map((x) => String(x || '').trim().toUpperCase())
      .filter(Boolean)
      .join(',') || '(vazio)';
    console.log(
      `🔎 [Alertas] tenant=${tid} filtros: situacoesNumericas=${hasSitNum ? sitNumList.join(',') : '(padrao)'} fgsit=${hasFgSit ? fgsitList.join(',') : '(padrao exclui D,E,F,C)'}`
    );
    console.log(
      `🧪 [Alertas] tenant=${tid} config: parada_vel_max=${Number(config.alert_parada_velocidade_max)} parada_min=${Number(config.alert_parada_minutos_min)} parada_raio=${Number(config.alert_parada_raio_metros)} janela=${Number(config.alert_parada_janela_posicoes)} desvio_suprimir_parado=${String(config.alert_desvio_suprimir_quando_parado_ativo || 'S').toUpperCase()} cooldown=${Number(config.alert_cooldown_minutos)} heartbeat_ativo=${String(config.alert_heartbeat_ativo || 'N').toUpperCase()} heartbeat_intervalo=${Number(config.alert_heartbeat_intervalo_minutos)} heartbeat_tipos=${hbTipos}`
    );

    const viagens = await listarViagensAtivasParaAlertas(pool, config, tid);
    if (viagens.length === 0) {
      continue;
    }

    console.log(`🔍 [Alertas] tenant=${tid} — verificando ${viagens.length} viagem(ns)`);
    totalViagensVerificadas += viagens.length;

    for (const viagem of viagens) {
      try {
        const id = viagem.IDVIAGEM ?? viagem.idviagem;
        const alertas = await alertService.verificarAlertas(id);
        totalAlertas += alertas.length;

        if (websocketTorre && alertas.length > 0) {
          alertas.forEach((alerta) => {
            websocketTorre.emitirNovoAlerta(alerta);
          });
        }
      } catch (err) {
        console.error(`Erro ao verificar alertas da viagem ${viagem.IDVIAGEM}:`, err.message);
      }
    }
  }

  if (totalViagensVerificadas === 0) {
    console.log('ℹ️  Nenhuma viagem ativa encontrada para verificação de alertas (após filtros por tenant)');
    return;
  }

  if (totalAlertas > 0) {
    console.log(`⚠️  ${totalAlertas} alerta(s) encontrado(s) em ${totalViagensVerificadas} viagem(ns) verificada(s)`);
  } else {
    console.log(`✅ Nenhum alerta novo encontrado em ${totalViagensVerificadas} viagem(ns) verificada(s)`);
  }
}

/** Para aplicar novo `alert_job_intervalo_minutos` sem reinício manual do processo (chamar após gravar CONFIGURACAO do tenant default). */
function restartAlertJob(app) {
  startAlertJob(app);
}

module.exports = { startAlertJob, stopAlertJob, restartAlertJob };
