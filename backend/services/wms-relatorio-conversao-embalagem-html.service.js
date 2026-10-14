'use strict';

const {
  esc,
  buildTabelasHtmlPorDono,
  contarDonosUnicos,
} = require('./wms-relatorio-html-agrupamento');

const THEAD_CONV =
  '<thead><tr>' +
  '<th>Origem</th><th>Cód. estoque</th><th>Cód. ref. (OL/NF)</th><th>Descrição</th>' +
  '<th class="num">Fator</th><th>Unid. ref.</th><th>Unid. estoque</th>' +
  '<th>Exemplo</th><th>Conservação</th><th>Obs.</th>' +
  '</tr></thead>';

const COLS_CONV = 10;

function badgeOrigem(origem) {
  const o = String(origem || '').toUpperCase();
  if (o.includes('DE-PARA')) return 'fx-depara';
  return 'fx-ol';
}

function rowConversaoHtml(r) {
  const fx = badgeOrigem(r.ORIGEM);
  return (
    '<tr>' +
    `<td><span class="fx ${fx}">${esc(r.ORIGEM)}</span></td>` +
    `<td>${esc(r.CODIGO_ESTOQUE)}</td>` +
    `<td>${esc(r.CODIGO_REFERENCIA)}</td>` +
    `<td>${esc(r.NM_PRODUTO || '—')}</td>` +
    `<td class="num">${esc(r.FATOR_CONVERSAO_FMT || r.FATOR_CONVERSAO)}</td>` +
    `<td>${esc(r.UNIDADE_REFERENCIA || '—')}</td>` +
    `<td>${esc(r.UNIDADE_ESTOQUE || '—')}</td>` +
    `<td class="exemplo">${esc(r.EXEMPLO_CONVERSAO || '—')}</td>` +
    `<td>${esc(r.TIPO_ARMAZENAGEM || '—')}</td>` +
    `<td>${esc(r.OBSERVACAO || '—')}</td>` +
    '</tr>'
  );
}

function buildConversaoEmbalagemHtml({
  linhas,
  avisos,
  geradoEm,
  filtroDonoLabel,
  filtroProdutoLabel,
  filtroOrigemLabel,
}) {
  const dh = geradoEm ? new Date(geradoEm) : new Date();
  const dhBr = esc(dh.toLocaleString('pt-BR'));
  const filtroProdTxt = filtroProdutoLabel
    ? `<br/><strong>Filtro produto:</strong> ${esc(filtroProdutoLabel)}`
    : '';
  const filtroOrigTxt = filtroOrigemLabel
    ? `<br/><strong>Origem:</strong> ${esc(filtroOrigemLabel)}`
    : '';
  const lista = linhas || [];
  const nuDonos = contarDonosUnicos(lista);
  const nuOl = lista.filter((r) => String(r.ORIGEM || '').includes('OL')).length;
  const nuDp = lista.filter((r) => String(r.ORIGEM || '').includes('DE-PARA')).length;
  const tabelaHtml = buildTabelasHtmlPorDono(
    lista,
    THEAD_CONV,
    (rows) => '<tbody>' + rows.map(rowConversaoHtml).join('') + '</tbody>',
    COLS_CONV,
    'Nenhum vínculo com conversão de embalagem no filtro.'
  );
  const avisoHtml = (avisos || []).map((a) => `<li>${esc(a)}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Conversão de embalagem — WMS</title>
<style>
@page { size: A4 landscape; margin: 10mm; }
body { font-family: system-ui, "Segoe UI", sans-serif; font-size: 9.5pt; color: #0f172a; margin: 0; padding-bottom: 48px; }
h1 { font-size: 16pt; margin: 0 0 6px; }
h2.grupo-dono { font-size: 12pt; margin: 18px 0 8px; padding: 6px 8px; background: #f1f5f9; border-left: 4px solid #0ea5e9; }
.meta { font-size: 9pt; color: #334155; margin-bottom: 10px; line-height: 1.45; }
.aviso { font-size: 8.5pt; color: #475569; margin: 0 0 10px 18px; }
.resumo { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 12px; }
.resumo .card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 12px; min-width: 120px; background: #f8fafc; }
.resumo .card strong { display: block; font-size: 14pt; color: #0f172a; }
.resumo .card span { font-size: 8.5pt; color: #64748b; }
table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
th, td { border: 1px solid #cbd5e1; padding: 4px 5px; text-align: left; vertical-align: top; }
th { background: #f1f5f9; }
td.num, th.num { text-align: right; white-space: nowrap; }
td.exemplo { font-size: 8.5pt; max-width: 220px; }
.fx { font-size: 8pt; font-weight: 600; padding: 2px 6px; border-radius: 4px; white-space: nowrap; }
.fx-ol { background: #e0f2fe; color: #0369a1; }
.fx-depara { background: #fef3c7; color: #92400e; }
.toolbar { position: fixed; bottom: 0; left: 0; right: 0; padding: 10px; background: #f8fafc; border-top: 1px solid #cbd5e1; text-align: center; z-index: 9; }
@media print { .toolbar { display: none !important; } body { padding-bottom: 0; } h2.grupo-dono { break-after: avoid; } }
</style>
</head>
<body>
<h1>Conversão de embalagem (WMS)</h1>
<p class="meta"><strong>Gerado em:</strong> ${dhBr}<br/>
<strong>Filtro dono:</strong> ${esc(filtroDonoLabel || '—')}${filtroProdTxt}${filtroOrigTxt}<br/>
<strong>Donos no relatório:</strong> ${nuDonos}<br/>
<strong>Linhas:</strong> ${lista.length}</p>
<div class="resumo">
  <div class="card"><strong>${nuOl}</strong><span>Catálogo OL</span></div>
  <div class="card"><strong>${nuDp}</strong><span>De-para NF</span></div>
</div>
<ul class="aviso">${avisoHtml}</ul>
${tabelaHtml}
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

module.exports = {
  buildConversaoEmbalagemHtml,
};
