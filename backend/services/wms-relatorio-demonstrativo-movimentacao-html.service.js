'use strict';

const { esc, metaPeriodoHtml } = require('./wms-relatorio-html-agrupamento');
const { contarDonosGrupos } = require('./wms-relatorio-demonstrativo-movimentacao.service');

function formatQtd(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (n === 0) return '0';
  return esc(n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 6 }));
}

function rowLinhaHtml(ln) {
  const cls = ln.FG_SALDO_INICIAL ? ' class="linha-saldo-inicial"' : '';
  return (
    `<tr${cls}>` +
    `<td>${esc(ln.DATA_LABEL || '—')}</td>` +
    `<td class="num">${formatQtd(ln.QTD_ENTRADA)}</td>` +
    `<td class="num">${formatQtd(ln.QTD_SAIDA)}</td>` +
    `<td class="num"><strong>${formatQtd(ln.QTD_SALDO)}</strong></td>` +
    '</tr>'
  );
}

function buildCorpoDemonstrativoHtml(grupos) {
  const lista = grupos || [];
  if (!lista.length) {
    return '<p class="vazio">Nenhum movimento no período.</p>';
  }
  return lista
    .map((g) => {
      const blocosProd = (g.produtos || [])
        .map((p) => {
          const tbody =
            (p.linhas || []).length > 0
              ? (p.linhas || []).map(rowLinhaHtml).join('')
              : '<tr><td colspan="4">Sem lançamentos.</td></tr>';
          return (
            '<section class="dre-produto">' +
            `<h3 class="dre-produto-titulo">Produto: ${esc(p.LABEL_PRODUTO)}</h3>` +
            '<table class="dre-tabela">' +
            '<thead><tr><th>Data</th><th class="num">Entrada</th><th class="num">Saída</th><th class="num">Saldo</th></tr></thead>' +
            `<tbody>${tbody}</tbody>` +
            '</table>' +
            '</section>'
          );
        })
        .join('');
      return (
        '<section class="dre-dono">' +
        `<h2 class="grupo-dono">${esc(g.LABEL_DONO)}</h2>` +
        blocosProd +
        '</section>'
      );
    })
    .join('');
}

function buildDemonstrativoMovimentacaoHtml({
  grupos,
  totalLinhas,
  avisos,
  geradoEm,
  filtroDonoLabel,
  filtroProdutoLabel,
  filtroPeriodoLabel,
}) {
  const dhBr = esc((geradoEm ? new Date(geradoEm) : new Date()).toLocaleString('pt-BR'));
  const filtroProdTxt = filtroProdutoLabel
    ? `<br/><strong>Filtro produto:</strong> ${esc(filtroProdutoLabel)}`
    : '';
  const filtroPeriodoTxt = metaPeriodoHtml(filtroPeriodoLabel);
  const nuDonos = contarDonosGrupos(grupos);
  const corpoHtml = buildCorpoDemonstrativoHtml(grupos);
  const avisoHtml = (avisos || []).map((a) => `<li>${esc(a)}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Demonstrativo de movimentação (DRE) — WMS</title>
<style>
@page { size: A4 portrait; margin: 12mm; }
body { font-family: system-ui, "Segoe UI", sans-serif; font-size: 10pt; color: #0f172a; margin: 0; padding-bottom: 48px; max-width: 520px; }
h1 { font-size: 15pt; margin: 0 0 8px; }
.meta { font-size: 9pt; color: #334155; margin-bottom: 12px; line-height: 1.45; }
.aviso { font-size: 8.5pt; color: #475569; margin: 0 0 12px 18px; }
.dre-dono { margin-bottom: 22px; page-break-inside: avoid; }
h2.grupo-dono { font-size: 12pt; font-weight: 700; margin: 0 0 10px; padding: 0 0 6px; border-bottom: 2px solid #0f172a; }
.dre-produto { margin: 0 0 16px 0; padding-left: 0; }
h3.dre-produto-titulo { font-size: 10pt; font-weight: 600; margin: 0 0 6px; color: #1e293b; }
table.dre-tabela { width: 100%; max-width: 480px; border-collapse: collapse; margin-bottom: 4px; }
table.dre-tabela th, table.dre-tabela td { border: 1px solid #334155; padding: 5px 8px; text-align: left; }
table.dre-tabela thead th { background: #0f172a; color: #fff; font-size: 9pt; font-weight: 600; }
table.dre-tabela td.num, table.dre-tabela th.num { text-align: right; white-space: nowrap; }
tr.linha-saldo-inicial td { background: #f8fafc; font-style: italic; }
p.vazio { color: #64748b; font-size: 10pt; }
.toolbar { position: fixed; bottom: 0; left: 0; right: 0; padding: 10px; background: #f8fafc; border-top: 1px solid #cbd5e1; text-align: center; z-index: 9; }
@media print { .toolbar { display: none !important; } body { padding-bottom: 0; max-width: none; } }
</style>
</head>
<body>
<h1>Demonstrativo de movimentação — WMS (DRE)</h1>
<p class="meta"><strong>Gerado em:</strong> ${dhBr}<br/>
<strong>Filtro dono:</strong> ${esc(filtroDonoLabel || '—')}${filtroPeriodoTxt}${filtroProdTxt}<br/>
<strong>Donos no relatório:</strong> ${nuDonos}<br/>
<strong>Linhas:</strong> ${totalLinhas != null ? totalLinhas : 0}</p>
<ul class="aviso">${avisoHtml}</ul>
${corpoHtml}
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

module.exports = { buildDemonstrativoMovimentacaoHtml };
