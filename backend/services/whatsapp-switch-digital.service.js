'use strict';

/**
 * Envio Switch Digital + logs usados em fluxos de convocação (torre / divergência).
 */

const sql = require('../config/mssql-compat');
const { getSgUser } = require('../utils/audit');
const { tenantIdForRequest } = require('../utils/tenant-context');

function parseSwitchSendSignatureFromDb(val) {
  if (val == null || String(val).trim() === '') return true;
  const u = String(val).trim().toUpperCase();
  return u === 'S' || u === 'SIM' || u === '1' || u === 'TRUE' || u === 'YES';
}

function parseSwitchCloseTicketFromDb(val) {
  if (val == null || String(val).trim() === '') return true;
  const u = String(val).trim().toUpperCase();
  if (u === 'N' || u === 'NAO' || u === 'NÃO' || u === '0' || u === 'FALSE' || u === 'NO') return false;
  return true;
}

async function registrarResumoEtapaWhatsApp(pool, {
  idConvocacao,
  etapa,
  mensagem,
  detalhes,
  status = 'info',
  sgUser = 'SYSTEM'
}) {
  try {
    const titulo = `Fluxo WhatsApp - ${String(etapa || 'ETAPA').toUpperCase()}`;
    await pool.request()
      .input('IDCONVOCACAO', sql.Int, Number.isFinite(Number(idConvocacao)) ? Number(idConvocacao) : null)
      .input('TIPO', String(status || 'info').toLowerCase())
      .input('TITULO', titulo.substring(0, 120))
      .input('MENSAGEM', String(mensagem || '').substring(0, 1000))
      .input('DETALHES', detalhes ? String(detalhes).substring(0, 4000) : null)
      .input('STATUS_HTTP', null)
      .input('TEMPO_RESPOSTA', null)
      .input('sgUser', sql.VarChar(50), String(sgUser || 'SYSTEM').substring(0, 50))
      .query(`
        INSERT INTO [dbo].[LOGSWEBHOOKMETA]
          ([IDCONVOCACAO], [TIPO], [TITULO], [MENSAGEM], [DETALHES], [STATUS_HTTP], [TEMPO_RESPOSTA], [DHLOG], [DHMAINTENANCE], [SGUSER], [SERVERORIG])
        VALUES
          (@IDCONVOCACAO, @TIPO, @TITULO, @MENSAGEM, @DETALHES, @STATUS_HTTP, @TEMPO_RESPOSTA, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, @sgUser, 'AppDVcargas')
      `);
  } catch (e) {
    console.warn('[WHATSAPP ETAPA] Falha ao registrar resumo:', e.message);
  }
}

