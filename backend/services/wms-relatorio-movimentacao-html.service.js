'use strict';

const {
  esc,
  buildTabelasHtmlPorDono,
  contarDonosUnicos,
  metaPeriodoHtml,
} = require('./wms-relatorio-html-agrupamento');

function formatDhBr(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return esc(String(iso));
  return esc(d.toLocaleString('pt-BR'));
}

function formatValidadeBr(raw) {
  const s = String(raw || '').trim();
  if (!s) return '—';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return esc(`${m[3]}/${m[2]}/${m[1]}`);
  return esc(s);
}

function formatQtd(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return esc(n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 6 }));
}

const THEAD_MOV =
  '<thead><tr>' +
  '<th class="col-dh">Data</th>' +
  '<th class="col-tipo">Tipo</th>' +
  '<th class="col-doc">Documento</th>' +
  '<th class="col-seq">Seq. item</th>' +
  '<th class="col-cod">Código</th>' +
  '<th class="col-desc">Descrição</th>' +
  '<th class="col-lote">Lote</th>' +
  '<th class="col-val">Validade</th>' +
  '<th class="num col-qtd">Qtd mov.</th>' +
  '<th class="num col-saldo">Saldo est.</th>' +
  '<th class="col-op">Operação WMS</th>' +
  '</tr></thead>';

const COLS_MOV = 11;

function formatDataMovBr(iso, fgSaldoInicial) {
  if (fgSaldoInicial) return '—';
  if (!iso) return '—';
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return esc(String(iso));
  return esc(d.toLocaleDateString('pt-BR'));
}

function rowMovHtml(r) {
  /** Lupa de diagnóstico — só faz sentido quando há código e dono. Permite
   *  o operador abrir o "por que esse SKU não soma" sem sair do relatório. */
  const btnDiag =
    !r.FG_SALDO_INICIAL && r.CD_DONO != null && r.CODIGO_PRODUTO
      ? ` <button type="button" class="btn-diag" data-cddono="${esc(r.CD_DONO)}" data-codigo="${esc(r.CODIGO_PRODUTO)}" title="Diagnosticar este SKU">🔍</button>`
      : '';
  const trClass = r.FG_SALDO_INICIAL
    ? ' class="row-saldo-inicial"'
    : r.FG_EXPEDICAO_ESTORNADA
      ? ' class="row-exp-estornada"'
      : '';
  return (
    '<tr' +
    trClass +
    '>' +
    `<td class="col-dh">${formatDataMovBr(r.DH_MOVIMENTO, r.FG_SALDO_INICIAL)}</td>` +
    `<td class="col-tipo">${esc(r.TIPO_LEGIVEL || r.TP_MOVIMENTO)}</td>` +
    `<td class="col-doc">${esc(r.DOCUMENTO || '—')}</td>` +
    `<td class="col-seq num">${r.FG_SALDO_INICIAL ? '—' : esc(r.N_ITEM || '—')}</td>` +
    `<td class="col-cod">${esc(r.CODIGO_PRODUTO)}${btnDiag}</td>` +
    `<td class="col-desc" title="${esc(r.NM_PRODUTO)}">${esc(r.NM_PRODUTO)}</td>` +
    `<td class="col-lote">${esc(r.LOTE || '—')}</td>` +
    `<td class="col-val">${formatValidadeBr(r.VALIDADE)}</td>` +
    `<td class="num col-qtd">${r.FG_SALDO_INICIAL ? '—' : formatQtd(r.QTD)}</td>` +
    `<td class="num col-saldo">${formatQtd(r.QTD_SALDO)}</td>` +
    `<td class="col-op">${esc(r.REF_OPERACAO || '—')}</td>` +
    '</tr>'
  );
}

