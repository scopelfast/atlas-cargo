'use strict';

/**
 * Suporte e Pedido de apoio → WhatsApp via Switch Digital do tenant padrão.
 * Destino: CONFIGURACAO.whatsapp_destino_suporte (default) ou TELEFONE_SUPORTE (.env).
 */

const crypto = require('crypto');
const { poolPromise } = require('../config/db');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const { enviarUmaMensagemSwitchDigital } = require('./whatsapp-switch-digital.service');

const CHAVE_DESTINO = 'whatsapp_destino_suporte';
const DEDUP_MS = 120000;
const MAX_ASSUNTO = 120;
const MAX_DESC = 800;
const MAX_PAGINA = 200;
const TIPOS_AJUDA = new Set(['OPERACIONAL', 'TECNICO', 'FINANCEIRO', 'OUTRO']);

let tabelaPronta = false;

async function garantirTabela(pool) {
  if (tabelaPronta) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "APOIO_WHATSAPP_LOG" (
      "ID" bigserial PRIMARY KEY,
      "DH" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "TIPO" varchar(20) NOT NULL,
      "ORIGEM" varchar(20) NOT NULL,
      "TENANT_ORIGEM" varchar(64) NOT NULL,
      "SGUSUARIO" varchar(80) NULL,
      "ASSUNTO" varchar(120) NULL,
      "TIPO_AJUDA" varchar(40) NULL,
      "PAGINA" varchar(200) NULL,
      "RESULTADO" char(1) NOT NULL,
      "DETALHE" varchar(400) NULL,
      "DESTINO_MASCARA" varchar(20) NULL,
      "FINGERPRINT" varchar(64) NULL,
      "IP" varchar(64) NULL
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "IX_APOIO_WHATSAPP_LOG_DH"
      ON "APOIO_WHATSAPP_LOG" ("DH" DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "IX_APOIO_WHATSAPP_LOG_FP"
      ON "APOIO_WHATSAPP_LOG" ("TENANT_ORIGEM", "FINGERPRINT", "DH" DESC)
  `);
  tabelaPronta = true;
}

function soDigitos(v) {
  return String(v || '').replace(/\D/g, '');
}

function mascaraDestino(num) {
  const d = soDigitos(num);
  if (d.length < 4) return '••••';
  return '••••' + d.slice(-4);
}

function normalizarDestino(raw) {
  let d = soDigitos(raw);
  if (!d) return '';
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (d.length < 12 || d.length > 15) return '';
  return d;
}

async function lerDestinoConfigurado(pool) {
  const tid = getDefaultTenantId();
  const r = await pool.query(
    `SELECT "VALOR" FROM "CONFIGURACAO"
      WHERE "TENANT_ID" = $1 AND "CHAVE" = $2
      LIMIT 1`,
    [tid, CHAVE_DESTINO]
  );
  const fromDb = r.rows[0] && (r.rows[0].VALOR != null ? r.rows[0].VALOR : r.rows[0].valor);
  const fromEnv = process.env.TELEFONE_SUPORTE || '';
  return normalizarDestino(fromDb || fromEnv);
}

async function destinoEstaConfigurado(pool) {
  const d = await lerDestinoConfigurado(pool || (await poolPromise));
  return { ok: !!d, mascara: d ? mascaraDestino(d) : null };
}

function fingerprint(parts) {
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 64);
}

function ipDe(req) {
  const fwd = req && req.headers ? req.headers['x-forwarded-for'] : '';
  const raw = (fwd && String(fwd).split(',')[0]) || (req && req.ip) || '';
  return String(raw).replace(/^::ffff:/, '').trim().slice(0, 64);
}

async function registrarLog(pool, row) {
  await garantirTabela(pool);
  await pool.query(
    `INSERT INTO "APOIO_WHATSAPP_LOG"
      ("TIPO","ORIGEM","TENANT_ORIGEM","SGUSUARIO","ASSUNTO","TIPO_AJUDA","PAGINA",
       "RESULTADO","DETALHE","DESTINO_MASCARA","FINGERPRINT","IP")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      row.tipo,
      row.origem,
      row.tenantOrigem,
      row.usuario || null,
      row.assunto || null,
      row.tipoAjuda || null,
      row.pagina || null,
      row.resultado,
      row.detalhe ? String(row.detalhe).slice(0, 400) : null,
      row.destinoMascara || null,
      row.fingerprint || null,
      row.ip || null,
    ]
  );
}