/**
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function enviarUmaMensagemSwitchDigital(pool, req, { idConvocacao, numeroCelular, corpoMensagem, tenantId }) {
  const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
  const tidSw = tenantId != null && String(tenantId).trim() !== ''
    ? String(tenantId).trim()
    : tenantIdForRequest(req);
  const configQuery = await pool
    .request()
    .input('tenantId', sql.NVarChar(64), tidSw)
    .query(`
    SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO"
    WHERE "TENANT_ID" = @tenantId
      AND "CHAVE" IN ('switch_digital_endpoint', 'switch_digital_metodo', 'switch_digital_content_type', 'switch_digital_token', 'switch_digital_user_id', 'switch_digital_queue_id', 'switch_digital_send_signature', 'switch_digital_close_ticket')
  `);
  const config = {
    endpoint: 'https://api.switchdigital.com.br/api/messages/send',
    metodo: 'POST',
    contentType: 'application/json',
    token: '',
    userId: '',
    queueId: '',
    sendSignature: true,
    closeTicket: true
  };
  if (configQuery.recordset) {
    configQuery.recordset.forEach(r => {
      const k = r.CHAVE || r.chave;
      const v = r.VALOR || r.valor;
      if (k === 'switch_digital_endpoint') config.endpoint = v;
      if (k === 'switch_digital_metodo') config.metodo = v;
      if (k === 'switch_digital_content_type') config.contentType = v;
      if (k === 'switch_digital_token') config.token = v;
      if (k === 'switch_digital_user_id') config.userId = v;
      if (k === 'switch_digital_queue_id') config.queueId = v;
      if (k === 'switch_digital_send_signature') config.sendSignature = parseSwitchSendSignatureFromDb(v);
      if (k === 'switch_digital_close_ticket') config.closeTicket = parseSwitchCloseTicketFromDb(v);
    });
  }
  if (!config.token || String(config.token).trim() === '') {
    return { ok: false, error: 'Token Switch Digital não configurado' };
  }
  const numeroBase = String(numeroCelular || '').replace(/\D/g, '');
  let numeroLimpo = numeroBase;
  if (numeroLimpo.length === 10 || numeroLimpo.length === 11) {
    numeroLimpo = `55${numeroLimpo}`;
  }
  if (!numeroLimpo || numeroLimpo.length < 12) {
    return { ok: false, error: 'Número de celular inválido' };
  }
  console.log(
    '[SWITCH DIGITAL] enviarUmaMensagem (CONFIGURACAO): sendSignature=%s closeTicket=%s userId=%s queueId=%s endpoint=%s',
    config.sendSignature,
    config.closeTicket,
    (config.userId && String(config.userId).trim()) || '(omitido)',
    (config.queueId && String(config.queueId).trim()) || '(omitido)',
    (config.endpoint && String(config.endpoint).split('?')[0]) || ''
  );
  const requestBody = {
    number: numeroLimpo,
    body: corpoMensagem,
    sendSignature: config.sendSignature,
    closeTicket: config.closeTicket
  };
  if (config.userId && config.userId.trim() !== '') requestBody.userId = config.userId.trim();
  if (config.queueId && config.queueId.trim() !== '') requestBody.queueId = config.queueId.trim();

  let logStatusEnvio = 'ERRO';
  let logMensagemErro = null;
  let logDhEnvio = null;
  let logStatusHttp = null;
  let logTempoResposta = null;
  let logDetalhesJson = null;

  try {
    const inicio = Date.now();
    const switchRes = await fetch(config.endpoint, {
      method: config.metodo,
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': config.contentType
      },
      body: JSON.stringify(requestBody)
    });
    const tempo = Date.now() - inicio;
    const responseText = await switchRes.text();
    let responseData;
    try { responseData = JSON.parse(responseText); } catch (e) { responseData = responseText; }

    if (switchRes.ok) {
      logStatusEnvio = 'ENVIADO';
      logDhEnvio = new Date();
      logStatusHttp = switchRes.status;
      logTempoResposta = tempo;
      logDetalhesJson = typeof responseData === 'object' ? JSON.stringify(responseData) : String(responseData);
    } else {
      logMensagemErro = (typeof responseData === 'object' ? (responseData.message || responseData.error || JSON.stringify(responseData)) : String(responseData)).substring(0, 500);
      logStatusHttp = switchRes.status;
      logTempoResposta = tempo;
      logDetalhesJson = typeof responseData === 'object' ? JSON.stringify(responseData) : String(responseData);
    }
  } catch (errApi) {
    logMensagemErro = (errApi.message || '').substring(0, 500);
    logDetalhesJson = JSON.stringify({ error: errApi.message });
  }

  const sgUserLog = getSgUser(req) || 'SYSTEM';
  const detalhesStr = (logDetalhesJson || '').substring(0, 4000);

  try {
    await pool.request()
      .input('IDCONVOCACAO', sql.Int, idConvocacao)
      .input('NRCELULAR', numeroLimpo)
      .input('STATUS_ENVIO', logStatusEnvio)
      .input('MENSAGEM_ERRO', logMensagemErro)
      .input('DHENVIO', logDhEnvio)
      .input('DHRESPOSTA_API', logDhEnvio)
      .input('TENTATIVAS', 1)
      .input('sgUser', sgUserLog)
      .query(`
        INSERT INTO [dbo].[LOG_ENVIO_WHATSAPP]
          ([IDCONVOCACAO], [NRCELULAR], [STATUS_ENVIO], [MENSAGEM_ERRO], [DHENVIO], [DHRESPOSTA_API], [TENTATIVAS], [DHMAINTENANCE], [SGUSER], [SERVERORIG])
        VALUES
          (@IDCONVOCACAO, @NRCELULAR, @STATUS_ENVIO, @MENSAGEM_ERRO, @DHENVIO, @DHRESPOSTA_API, @TENTATIVAS, CURRENT_TIMESTAMP, @sgUser, 'AppDVcargas')
      `);
  } catch (logErr) {
    console.error('[SWITCH DIGITAL] Erro ao gravar LOG_ENVIO_WHATSAPP:', logErr.message);
  }

  try {
    await pool.request()
      .input('IDCONVOCACAO', sql.Int, idConvocacao)
      .input('TIPO', 'envio_switch')
      .input('TITULO', `Switch Digital - ${logStatusEnvio === 'ENVIADO' ? 'Enviado' : 'Erro'}`)
      .input('MENSAGEM', logStatusEnvio === 'ENVIADO' ? `Enviado para ${numeroLimpo}` : (logMensagemErro || 'Erro no envio'))
      .input('DETALHES', detalhesStr)
      .input('STATUS_HTTP', logStatusHttp)
      .input('TEMPO_RESPOSTA', logTempoResposta)
      .input('sgUser', sgUserLog)
      .query(`
        INSERT INTO [dbo].[LOGSWEBHOOKMETA]
          ([IDCONVOCACAO], [TIPO], [TITULO], [MENSAGEM], [DETALHES], [STATUS_HTTP], [TEMPO_RESPOSTA], [DHLOG], [DHMAINTENANCE], [SGUSER], [SERVERORIG])
        VALUES
          (@IDCONVOCACAO, @TIPO, @TITULO, @MENSAGEM, @DETALHES, @STATUS_HTTP, @TEMPO_RESPOSTA, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, @sgUser, 'AppDVcargas')
      `);
  } catch (logErr) {
    console.error('[SWITCH DIGITAL] Erro ao gravar LOGSWEBHOOKMETA:', logErr.message);
  }

  return { ok: logStatusEnvio === 'ENVIADO', error: logMensagemErro || undefined };
}

module.exports = {
  parseSwitchSendSignatureFromDb,
  parseSwitchCloseTicketFromDb,
  registrarResumoEtapaWhatsApp,
  enviarUmaMensagemSwitchDigital,
};