function buildMovimentacaoHtml({
  linhas,
  avisos,
  geradoEm,
  filtroDonoLabel,
  filtroProdutoLabel,
  filtroPeriodoLabel,
  filtroSentidoLabel,
  filtroOrdemLabel,
}) {
  const dhBr = esc((geradoEm ? new Date(geradoEm) : new Date()).toLocaleString('pt-BR'));
  const filtroProdTxt = filtroProdutoLabel
    ? `<br/><strong>Filtro produto:</strong> ${esc(filtroProdutoLabel)}`
    : '';
  const filtroPeriodoTxt = metaPeriodoHtml(filtroPeriodoLabel);
  /** Quando o usuário escolhe "Entradas" ou "Saídas", destacamos no cabeçalho
   *  com fundo amarelo claro — sinal visual forte de que o relatório está
   *  filtrado e não representa toda a movimentação do período. */
  const filtroSentidoTxt = filtroSentidoLabel
    ? `<br/><span class="meta-tipo-mov"><strong>Tipo de movimento:</strong> ${esc(filtroSentidoLabel)} (somente)</span>`
    : '';
  const filtroOrdemTxt = filtroOrdemLabel
    ? `<br/><strong>Ordenação:</strong> ${esc(filtroOrdemLabel)}`
    : '';
  const lista = linhas || [];
  const nuDonos = contarDonosUnicos(lista);
  const tabelaHtml = buildTabelasHtmlPorDono(
    lista,
    THEAD_MOV,
    (rows) => '<tbody>' + rows.map(rowMovHtml).join('') + '</tbody>',
    COLS_MOV,
    'Nenhum movimento no período.'
  );
  const avisoHtml = (avisos || []).map((a) => `<li>${esc(a)}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Movimentação de itens — WMS</title>
<style>
@page { size: A4 landscape; margin: 10mm; }
body { font-family: system-ui, "Segoe UI", sans-serif; font-size: 9pt; color: #0f172a; margin: 0; padding-bottom: 48px; }
h1 { font-size: 16pt; margin: 0 0 6px; }
h2.grupo-dono { font-size: 12pt; margin: 18px 0 8px; padding: 6px 8px; background: #f1f5f9; border-left: 4px solid #0ea5e9; }
.meta { font-size: 9pt; color: #334155; margin-bottom: 10px; line-height: 1.45; }
.meta-tipo-mov { display: inline-block; margin-top: 2px; padding: 2px 6px; background: #fef3c7; border: 1px solid #f59e0b; border-radius: 3px; color: #92400e; }
.aviso { font-size: 8.5pt; color: #475569; margin: 0 0 10px 18px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 8px; table-layout: fixed; font-size: 8pt; }
table th, table td { border: 1px solid #cbd5e1; padding: 3px 4px; text-align: left; vertical-align: top; overflow: hidden; }
table th { background: #f1f5f9; font-size: 7.5pt; font-weight: 600; }
table td.num, table th.num { text-align: right; white-space: nowrap; }
table th.col-dh, table td:first-child { white-space: nowrap; }
table th.col-dh { width: 7%; }
table th.col-tipo { width: 11%; }
table th.col-doc { width: 12%; }
table th.col-seq { width: 4%; }
table th.col-cod { width: 10%; }
table th.col-desc { width: 20%; }
table th.col-lote { width: 6%; }
table th.col-val { width: 7%; }
table th.col-qtd { width: 7%; }
table th.col-saldo { width: 8%; }
table th.col-op { width: 7%; }
table td.col-desc { word-wrap: break-word; line-height: 1.25; }
table td.col-doc, table td.col-cod, table td.col-op { white-space: nowrap; }
tr.row-saldo-inicial td { background: #f8fafc; font-weight: 600; color: #334155; }
tr.row-exp-estornada td { background: #fffbeb; color: #92400e; font-style: italic; }
.toolbar { position: fixed; bottom: 0; left: 0; right: 0; padding: 10px; background: #f8fafc; border-top: 1px solid #cbd5e1; text-align: center; z-index: 9; }
.btn-diag { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; margin-left: 4px; border: 1px solid #cbd5e1; background: #f1f5f9; border-radius: 4px; cursor: pointer; font-size: 10pt; vertical-align: middle; line-height: 1; }
.btn-diag:hover { background: #e2e8f0; border-color: #94a3b8; }
.diag-overlay { position: fixed; inset: 0; background: rgba(15,23,42,0.55); display: none; align-items: center; justify-content: center; z-index: 50; padding: 16px; box-sizing: border-box; }
.diag-overlay[data-open="1"] { display: flex; }
.diag-modal { background: #fff; border-radius: 10px; max-width: 880px; width: 100%; max-height: 92vh; overflow-y: auto; padding: 22px 26px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); font-family: inherit; font-size: 10.5pt; color: #0f172a; }
.diag-modal h2 { font-size: 16pt; margin: 0 0 6px; }
.diag-modal h3 { font-size: 11pt; margin: 16px 0 6px; padding: 6px 10px; background: #f1f5f9; border-left: 4px solid #0ea5e9; }
.diag-modal table { width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 9.5pt; }
.diag-modal th, .diag-modal td { border: 1px solid #cbd5e1; padding: 4px 6px; vertical-align: top; }
.diag-modal th { background: #f1f5f9; font-size: 9pt; }
.diag-causa-erro { color: #b91c1c; font-weight: 600; }
.diag-causa-ok { color: #15803d; font-weight: 600; }
.diag-acao { border-left: 4px solid #f59e0b; padding: 8px 12px; background: #fef3c7; margin-bottom: 8px; border-radius: 0 6px 6px 0; }
.diag-acao.ok { border-color: #10b981; background: #d1fae5; }
.diag-acao-codigo { font-size: 9pt; font-weight: 700; color: #92400e; text-transform: uppercase; letter-spacing: 0.4px; }
.diag-acao.ok .diag-acao-codigo { color: #065f46; }
.diag-modal .resumo-cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin: 8px 0 12px; }
.diag-modal .resumo-card { background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 12px; text-align: center; }
.diag-modal .resumo-card .lab { font-size: 8.5pt; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; }
.diag-modal .resumo-card .val { font-size: 14pt; font-weight: 700; color: #0f172a; }
.diag-fechar { float: right; background: #e2e8f0; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-weight: 600; }
.diag-fechar:hover { background: #cbd5e1; }
@media print { .toolbar, .btn-diag, .diag-overlay { display: none !important; } body { padding-bottom: 0; } h2.grupo-dono { break-after: avoid; } }
</style>
</head>
<body>
<h1>Movimentação de itens (WMS)</h1>
<p class="meta"><strong>Gerado em:</strong> ${dhBr}<br/>
<strong>Filtro dono:</strong> ${esc(filtroDonoLabel || '—')}${filtroPeriodoTxt}${filtroProdTxt}${filtroSentidoTxt}${filtroOrdemTxt}<br/>
<strong>Donos no relatório:</strong> ${nuDonos}<br/>
<strong>Linhas:</strong> ${lista.length}</p>
<ul class="aviso">${avisoHtml}</ul>
${tabelaHtml}
<div class="toolbar">
<button type="button" id="wmsPrintBtn">Imprimir / PDF</button>
<button type="button" id="wmsCloseBtn">Fechar</button>
</div>

<div class="diag-overlay" id="diagOverlay">
  <div class="diag-modal">
    <button type="button" class="diag-fechar" id="diagClose">Fechar ✕</button>
    <h2 id="diagTitulo">Diagnóstico do SKU</h2>
    <div id="diagConteudo">Carregando…</div>
  </div>
</div>

<script>
(function () {
  function authHeaders() {
    var h = {};
    var token = localStorage.getItem('token');
    if (token) h.Authorization = 'Bearer ' + token;
    try {
      var u = JSON.parse(localStorage.getItem('user') || '{}');
      if (u && (u.login || u.SGUSUARIO)) h['user-login'] = u.login || u.SGUSUARIO;
    } catch (e) {}
    var alt = localStorage.getItem('usuario login') || localStorage.getItem('usuarioLogin');
    if (alt && !h['user-login']) h['user-login'] = alt;
    return h;
  }
  function esc(s) {
    if (s == null) return '—';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtQ(v) {
    if (v == null || v === '') return '—';
    var n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 6 });
  }
  function fmtDh(v) {
    if (!v) return '—';
    try { return new Date(v).toLocaleString('pt-BR'); } catch (e) { return String(v); }
  }
  function classeCausa(code) {
    return code === 'OK' ? 'diag-causa-ok' : 'diag-causa-erro';
  }
  function renderResumo(d) {
    var html = '<div style="font-size:10pt; color:#475569; margin-bottom:8px;">';
    html += 'Dono: <strong>' + esc(d.cdDono + ' — ' + (d.nmDono || '?')) + '</strong>';
    html += ' · Código: <strong>' + esc(d.codigoConsultado) + '</strong>';
    if (d.cadastro) html += ' (CD_PRODUTO ' + esc(d.cadastro.CD_PRODUTO) + ' — ' + esc(d.cadastro.NOME) + ')';
    html += '</div>';
    if (d.causas && d.causas.length) {
      html += '<div style="margin-bottom:8px;"><strong>Causas detectadas:</strong> ';
      html += d.causas.map(function (c) { return '<span class="diag-causa-erro">' + esc(c) + '</span>'; }).join(', ');
      html += '</div>';
    }
    if (d.resumo) {
      html += '<div class="resumo-cards">' +
        '<div class="resumo-card"><div class="lab">NF encerrada</div><div class="val">' + fmtQ(d.resumo.qtdEntradaNfEncerrada) + '</div></div>' +
        '<div class="resumo-card"><div class="lab">Movimentos (ledger)</div><div class="val">' + fmtQ(d.resumo.qtdMovimentos) + '</div></div>' +
        '<div class="resumo-card"><div class="lab">Saldo SKU</div><div class="val">' + fmtQ(d.resumo.qtdSaldoSku) + '</div></div>' +
      '</div>';
    }
    return html;
  }
  function renderAcoes(acoes) {
    if (!acoes || !acoes.length) return '';
    var html = '<h3>Ações sugeridas</h3>';
    acoes.forEach(function (a) {
      var cls = a.codigo === 'NADA_A_FAZER' ? 'ok' : '';
      html += '<div class="diag-acao ' + cls + '">' +
              '<div class="diag-acao-codigo">' + esc(a.codigo) + '</div>' +
              '<div>' + esc(a.texto) + '</div>';
      if (a.nfs && a.nfs.length) {
        html += '<div style="margin-top:6px; font-size:9.5pt;">NF-e: ';
        html += a.nfs.map(function (n) { return '#' + esc(n.CD_NFE_ENTRADA) + ' NF ' + esc(n.NU_NF) + ' (' + esc(n.ST_RECEBIMENTO) + ')'; }).join('; ');
        html += '</div>';
      }
      if (a.linhas && a.linhas.length) {
        html += '<div style="margin-top:6px; font-size:9.5pt; color:#475569;">' + a.linhas.length + ' linha(s) com problema — veja "Conferência" abaixo.</div>';
      }
      html += '</div>';
    });
    return html;
  }
  function renderNfs(label, nfs, mostrarVazio) {
    if (!nfs || !nfs.length) return mostrarVazio ? '<h3>' + label + '</h3><p style="font-size:10pt; color:#64748b;">Nenhuma.</p>' : '';
    var rows = nfs.map(function (n) {
      return '<tr><td>#' + esc(n.CD_NFE_ENTRADA) + '</td><td>' + esc(n.NU_NF) + '/' + esc(n.NU_SERIE) + '</td><td>' + esc(fmtDh(n.DH_RECEBIMENTO)) + '</td><td>' + esc(n.ST_RECEBIMENTO) + '</td><td class="num">' + esc(n.qtd_linhas_nfe != null ? n.qtd_linhas_nfe : (n.qtd_linhas != null ? n.qtd_linhas : '—')) + '</td><td class="num">' + esc(n.qtd_linhas_conf != null ? n.qtd_linhas_conf : '—') + '</td></tr>';
    }).join('');
    return '<h3>' + label + ' (' + nfs.length + ')</h3><table><thead><tr><th>CD_NFE</th><th>NF/Série</th><th>Recebido em</th><th>Status</th><th class="num">Linhas JSON</th><th class="num">Linhas conferência</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  function renderNfsAmpliadas(label, nfs) {
    if (!nfs || !nfs.length) return '<h3>' + label + '</h3><p style="font-size:10pt; color:#15803d;">✓ Nenhuma NF deste código em outros donos do tenant.</p>';
    var rows = nfs.map(function (n) {
      return '<tr><td>#' + esc(n.CD_NFE_ENTRADA) + '</td><td><strong>' + esc(n.CD_DONO) + ' — ' + esc(n.NM_DONO) + '</strong></td><td>' + esc(n.NU_NF) + '/' + esc(n.NU_SERIE) + '</td><td>' + esc(fmtDh(n.DH_RECEBIMENTO)) + '</td><td>' + esc(n.ST_RECEBIMENTO) + '</td></tr>';
    }).join('');
    return '<h3 style="border-left-color:#dc2626; background:#fef2f2;">' + label + ' (' + nfs.length + ')</h3><table><thead><tr><th>CD_NFE</th><th>Dono</th><th>NF/Série</th><th>Recebido em</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  function renderCadastrosDuplicados(produtos) {
    if (!produtos || !produtos.length) return '';
    var rows = produtos.map(function (p) {
      return '<tr><td>#' + esc(p.CD_PRODUTO) + '</td><td>' + esc(p.CODIGO) + '</td><td>' + esc(p.NOME) + '</td><td>' + esc(p.UNIDADE) + '</td><td>' + esc(p.FGACTIVE) + '</td></tr>';
    }).join('');
    return '<h3 style="border-left-color:#dc2626; background:#fef2f2;">Cadastros DUPLICADOS no mesmo dono (' + produtos.length + ')</h3><p style="font-size:10pt; color:#475569;">Mesma chave de código OL em mais de um CD_PRODUTO (ex.: com e sem máscara). Nome igual com códigos diferentes não entra aqui.</p><table><thead><tr><th>CD_PRODUTO</th><th>Código</th><th>Nome</th><th>Unid.</th><th>Ativo</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  function renderConferencia(linhas) {
    if (!linhas || !linhas.length) return '';
    var rows = linhas.map(function (l) {
      return '<tr><td>#' + esc(l.CD_NFE_ENTRADA) + '</td><td>' + esc(l.NU_NF) + '</td><td>' + esc(l.nItem) + '</td><td>' + esc(l.codigoProduto) + '</td><td>' + esc(l.cdProdutoRaw) + '</td><td>' + esc(l.lote) + '</td><td>' + esc(l.validade) + '</td><td class="num">' + esc(l.qtdRecebida) + '</td><td class="num">' + esc(l.fatorConversao) + '</td><td class="num">' + esc(l.qtdConvertida) + '</td><td class="' + classeCausa(l.diagnostico.code) + '">' + esc(l.diagnostico.txt) + '</td></tr>';
    }).join('');
    return '<h3>Linhas da conferência</h3><table><thead><tr><th>CD_NFE</th><th>NF</th><th>nItem</th><th>codigoProduto</th><th>cdProduto</th><th>Lote</th><th>Validade</th><th class="num">QtdReceb.</th><th class="num">Fator</th><th class="num">QtdConv.</th><th>Diagnóstico</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  function renderReservasOpl(rsv) {
    if (!rsv || !rsv.reservas || !rsv.reservas.length) return '';
    var totalOrfa = (rsv.totais && rsv.totais.totalOrfas) || 0;
    var totalAtiva = (rsv.totais && rsv.totais.totalAtivas) || 0;
    var headerCls = totalOrfa > 0 ? 'border-left-color:#dc2626; background:#fef2f2;' : 'border-left-color:#0ea5e9;';
    var titulo = totalOrfa > 0
      ? 'Reservas OPL — encontrou ' + rsv.reservas.filter(function (r) { return r.classificacao === "ORFA"; }).length + ' ESPELHO(S) ÓRFÃO(S)'
      : 'Reservas OPL (ativas, sem órfãs)';
    var rows = rsv.reservas.map(function (r) {
      var cls = r.classificacao === 'ORFA' ? 'diag-causa-erro' : '';
      return '<tr>' +
        '<td>#' + esc(r.CD_OPL_ARQUIVO) + '</td>' +
        '<td>' + esc(r.NM_ARQUIVO || '—') + '</td>' +
        '<td>' + esc(fmtDh(r.DH_IMPORT)) + '</td>' +
        '<td class="num">' + fmtQ(r.QTD_RESERVADA) + '</td>' +
        '<td class="num">' + esc(r.qtdCargasExpedidas || 0) + ' / ' + esc(r.qtdCargas || 0) + '</td>' +
        '<td class="' + cls + '"><strong>' + esc(r.classificacao) + '</strong></td>' +
        '</tr>';
    }).join('');
    return '<h3 style="' + headerCls + '">' + titulo + '</h3>' +
      '<p style="font-size:10pt; color:#475569;">Total ativo: <strong>' + fmtQ(totalAtiva) + '</strong> · Total órfão (descontando 2x da trava): <strong style="color:#dc2626">' + fmtQ(totalOrfa) + '</strong></p>' +
      '<table><thead><tr><th>CD espelho</th><th>Arquivo</th><th>Importado em</th><th class="num">Qtd reservada</th><th class="num">Cargas expedidas / total</th><th>Classificação</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  function renderMovimentos(movs) {
    if (!movs || !movs.length) return '<h3>Movimentos do ledger</h3><p style="font-size:10pt; color:#64748b;">Nenhum movimento registrado.</p>';
    var rows = movs.map(function (m) {
      return '<tr><td>#' + esc(m.CD_MOVIMENTO) + '</td><td>' + esc(fmtDh(m.DH_REGISTRO)) + '</td><td>' + esc(m.TP_MOVIMENTO) + '</td><td class="num">' + fmtQ(m.QTD) + '</td><td>' + esc(m.REF_CD_CARGA) + '</td><td>' + esc(m.SG_USER) + '</td></tr>';
    }).join('');
    return '<h3>Movimentos do ledger</h3><table><thead><tr><th>CD_MOV</th><th>Data/hora</th><th>Tipo</th><th class="num">Qtd</th><th>Carga</th><th>Usuário</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }
  async function abrirDiagnostico(cdDono, codigo) {
    var ov = document.getElementById('diagOverlay');
    var conteudo = document.getElementById('diagConteudo');
    document.getElementById('diagTitulo').textContent = 'Diagnóstico do SKU ' + codigo + ' (dono ' + cdDono + ')';
    conteudo.innerHTML = 'Consultando…';
    ov.setAttribute('data-open', '1');
    try {
      var r = await fetch('/api/wms/diagnostico-sku?cdDono=' + encodeURIComponent(cdDono) + '&codigo=' + encodeURIComponent(codigo), { headers: authHeaders() });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
      conteudo.innerHTML = renderResumo(data) + renderAcoes(data.acoes) + renderNfsAmpliadas('NF-e em OUTROS donos do mesmo tenant (provável dono errado)', data.nfsOutrosDonos) + renderNfs('NF-e abertas (não encerradas)', data.nfsAbertas, true) + renderNfs('NF-e encerradas', data.nfsEncerradas, true) + renderNfs('NF-e do dono com NOME parecido mas sem o código (provável código de fornecedor)', data.nfsPorNome, false) + renderCadastrosDuplicados(data.cadastrosDuplicados) + renderReservasOpl(data.reservasOpl) + renderConferencia(data.conferencias) + renderMovimentos(data.movimentos);
    } catch (e) {
      conteudo.innerHTML = '<p style="color:#b91c1c; font-weight:600;">Erro: ' + esc(e.message || 'falha no diagnóstico') + '</p>';
    }
  }
  document.getElementById('diagClose').addEventListener('click', function () { document.getElementById('diagOverlay').removeAttribute('data-open'); });
  document.getElementById('diagOverlay').addEventListener('click', function (ev) { if (ev.target === this) this.removeAttribute('data-open'); });
  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest && ev.target.closest('.btn-diag');
    if (!btn) return;
    var cd = btn.getAttribute('data-cddono');
    var cod = btn.getAttribute('data-codigo');
    if (cd && cod) abrirDiagnostico(cd, cod);
  });
  document.getElementById('wmsPrintBtn').addEventListener('click', function () { window.focus(); window.print(); });
  document.getElementById('wmsCloseBtn').addEventListener('click', function () { window.close(); });
})();
</script>
</body>
</html>`;
}

module.exports = { buildMovimentacaoHtml };