async function jaEnviadoRecentemente(pool, tenantOrigem, fp) {
  await garantirTabela(pool);
  const r = await pool.query(
    `SELECT "ID","RESULTADO","DH" FROM "APOIO_WHATSAPP_LOG"
      WHERE "TENANT_ORIGEM" = $1 AND "FINGERPRINT" = $2
        AND "DH" > (CURRENT_TIMESTAMP - ($3::text || ' milliseconds')::interval)
        AND "RESULTADO" = 'S'
      ORDER BY "DH" DESC
      LIMIT 1`,
    [tenantOrigem, fp, String(DEDUP_MS)]
  );
  return r.rows[0] || null;
}

function montarCorpo({ tipo, origem, tenantOrigem, usuario, assunto, tipoAjuda, descricao, pagina, agora }) {
  const linhas = [
    tipo === 'SUPORTE' ? 'Atlas Cargo — Suporte' : 'Atlas Cargo — Pedido de apoio',
    `Origem: ${origem}`,
    `Empresa/tenant: ${tenantOrigem}`,
    `Usuário: ${usuario || '(não identificado)'}`,
    `Quando: ${agora}`,
  ];
  if (tipo === 'SUPORTE') {
    linhas.push(`Assunto: ${assunto}`);
  } else {
    linhas.push(`Tipo de ajuda: ${tipoAjuda}`);
  }
  if (pagina) linhas.push(`Página/módulo: ${pagina}`);
  linhas.push('', 'Descrição:', descricao);
  return linhas.join('\n').slice(0, 3500);
}

/**
 * @param {object} args
 * @param {'SUPORTE'|'APOIO'} args.tipo
 * @param {'PAINEL'|'MOTORISTA'} args.origem
 * @param {string} args.tenantOrigem — sempre da sessão
 * @param {string} args.usuario
 * @param {string} [args.assunto]
 * @param {string} [args.tipoAjuda]
 * @param {string} args.descricao
 * @param {string} [args.pagina]
 * @param {object} [args.req]
 */
