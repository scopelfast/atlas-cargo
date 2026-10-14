'use strict';

/**
 * HTML imprimível — comprovante de transferência entre donos (A4).
 *
 * Modelo: documento auditável com cabeçalho, dados das partes, item
 * transferido, espaço para assinaturas e rodapé com toolbar de impressão.
 * Inclui marca d'água "CANCELADA" se ST_TRANSFERENCIA = 'CANCELADA'.
 */

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtQtd(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return esc(n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 6 }));
}

function fmtDh(v) {
  if (!v) return '—';
  try { return esc(new Date(v).toLocaleString('pt-BR')); }
  catch (_) { return esc(String(v)); }
}

/** Data (validade) em dd/mm/aaaa — aceita ISO, Date do pg ou texto. */
function fmtData(v) {
  if (v == null || v === '') return '—';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const d = String(v.getUTCDate()).padStart(2, '0');
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const y = v.getUTCFullYear();
    return esc(d + '/' + m + '/' + y);
  }
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return esc(iso[3] + '/' + iso[2] + '/' + iso[1]);
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    const d = String(parsed.getUTCDate()).padStart(2, '0');
    const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const y = parsed.getUTCFullYear();
    return esc(d + '/' + m + '/' + y);
  }
  return esc(s);
}

/**
 * @param {object} doc — registro de WMS_TRANSFERENCIA_DONO com joins (donos
 *                       + produtos), tal qual retornado por
 *                       `obterTransferencia()`.
 * @param {object} [opts]
 * @param {string} [opts.geradoEm] — ISO; default = agora.
 * @param {string} [opts.usuarioEmitente] — SG_USER de quem está imprimindo.
 */
