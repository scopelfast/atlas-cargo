'use strict';

const { esc, metaPeriodoHtml } = require('./wms-relatorio-html-agrupamento');
const { resumirPorCodigo, resumirPorEspelho } = require('./wms-relatorio-separacao-opl.service');

function formatDhBr(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return esc(String(iso));
  return esc(d.toLocaleString('pt-BR'));
}

function formatQtd(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return esc(n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 6 }));
}

function badgeSituacao(st) {
  const s = String(st || '').toUpperCase();
  if (s === 'COLETADO') return '<span class="ok">Coletado</span>';
  if (s === 'DIVERGENTE') return '<span class="warn">Divergente</span>';
  return '<span class="pend">Pendente</span>';
}

function buildResumoEspelhoHtml(resumo) {
  if (!resumo || !resumo.length) return '';
  const rows = resumo
    .map(
      (r) =>
        '<tr>' +
        `<td>#${esc(r.CD_OPL_ARQUIVO)}</td>` +
        `<td>${esc(r.NM_ARQUIVO)}</td>` +
        `<td>${formatDhBr(r.DH_REF)}</td>` +
        `<td class="num">${esc(r.Q_PEDIDOS)}</td>` +
        `<td class="num">${formatQtd(r.QT_PEDIDA)}</td>` +
        `<td class="num">${formatQtd(r.QT_COLETADA)}</td>` +
        `<td class="num">${esc(r.LINHAS)}</td>` +
        '</tr>'
    )
    .join('');
  return (
    '<section class="resumo-box">' +
    '<h2>Resumo por espelho OPL (lote / rota)</h2>' +
    '<p class="meta">Use este bloco para achar em qual arquivo de separação o produto está — filtre depois pelo nome do espelho (ex.: <em>Lote 04</em>, <em>Rota A</em>).</p>' +
    '<table><thead><tr>' +
    '<th>Espelho</th><th>Arquivo</th><th>Importação</th><th class="num">Pedidos</th><th class="num">Σ pedida</th><th class="num">Σ coletada</th><th class="num">Linhas</th>' +
    '</tr></thead><tbody>' +
    rows +
    '</tbody></table></section>'
  );
}

function buildResumoHtml(resumo) {
  if (!resumo || !resumo.length) return '';
  const rows = resumo
    .slice(0, 80)
    .map(
      (r) =>
        '<tr>' +
        `<td>${esc(r.CODIGO_PRODUTO)}</td>` +
        `<td>${esc(r.NM_PRODUTO)}</td>` +
        `<td class="num">${formatQtd(r.QT_PEDIDA)}</td>` +
        `<td class="num">${formatQtd(r.QT_COLETADA)}</td>` +
        `<td class="num">${esc(r.LINHAS)}</td>` +
        `<td class="num">${esc(r.Q_ESPELHOS)}</td>` +
        '</tr>'
    )
    .join('');
  return (
    '<section class="resumo-box">' +
    '<h2>Resumo por código (filtros aplicados)</h2>' +
    '<p class="meta">Soma das linhas do espelho OPL — útil para cruzar com inventário.</p>' +
    '<table><thead><tr>' +
    '<th>Código</th><th>Descrição</th><th class="num">Σ pedida</th><th class="num">Σ coletada</th><th class="num">Linhas</th><th class="num">Espelhos</th>' +
    '</tr></thead><tbody>' +
    rows +
    '</tbody></table></section>'
  );
}

