'use strict';

const { esc, metaPeriodoHtml } = require('./wms-relatorio-html-agrupamento');
const { labelCategoria } = require('./wms-relatorio-nf-opl-comparativo.service');

function formatDhBr(dt) {
  if (!dt) return '—';
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return esc(String(dt));
  return esc(d.toLocaleString('pt-BR'));
}

function formatQtd(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return esc(n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 6 }));
}

function badgeCategoria(cat) {
  if (cat === 'SEPARACAO_SEM_NF') {
    return '<span class="cat-sep">Separação sem NF</span>';
  }
  if (cat === 'NF_SEM_SEPARACAO') {
    return '<span class="cat-nf">NF sem separação</span>';
  }
  return '<span class="cat-outros">Outros</span>';
}

function labelModo(modo) {
  return modo === 'sintetico' ? 'Sintético (por entrega/nota)' : 'Analítico (por item)';
}

function buildTabelaAnalitica(rows, emptyMsg) {
  if (!rows.length) {
    return `<p class="empty">${esc(emptyMsg)}</p>`;
  }
  const body = rows
    .map(
      (r) =>
        '<tr>' +
        `<td>#${esc(r.CD_CARGA)}<br/><small>${esc(r.NM_DESCRICAO || '')}</small></td>` +
        `<td>${esc(r.ST_EXPEDICAO || r.ST_CARGA || '')}</td>` +
        `<td><strong>${esc(r.DS_NOTA || '—')}</strong></td>` +
        `<td>${esc(r.DS_LOCAL || '—')}</td>` +
        `<td><small>${esc(r.DS_CLIENTE_ENTREGA || '—')}</small></td>` +
        `<td>${esc(r.NR_PEDIDO)}</td>` +
        `<td>${esc(r.NR_PEDIDO_OPL || '—')}</td>` +
        `<td>${badgeCategoria(r.CATEGORIA)}<br/><small>${esc(r.DS_TIPO)}</small>` +
        (r.DS_AVISO ? `<br/><small class="hint" style="color:#b45309;">${esc(r.DS_AVISO)}</small>` : '') +
        `</td>` +
        `<td>${esc(r.COD_PRODUTO)}</td>` +
        `<td>${esc(r.DS_PRODUTO)}</td>` +
        `<td class="num">${formatQtd(r.QTD_SEPARACAO)}</td>` +
        `<td class="num">${formatQtd(r.QTD_NF)}</td>` +
        `<td class="num">${formatQtd(r.QTD_DIF)}</td>` +
        '</tr>'
    )
    .join('');

  return (
    '<table><thead><tr>' +
    '<th>Carga</th><th>Status</th><th>Nota</th><th>Local</th><th>Cliente entrega</th>' +
    '<th>Pedido NF</th><th>Pedido OPL</th><th>Divergência</th><th>Código</th><th>Produto</th>' +
    '<th class="num">Qtd sep.</th><th class="num">Qtd NF</th><th class="num">Dif.</th>' +
    '</tr></thead><tbody>' +
    body +
    '</tbody></table>'
  );
}

function buildTabelaSintetica(grupos, emptyMsg) {
  if (!grupos.length) {
    return `<p class="empty">${esc(emptyMsg)}</p>`;
  }
  const body = grupos
    .map(
      (g) =>
        '<tr>' +
        `<td>#${esc(g.CD_CARGA)}<br/><small>${esc(g.NM_DESCRICAO || '')}</small></td>` +
        `<td>${esc(g.ST_EXPEDICAO || '')}</td>` +
        `<td><strong>${esc(g.DS_NOTA || '—')}</strong></td>` +
        `<td>${esc(g.DS_LOCAL || '—')}</td>` +
        `<td><small>${esc(g.DS_CLIENTE_ENTREGA || '—')}</small></td>` +
        `<td>${esc(g.NR_PEDIDO)}</td>` +
        `<td class="num sep">${esc(g.Q_SEP_SEM_NF)}</td>` +
        `<td class="num nf">${esc(g.Q_NF_SEM_SEP)}</td>` +
        `<td class="num">${esc(g.Q_OUTROS)}</td>` +
        `<td><small>${esc(g.DS_ITENS || '—')}</small></td>` +
        '</tr>'
    )
    .join('');

  return (
    '<table><thead><tr>' +
    '<th>Carga</th><th>Status</th><th>Nota</th><th>Local</th><th>Cliente entrega</th>' +
    '<th>Pedido</th><th class="num">Sep. s/ NF</th><th class="num">NF s/ sep.</th><th class="num">Outros</th>' +
    '<th>Itens divergentes</th>' +
    '</tr></thead><tbody>' +
    body +
    '</tbody></table>'
  );
}

