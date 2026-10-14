'use strict';

const {
  normalizarModoSeparadores,
  resolverCamposQuebra,
  ordenarLinhasSaldo,
  chaveSeparadorLinha,
  rotuloSeparadorGrupo,
  rotuloModoSeparadores,
  rotuloOrdemCampos,
} = require('./wms-relatorio-separadores-cadastro.service');

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
  return esc(n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 }));
}

function fmtValidade(v) {
  if (!v) return '—';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return esc(`${d}/${m}/${y}`);
  }
  return esc(s);
}

function rowHtml(r, idx) {
  return (
    '<tr>' +
    `<td class="num">${idx}</td>` +
    `<td>${esc(r.CODIGO_PRODUTO)}</td>` +
    `<td>${esc(r.NM_PRODUTO || '—')}</td>` +
    `<td>${esc(r.LOTE || '—')}</td>` +
    `<td>${fmtValidade(r.VALIDADE)}</td>` +
    `<td class="num">${formatQtd(r.QTD_SISTEMA)}</td>` +
    `<td>${esc(r.TIPO_ARMAZENAGEM || '—')}</td>` +
    '</tr>'
  );
}

function buildCorpo(linhas, optsSeparadores) {
  const cols = 7;
  if (!linhas || !linhas.length) {
    return `<tbody><tr><td colspan="${cols}">Nenhum SKU na lista.</td></tr></tbody>`;
  }
  const modo = normalizarModoSeparadores(optsSeparadores && optsSeparadores.modo);
  const camposQuebra = resolverCamposQuebra([], modo);
  const usarSeparadores = modo !== 'nao' && camposQuebra.length > 0;
  let html = '<tbody>';
  let chaveAnterior = null;
  let idx = 0;
  for (const r of linhas) {
    if (usarSeparadores) {
      const chaveAtual = chaveSeparadorLinha(r, camposQuebra);
      if (chaveAtual !== chaveAnterior) {
        const rotulo = rotuloSeparadorGrupo(r, camposQuebra);
        html +=
          `<tr class="lista-grp-sep"><td colspan="${cols}">` +
          `<span class="lista-grp-bullet" aria-hidden="true">▌</span>${esc(rotulo)}</td></tr>`;
        chaveAnterior = chaveAtual;
      }
    }
    idx += 1;
    html += rowHtml(r, idx);
  }
  html += '</tbody>';
  return html;
}

/**
 * HTML imprimível — lista prévia do inventário cíclico (antes de criar o documento).
 */
function buildListaCiclicaHtml({
  linhas,
  cabecalho,
  geradoEm,
  separadoresGrupo,
  ordem,
}) {
  const modoSep = normalizarModoSeparadores(separadoresGrupo || 'nao');
  const camposQuebra = resolverCamposQuebra(ordem, modoSep);
  const listaBruta = linhas || [];
  const lista =
    modoSep !== 'nao' || (ordem && ordem.length)
      ? ordenarLinhasSaldo(listaBruta, ordem || [], modoSep)
      : listaBruta;
  const cab = cabecalho || {};
  const dh = geradoEm ? new Date(geradoEm) : new Date();
  const dhBr = esc(dh.toLocaleString('pt-BR'));
  const donoLabel = esc(cab.donoLabel || cab.CD_DONO || '—');
  const sepTxt =
    modoSep !== 'nao' && camposQuebra.length
      ? `<br/><strong>Separadores:</strong> ${esc(rotuloModoSeparadores(modoSep, camposQuebra))}`
      : '';
  const ordemTxt = rotuloOrdemCampos(ordem)
    ? `<br/><strong>Ordenação:</strong> ${esc(rotuloOrdemCampos(ordem))}`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Lista cíclica — inventário WMS</title>
<style>
@page { size: A4 portrait; margin: 12mm; }
body { font-family: system-ui, "Segoe UI", sans-serif; font-size: 10pt; color: #0f172a; margin: 0; padding-bottom: 48px; }
h1 { font-size: 16pt; margin: 0 0 6px; }
.meta { font-size: 9.5pt; line-height: 1.45; color: #334155; margin-bottom: 10px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
th, td { border: 1px solid #cbd5e1; padding: 5px 6px; text-align: left; vertical-align: top; }
th { background: #f1f5f9; font-size: 9pt; }
td.num, th.num { text-align: right; white-space: nowrap; }
.lista-grp-sep td {
  background: #eff6ff; font-weight: 700; font-size: 9.5pt; color: #1e3a8a;
  border-top: 2px solid #93c5fd; padding: 6px 8px;
}
.lista-grp-bullet { color: #1d4ed8; margin-right: 4px; }
.toolbar { position: fixed; bottom: 0; left: 0; right: 0; padding: 10px; background: #f8fafc; border-top: 1px solid #cbd5e1; text-align: center; z-index: 9; }
@media print { .toolbar { display: none !important; } body { padding-bottom: 0; } .lista-grp-sep td { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<h1>Lista de inventário cíclico (prévia)</h1>
<p class="meta">
<strong>Gerado em:</strong> ${dhBr}<br/>
<strong>Dono:</strong> ${donoLabel}<br/>
<strong>Critério:</strong> ${esc(cab.criterio || '—')} · <strong>Janela:</strong> ${esc(cab.diasJanela != null ? cab.diasJanela + 'd' : '—')} · <strong>Limite:</strong> ${esc(cab.limite != null ? cab.limite : '—')}<br/>
<strong>Linhas:</strong> ${lista.length}${sepTxt}${ordemTxt}
</p>
<table>
<thead><tr>
<th class="num">#</th><th>Código</th><th>Descrição</th><th>Lote</th><th>Validade</th><th class="num">Saldo sist.</th><th>Conserv.</th>
</tr></thead>
${buildCorpo(lista, { modo: modoSep })}
</table>
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

module.exports = { buildListaCiclicaHtml };