async function enviarPedido(args) {
  const pool = await poolPromise;
  await garantirTabela(pool);

  const tipo = String(args.tipo || '').toUpperCase() === 'APOIO' ? 'APOIO' : 'SUPORTE';
  const origem = String(args.origem || '').toUpperCase() === 'MOTORISTA' ? 'MOTORISTA' : 'PAINEL';
  const tenantOrigem = String(args.tenantOrigem || '').trim();
  const usuario = String(args.usuario || '').trim().slice(0, 80);
  const assunto = String(args.assunto || '').trim().slice(0, MAX_ASSUNTO);
  const tipoAjuda = String(args.tipoAjuda || '').trim().toUpperCase().slice(0, 40);
  const descricao = String(args.descricao || '').trim().slice(0, MAX_DESC);
  const pagina = String(args.pagina || '').trim().slice(0, MAX_PAGINA);
  const ip = ipDe(args.req);

  if (!tenantOrigem) {
    return { ok: false, status: 400, code: 'TENANT', message: 'Tenant da sessão obrigatório.' };
  }
  if (!usuario) {
    return { ok: false, status: 401, code: 'USUARIO', message: 'Usuário não autenticado.' };
  }
  if (descricao.length < 10) {
    return { ok: false, status: 400, code: 'DESCRICAO', message: 'Descreva o problema (mínimo 10 caracteres).' };
  }
  if (tipo === 'SUPORTE' && assunto.length < 3) {
    return { ok: false, status: 400, code: 'ASSUNTO', message: 'Informe o assunto (mínimo 3 caracteres).' };
  }
  if (tipo === 'APOIO' && !TIPOS_AJUDA.has(tipoAjuda)) {
    return {
      ok: false,
      status: 400,
      code: 'TIPO_AJUDA',
      message: 'Tipo de ajuda inválido. Use OPERACIONAL, TECNICO, FINANCEIRO ou OUTRO.',
    };
  }

  const fp = fingerprint([
    tipo,
    origem,
    tenantOrigem,
    usuario.toUpperCase(),
    tipo === 'SUPORTE' ? assunto.toLowerCase() : tipoAjuda,
    descricao.toLowerCase().slice(0, 200),
  ]);

  const dup = await jaEnviadoRecentemente(pool, tenantOrigem, fp);
  if (dup) {
    return {
      ok: true,
      deduplicado: true,
      message: 'Este pedido já foi enviado há pouco. Aguarde antes de reenviar.',
    };
  }

  const destino = await lerDestinoConfigurado(pool);
  if (!destino) {
    await registrarLog(pool, {
      tipo,
      origem,
      tenantOrigem,
      usuario,
      assunto: tipo === 'SUPORTE' ? assunto : null,
      tipoAjuda: tipo === 'APOIO' ? tipoAjuda : null,
      pagina,
      resultado: 'N',
      detalhe: 'Destino Atlas (whatsapp_destino_suporte / TELEFONE_SUPORTE) não configurado.',
      destinoMascara: null,
      fingerprint: fp,
      ip,
    });
    return {
      ok: false,
      status: 503,
      code: 'DESTINO_AUSENTE',
      message:
        'O canal de suporte da Atlas ainda não está pronto (número de destino não configurado). Tente mais tarde.',
    };
  }

  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const corpo = montarCorpo({
    tipo,
    origem,
    tenantOrigem,
    usuario,
    assunto,
    tipoAjuda,
    descricao,
    pagina,
    agora,
  });

  const envio = await enviarUmaMensagemSwitchDigital(pool, args.req || null, {
    idConvocacao: null,
    numeroCelular: destino,
    corpoMensagem: corpo,
    tenantId: getDefaultTenantId(),
    jaTemDdi: true,
    protocolo: `AP-${tipo.slice(0, 3)}-${Date.now().toString(36).toUpperCase()}`,
  });

  if (!envio.ok) {
    const semCanal = /não configurado|nao configurado|token/i.test(envio.error || '');
    await registrarLog(pool, {
      tipo,
      origem,
      tenantOrigem,
      usuario,
      assunto: tipo === 'SUPORTE' ? assunto : null,
      tipoAjuda: tipo === 'APOIO' ? tipoAjuda : null,
      pagina,
      resultado: 'N',
      detalhe: semCanal
        ? 'Canal Switch do tenant padrão sem token.'
        : String(envio.error || 'Falha no envio').slice(0, 400),
      destinoMascara: mascaraDestino(destino),
      fingerprint: fp,
      ip,
    });
    return {
      ok: false,
      status: semCanal ? 503 : 502,
      code: semCanal ? 'CANAL' : 'ENVIO',
      message: semCanal
        ? 'O WhatsApp da Atlas não está configurado. Tente mais tarde.'
        : 'Não foi possível enviar a mensagem. Tente de novo.',
    };
  }

  await registrarLog(pool, {
    tipo,
    origem,
    tenantOrigem,
    usuario,
    assunto: tipo === 'SUPORTE' ? assunto : null,
    tipoAjuda: tipo === 'APOIO' ? tipoAjuda : null,
    pagina,
    resultado: 'S',
    detalhe: 'Mensagem enviada ao destino Atlas via Switch Digital.',
    destinoMascara: mascaraDestino(destino),
    fingerprint: fp,
    ip,
  });

  return {
    ok: true,
    message: tipo === 'SUPORTE' ? 'Pedido de suporte enviado.' : 'Pedido de apoio enviado.',
  };
}

async function listarLog(pool, query) {
  await garantirTabela(pool);
  const vals = [];
  let where = 'WHERE 1=1';
  const tipo = String(query.tipo || '').trim().toUpperCase();
  if (tipo === 'SUPORTE' || tipo === 'APOIO') {
    vals.push(tipo);
    where += ` AND "TIPO" = $${vals.length}`;
  }
  const lim = Math.min(200, Math.max(1, parseInt(query.limit, 10) || 50));
  vals.push(lim);
  const r = await pool.query(
    `SELECT "ID","DH","TIPO","ORIGEM","TENANT_ORIGEM","SGUSUARIO","ASSUNTO","TIPO_AJUDA",
            "PAGINA","RESULTADO","DETALHE","DESTINO_MASCARA"
       FROM "APOIO_WHATSAPP_LOG"
      ${where}
      ORDER BY "DH" DESC
      LIMIT $${vals.length}`,
    vals
  );
  return r.rows;
}

module.exports = {
  CHAVE_DESTINO,
  TIPOS_AJUDA: Array.from(TIPOS_AJUDA),
  garantirTabela,
  lerDestinoConfigurado,
  destinoEstaConfigurado,
  normalizarDestino,
  mascaraDestino,
  enviarPedido,
  listarLog,
  fingerprint,
  montarCorpo,
};
