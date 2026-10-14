'use strict';

const { poolPromise } = require('../config/db');
const {
  listarRelatorioVencimentoPorRecebimentoEncerrado,
  linhasParaCsv,
  AVISO_FONTE,
} = require('../services/wms-relatorio-vencimento.service');
const mailout = require('../services/mailout-smtp.service');
const { registrarEnvioRelatorioVencimento } = require('../services/wms-relatorio-vencimento-envio-log.service');
const { marcarLinhasApontadas } = require('../services/wms-shelf-apontado.service');

let intervalHandle = null;
let firstRunTimeout = null;

function jobAtivo() {
  const v = String(process.env.WMS_VENCIMENTO_JOB_ATIVO || 'S').trim().toUpperCase();
  return v !== 'N' && v !== '0' && v !== 'FALSE';
}

function intervaloHoras() {
  const n = parseFloat(process.env.WMS_VENCIMENTO_JOB_INTERVALO_HORAS || '24');
  if (!Number.isFinite(n) || n < 1) return 24;
  if (n > 168) return 168;
  return n;
}

function primeiraExecucaoMinutos() {
  const n = parseInt(process.env.WMS_VENCIMENTO_JOB_PRIMEIRA_EXEC_MIN || '120', 10);
  if (!Number.isFinite(n) || n < 1) return 120;
  if (n > 24 * 60) return 24 * 60;
  return n;
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

/**
 * Um ciclo: por tenant com dono WMS ativo, gera relatório; envia e-mail se SMTP + destinatários configurados.
 * @returns {Promise<{ tenants: number; emailsEnviados: number; linhasTotal: number }>}
 */
async function executarCicloRelatorioVencimentoWms() {
  const pool = await poolPromise;
  let tenants;
  try {
    tenants = await listarTenantsComDonoWms(pool);
  } catch (e) {
    console.warn('[WMS vencimento job] não foi possível listar tenants (tabela ausente?):', e.message);
    return { tenants: 0, emailsEnviados: 0, linhasTotal: 0 };
  }

  if (!tenants.length) {
    console.log('[WMS vencimento job] nenhum tenant com WMS_DONO_ESTOQUE ativo');
    return { tenants: 0, emailsEnviados: 0, linhasTotal: 0 };
  }

  const hoje = new Date().toISOString().slice(0, 10);
  let linhasTotal = 0;
  let emailsEnviados = 0;

  for (const tid of tenants) {
    let rows;
    let avisos;
    try {
      const out = await listarRelatorioVencimentoPorRecebimentoEncerrado(tid, null);
      rows = out.rows || [];
      avisos = out.avisos || [];
    } catch (e) {
      if (e && e.code === 'SCHEMA') {
        console.warn(`[WMS vencimento job] tenant=${tid} estrutura incompleta — ignorado`);
      } else {
        console.error(`[WMS vencimento job] tenant=${tid} erro:`, e.message);
      }
      continue;
    }

    linhasTotal += rows.length;
    const n = rows.length;
    if (n === 0) {
      console.log(`[WMS vencimento job] tenant=${tid} — 0 linhas no horizonte (ok)`);
      continue;
    }

    const csvBody = linhasParaCsv(rows);
    const csv = `\uFEFF${csvBody}`;
    const fn = `wms-vencimento-${tid}-${hoje}.csv`;
    const subject = `[SysScopel WMS] Relatório vencimento — tenant ${tid} — ${hoje} — ${n} linha(s)`;
    const text =
      `Relatório automático de itens com validade dentro do horizonte configurado no dono do estoque.\n\n` +
      `Tenant: ${tid}\n` +
      `Linhas: ${n}\n` +
      (avisos[0] ? `Aviso: ${avisos[0]}\n` : '') +
      `\nFonte: ${AVISO_FONTE}\n`;

    const sent = await mailout.sendMailOptional({
      subject,
      text,
      attachmentCsv: csv,
      attachmentFilename: fn,
    });

    let stEmail = 'N';
    if (sent.ok) {
      emailsEnviados += 1;
      stEmail = 'S';
      console.log(`[WMS vencimento job] tenant=${tid} — ${n} linhas — e-mail enviado (${sent.messageId || 'ok'})`);
      try {
        const stats = await marcarLinhasApontadas(tid, 'JOB', rows, 'JOB');
        console.log(
          `[WMS vencimento job] tenant=${tid} — apontados: +${stats.marcadas || 0} (já ${stats.jaAtivas || 0}, ign. ${stats.ignoradas || 0})`
        );
      } catch (apErr) {
        console.warn('[WMS vencimento job] falha ao marcar apontados:', apErr.message);
      }
    } else {
      stEmail = sent.error ? 'E' : 'N';
      console.log(
        `[WMS vencimento job] tenant=${tid} — ${n} linhas — e-mail não enviado (${sent.skipped || sent.error || '?'})`
      );
    }

    const dsLog = sent.ok ? null : String(sent.error || sent.skipped || '').slice(0, 500) || null;
    try {
      await registrarEnvioRelatorioVencimento(pool, {
        tenantId: tid,
        nuLinhas: n,
        stEmail,
        dsDetalhe: dsLog,
        nmAnexo: fn,
        emailMessageId: sent.ok && sent.messageId ? String(sent.messageId).slice(0, 300) : null,
      });
    } catch (logErr) {
      console.warn('[WMS vencimento job] falha ao gravar histórico de envio:', logErr.message);
    }
  }

  return { tenants: tenants.length, emailsEnviados, linhasTotal };
}

function startWmsRelatorioVencimentoJob() {
  stopWmsRelatorioVencimentoJob();
  if (!jobAtivo()) {
    console.log('[WMS vencimento job] desativado (WMS_VENCIMENTO_JOB_ATIVO=N)');
    return;
  }

  const horas = intervaloHoras();
  const ms = horas * 60 * 60 * 1000;
  const minPrimeira = primeiraExecucaoMinutos();
  console.log(
    `[WMS vencimento job] agendado a cada ${horas} h; primeira execução em ~${minPrimeira} min (ajuste: WMS_VENCIMENTO_JOB_PRIMEIRA_EXEC_MIN)`
  );

  firstRunTimeout = setTimeout(async () => {
    try {
      await executarCicloRelatorioVencimentoWms();
    } catch (err) {
      console.error('[WMS vencimento job] erro na primeira execução:', err.message);
    }
  }, minPrimeira * 60 * 1000);

  intervalHandle = setInterval(async () => {
    try {
      await executarCicloRelatorioVencimentoWms();
    } catch (err) {
      console.error('[WMS vencimento job] erro no ciclo:', err.message);
    }
  }, ms);
}

function stopWmsRelatorioVencimentoJob() {
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
  startWmsRelatorioVencimentoJob,
  stopWmsRelatorioVencimentoJob,
  executarCicloRelatorioVencimentoWms,
};
