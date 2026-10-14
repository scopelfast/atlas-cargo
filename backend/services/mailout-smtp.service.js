'use strict';

/**
 * Envio opcional via SMTP (nodemailer). Se SMTP_HOST ou destinatários não estiverem definidos, não envia.
 */
function smtpConfigured() {
  const h = (process.env.SMTP_HOST || '').trim();
  return !!h;
}

function parseDestinatarios() {
  const raw = (process.env.WMS_VENCIMENTO_JOB_EMAIL_TO || '').trim();
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {{ to?: string[]; subject: string; text: string; attachmentCsv?: string; attachmentFilename?: string }} opts
 * @returns {Promise<{ ok: boolean; skipped?: string; messageId?: string; error?: string }>}
 */
async function sendMailOptional(opts) {
  const to = (opts.to && opts.to.length ? opts.to : parseDestinatarios()).filter(Boolean);
  if (!smtpConfigured()) {
    return { ok: false, skipped: 'SMTP_HOST vazio' };
  }
  if (!to.length) {
    return { ok: false, skipped: 'WMS_VENCIMENTO_JOB_EMAIL_TO vazio' };
  }

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (e) {
    return { ok: false, skipped: 'pacote nodemailer não instalado (npm install nodemailer)' };
  }

  const host = (process.env.SMTP_HOST || '').trim();
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure =
    String(process.env.SMTP_SECURE || '').trim().toLowerCase() === 'true' ||
    String(process.env.SMTP_SECURE || '').trim() === '1' ||
    port === 465;
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '').trim();
  const from = (process.env.SMTP_FROM || user || 'noreply@localhost').trim();

  const transporter = nodemailer.createTransport({
    host,
    port: Number.isFinite(port) ? port : 587,
    secure,
    auth: user ? { user, pass } : undefined,
    tls: { rejectUnauthorized: String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || 'true') !== 'false' },
  });

  const mail = {
    from,
    to: to.join(', '),
    subject: opts.subject,
    text: opts.text || '',
  };
  if (opts.attachmentCsv != null && String(opts.attachmentFilename || '').trim()) {
    mail.attachments = [
      {
        filename: String(opts.attachmentFilename).trim(),
        content: opts.attachmentCsv,
        contentType: 'text/csv; charset=utf-8',
      },
    ];
  }

  try {
    const info = await transporter.sendMail(mail);
    return { ok: true, messageId: info && info.messageId };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

module.exports = {
  smtpConfigured,
  parseDestinatarios,
  sendMailOptional,
};
