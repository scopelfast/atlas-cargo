/**
 * Templates opcionais de WhatsApp (Switch) para alertas automáticos de viagem.
 * Chaves CONFIGURACAO: msg_alert_*_corpo — vazio/ausente = texto padrão (montarMensagemPadrao).
 */

const sql = require('../config/mssql-compat');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');

const CHAVE_PARADA = 'msg_alert_parada_corpo';
const CHAVE_ATRASO = 'msg_alert_atraso_corpo';
const CHAVE_ETA_PRAZO = 'msg_alert_eta_prazo_corpo';
const CHAVE_OFFLINE = 'msg_alert_offline_corpo';
const CHAVE_DESVIO = 'msg_alert_desvio_corpo';
const CHAVE_ATRASO_INICIO = 'msg_alert_atraso_inicio_corpo';
const CHAVE_EXCESSO_VELOCIDADE = 'msg_alert_excesso_velocidade_corpo';

/** tipo alerta (lowercase) -> chave CONFIGURACAO */
const CHAVE_POR_TIPO = {
  parada: CHAVE_PARADA,
  atraso: CHAVE_ATRASO,
  eta_prazo: CHAVE_ETA_PRAZO,
  offline: CHAVE_OFFLINE,
  desvio: CHAVE_DESVIO,
  atraso_inicio: CHAVE_ATRASO_INICIO,
  excesso_velocidade: CHAVE_EXCESSO_VELOCIDADE,
};

const TIPO_LEGIVEL = {
  parada: 'Parada prolongada',
  atraso: 'Atraso',
  eta_prazo: 'ETA preventivo',
  offline: 'Offline',
  desvio: 'Desvio de rota',
  atraso_inicio: 'Atraso para iniciar',
  excesso_velocidade: 'Excesso de velocidade',
};

/**
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {string}
 */
