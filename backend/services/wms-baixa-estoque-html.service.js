'use strict';

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatQtd(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n - Math.round(n)) < 1e-6) return esc(Math.round(n).toLocaleString('pt-BR'));
  return esc(n.toLocaleString('pt-BR', { maximumFractionDigits: 3 }));
}

function fmtDhBr(v) {
  if (!v) return '—';
  try {
    return esc(new Date(v).toLocaleString('pt-BR'));
  } catch (_) {
    return esc(String(v));
  }
}

function fmtValidade(v) {
  if (v == null || v === '') return '—';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const d = String(v.getDate()).padStart(2, '0');
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const y = v.getFullYear();
    return esc(`${d}/${m}/${y}`);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return esc(`${m[3]}/${m[2]}/${m[1]}`);
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return esc(s);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = d.getFullYear();
    return esc(`${dd}/${mm}/${yy}`);
  }
  return esc(s);
}

/**
 * HTML A4 para retirada no depósito (motivo, linhas, data, assinaturas).
 * @param {{ cabecalho: object, linhas: object[], geradoEm?: string|Date }} payload
 */
function buildBaixaEstoqueHtml({ cabecalho, linhas, geradoEm }) {
  const cab = cabecalho || {};
  const lista = Array.isArray(linhas) ? linhas : [];
  const dh = geradoEm ? new Date(geradoEm) : new Date();
  const dhBr = esc(dh.toLocaleString('pt-BR'));
  const st = String(cab.ST_BAIXA || '').toUpperCase();
  const donoLabel =
    [cab.CD_DONO, cab.NM_DONO].filter((x) => x != null && String(x).trim() !== '').join(' — ') || '—';
  const motivoLabel =
    [cab.COD_MOTIVO, cab.DS_MOTIVO].filter((x) => x != null && String(x).trim() !== '').join(' — ') ||
    '—';
  const qtdTotal = lista.reduce((acc, l) => acc + (Number(l.QTD_BAIXA) || 0), 0);

  const bannerEstorno =
    st === 'ESTORNADO'
      ? '<div class="banner-estorno">DOCUMENTO ESTORNADO — não usar para retirada física de estoque.</div>'
      : '';

  const obsHtml = cab.OBSERVACAO
    ? `<p class="meta"><strong>Observação:</strong> ${esc(cab.OBSERVACAO)}</p>`
    : '';

  const linhasBody = lista.length
    ? lista
        .map((l, idx) => {
          return (
            '<tr>' +
            `<td class="num">${idx + 1}</td>` +
            `<td>${esc(l.CODIGO_PRODUTO || '')}</td>` +
            `<td>${esc(l.NM_PRODUTO || '—')}</td>` +
            `<td>${esc(l.LOTE || '—')}</td>` +
            `<td>${fmtValidade(l.VALIDADE)}</td>` +
            `<td class="num">${formatQtd(l.QTD_BAIXA)}</td>` +
            '</tr>'
          );
        })
        .join('')
    : '<tr><td colspan="6">Nenhuma linha neste documento.</td></tr>';

  const nrDoc = esc(cab.NR_DOCUMENTO || cab.CD_BAIXA || '—');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Baixa de estoque ${nrDoc} — Atlas Cargo WMS</title>
<style>
@page { size: A4 portrait; margin: 12mm; }
body { font-family: system-ui, "Segoe UI", sans-serif; font-size: 10pt; color: #0f172a; margin: 0; padding: 0 0 56px; }
h1 { font-size: 15pt; margin: 0 0 4px; }
.sub { font-size: 10pt; color: #475569; margin: 0 0 12px; }
.meta { font-size: 9.5pt; line-height: 1.5; color: #334155; margin: 0 0 10px; }
.banner-estorno {
  background: #fee2e2; border: 1px solid #ef4444; color: #991b1b;
  padding: 8px 10px; margin-bottom: 12px; font-size: 9.5pt; font-weight: 700; border-radius: 4px;
}
table { width: 100%; border-collapse: collapse; margin: 8px 0 4px; }
th, td { border: 1px solid #cbd5e1; padding: 5px 6px; text-align: left; vertical-align: top; }
th { background: #f1f5f9; font-size: 9pt; }
td.num, th.num { text-align: right; white-space: nowrap; }
.totais { margin: 8px 0 0; font-size: 9.5pt; color: #334155; }
.assinaturas { margin-top: 32px; page-break-inside: avoid; }
.assinaturas h2 { font-size: 11pt; margin: 0 0 8px; }
.assinaturas-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px 36px; margin-top: 8px; }
.assinatura-box {
  border-top: 1px solid #334155; padding-top: 6px; min-height: 64px;
  font-size: 9pt; color: #475569;
}
.assinatura-box strong { display: block; color: #0f172a; font-size: 9.5pt; margin-bottom: 30px; }
.rodape { margin-top: 24px; font-size: 8.5pt; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 8px; }
.toolbar {
  position: fixed; bottom: 0; left: 0; right: 0; padding: 10px;
  background: #f8fafc; border-top: 1px solid #cbd5e1; text-align: center; z-index: 9;
}
.toolbar button {
  font: inherit; font-size: 11pt; padding: 8px 18px; cursor: pointer;
  background: #1d4ed8; color: #fff; border: none; border-radius: 6px;
}
@media print {
  .toolbar { display: none !important; }
  body { padding-bottom: 0; }
  .banner-estorno { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
</style>
</head>
<body>
${bannerEstorno}
<h1>Documento de baixa de estoque</h1>
<p class="sub">Retirada / movimentação no depósito — Atlas Cargo WMS</p>
<p class="meta">
<strong>Documento:</strong> ${nrDoc}<br/>
<strong>Data da baixa:</strong> ${fmtDhBr(cab.DH_BAIXA)} · <strong>Status:</strong> ${esc(st || '—')}<br/>
<strong>Dono do estoque:</strong> ${esc(donoLabel)}<br/>
<strong>Motivo:</strong> ${esc(motivoLabel)}${
    cab.CODIGO_OL ? ` · <strong>OL:</strong> ${esc(cab.CODIGO_OL)}` : ''
  }${cab.ROTULO_MOVIMENTO ? ` · <strong>Movimento:</strong> ${esc(cab.ROTULO_MOVIMENTO)}` : ''}<br/>
<strong>Usuário (sistema):</strong> ${esc(cab.SG_USER || '—')}<br/>
<strong>Impresso em:</strong> ${dhBr}
</p>
${obsHtml}
<table>
<thead>
<tr>
<th class="num">#</th>
<th>Código</th>
<th>Descrição</th>
<th>Lote</th>
<th>Validade</th>
<th class="num">Qtd</th>
</tr>
</thead>
<tbody>
${linhasBody}
</tbody>
</table>
<p class="totais"><strong>Linhas:</strong> ${lista.length} · <strong>Quantidade total:</strong> ${formatQtd(qtdTotal)}</p>

<div class="assinaturas">
<h2>Assinaturas / comprovação da retirada</h2>
<p class="meta" style="margin-bottom:4px;">Confirmo a retirada física dos itens acima do depósito.</p>
<div class="assinaturas-grid">
<div class="assinatura-box"><strong>Responsável pelo depósito</strong>Nome legível · Assinatura · Data: ____/____/________</div>
<div class="assinatura-box"><strong>Quem retirou / solicitante</strong>Nome legível · Assinatura · Data: ____/____/________</div>
<div class="assinatura-box"><strong>Conferência / auditoria</strong>Nome legível · Assinatura · Data: ____/____/________</div>
<div class="assinatura-box"><strong>Gestão / cliente (dono)</strong>Nome legível · Assinatura · Data: ____/____/________</div>
</div>
</div>

<p class="rodape">Impresso em ${dhBr} — Atlas Cargo / SysScopel WMS · Documento ${nrDoc}</p>
<div class="toolbar no-print"><button type="button" onclick="window.print()">Imprimir</button></div>
</body>
</html>`;
}

module.exports = { buildBaixaEstoqueHtml };
