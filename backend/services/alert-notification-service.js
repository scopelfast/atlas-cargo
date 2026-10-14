// backend/services/alert-notification-service.js
// Envio de notificações (WhatsApp/Switch) quando um alerta é criado.
// Configurável via CONFIGURACAO: alert_whatsapp_* e switch_digital_*.

const { poolPromise } = require('../config/db');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const alertMsgTpl = require('./alert-mensagem-template.service');

const CHAVES_SWITCH = [
  'switch_digital_endpoint', 'switch_digital_metodo', 'switch_digital_content_type',
  'switch_digital_token', 'switch_digital_user_id', 'switch_digital_queue_id',
  'switch_digital_send_signature', 'switch_digital_close_ticket'
];

let logTableReady = false;

async function ensureAlertNotificationLogTable(pool) {
  if (logTableReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "ALERT_NOTIFICATION_LOG" (
      "ID" BIGSERIAL PRIMARY KEY,
      "IDVIAGEM" DECIMAL(15,0),
      "CDMOTORISTA" DECIMAL(15,0),
      "TIPO_ALERTA" VARCHAR(50),
      "DESTINO_CONTEXTO" VARCHAR(30),
      "DESTINO_NUMERO" VARCHAR(30),
      "SUCESSO" BOOLEAN NOT NULL DEFAULT false,
      "STATUS_HTTP" INT,
      "ERRO" TEXT,
      "REQUEST_BODY" TEXT,
      "RESPONSE_BODY" TEXT,
      "DHREGISTRO" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  logTableReady = true;
}

async function registrarLogEnvio(pool, dados) {
  try {
    await ensureAlertNotificationLogTable(pool);
    await pool.query(
      `INSERT INTO "ALERT_NOTIFICATION_LOG" (
        "IDVIAGEM","CDMOTORISTA","TIPO_ALERTA","DESTINO_CONTEXTO","DESTINO_NUMERO",
        "SUCESSO","STATUS_HTTP","ERRO","REQUEST_BODY","RESPONSE_BODY"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        dados.idviagem != null ? Number(dados.idviagem) : null,
        dados.cdmotorista != null ? Number(dados.cdmotorista) : null,
        dados.tipo_alerta || null,
        dados.destino_contexto || null,
        dados.destino_numero || null,
        !!dados.sucesso,
        dados.status_http != null ? Number(dados.status_http) : null,
        dados.erro || null,
        dados.request_body || null,
        dados.response_body || null
      ]
    );
  } catch (err) {
    console.warn('[AlertNotification] Falha ao gravar log de envio:', err.message);
  }
}
async function tenantIdParaAlerta(pool, alerta) {
  if (alerta && alerta.tenantId != null && String(alerta.tenantId).trim() !== '') {
    return String(alerta.tenantId).trim();
  }
  const id = alerta && alerta.idviagem;
  const idn = typeof id === 'number' ? id : parseFloat(id);
  if (Number.isFinite(idn)) {
    try {
      const r = await pool.query(
        'SELECT "TENANT_ID" FROM public."VIAGEMMESTRE" WHERE "IDVIAGEM" = $1 LIMIT 1',
        [idn]
      );
      const row = r.rows && r.rows[0];
      const t = row && (row.TENANT_ID ?? row.tenant_id);
      if (t != null && String(t).trim() !== '') return String(t).trim();
    } catch (_) { /* ignore */ }
  }
  return getDefaultTenantId();
}

/**
 * Carrega configuração Switch + alertas WhatsApp da CONFIGURACAO (escopo tenant)
 * @param {object} pool
 * @param {string} [tenantId]
 * @returns {Promise<{ switch: object, alertWhatsApp: object }>}
 */
async function getConfig(pool, tenantId) {
  const tid =
    tenantId != null && String(tenantId).trim() !== '' ? String(tenantId).trim() : getDefaultTenantId();
  const result = await pool.query(`
    SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO"
    WHERE ("CHAVE" = ANY($1::text[]) OR "CHAVE" LIKE 'alert_whatsapp%')
      AND "TENANT_ID" = $2
  `, [CHAVES_SWITCH, tid]);
  const rows = result.rows || [];
  const switchConfig = {
    endpoint: 'https://api.switchdigital.com.br/api/messages/send',
    metodo: 'POST',
    contentType: 'application/json',
    token: '',
    userId: '',
    queueId: '',
    sendSignature: true,
    closeTicket: true
  };
  const alertWhatsApp = {
    ativo: false,
    notificar_motorista: false,
    notificar_programador: false,
    notificar_central: false,
    celular_central: '',
    tipo_parada: false, tipo_atraso: false, tipo_eta_prazo: false, tipo_offline: false,
    tipo_desvio: false, tipo_atraso_inicio: false, tipo_excesso_velocidade: false
  };
  let reenvioMinutos = 30;
  for (const r of rows) {
    const k = (r.CHAVE || r.chave || '').trim();
    const v = (r.VALOR != null ? r.VALOR : r.valor);
    const val = typeof v === 'string' ? v.trim() : String(v || '');
    if (k === 'switch_digital_endpoint') switchConfig.endpoint = val;
    else if (k === 'switch_digital_metodo') switchConfig.metodo = val;
    else if (k === 'switch_digital_content_type') switchConfig.contentType = val;
    else if (k === 'switch_digital_token') switchConfig.token = val;
    else if (k === 'switch_digital_user_id') switchConfig.userId = val;
    else if (k === 'switch_digital_queue_id') switchConfig.queueId = val;
    else if (k === 'switch_digital_send_signature') switchConfig.sendSignature = (val === 'S' || val === 's');
    else if (k === 'switch_digital_close_ticket') switchConfig.closeTicket = (val !== 'N' && val !== 'n');
    else if (k === 'alert_whatsapp_ativo') alertWhatsApp.ativo = (val === 'S' || val === 's');
    else if (k === 'alert_whatsapp_notificar_motorista') alertWhatsApp.notificar_motorista = (val === 'S' || val === 's');
    else if (k === 'alert_whatsapp_notificar_programador') alertWhatsApp.notificar_programador = (val === 'S' || val === 's');
    else if (k === 'alert_whatsapp_notificar_central') alertWhatsApp.notificar_central = (val === 'S' || val === 's');
    else if (k === 'alert_whatsapp_celular_central') alertWhatsApp.celular_central = val;
    else if (k === 'alert_whatsapp_tipo_parada') alertWhatsApp.tipo_parada = (val === 'S' || val === 's');
    else if (k === 'alert_whatsapp_tipo_atraso') alertWhatsApp.tipo_atraso = (val === 'S' || val === 's');
    else if (k === 'alert_whatsapp_tipo_eta_prazo') alertWhatsApp.tipo_eta_prazo = (val === 'S' || val === 's');
    else if (k === 'alert_whatsapp_tipo_offline') alertWhatsApp.tipo_offline = (val === 'S' || val === 's');
    else if (k === 'alert_whatsapp_tipo_desvio') alertWhatsApp.tipo_desvio = (val === 'S' || val === 's');
    else if (k === 'alert_whatsapp_tipo_atraso_inicio') alertWhatsApp.tipo_atraso_inicio = (val === 'S' || val === 's');
    else if (k === 'alert_whatsapp_tipo_excesso_velocidade') alertWhatsApp.tipo_excesso_velocidade = (val === 'S' || val === 's');
    else if (k === 'alert_whatsapp_reenvio_minutos') {
      const n = Number(val);
      if (Number.isFinite(n) && n >= 0) reenvioMinutos = n;
    }
  }
  return { switch: switchConfig, alertWhatsApp, reenvioMinutos };
}

/**
 * Verifica se o tipo de alerta está habilitado para envio WhatsApp na config
 * @param {object} alertWhatsApp
 * @param {string} type - tipo do alerta (parada, atraso, etc.)
 * @returns {boolean}
 */
function tipoHabilitadoParaWhatsApp(alertWhatsApp, type) {
  const t = (type || '').toLowerCase().trim();
  if (t === 'parada') return !!alertWhatsApp.tipo_parada;
  if (t === 'atraso') return !!alertWhatsApp.tipo_atraso;
  if (t === 'eta_prazo') return !!alertWhatsApp.tipo_eta_prazo;
  if (t === 'offline') return !!alertWhatsApp.tipo_offline;
  if (t === 'desvio') return !!alertWhatsApp.tipo_desvio;
  if (t === 'atraso_inicio') return !!alertWhatsApp.tipo_atraso_inicio;
  if (t === 'excesso_velocidade') return !!alertWhatsApp.tipo_excesso_velocidade;
  return false;
}

/**
 * Busca celular do contratador da viagem (VIAGEMMESTRE.CDCONTRATADOR -> CADASTROGERAL.NRCELULAR)
 * @param {object} pool
 * @param {number} idViagem
 * @returns {Promise<string|null>} Número limpo ou null
 */
function tenantIdParaCelular(tenantId) {
  if (tenantId != null && String(tenantId).trim() !== '') return String(tenantId).trim();
  return getDefaultTenantId();
}

async function getCelularContratadorViagem(pool, idViagem, tenantId) {
  try {
    const tid = tenantIdParaCelular(tenantId);
    const result = await pool.query(`
      SELECT cg."NRCELULAR" AS celular
      FROM "VIAGEMMESTRE" v
      INNER JOIN "CADASTROGERAL" cg ON v."CDCONTRATADOR" = cg."CDCADASTRO" AND cg."TENANT_ID" = v."TENANT_ID"
      WHERE v."IDVIAGEM" = $1 AND v."TENANT_ID" = $2 AND v."CDCONTRATADOR" IS NOT NULL
      LIMIT 1
    `, [idViagem, tid]);
    if (result.rows && result.rows[0] && result.rows[0].celular) {
      const n = String(result.rows[0].celular).replace(/\D/g, '');
      return n.length >= 10 ? n : null;
    }
  } catch (e) {
    console.warn('[AlertNotification] Erro ao buscar celular contratador da viagem:', e.message);
  }
  return null;
}

/**
 * Busca celular do motorista da viagem (CONVOCACAO + CADASTRO)
 * @param {object} pool
 * @param {number} idViagem
 * @param {number|null} cdmotorista
 * @returns {Promise<string|null>} Número limpo (apenas dígitos) ou null
 */
async function getCelularMotorista(pool, idViagem, cdmotorista, tenantId) {
  try {
    const tid = tenantIdParaCelular(tenantId);
    const result = await pool.query(`
      SELECT c."NRCELULAR" AS celular
      FROM "CONVOCACAO" c
      WHERE c."IDVIAGEM" = $1 AND c."TENANT_ID" = $2 AND c."STATUS" IN ('ACEITA', 'CONFIRMADA')
      ORDER BY c."DHRESPOSTA" DESC
      LIMIT 1
    `, [idViagem, tid]);
    if (result.rows && result.rows[0] && result.rows[0].celular) {
      const n = String(result.rows[0].celular).replace(/\D/g, '');
      return n.length >= 10 ? n : null;
    }
    if (cdmotorista) {
      const r2 = await pool.query(`
        SELECT "NRCELULAR" AS celular FROM "CADASTROGERAL"
        WHERE "CDCADASTRO" = $1 AND "TENANT_ID" = $2
        LIMIT 1
      `, [cdmotorista, tid]);
      if (r2.rows && r2.rows[0] && r2.rows[0].celular) {
        const n = String(r2.rows[0].celular).replace(/\D/g, '');
        return n.length >= 10 ? n : null;
      }
    }
  } catch (e) {
    console.warn('[AlertNotification] Erro ao buscar celular motorista:', e.message);
  }
  return null;
}

/**
 * Formata número para WhatsApp (55 + DDD + número)
 * @param {string} numeroLimpo
 * @returns {string}
 */
function formatarNumeroWhatsApp(numeroLimpo) {
  const n = String(numeroLimpo || '').replace(/\D/g, '');
  if (n.length >= 12) return n;
  if (n.length >= 10) return '55' + n;
  return n;
}

/**
 * Preenche alerta.contactTemplateVars para placeholders {{NOME_MOTORISTA}}, {{DDI_MOTORISTA}}, etc.
 * @param {object} pool
 * @param {object} alerta
 * @param {string} tenantId
 */
async function enriquecerAlertaComContatoTemplate(pool, alerta, tenantId) {
  if (!alerta || alerta.idviagem == null) return;
  const tid = tenantIdParaCelular(tenantId);
  let nome = '';
  try {
    const r = await pool.query(
      `SELECT COALESCE(NULLIF(TRIM(cg."NMFANTASIA"), ''), NULLIF(TRIM(cg."RZSOCIAL"), '')) AS nome
       FROM "CONVOCACAO" c
       INNER JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = c."CDCADASTRO_MOTORISTA" AND cg."TENANT_ID" = c."TENANT_ID"
       WHERE c."IDVIAGEM" = $1 AND c."TENANT_ID" = $2 AND c."STATUS" IN ('ACEITA', 'CONFIRMADA')
       ORDER BY c."DHRESPOSTA" DESC NULLS LAST
       LIMIT 1`,
      [Number(alerta.idviagem), tid]
    );
    const row = r.rows && r.rows[0];
    if (row && row.nome != null && String(row.nome).trim() !== '') nome = String(row.nome).trim();
  } catch (e) {
    console.warn('[AlertNotification] Nome motorista (template):', e.message);
  }
  if (!nome && alerta.cdmotorista) {
    try {
      const r2 = await pool.query(
        `SELECT COALESCE(NULLIF(TRIM("NMFANTASIA"), ''), NULLIF(TRIM("RZSOCIAL"), '')) AS nome
         FROM "CADASTROGERAL"
         WHERE "CDCADASTRO" = $1 AND "TENANT_ID" = $2
         LIMIT 1`,
        [alerta.cdmotorista, tid]
      );
      const row2 = r2.rows && r2.rows[0];
      if (row2 && row2.nome != null && String(row2.nome).trim() !== '') nome = String(row2.nome).trim();
    } catch (e) {
      console.warn('[AlertNotification] Nome motorista por CDCADASTRO (template):', e.message);
    }
  }
  const celM = await getCelularMotorista(pool, alerta.idviagem, alerta.cdmotorista, tid);
  const celC = await getCelularContratadorViagem(pool, alerta.idviagem, tid);
  const pm = alertMsgTpl.telefoneParaPartesExibicao(celM);
  const pc = alertMsgTpl.telefoneParaPartesExibicao(celC);
  alerta.contactTemplateVars = {
    nomeMotorista: nome,
    ddiMotorista: pm.ddi,
    dddMotorista: pm.ddd,
    numeroMotorista: pm.numero,
    legivelMotorista: pm.legivel,
    ddiContratador: pc.ddi,
    dddContratador: pc.ddd,
    numeroContratador: pc.numero,
    legivelContratador: pc.legivel,
  };
}

/**
 * Monta corpo da mensagem (legado); preferir resolver com templates em CONFIGURACAO.
 * @param {object} alerta - { type, message, idviagem, severity }
 * @param {string} contexto - 'motorista' | 'contratador' | 'central'
 * @returns {string}
 */
function montarMensagem(alerta, contexto) {
  return alertMsgTpl.montarMensagemPadrao(alerta, contexto);
}

/**
 * Envia uma mensagem via API Switch Digital
 * @param {object} switchConfig
 * @param {string} numeroCelular - número limpo (apenas dígitos)
 * @param {string} corpoMensagem
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function sendViaSwitch(switchConfig, numeroCelular, corpoMensagem) {
  const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
  if (!switchConfig.token || String(switchConfig.token).trim() === '') {
    return { ok: false, error: 'Token Switch Digital não configurado', statusHttp: null, requestBody: null, responseBody: null };
  }
  const numero = formatarNumeroWhatsApp(numeroCelular);
  if (numero.length < 12) return { ok: false, error: 'Número de celular inválido', statusHttp: null, requestBody: null, responseBody: null };
  const body = {
    number: numero,
    body: corpoMensagem,
    sendSignature: !!switchConfig.sendSignature,
    closeTicket: !!switchConfig.closeTicket
  };
  if (switchConfig.userId && switchConfig.userId.trim()) body.userId = switchConfig.userId.trim();
  if (switchConfig.queueId && switchConfig.queueId.trim()) body.queueId = switchConfig.queueId.trim();
  try {
    const res = await fetch(switchConfig.endpoint, {
      method: switchConfig.metodo,
      headers: {
        'Authorization': `Bearer ${switchConfig.token}`,
        'Content-Type': switchConfig.contentType
      },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    if (res.ok) {
      return { ok: true, statusHttp: res.status, requestBody: JSON.stringify(body), responseBody: text };
    }
    let errMsg = text;
    try {
      const data = JSON.parse(text);
      errMsg = data.message || data.error || text;
    } catch (_) {}
    return { ok: false, error: errMsg, statusHttp: res.status, requestBody: JSON.stringify(body), responseBody: text };
  } catch (err) {
    return { ok: false, error: err.message || 'Erro ao enviar', statusHttp: null, requestBody: JSON.stringify(body), responseBody: null };
  }
}

/**
 * Chamado após um alerta ser salvo no banco. Verifica configuração e envia WhatsApp para motorista, programador e central conforme config.
 * Não bloqueia nem propaga erro (apenas log).
 * @param {object} pool
 * @param {object} alerta - { idviagem, cdmotorista, type, message, severity, details }
 */
async function notificarAlertaCriado(pool, alerta) {
  if (!alerta || !alerta.idviagem || !alerta.type) return;
  try {
    const tid = await tenantIdParaAlerta(pool, alerta);
    const { switch: switchConfig, alertWhatsApp, reenvioMinutos } = await getConfig(pool, tid);
    if (!alertWhatsApp.ativo) return;
    if (!tipoHabilitadoParaWhatsApp(alertWhatsApp, alerta.type)) {
      return;
    }
    if (!switchConfig.token || String(switchConfig.token).trim() === '') {
      console.log('[AlertNotification] Switch Digital não configurado; notificação de alerta não enviada.');
      return;
    }
    const templatesMap = await alertMsgTpl.carregarTemplatesAlertas(pool, tid);
    await enriquecerAlertaComContatoTemplate(pool, alerta, tid);
    const envios = [];
    if (alertWhatsApp.notificar_motorista) {
      const cel = await getCelularMotorista(pool, alerta.idviagem, alerta.cdmotorista, tid);
      if (cel) envios.push({ numero: cel, contexto: 'motorista' });
      else console.log('[AlertNotification] Motorista sem celular cadastrado para viagem', alerta.idviagem);
    }
    if (alertWhatsApp.notificar_programador) {
      const cel = await getCelularContratadorViagem(pool, alerta.idviagem, tid);
      if (cel) envios.push({ numero: cel, contexto: 'contratador' });
      else console.log('[AlertNotification] Contratador da viagem sem celular cadastrado', alerta.idviagem);
    }
    if (alertWhatsApp.notificar_central && alertWhatsApp.celular_central) {
      const n = String(alertWhatsApp.celular_central).replace(/\D/g, '');
      if (n.length >= 10) envios.push({ numero: n, contexto: 'central' });
    }
    for (const dest of envios) {
      if (reenvioMinutos > 0) {
        await ensureAlertNotificationLogTable(pool);
        const ultimoEnvio = await pool.query(
          `SELECT 1
           FROM "ALERT_NOTIFICATION_LOG"
           WHERE "IDVIAGEM" = $1
             AND "TIPO_ALERTA" = $2
             AND "DESTINO_CONTEXTO" = $3
             AND "DESTINO_NUMERO" = $4
             AND "DHREGISTRO" >= (CURRENT_TIMESTAMP - ($5 * INTERVAL '1 minute'))
           ORDER BY "DHREGISTRO" DESC
           LIMIT 1`,
          [
            Number(alerta.idviagem),
            String(alerta.type || '').toUpperCase(),
            dest.contexto,
            formatarNumeroWhatsApp(dest.numero),
            Math.floor(Number(reenvioMinutos))
          ]
        );
        if (ultimoEnvio.rows && ultimoEnvio.rows.length > 0) {
          console.log(`[AlertNotification] Em cooldown (${reenvioMinutos} min), não reenviando para ${dest.contexto} (viagem ${alerta.idviagem}, tipo ${alerta.type})`);
          continue;
        }
      }
      const corpo = alertMsgTpl.resolverMensagemAlerta(templatesMap, alerta, dest.contexto);
      const result = await sendViaSwitch(switchConfig, dest.numero, corpo);
      if (result.ok) {
        console.log(`[AlertNotification] WhatsApp enviado para ${dest.contexto} (viagem ${alerta.idviagem}, tipo ${alerta.type})`);
      } else {
        console.warn(`[AlertNotification] Falha ao enviar para ${dest.contexto}:`, result.error);
      }
      await registrarLogEnvio(pool, {
        idviagem: alerta.idviagem,
        cdmotorista: alerta.cdmotorista,
        tipo_alerta: String(alerta.type || '').toUpperCase(),
        destino_contexto: dest.contexto,
        destino_numero: formatarNumeroWhatsApp(dest.numero),
        sucesso: result.ok,
        status_http: result.statusHttp,
        erro: result.error || null,
        request_body: result.requestBody || null,
        response_body: result.responseBody || null
      });
    }
  } catch (err) {
    console.warn('[AlertNotification] Erro ao processar notificação de alerta:', err.message);
  }
}

/**
 * Heartbeat: reenvio periódico de lembrete para alerta já aberto.
 * Não cria novo alerta; apenas notifica novamente por WhatsApp no intervalo configurado.
 * @param {object} pool
 * @param {object} alerta - alerta detectado com __existingAlertId
 * @param {object} config - configuração alert_* já carregada (opcional)
 */
async function notificarHeartbeatAlerta(pool, alerta, config = null) {
  if (!alerta || !alerta.idviagem || !alerta.type) return;
  try {
    const tid = await tenantIdParaAlerta(pool, alerta);
    const { switch: switchConfig, alertWhatsApp } = await getConfig(pool, tid);
    if (!alertWhatsApp.ativo) return;
    if (!tipoHabilitadoParaWhatsApp(alertWhatsApp, alerta.type)) return;
    if (!switchConfig.token || String(switchConfig.token).trim() === '') return;

    const intervaloCfg = Number(config && config.alert_heartbeat_intervalo_minutos);
    const intervaloMin = Number.isFinite(intervaloCfg) && intervaloCfg > 0 ? Math.floor(intervaloCfg) : 15;
    const tipoLog = `${String(alerta.type || '').toUpperCase()}_HEARTBEAT`;

    const templatesMap = await alertMsgTpl.carregarTemplatesAlertas(pool, tid);
    await enriquecerAlertaComContatoTemplate(pool, alerta, tid);
    const envios = [];
    if (alertWhatsApp.notificar_motorista) {
      const cel = await getCelularMotorista(pool, alerta.idviagem, alerta.cdmotorista, tid);
      if (cel) envios.push({ numero: cel, contexto: 'motorista' });
    }
    if (alertWhatsApp.notificar_programador) {
      const cel = await getCelularContratadorViagem(pool, alerta.idviagem, tid);
      if (cel) envios.push({ numero: cel, contexto: 'contratador' });
    }
    if (alertWhatsApp.notificar_central && alertWhatsApp.celular_central) {
      const n = String(alertWhatsApp.celular_central).replace(/\D/g, '');
      if (n.length >= 10) envios.push({ numero: n, contexto: 'central' });
    }

    for (const dest of envios) {
      await ensureAlertNotificationLogTable(pool);
      const ultimoHeartbeat = await pool.query(
        `SELECT 1
         FROM "ALERT_NOTIFICATION_LOG"
         WHERE "IDVIAGEM" = $1
           AND "TIPO_ALERTA" = $2
           AND "DESTINO_CONTEXTO" = $3
           AND "DESTINO_NUMERO" = $4
           AND "DHREGISTRO" >= (CURRENT_TIMESTAMP - ($5 * INTERVAL '1 minute'))
         ORDER BY "DHREGISTRO" DESC
         LIMIT 1`,
        [
          Number(alerta.idviagem),
          tipoLog,
          dest.contexto,
          formatarNumeroWhatsApp(dest.numero),
          intervaloMin
        ]
      );
      if (ultimoHeartbeat.rows && ultimoHeartbeat.rows.length > 0) continue;

      const base = alertMsgTpl.resolverMensagemAlerta(templatesMap, alerta, dest.contexto);
      const corpo = `${base}\n\n[Lembrete automático: alerta ainda pendente]`;
      const result = await sendViaSwitch(switchConfig, dest.numero, corpo);
      await registrarLogEnvio(pool, {
        idviagem: alerta.idviagem,
        cdmotorista: alerta.cdmotorista,
        tipo_alerta: tipoLog,
        destino_contexto: dest.contexto,
        destino_numero: formatarNumeroWhatsApp(dest.numero),
        sucesso: result.ok,
        status_http: result.statusHttp,
        erro: result.error || null,
        request_body: result.requestBody || null,
        response_body: result.responseBody || null
      });
    }
  } catch (err) {
    console.warn('[AlertNotification] Erro no heartbeat de alerta:', err.message);
  }
}

module.exports = {
  getConfig,
  getCelularMotorista,
  getCelularContratadorViagem,
  tipoHabilitadoParaWhatsApp,
  montarMensagem,
  sendViaSwitch,
  notificarAlertaCriado,
  notificarHeartbeatAlerta
};