function buildSeparacaoOplHtml({
  linhas,
  avisos,
  geradoEm,
  filtroDonoLabel,
  filtroProdutoLabel,
  filtroPeriodoLabel,
  filtroSituacaoLabel,
  filtroEspelhoLabel,
  filtroPedidoDestinoLabel,
  filtroTipoPeriodoLabel,
  resumoPorCodigo,
  resumoPorEspelho,
}) {
  const dhBr = esc((geradoEm ? new Date(geradoEm) : new Date()).toLocaleString('pt-BR'));
  const filtroProdTxt = filtroProdutoLabel
    ? `<br/><strong>Filtro produto:</strong> ${esc(filtroProdutoLabel)}`
    : '';
  const filtroPeriodoTxt = metaPeriodoHtml(filtroPeriodoLabel);
  const filtroSitTxt = filtroSituacaoLabel
    ? `<br/><strong>Situação picking:</strong> ${esc(filtroSituacaoLabel)}`
    : '';
  const filtroEspTxt = filtroEspelhoLabel
    ? `<br/><strong>Espelho:</strong> ${esc(filtroEspelhoLabel)}`
    : '';
  const filtroPedTxt = filtroPedidoDestinoLabel
    ? `<br/><strong>Pedido/destino:</strong> ${esc(filtroPedidoDestinoLabel)}`
    : '';
  const filtroTipoPerTxt = filtroTipoPeriodoLabel
    ? `<br/><strong>Período por:</strong> ${esc(filtroTipoPeriodoLabel)}`
    : '';
  const avisosHtml = (avisos || [])
    .map((a) => `<li>${esc(a)}</li>`)
    .join('');
  const bodyRows = (linhas || [])
    .map(
      (r) =>
        '<tr>' +
        `<td>${formatDhBr(r.DH_REF)}</td>` +
        `<td>#${esc(r.CD_OPL_ARQUIVO)}<br/><small>${esc(r.NM_ARQUIVO)}</small></td>` +
        `<td>${esc(r.NUM_PEDIDO)}</td>` +
        `<td>${r.DATA_ENTREGA ? esc(r.DATA_ENTREGA) : '—'}</td>` +
        `<td>${esc(r.DESTINO)}<br/><small>${esc(r.CIDADE_UF)}</small></td>` +
        `<td>${esc(r.CODIGO_PRODUTO)}</td>` +
        `<td>${esc(r.NM_PRODUTO)}</td>` +
        `<td class="num">${formatQtd(r.QT_PEDIDA)}</td>` +
        `<td class="num">${formatQtd(r.QT_COLETADA)}</td>` +
        `<td class="num">${formatQtd(r.DELTA)}</td>` +
        `<td>${badgeSituacao(r.ST_PICKING)}</td>` +
        '</tr>'
    )
    .join('');

  const resumo = resumoPorCodigo || resumirPorCodigo(linhas);
  const resumoEsp = resumoPorEspelho || resumirPorEspelho(linhas);

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><title>Separação OPL — WMS</title>
<style>
  body{font-family:Segoe UI,system-ui,sans-serif;margin:24px;color:#0f172a;font-size:13px;}
  h1{font-size:20px;margin:0 0 8px;}
  .meta{color:#64748b;margin-bottom:16px;line-height:1.45;}
  .avisos{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 14px;margin-bottom:16px;}
  .avisos ul{margin:6px 0 0;padding-left:18px;}
  table{width:100%;border-collapse:collapse;margin-top:12px;}
  th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;vertical-align:top;}
  th{background:#e2e8f0;font-size:12px;}
  td.num, th.num{text-align:right;font-variant-numeric:tabular-nums;}
  .ok{color:#15803d;font-weight:600;}
  .warn{color:#b45309;font-weight:600;}
  .pend{color:#64748b;}
  .resumo-box{margin-bottom:24px;}
  .resumo-box h2{font-size:16px;margin:0 0 6px;}
  @media print{body{margin:12px;} .no-print{display:none;}}
</style></head><body>
<h1>Separação OPL — histórico por produto</h1>
<p class="meta">Gerado em ${dhBr}<br/>
<strong>Dono:</strong> ${esc(filtroDonoLabel || 'Todos')}${filtroProdTxt}${filtroEspTxt}${filtroPedTxt}${filtroTipoPerTxt}${filtroPeriodoTxt}${filtroSitTxt}<br/>
<strong>Linhas:</strong> ${esc(String((linhas || []).length))}</p>
<div class="avisos"><strong>Observações</strong><ul>${avisosHtml}</ul></div>
${buildResumoEspelhoHtml(resumoEsp)}
${buildResumoHtml(resumo)}
<table>
<thead><tr>
<th>Importação</th><th>Espelho</th><th>Pedido</th><th>Entrega</th><th>Destino</th><th>Código</th><th>Descrição</th>
<th class="num">Qtd pedida</th><th class="num">Qtd coletada</th><th class="num">Δ</th><th>Situação</th>
</tr></thead>
<tbody>${bodyRows || '<tr><td colspan="11">Nenhuma linha.</td></tr>'}</tbody>
</table>
<p class="no-print meta" style="margin-top:20px;">Atlas Cargo — Relatório Separação OPL</p>
</body></html>`;
}

module.exports = {
  buildSeparacaoOplHtml,
};
