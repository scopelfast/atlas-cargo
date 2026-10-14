'use strict';

const sql = require('../config/mssql-compat');
const {
  enviarUmaMensagemSwitchDigital,
  registrarResumoEtapaWhatsApp,
} = require('./whatsapp-switch-digital.service');

const CHAVE_DIV_NOTIF_SWITCH = 'divergencia_placas_notificar_switch';
const CHAVE_DIV_NOTIF_TORRE_WS = 'divergencia_placas_notificar_torre_websocket';

function parseConfigSimNao(val, defaultTrue = true) {
  if (val == null || String(val).trim() === '') return defaultTrue;
  const u = String(val).trim().toUpperCase();
  if (u === 'N' || u === 'NAO' || u === 'NÃO' || u === '0' || u === 'FALSE' || u === 'NO') return false;
  if (u === 'S' || u === 'SIM' || u === '1' || u === 'TRUE' || u === 'YES') return true;
  return defaultTrue;
}

async function lerFlagsNotificacaoDivergenciaPlacas(pool, tenantId) {
  let notificarSwitch = true;
  let notificarTorreWs = true;
  try {
    const r = await pool
      .request()
      .input('TENANT_ID', sql.NVarChar(64), tenantId)
      .query(`
        SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO"
        WHERE "TENANT_ID" = @TENANT_ID
          AND ("CHAVE" = 'divergencia_placas_notificar_switch' OR "CHAVE" = 'divergencia_placas_notificar_torre_websocket')
      `);
    const rows = r.recordset || r.rows || [];
    for (const row of rows) {
      const k = row.CHAVE ?? row.chave;
      const v = row.VALOR ?? row.valor;
      if (k === CHAVE_DIV_NOTIF_SWITCH) notificarSwitch = parseConfigSimNao(v, true);
      if (k === CHAVE_DIV_NOTIF_TORRE_WS) notificarTorreWs = parseConfigSimNao(v, true);
    }
  } catch (e) {
    if (e.code !== '42P01' && e.code !== '208') {
      console.warn('[DIVERGENCIA PLACAS] lerFlagsNotificacao:', e.message);
    }
  }
  return { notificarSwitch, notificarTorreWs };
}

/** Exibe número para leitura humana (WhatsApp aceita *negrito* com *). */
function formatarCelularLegivel(num) {
  const d = String(num == null ? '' : num).replace(/\D/g, '');
  if (!d) return '—';
  let n = d;
  if (n.length >= 12 && n.startsWith('55')) n = n.slice(2);
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return d;
}