function aplicarPlaceholders(template, vars) {
  if (template == null) return '';
  let out = String(template);
  Object.keys(vars).forEach((key) => {
    const val = vars[key] == null ? '' : String(vars[key]);
    const re = new RegExp(`\\{\\{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'gi');
    out = out.replace(re, val);
  });
  return out;
}

function prioridadeLegivel(severity) {
  const s = (severity || '').toLowerCase();
  if (s === 'high') return 'Alta';
  if (s === 'medium') return 'Média';
  return 'Normal';
}

/**
 * Só dígitos a partir de valor armazenado (numeric ou string).
 * @param {unknown} v
 * @returns {string}
 */
function apenasDigitos(v) {
  if (v == null) return '';
  return String(v).replace(/\D/g, '');
}

function formatarBrLegivel(ddi, ddd, numeroLocal) {
  const n = String(numeroLocal || '');
  if (!n) return ddi ? `+${ddi}` : '';
  if (n.length === 9) return `+${ddi} (${ddd}) ${n.slice(0, 5)}-${n.slice(5)}`;
  if (n.length === 8) return `+${ddi} (${ddd}) ${n.slice(0, 4)}-${n.slice(4)}`;
  return `+${ddi} (${ddd}) ${n}`;
}

/**
 * Partes DDI / DDD / número para templates (Brasil 55 e casos comuns; fallback seguro).
 * @param {unknown} valorBruto — ex.: NRCELULAR do cadastro
 * @returns {{ ddi: string, ddd: string, numero: string, legivel: string }}
 */
function telefoneParaPartesExibicao(valorBruto) {
  const raw = apenasDigitos(valorBruto);
  if (!raw) return { ddi: '', ddd: '', numero: '', legivel: '' };

  // Brasil com código 55 (12 ou 13 dígitos: 55 + DDD + 8 ou 9)
  if (raw.startsWith('55') && raw.length >= 12 && raw.length <= 13) {
    const ddi = '55';
    const rest = raw.slice(2);
    const ddd = rest.slice(0, 2);
    const num = rest.slice(2);
    return { ddi, ddd, numero: num, legivel: formatarBrLegivel(ddi, ddd, num) };
  }

  // Paraguai +595 (ex.: 595 + 9 dígitos ou mais)
  if (raw.startsWith('595') && raw.length >= 10) {
    const ddi = '595';
    const rest = raw.slice(3);
    if (rest.length >= 8) {
      const ddd = rest.slice(0, 2);
      const num = rest.slice(2);
      return { ddi, ddd, numero: num, legivel: `+${ddi} ${ddd} ${num}` };
    }
  }

  // Brasil sem DDI (10 = fixo, 11 = celular com 9)
  if (raw.length === 10 || raw.length === 11) {
    const ddi = '55';
    const ddd = raw.slice(0, 2);
    const num = raw.slice(2);
    return { ddi, ddd, numero: num, legivel: formatarBrLegivel(ddi, ddd, num) };
  }

  // E.164 genérico curto (ex.: EUA +1)
  if (raw.startsWith('1') && raw.length === 11) {
    const ddi = '1';
    const ddd = raw.slice(1, 4);
    const num = raw.slice(4);
    return { ddi, ddd, numero: num, legivel: `+${ddi} (${ddd}) ${num}` };
  }

  return { ddi: '', ddd: '', numero: raw, legivel: `+${raw}` };
}

function variaveisContatoDoAlerta(alerta) {
  const ct = alerta && alerta.contactTemplateVars && typeof alerta.contactTemplateVars === 'object'
    ? alerta.contactTemplateVars
    : {};
  return {
    NOME_MOTORISTA: ct.nomeMotorista != null ? String(ct.nomeMotorista) : '',
    DDI_MOTORISTA: ct.ddiMotorista != null ? String(ct.ddiMotorista) : '',
    DDD_MOTORISTA: ct.dddMotorista != null ? String(ct.dddMotorista) : '',
    NUMERO_MOTORISTA: ct.numeroMotorista != null ? String(ct.numeroMotorista) : '',
    CELULAR_MOTORISTA_LEGIVEL: ct.legivelMotorista != null ? String(ct.legivelMotorista) : '',
    DDI_CONTRATADOR: ct.ddiContratador != null ? String(ct.ddiContratador) : '',
    DDD_CONTRATADOR: ct.dddContratador != null ? String(ct.dddContratador) : '',
    NUMERO_CONTRATADOR: ct.numeroContratador != null ? String(ct.numeroContratador) : '',
    CELULAR_CONTRATADOR_LEGIVEL: ct.legivelContratador != null ? String(ct.legivelContratador) : '',
  };
}

function detalhesParaVars(detailsStr) {
  const vars = {};
  if (detailsStr == null || String(detailsStr).trim() === '') return vars;
  try {
    const o = typeof detailsStr === 'string' ? JSON.parse(detailsStr) : detailsStr;
    if (!o || typeof o !== 'object') return vars;
    for (const [k, v] of Object.entries(o)) {
      const snake = k
        .replace(/([A-Z])/g, '_$1')
        .replace(/^_/, '')
        .toUpperCase();
      if (v !== null && typeof v === 'object') vars[snake] = JSON.stringify(v);
      else vars[snake] = v != null ? String(v) : '';
    }
  } catch (_) {
    /* ignore */
  }
  return vars;
}

/**
 * Corpo padrão (legado) — mesmo formato que alert-notification-service usava.
 * @param {object} alerta - { type, message, idviagem, severity }
 * @param {string} contexto - 'motorista' | 'contratador' | 'central' (reservado; corpo igual hoje)
 */
function montarMensagemPadrao(alerta, contexto) {
  const tipoRaw = (alerta.type || '').toLowerCase().trim();
  const tipo = (alerta.type || '').toUpperCase().replace(/_/g, ' ');
  let detalhes = {};
  try {
    detalhes = alerta && alerta.details ? (typeof alerta.details === 'string' ? JSON.parse(alerta.details) : alerta.details) : {};
  } catch (_) {
    detalhes = {};
  }
  const prefixo = '[Atlas Cargo – Alerta]';
  let texto = `${prefixo}\n\n`;
  if (tipoRaw === 'atraso') {
    const msg = String(alerta.message || '');
    const confirmado = /chegada em atraso|prazo de entrega vencido/i.test(msg);
    texto += confirmado ? '*[ATRASO CONFIRMADO]*\n' : '*[RISCO DE ATRASO]*\n';
  } else {
    texto += `*Tipo:* ${tipo}\n`;
  }
  texto += `*Viagem:* ${alerta.idviagem}\n`;
  texto += `*Mensagem:* ${alerta.message || '-'}\n`;
  if (tipoRaw === 'atraso') {
    const minVencido = Number(detalhes.minutosAtraso);
    const kmRestante = Number(detalhes.distanciaRestanteKm);
    const etaMin = Number(detalhes.etaMinutos);
    if (Number.isFinite(minVencido) && minVencido > 0) {
      texto += `*Prazo vencido:* há ${Math.round(minVencido)} min\n`;
    }
    if (Number.isFinite(kmRestante) && kmRestante > 0) {
      texto += `*Distância restante:* ~${kmRestante.toFixed(1)} km\n`;
    }
    if (Number.isFinite(etaMin) && etaMin > 0) {
      texto += `*ETA restante:* ~${Math.round(etaMin)} min\n`;
    }
  }
  if (alerta.severity) {
    texto += `*Prioridade:* ${alerta.severity === 'high' ? 'Alta' : alerta.severity === 'medium' ? 'Média' : 'Normal'}\n`;
  }
  void contexto;
  return texto;
}

function montarVariaveisCompletas(alerta, contexto) {
  const t = (alerta.type || '').toLowerCase().trim();
  const tipoLeg = TIPO_LEGIVEL[t] || t || 'Alerta';
  const ctx = (contexto || 'motorista').toLowerCase();
  let ctxLabel = 'Motorista';
  if (ctx === 'contratador') ctxLabel = 'Contratador da viagem';
  if (ctx === 'central') ctxLabel = 'Central';
  const vars = {
    PREFIXO_ALERTA: '[Atlas Cargo – Alerta]',
    ID_VIAGEM: alerta.idviagem != null ? String(alerta.idviagem) : '',
    TIPO_ALERTA: t,
    TIPO_ALERTA_LEGIVEL: tipoLeg,
    MENSAGEM: alerta.message != null ? String(alerta.message) : '',
    PRIORIDADE: alerta.severity != null ? String(alerta.severity) : '',
    PRIORIDADE_LEGIVEL: prioridadeLegivel(alerta.severity),
    CONTEXTO_DESTINATARIO: ctx,
    CONTEXTO_DESTINATARIO_LEGIVEL: ctxLabel,
    ...detalhesParaVars(alerta.details),
    ...variaveisContatoDoAlerta(alerta),
  };
  return vars;
}

function usarTemplateOuPadrao(rawTemplate, vars, montarPadrao) {
  if (rawTemplate == null) return montarPadrao();
  const s = String(rawTemplate);
  if (!s.trim()) return montarPadrao();
  const aplicado = aplicarPlaceholders(s, vars);
  if (!aplicado || !String(aplicado).trim()) return montarPadrao();
  return aplicado;
}

/**
 * @param {Record<string, string>} templatesMap — chave CONFIG -> valor bruto
 * @param {object} alerta
 * @param {string} contexto
 * @returns {string}
 */
function resolverMensagemAlerta(templatesMap, alerta, contexto) {
  const t = (alerta.type || '').toLowerCase().trim();
  const chaveCfg = CHAVE_POR_TIPO[t];
  const raw = chaveCfg && templatesMap ? templatesMap[chaveCfg] : undefined;
  const vars = montarVariaveisCompletas(alerta, contexto);
  return usarTemplateOuPadrao(raw, vars, () => montarMensagemPadrao(alerta, contexto));
}

async function carregarTemplatesAlertas(pool, tenantId) {
  const tid =
    tenantId != null && String(tenantId).trim() !== '' ? String(tenantId).trim() : getDefaultTenantId();
  const keys = Object.values(CHAVE_POR_TIPO);
  const inList = keys.map((k) => `'${k.replace(/'/g, "''")}'`).join(', ');
  const r = await pool
    .request()
    .input('tenantId', sql.NVarChar(64), tid)
    .query(`
    SELECT "CHAVE", "VALOR" FROM "CONFIGURACAO"
    WHERE "TENANT_ID" = @tenantId AND "CHAVE" IN (${inList})
  `);
  const map = {};
  keys.forEach((k) => { map[k] = ''; });
  (r.recordset || []).forEach((row) => {
    const k = row.CHAVE || row.chave;
    const v = row.VALOR != null ? row.VALOR : row.valor;
    if (k && map[k] !== undefined) map[k] = v != null ? String(v) : '';
  });
  return map;
}

function obterAlertaExemplo(tipoApi) {
  const id = 12345;
  const pm = telefoneParaPartesExibicao('5511987654321');
  const pc = telefoneParaPartesExibicao('554130251234');
  const base = {
    idviagem: id,
    cdmotorista: 99,
    severity: 'medium',
    contactTemplateVars: {
      nomeMotorista: 'João Motorista (exemplo)',
      ddiMotorista: pm.ddi,
      dddMotorista: pm.ddd,
      numeroMotorista: pm.numero,
      legivelMotorista: pm.legivel,
      ddiContratador: pc.ddi,
      dddContratador: pc.ddd,
      numeroContratador: pc.numero,
      legivelContratador: pc.legivel,
    },
  };
  switch (tipoApi) {
    case 'parada':
      return {
        ...base,
        type: 'parada',
        message: 'Motorista parado há 45 minutos',
        severity: 'medium',
        details: JSON.stringify({
          minutosParado: 45,
          velocidadeMedia: 0,
          origemDeteccao: 'gps',
        }),
      };
    case 'atraso':
      return {
        ...base,
        type: 'atraso',
        message: 'Viagem chegará 30 minutos após o prazo de entrega',
        severity: 'high',
        details: JSON.stringify({
          minutosAtraso: 30,
          margemMinutos: 0,
          etaMinutos: 120,
        }),
      };
    case 'eta_prazo':
      return {
        ...base,
        type: 'eta_prazo',
        message: 'ETA estimado: 25 minutos após o prazo de entrega',
        severity: 'medium',
        details: JSON.stringify({
          etaMinutos: 180,
          minutosAlemPrazo: 25,
          margemMinutos: 0,
        }),
      };
    case 'offline':
      return {
        ...base,
        type: 'offline',
        message: 'Sem posição GPS há 95 minutos',
        severity: 'high',
        details: JSON.stringify({
          minutosOffline: 95,
          ultimaPosicao: '2026-03-27T10:00:00',
        }),
      };
    case 'desvio':
      return {
        ...base,
        type: 'desvio',
        message: 'Desvio de rota detectado: 850m fora do trajeto planejado',
        severity: 'medium',
        details: JSON.stringify({
          distanciaMetros: 850,
          posicaoAtual: { lat: -25.4, lon: -49.3 },
        }),
      };
    case 'atraso_inicio':
      return {
        ...base,
        type: 'atraso_inicio',
        message: 'Atraso para iniciar viagem: previsão de início já passou há 40 minutos',
        severity: 'medium',
        details: JSON.stringify({
          minutosAtraso: 40,
        }),
      };
    case 'excesso_velocidade':
      return {
        ...base,
        type: 'excesso_velocidade',
        message: 'Excesso de velocidade detectado: até 118 km/h (limite 100 km/h)',
        severity: 'high',
        details: JSON.stringify({
          velocidadeMaxKmh: 118,
          velocidadeMediaKmh: 105,
          limiteKmh: 100,
        }),
      };
    default:
      return {
        ...base,
        type: 'parada',
        message: 'Exemplo',
        details: '{}',
      };
  }
}

const TEMPLATE_SUGERIDO_PARADA = `{{PREFIXO_ALERTA}}

*{{TIPO_ALERTA_LEGIVEL}}*
Viagem *{{ID_VIAGEM}}*
{{MENSAGEM}}

_Detalhes: parado {{MINUTOS_PARADO}} min (detecção {{ORIGEM_DETECCAO}})._`;

const TEMPLATE_SUGERIDO_ATRASO = `{{PREFIXO_ALERTA}}

*[ATRASO CONFIRMADO]*
Viagem *{{ID_VIAGEM}}*
{{MENSAGEM}}
*Prazo vencido:* há {{MINUTOS_ATRASO}} min
*Distância restante:* ~{{DISTANCIA_RESTANTE_KM}} km
*ETA restante:* ~{{ETA_MINUTOS}} min`;

const TEMPLATE_SUGERIDO_ETA = `{{PREFIXO_ALERTA}}

*{{TIPO_ALERTA_LEGIVEL}}*
Viagem *{{ID_VIAGEM}}*
{{MENSAGEM}}`;

const TEMPLATE_SUGERIDO_OFFLINE = `{{PREFIXO_ALERTA}}

*{{TIPO_ALERTA_LEGIVEL}}*
Viagem *{{ID_VIAGEM}}*
{{MENSAGEM}}`;

const TEMPLATE_SUGERIDO_DESVIO = `{{PREFIXO_ALERTA}}

*{{TIPO_ALERTA_LEGIVEL}}*
Viagem *{{ID_VIAGEM}}*
{{MENSAGEM}}`;

const TEMPLATE_SUGERIDO_ATRASO_INICIO = `{{PREFIXO_ALERTA}}

*{{TIPO_ALERTA_LEGIVEL}}*
Viagem *{{ID_VIAGEM}}*
{{MENSAGEM}}`;

const TEMPLATE_SUGERIDO_EXCESSO = `{{PREFIXO_ALERTA}}

*{{TIPO_ALERTA_LEGIVEL}}*
Viagem *{{ID_VIAGEM}}*
{{MENSAGEM}}`;

function obterTemplatesSugeridos() {
  return {
    parada: TEMPLATE_SUGERIDO_PARADA,
    atraso: TEMPLATE_SUGERIDO_ATRASO,
    eta_prazo: TEMPLATE_SUGERIDO_ETA,
    offline: TEMPLATE_SUGERIDO_OFFLINE,
    desvio: TEMPLATE_SUGERIDO_DESVIO,
    atraso_inicio: TEMPLATE_SUGERIDO_ATRASO_INICIO,
    excesso_velocidade: TEMPLATE_SUGERIDO_EXCESSO,
  };
}

/**
 * Pré-visualização com alerta de exemplo (destinatário = motorista).
 * @param {string} tipoApi - parada | atraso | eta_prazo | offline | desvio | atraso_inicio | excesso_velocidade
 * @param {string} corpo
 */
function previewComExemplo(tipoApi, corpo) {
  const alerta = obterAlertaExemplo(tipoApi);
  const corpoStr = corpo != null ? String(corpo) : '';
  if (!corpoStr.trim()) {
    return montarMensagemPadrao(alerta, 'motorista');
  }
  const vars = montarVariaveisCompletas(alerta, 'motorista');
  const aplicado = aplicarPlaceholders(corpoStr, vars);
  if (!String(aplicado).trim()) return montarMensagemPadrao(alerta, 'motorista');
  return aplicado;
}

module.exports = {
  CHAVE_PARADA,
  CHAVE_ATRASO,
  CHAVE_ETA_PRAZO,
  CHAVE_OFFLINE,
  CHAVE_DESVIO,
  CHAVE_ATRASO_INICIO,
  CHAVE_EXCESSO_VELOCIDADE,
  CHAVE_POR_TIPO,
  TIPO_LEGIVEL,
  aplicarPlaceholders,
  apenasDigitos,
  telefoneParaPartesExibicao,
  montarMensagemPadrao,
  montarVariaveisCompletas,
  resolverMensagemAlerta,
  carregarTemplatesAlertas,
  obterTemplatesSugeridos,
  previewComExemplo,
  obterAlertaExemplo,
};