function buildComprovanteTransferenciaHtml(doc, opts) {
  opts = opts || {};
  const dh = opts.geradoEm ? new Date(opts.geradoEm) : new Date();
  const cancelada = String(doc.ST_TRANSFERENCIA || '').toUpperCase() === 'CANCELADA';
  const titulo = 'Comprovante de transferência entre donos · #' + doc.CD_TRANSFERENCIA;

  const watermark = cancelada
    ? '<div class="watermark">CANCELADA</div>'
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>${esc(titulo)}</title>
<style>
@page { size: A4 portrait; margin: 14mm; }
body { font-family: system-ui, "Segoe UI", sans-serif; font-size: 10.5pt; color: #0f172a; margin: 0; padding-bottom: 52px; position: relative; }
h1 { font-size: 16pt; margin: 0 0 4px; }
h2 { font-size: 12pt; margin: 18px 0 6px; padding: 6px 8px; background: #f1f5f9; border-left: 4px solid #0ea5e9; }
.meta { font-size: 9.5pt; color: #334155; line-height: 1.5; margin-bottom: 14px; }
.partes { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
.parte { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; background: #f8fafc; }
.parte .label { font-size: 9pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; }
.parte .valor { font-size: 13pt; font-weight: 600; margin-top: 2px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; font-size: 10pt; vertical-align: top; }
th { background: #f1f5f9; font-size: 9pt; }
.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.toolbar { position: fixed; bottom: 0; left: 0; right: 0; padding: 10px; background: #f8fafc; border-top: 1px solid #cbd5e1; text-align: center; z-index: 9; }
.assinaturas { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 30px; }
.assinaturas .linha { border-top: 1px solid #0f172a; padding-top: 4px; font-size: 9pt; text-align: center; }
.legenda { font-size: 8.5pt; color: #64748b; }
.aviso { background: #fef3c7; border: 1px solid #fbbf24; border-radius: 6px; padding: 8px 12px; margin-bottom: 10px; font-size: 10pt; }
.watermark {
  position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
  pointer-events: none; z-index: 1;
}
.watermark::after {
  content: 'CANCELADA'; font-size: 96pt; color: #ef4444; opacity: 0.18;
  transform: rotate(-22deg); font-weight: 800; letter-spacing: 6px;
}
@media print { .toolbar { display: none !important; } body { padding-bottom: 0; } }
</style>
</head>
<body>
${watermark}
<h1>${esc(titulo)}</h1>
<p class="meta">
  <strong>Status:</strong> ${esc(doc.ST_TRANSFERENCIA || 'EFETIVADA')}
  · <strong>Registrada em:</strong> ${fmtDh(doc.DH_REGISTRO)}
  ${doc.DH_CANCELAMENTO ? '· <strong>Cancelada em:</strong> ' + fmtDh(doc.DH_CANCELAMENTO) : ''}
  <br/>
  <strong>Emitido por:</strong> ${esc(opts.usuarioEmitente || doc.SG_USER || '—')}
  · <strong>Operador que registrou:</strong> ${esc(doc.SG_USER || '—')}
  ${doc.SG_USER_CANCEL ? '· <strong>Cancelado por:</strong> ' + esc(doc.SG_USER_CANCEL) : ''}
  <br/>
  <strong>Documento gerado em:</strong> ${esc(dh.toLocaleString('pt-BR'))}
</p>

${cancelada ? '<div class="aviso"><strong>⚠ Esta transferência foi CANCELADA.</strong> O estorno automático já foi aplicado no estoque (entrada na origem + saída no destino).</div>' : ''}

<div class="partes">
  <div class="parte">
    <div class="label">Origem (de)</div>
    <div class="valor">${esc(doc.CD_DONO_ORIGEM + ' — ' + (doc.NM_DONO_ORIGEM || ''))}</div>
  </div>
  <div class="parte">
    <div class="label">Destino (para)</div>
    <div class="valor">${esc(doc.CD_DONO_DESTINO + ' — ' + (doc.NM_DONO_DESTINO || ''))}</div>
  </div>
</div>

<h2>Item transferido</h2>
<table>
  <thead>
    <tr>
      <th>Código (origem)</th>
      <th>Descrição</th>
      <th>Unid.</th>
      <th>Lote</th>
      <th>Validade</th>
      <th class="num">Quantidade</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>${esc(doc.CODIGO_PRODUTO)}</td>
      <td>${esc(doc.NM_PRODUTO_SNAPSHOT || doc.NM_PRODUTO_ORIGEM || '—')}</td>
      <td>${esc(doc.UN_PRODUTO_ORIGEM || '—')}</td>
      <td>${esc(doc.LOTE || '—')}</td>
      <td>${fmtData(doc.VALIDADE)}</td>
      <td class="num"><strong>${fmtQtd(doc.QTD)}</strong></td>
    </tr>
  </tbody>
</table>

<h2>Motivo / observação</h2>
<p style="margin: 0 0 6px;">${esc(doc.MOTIVO || '(sem motivo informado)')}</p>

<p class="legenda" style="margin-top: 14px;">
  Movimentos de ledger gerados:
  ${doc.REF_CD_MOVIMENTO_SAIDA != null
    ? '<strong>SAÍDA</strong> #' + esc(doc.REF_CD_MOVIMENTO_SAIDA) + ' (origem)'
    : ''}
  ${doc.REF_CD_MOVIMENTO_ENTRADA != null
    ? ' · <strong>ENTRADA</strong> #' + esc(doc.REF_CD_MOVIMENTO_ENTRADA) + ' (destino)'
    : ''}
  ${cancelada ? ' · estorno aplicado em movimentos posteriores' : ''}
</p>

<div class="assinaturas">
  <div>
    <div style="height: 60px;"></div>
    <div class="linha">Responsável pela origem<br/><span class="legenda">Nome legível · CPF · Data</span></div>
  </div>
  <div>
    <div style="height: 60px;"></div>
    <div class="linha">Responsável pelo destino<br/><span class="legenda">Nome legível · CPF · Data</span></div>
  </div>
  <div>
    <div style="height: 60px;"></div>
    <div class="linha">Supervisão WMS<br/><span class="legenda">Nome legível · CPF · Data</span></div>
  </div>
  <div>
    <div style="height: 60px;"></div>
    <div class="linha">Auditoria / cliente<br/><span class="legenda">Nome legível · CPF · Data</span></div>
  </div>
</div>

<div class="toolbar">
  <button type="button" id="wmsPrintBtn">Imprimir / PDF</button>
  <button type="button" id="wmsCloseBtn">Fechar</button>
</div>
<script>
document.getElementById('wmsPrintBtn')?.addEventListener('click', function () { window.focus(); window.print(); });
document.getElementById('wmsCloseBtn')?.addEventListener('click', function () { window.close(); });
</script>
</body>
</html>`;
}

module.exports = { buildComprovanteTransferenciaHtml };