/** Evita que * na justificativa quebre o negrito do WhatsApp. */
function sanitizarParaNegritoWhatsApp(s) {
  return String(s || '')
    .replace(/\*/g, '·')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Registra divergência de placas sem aceitar a convocação.
 * @param {object} opts
 * @param {number|string} [opts.cdCadastroMotorista] — se informado, exige correspondência (app motorista).
 * @param {string} [opts.sgUserGravacao] — default MOTORISTA_LINK (link público); app motorista usa MOTORISTA.
 * @param {number|null} [opts.vlFretePropostoMotorista] — frete informado pelo motorista (opcional; link/app).
 * @returns {Promise<number>} linhas afetadas
 */
async function gravarDivergenciaPlacasSomente(pool, { idConvocacao, tenantId, texto, cdCadastroMotorista, sgUserGravacao, vlFretePropostoMotorista }) {
  const txt = texto != null ? String(texto).trim().slice(0, 4000) : '';
  const sg = String(sgUserGravacao || 'MOTORISTA_LINK').substring(0, 50);
  const reqSql = pool
    .request()
    .input('IDCONVOCACAO', sql.Int, parseInt(idConvocacao, 10))
    .input('TENANT_ID', sql.NVarChar(64), tenantId)
    .input('TXT', sql.NVarChar(4000), txt)
    .input('SGUSER', sql.VarChar(50), sg);

  let whereExtra = '';
  const mot = cdCadastroMotorista != null ? Number(cdCadastroMotorista) : NaN;
  if (Number.isFinite(mot)) {
    reqSql.input('CDMOT', sql.Decimal(15, 0), mot);
    whereExtra = ' AND [CDCADASTRO_MOTORISTA] = @CDMOT';
  }

  const result = await reqSql.query(`
      UPDATE [dbo].[CONVOCACAO]
      SET [FGCONFIRMACAOPLACAS] = 'D',
          [TXTPLACASDIVERGENCIA] = @TXT,
          [DHCONFIRMACAOPLACAS] = CURRENT_TIMESTAMP,
          [DHMAINTENANCE] = CURRENT_TIMESTAMP,
          [SGUSER] = @SGUSER
      WHERE [IDCONVOCACAO] = @IDCONVOCACAO AND [TENANT_ID] = @TENANT_ID AND [STATUS] = 'PENDENTE'${whereExtra}
    `);
  const n = result.rowsAffected && result.rowsAffected[0] != null ? result.rowsAffected[0] : 0;

  const vlf =
    vlFretePropostoMotorista != null && Number.isFinite(Number(vlFretePropostoMotorista))
      ? Number(vlFretePropostoMotorista)
      : null;
  if (n > 0 && vlf != null && vlf >= 0) {
    try {
      const r2 = pool
        .request()
        .input('IDCONVOCACAO', sql.Int, parseInt(idConvocacao, 10))
        .input('TENANT_ID', sql.NVarChar(64), tenantId)
        .input('VLF', sql.Decimal(15, 2), vlf);
      let w2 = 'WHERE [IDCONVOCACAO] = @IDCONVOCACAO AND [TENANT_ID] = @TENANT_ID';
      if (Number.isFinite(mot)) {
        r2.input('CDMOT', sql.Decimal(15, 0), mot);
        w2 += ' AND [CDCADASTRO_MOTORISTA] = @CDMOT';
      }
      await r2.query(`
        UPDATE [dbo].[CONVOCACAO]
        SET [VL_FRETE_PROPOSTO_MOTORISTA] = @VLF,
            [DHMAINTENANCE] = CURRENT_TIMESTAMP
        ${w2}
      `);
    } catch (e) {
      const em = String(e.message || '');
      if (e.code === '42703' && /VL_FRETE_PROPOSTO/i.test(em)) {
        console.warn('[DIVERGENCIA PLACAS] Coluna VL_FRETE_PROPOSTO_MOTORISTA ausente; frete não persistido.');
      } else {
        console.warn('[DIVERGENCIA PLACAS] Falha ao gravar frete proposto:', em);
      }
    }
  }

  return n;
}

async function notificarDivergenciaPlacasContratador(pool, req, { idConvocacao, tenantId, textoDivergencia, nomeMotorista }) {
  const idCNum = parseInt(idConvocacao, 10);
  const nomeMotAud = String(nomeMotorista || '').trim();
  const detalhesAud = JSON.stringify({
    idConvocacao: idCNum,
    nomeMotorista: nomeMotAud,
    textoMotorista: String(textoDivergencia || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 400),
  });

  // Auditoria primeiro: garante linha em LOGSWEBHOOKMETA mesmo se Switch/CONFIG falhar depois.
  try {
    await registrarResumoEtapaWhatsApp(pool, {
      idConvocacao: idCNum,
      etapa: 'DIVERGENCIA_PLACAS_LINK_PUBLICO',
      mensagem: `Convocação #${idCNum}: divergência de placas — ${nomeMotAud || 'Motorista'} (aceite bloqueado).`,
      detalhes: detalhesAud,
      status: 'warning',
      sgUser: 'MOTORISTA_LINK',
    });
  } catch (audErr) {
    console.warn('[DIVERGENCIA PLACAS] Falha ao registrar auditoria (LOGSWEBHOOKMETA):', audErr.message);
  }

  try {
    const flags = await lerFlagsNotificacaoDivergenciaPlacas(pool, tenantId);
    const r = await pool
      .request()
      .input('IDCONVOCACAO', sql.Int, parseInt(idConvocacao, 10))
      .input('TENANT_ID', sql.NVarChar(64), tenantId)
      .query(`
        SELECT c.[IDVIAGEM],
               upper(TRIM(COALESCE(contr.[RZSOCIAL], ''))) AS [NM_CONTR],
               contr.[NRCELULAR] AS [TEL_CONTR],
               COALESCE(
                 NULLIF(LTRIM(RTRIM(CAST(c.[NRCELULAR] AS VARCHAR(40)))), ''),
                 mot.[NRCELULAR]
               ) AS [TEL_MOTORISTA]
        FROM [dbo].[CONVOCACAO] c
        INNER JOIN [dbo].[VIAGEMMESTRE] v ON v.[IDVIAGEM] = c.[IDVIAGEM] AND v.[TENANT_ID] = c.[TENANT_ID]
        LEFT JOIN [dbo].[CADASTROGERAL] contr ON contr.[CDCADASTRO] = v.[CDCONTRATADOR]
          AND contr.[TENANT_ID] = v.[TENANT_ID]
          AND contr.[FGACTIVE] = 'A'
        LEFT JOIN [dbo].[CADASTROGERAL] mot ON mot.[CDCADASTRO] = c.[CDCADASTRO_MOTORISTA]
          AND mot.[TENANT_ID] = c.[TENANT_ID]
          AND mot.[FGACTIVE] = 'A'
        WHERE c.[IDCONVOCACAO] = @IDCONVOCACAO AND c.[TENANT_ID] = @TENANT_ID
      `);
    const row = r.recordset && r.recordset[0];
    const idViagem = row ? row.IDVIAGEM ?? row.idviagem : '';
    const tel = row ? row.TEL_CONTR ?? row.tel_contr : null;
    const nmContr = row ? row.NM_CONTR ?? row.nm_contr : '';
    const telMotRaw = row ? row.TEL_MOTORISTA ?? row.tel_motorista : null;
    const trechoSan = sanitizarParaNegritoWhatsApp(textoDivergencia).slice(0, 400);
    const trechoBold = trechoSan || 'sem texto informado';
    const nomeMot = sanitizarParaNegritoWhatsApp(String(nomeMotorista || '—').trim()) || '—';
    const nmContrStr = sanitizarParaNegritoWhatsApp(String(nmContr || '—').trim()) || '—';
    const telMotLeg = formatarCelularLegivel(telMotRaw);
    const telMotLinha =
      telMotRaw != null && String(telMotRaw).replace(/\D/g, '').length >= 10
        ? `Celular do motorista: *${telMotLeg}*`
        : 'Celular do motorista: *(não localizado no cadastro / convocação)*';

    const body = [
      '*Atlas Cargo* — *Divergência de placas/conjunto*',
      '',
      `Convocação *#${idConvocacao}* · Viagem *#${idViagem}*`,
      `Motorista: *${nomeMot}*`,
      telMotLinha,
      '',
      '*Justificativa informada pelo motorista:*',
      `*${trechoBold}*`,
      '',
      'Na torre: *Gerenciar Viagens* → aba *Convocações* → marque *Somente divergência de placas*.',
      `Contratador: *${nmContrStr}*.`,
    ].join('\n');
    if (flags.notificarSwitch && tel != null && String(tel).replace(/\D/g, '').length >= 10) {
      try {
        const sw = await enviarUmaMensagemSwitchDigital(pool, req, {
          idConvocacao: idCNum,
          numeroCelular: tel,
          corpoMensagem: body,
          tenantId,
        });
        if (!sw.ok) {
          console.warn('[DIVERGENCIA PLACAS] WhatsApp contratador não enviado:', sw.error || '(sem detalhe)');
          try {
            await registrarResumoEtapaWhatsApp(pool, {
              idConvocacao: idCNum,
              etapa: 'DIVERGENCIA_PLACAS_SWITCH_FALHA',
              mensagem: `Convocação #${idCNum}: WhatsApp ao contratador não foi enviado — ${String(sw.error || 'erro desconhecido').slice(0, 400)}`,
              detalhes: JSON.stringify({ idConvocacao: idCNum, erro: sw.error || null }),
              status: 'erro',
              sgUser: 'MOTORISTA_LINK',
            });
          } catch (_) {
            /* noop */
          }
        }
      } catch (swErr) {
        console.warn('[DIVERGENCIA PLACAS] Exceção ao enviar WhatsApp:', swErr.message);
        try {
          await registrarResumoEtapaWhatsApp(pool, {
            idConvocacao: idCNum,
            etapa: 'DIVERGENCIA_PLACAS_SWITCH_FALHA',
            mensagem: `Convocação #${idCNum}: exceção ao chamar Switch — ${String(swErr.message || swErr).slice(0, 400)}`,
            detalhes: JSON.stringify({ idConvocacao: idCNum, stack: String(swErr.stack || '').slice(0, 1500) }),
            status: 'erro',
            sgUser: 'MOTORISTA_LINK',
          });
        } catch (_) {
          /* noop */
        }
      }
    } else if (!flags.notificarSwitch) {
      console.warn('[DIVERGENCIA PLACAS] Notificação Switch desativada em Configurações (divergencia_placas_notificar_switch).');
    } else {
      console.warn('[DIVERGENCIA PLACAS] Contratador sem celular válido; só log na torre.');
      try {
        await registrarResumoEtapaWhatsApp(pool, {
          idConvocacao: idCNum,
          etapa: 'DIVERGENCIA_PLACAS_SWITCH_FALHA',
          mensagem: `Convocação #${idCNum}: WhatsApp não enviado — cadastro do contratador da viagem sem celular válido (NRCELULAR).`,
          detalhes: JSON.stringify({ idConvocacao: idCNum, nmContr: String(nmContr || '').trim() }),
          status: 'warning',
          sgUser: 'MOTORISTA_LINK',
        });
      } catch (_) {
        /* noop */
      }
    }

    if (flags.notificarTorreWs && req && req.app) {
      try {
        const websocketTorre = req.app.get('websocketTorre');
        if (websocketTorre && typeof websocketTorre.emitirDivergenciaPlacasConvocacao === 'function') {
          websocketTorre.emitirDivergenciaPlacasConvocacao({
            TENANT_ID: String(tenantId || '').trim(),
            IDCONVOCACAO: idCNum,
            IDVIAGEM: idViagem,
            NOME_MOTORISTA: String(nomeMotorista || '').trim(),
            TXTPLACASDIVERGENCIA: String(textoDivergencia || '').trim().slice(0, 400),
            mensagemResumo: `Divergência de placas — conv. #${idCNum} · viagem #${idViagem} · ${String(nomeMotorista || 'Motorista').trim()}`,
          });
        }
      } catch (wsErr) {
        console.warn('[DIVERGENCIA PLACAS] WebSocket torre:', wsErr.message);
      }
    }
  } catch (e) {
    console.warn('[DIVERGENCIA PLACAS] notificar (pós-auditoria):', e.message);
  }
}

module.exports = {
  gravarDivergenciaPlacasSomente,
  notificarDivergenciaPlacasContratador,
  CHAVE_DIV_NOTIF_SWITCH,
  CHAVE_DIV_NOTIF_TORRE_WS,
};