function buildComparativoNfOplHtml({
  linhas,
  linhasSintetico,
  modo,
  cargasOk,
  avisos,
  geradoEm,
  filtroDonoLabel,
  filtroPeriodoLabel,
  filtroTipo,
  filtroTipoLabel,
  resumo,
}) {
  const dhBr = esc((geradoEm ? new Date(geradoEm) : new Date()).toLocaleString('pt-BR'));
  const filtroDonoTxt = filtroDonoLabel
    ? `<br/><strong>Dono:</strong> ${esc(filtroDonoLabel)}`
    : '';
  const filtroPeriodoTxt = metaPeriodoHtml(filtroPeriodoLabel);
  const modoTxt = `<br/><strong>Modo:</strong> ${esc(labelModo(modo))}`;
  const filtroTipoTxt = filtroTipoLabel
    ? `<br/><strong>Tipo:</strong> ${esc(filtroTipoLabel)}`
    : '';
  const avisosHtml = (avisos || [])
    .map((a) => `<li>${esc(a)}</li>`)
    .join('');

  const res = resumo || {};
  const resumoHtml =
    '<section class="resumo-box">' +
    '<h2>Resumo</h2>' +
    '<ul class="resumo-list">' +
    `<li><strong>${esc(res.cargasAnalisadas || 0)}</strong> carga(s) analisada(s)</li>` +
    `<li><strong>${esc(res.cargasComDivergencia || 0)}</strong> com divergência</li>` +
    `<li class="sep-li"><strong>${esc(res.separacaoSemNf || 0)}</strong> linha(s): separação sem NF</li>` +
    `<li class="nf-li"><strong>${esc(res.nfSemSeparacao || 0)}</strong> linha(s): NF sem separação / falta separar</li>` +
    `<li><strong>${esc(res.outros || 0)}</strong> outra(s) divergência(s)</li>` +
    '</ul></section>';

  const okHtml =
    cargasOk && cargasOk.length
      ? '<section><h2>Cargas sem divergência (filtro “todas”)</h2><table><thead><tr>' +
        '<th>Carga</th><th>Descrição</th><th>Status</th><th>Itens NF</th><th>Itens sep.</th>' +
        '</tr></thead><tbody>' +
        cargasOk
          .map(
            (c) =>
              '<tr>' +
              `<td>#${esc(c.CD_CARGA)}</td>` +
              `<td>${esc(c.NM_DESCRICAO)}</td>` +
              `<td>${esc(c.ST_EXPEDICAO)}</td>` +
              `<td class="num">${esc(c.ITENS_NF)}</td>` +
              `<td class="num">${esc(c.ITENS_SEPARACAO)}</td>` +
              '</tr>'
          )
          .join('') +
        '</tbody></table></section>'
      : '';

  let corpoHtml;
  if (modo === 'sintetico') {
    corpoHtml =
      '<section>' +
      '<h2>Visão sintética por entrega / nota / pedido</h2>' +
      '<p class="meta">Agrupa divergências no mesmo ponto de entrega para priorizar tratamento na rota.</p>' +
      buildTabelaSintetica(linhasSintetico || [], 'Nenhuma divergência no filtro.') +
      '</section>';
  } else {
    const showSep = filtroTipo !== 'nf_sem_separacao';
    const showNf = filtroTipo !== 'separacao_sem_nf';
    const sepRows = showSep
      ? (linhas || []).filter((r) => r.CATEGORIA === 'SEPARACAO_SEM_NF')
      : [];
    const nfRows = showNf
      ? (linhas || []).filter((r) => r.CATEGORIA === 'NF_SEM_SEPARACAO')
      : [];
    const outrosRows = (linhas || []).filter((r) => r.CATEGORIA === 'OUTROS');
    corpoHtml =
      (showSep
        ? '<section>' +
          `<h2>${esc(labelCategoria('SEPARACAO_SEM_NF'))}</h2>` +
          '<p class="meta">Itens presentes no espelho/separação e ausentes ou a menor na NF-e.</p>' +
          buildTabelaAnalitica(sepRows, 'Nenhuma divergência nesta categoria.') +
          '</section>'
        : '') +
      (showNf
        ? '<section>' +
          `<h2>${esc(labelCategoria('NF_SEM_SEPARACAO'))}</h2>` +
          '<p class="meta">Itens na NF-e sem correspondência na separação, pedido não encontrado no OPL ou quantidade NF maior que a separada.</p>' +
          buildTabelaAnalitica(nfRows, 'Nenhuma divergência nesta categoria.') +
          '</section>'
        : '') +
      (outrosRows.length
        ? `<section><h2>${esc(labelCategoria('OUTROS'))}</h2>${buildTabelaAnalitica(
            outrosRows,
            ''
          )}</section>`
        : '');
  }

  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/><title>Comparativo NF × Separação — WMS</title>
<style>
  body{font-family:Segoe UI,system-ui,sans-serif;margin:24px;color:#0f172a;font-size:13px;line-height:1.45;}
  h1{font-size:20px;margin:0 0 8px;}
  h2{font-size:16px;margin:24px 0 10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;}
  .meta{color:#64748b;margin-bottom:16px;}
  .avisos{background:#fff7ed;border:1px solid #fed7aa;padding:10px 14px;border-radius:8px;margin-bottom:16px;}
  .avisos ul{margin:6px 0 0;padding-left:18px;}
  .resumo-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin-bottom:20px;}
  .resumo-list{margin:0;padding-left:18px;}
  .sep-li{color:#b45309;}
  .nf-li{color:#b91c1c;}
  table{width:100%;border-collapse:collapse;margin-bottom:8px;}
  th,td{border:1px solid #e2e8f0;padding:6px 8px;text-align:left;vertical-align:top;}
  th{background:#f1f5f9;font-weight:600;}
  td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;}
  td.num.sep{color:#b45309;font-weight:600;}
  td.num.nf{color:#b91c1c;font-weight:600;}
  .cat-sep{display:inline-block;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;}
  .cat-nf{display:inline-block;background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;}
  .cat-outros{display:inline-block;background:#e2e8f0;color:#334155;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;}
  .empty{color:#64748b;font-style:italic;}
  @media print{body{margin:12px;} h2{page-break-after:avoid;} table{page-break-inside:auto;} tr{page-break-inside:avoid;}}
</style></head><body>
<h1>Comparativo NF-e × Pedido de Separação (OPL)</h1>
<p class="meta">Gerado em ${dhBr}${filtroDonoTxt}${filtroPeriodoTxt}${modoTxt}${filtroTipoTxt}</p>
${avisosHtml ? `<div class="avisos"><strong>Avisos</strong><ul>${avisosHtml}</ul></div>` : ''}
${resumoHtml}
${corpoHtml}
${okHtml}
</body></html>`;
}

module.exports = {
  buildComparativoNfOplHtml,
};
