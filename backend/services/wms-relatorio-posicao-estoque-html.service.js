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
  return esc(n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
}

function labelDonoLinha(r) {
  const cd = r.CD_DONO != null ? String(r.CD_DONO) : '';
  const nm = String(r.NM_DONO || '').trim();
  if (cd && nm) return `${cd} — ${nm}`;
  if (nm) return nm;
  return cd || '—';
}

/** Conservação já aparece no ▌separador — coluna por linha só ocupa espaço. */
function exibirColunaConservacao(camposQuebra) {
  const campos = camposQuebra || [];
  return !campos.includes('conservacao') && !campos.includes('conservacao_faixas');
}

function contarColunasPosicao(exibirColDono, exibirColCons) {
  /** Dono? + Código + Desc + Cons? + Lote + Validade + Entrada validade + Saldo validade */
  return 6 + (exibirColDono ? 1 : 0) + (exibirColCons ? 1 : 0);
}

function chaveSku(r) {
  return `${r.CD_DONO != null ? r.CD_DONO : ''}|${r.CD_PRODUTO != null ? r.CD_PRODUTO : ''}`;
}

function btnDiagHtml(r) {
  if (r.CD_DONO == null || !r.CODIGO_PRODUTO) return '';
  return (
    `<button type="button" class="btn-diag${r.SEM_ENTRADA_ENCERRADA ? ' btn-diag-alerta' : ''}" ` +
    `data-cddono="${esc(r.CD_DONO)}" data-codigo="${esc(r.CODIGO_PRODUTO)}" ` +
    `title="Diagnosticar este SKU">🔍</button>`
  );
}

function badgesSkuHtml(r) {
  const saldo = Number(r.QTD_SALDO_SKU) || 0;
  const zerado = Math.abs(saldo) < 1e-9;
  const entSku =
    r.QTD_ENTRADA_SKU != null && Number.isFinite(Number(r.QTD_ENTRADA_SKU))
      ? Number(r.QTD_ENTRADA_SKU)
      : null;
  return (
    `<span class="sku-badges">` +
    (entSku != null
      ? `<span class="sku-badge" title="Entradas NF/inventário no SKU">Ent. ${formatQtd(entSku)}</span>`
      : '') +
    `<span class="sku-badge" title="Saídas acumuladas no ledger do SKU (não por validade)">Saídas ${formatQtd(r.QTD_SAIDA_SKU)}</span>` +
    `<span class="sku-badge" title="Reservas OPL">Res. ${formatQtd(r.QTD_RESERVA_SKU)}</span>` +
    `<span class="sku-badge sku-badge-saldo${zerado ? ' is-zero' : ''}" title="Saldo ledger do produto">Saldo <strong>${formatQtd(saldo)}</strong></span>` +
    (zerado ? `<span class="sku-badge sku-badge-hist">zerado</span>` : '') +
    `</span>`
  );
}

/** Cabeçalho do SKU: métricas do produto uma vez. */
function rowSkuCabHtml(r, exibirColDono, exibirColCons) {
  const origemTag = r.ORIGEM_INVENTARIO
    ? ' <span class="tag-origem">(inventário)</span>'
    : r.ORIGEM_TRANSFERENCIA
      ? ' <span class="tag-origem">(transferência)</span>'
      : '';
  const semEnt =
    r.SEM_ENTRADA_ENCERRADA && !r.ORIGEM_INVENTARIO && !r.ORIGEM_TRANSFERENCIA
      ? ' <span class="tag-origem tag-alerta">(só mov.)</span>'
      : '';
  const saldo = Number(r.QTD_SALDO_SKU) || 0;
  const cls = Math.abs(saldo) < 1e-9 ? 'sku-cab sku-cab-zero' : 'sku-cab';
  return (
    `<tr class="${cls}">` +
    (exibirColDono ? `<td>${esc(labelDonoLinha(r))}</td>` : '') +
    `<td class="sku-cod">${esc(r.CODIGO_PRODUTO)}${origemTag}${semEnt} ${btnDiagHtml(r)}</td>` +
    `<td class="sku-nome">${esc(r.NM_PRODUTO)}</td>` +
    (exibirColCons ? `<td>${esc(r.TIPO_ARMAZENAGEM || '—')}</td>` : '') +
    `<td class="sku-totais" colspan="4">${badgesSkuHtml(r)}</td>` +
    '</tr>'
  );
}

/** Linha de validade/lote — sem repetir Saída/Saldo SKU. */
function rowValidadeHtml(r, exibirColDono, exibirColCons) {
  const fefo =
    r.QTD_SALDO_EST_FEFO != null && Number.isFinite(Number(r.QTD_SALDO_EST_FEFO))
      ? formatQtd(r.QTD_SALDO_EST_FEFO)
      : '—';
  const fefoN = Number(r.QTD_SALDO_EST_FEFO);
  const fefoZero = Number.isFinite(fefoN) && Math.abs(fefoN) < 1e-9;
  const origemLinha = r.ORIGEM_TRANSFERENCIA
    ? ' <span class="tag-origem" title="Entrada via transferência entre donos">transf.</span>'
    : r.ORIGEM_INVENTARIO
      ? ' <span class="tag-origem" title="Saldo registrado no inventário">inv.</span>'
      : '';
  return (
    `<tr class="sku-val${fefoZero ? ' sku-val-zero' : ''}">` +
    (exibirColDono ? '<td class="muted"></td>' : '') +
    '<td class="muted sku-indent">↳ validade</td>' +
    '<td class="muted"></td>' +
    (exibirColCons ? `<td class="muted">${esc(r.TIPO_ARMAZENAGEM || '—')}</td>` : '') +
    `<td>${esc(r.LOTE || '—')}${origemLinha}</td>` +
    `<td>${esc(r.VALIDADE_BR || r.VALIDADE || '—')}</td>` +
    `<td class="num">${formatQtd(r.QTD_ENTRADA)}</td>` +
    `<td class="num fefo">${fefo}</td>` +
    '</tr>'
  );
}

function theadHtml(exibirColDono, exibirColCons) {
  return (
    '<thead><tr>' +
    (exibirColDono ? '<th>Dono</th>' : '') +
    '<th>Código</th><th>Descrição / totais do SKU</th>' +
    (exibirColCons ? '<th>Conservação</th>' : '') +
    '<th>Lote</th><th>Validade</th>' +
    '<th class="num" title="Quantidade registrada nesta validade (NF, inventário ou transferência)">Entrada nesta validade</th>' +
    '<th class="num" title="Quanto resta nesta validade após ratear saídas do SKU (FEFO)">Saldo nesta validade</th>' +
    '</tr></thead>'
  );
}

function buildTabelaCorpo(linhas, exibirColDono, optsSeparadores) {
  const modo = normalizarModoSeparadores(optsSeparadores && optsSeparadores.modo);
  const camposQuebra = resolverCamposQuebra([], modo);
  const exibirColCons =
    optsSeparadores && optsSeparadores.exibirColCons != null
      ? !!optsSeparadores.exibirColCons
      : exibirColunaConservacao(camposQuebra);
  const cols = contarColunasPosicao(exibirColDono, exibirColCons);
  if (!linhas || !linhas.length) {
    return (
      `<tbody><tr><td colspan="${cols}"><strong>Nenhum saldo encontrado.</strong> ` +
      `Com «ocultar zerados» ativo, SKUs sem saldo não aparecem. ` +
      `Sem NF-e encerrada e sem movimentos o relatório fica vazio.</td></tr></tbody>`
    );
  }
  const usarSeparadores = modo !== 'nao' && camposQuebra.length > 0;
  let html = '<tbody>';
  let chaveAnterior = null;
  let skuAnterior = null;
  for (const r of linhas) {
    if (usarSeparadores) {
      const chaveAtual = chaveSeparadorLinha(r, camposQuebra);
      if (chaveAtual !== chaveAnterior) {
        const rotulo = rotuloSeparadorGrupo(r, camposQuebra);
        html +=
          `<tr class="saldo-grp-sep"><td colspan="${cols}">` +
          `<span class="saldo-grp-bullet" aria-hidden="true">▌</span>${esc(rotulo)}</td></tr>`;
        chaveAnterior = chaveAtual;
      }
    }
    const sk = chaveSku(r);
    if (sk !== skuAnterior) {
      html += rowSkuCabHtml(r, exibirColDono, exibirColCons);
      skuAnterior = sk;
    }
    html += rowValidadeHtml(r, exibirColDono, exibirColCons);
  }
  html += '</tbody>';
  return html;
}

function buildTabelasAgrupadasPorDono(linhas, optsSeparadores) {
  const byDono = new Map();
  (linhas || []).forEach((r) => {
    const k = r.CD_DONO != null ? String(r.CD_DONO) : '0';
    if (!byDono.has(k)) byDono.set(k, []);
    byDono.get(k).push(r);
  });
  const exibirColCons =
    optsSeparadores && optsSeparadores.exibirColCons != null
      ? !!optsSeparadores.exibirColCons
      : true;
  const parts = [];
  for (const [, rows] of byDono) {
    const tit = labelDonoLinha(rows[0]);
    parts.push(
      `<h2 class="grupo-dono">${esc(tit)}</h2>` +
        `<table>${theadHtml(false, exibirColCons)}${buildTabelaCorpo(rows, false, optsSeparadores)}</table>`
    );
  }
  return parts.join('');
}

/**
 * HTML imprimível — posição de estoque (A4).
 * @param {{ linhas: object[], avisos: string[], geradoEm: string, filtroDonoLabel?: string, separadoresGrupo?: string }} payload
 */
function buildPosicaoEstoqueHtml({
  linhas,
  avisos,
  geradoEm,
  filtroDonoLabel,
  filtroProdutoLabel,
  separadoresGrupo,
  ordem,
  ocultarZerados,
  skusOcultosZerados,
  skusVisiveis,
}) {
  const modoSep = normalizarModoSeparadores(separadoresGrupo || 'nao');
  const camposQuebra = resolverCamposQuebra(ordem, modoSep);
  const listaBruta = linhas || [];
  const lista =
    modoSep !== 'nao' || (ordem && ordem.length)
      ? ordenarLinhasSaldo(listaBruta, ordem || [], modoSep)
      : listaBruta;
  const dh = geradoEm ? new Date(geradoEm) : new Date();
  const dhBr = esc(dh.toLocaleString('pt-BR'));
  const donosUnicos = new Set(lista.map((r) => (r.CD_DONO != null ? String(r.CD_DONO) : '')));
  /** Sempre agrupa por dono (cabeçalho "1 — Mana") — mesmo com 1 dono no
   *  resultado. Evita dúvida quando o filtro pede vários donos e só um tem linhas. */
  const exibirColCons = exibirColunaConservacao(camposQuebra);
  const optsSep = { modo: modoSep, exibirColCons };
  const tabelaHtml = lista.length
    ? buildTabelasAgrupadasPorDono(lista, optsSep)
    : `<table>${theadHtml(false, exibirColCons)}<tbody><tr><td colspan="${contarColunasPosicao(false, exibirColCons)}">Sem linhas.</td></tr></tbody></table>`;

  const avisoHtml = (avisos || [])
    .map((a) => `<li>${esc(a)}</li>`)
    .join('');

  const filtroTxt = esc(
    filtroDonoLabel || 'Todos os donos com saldo em entradas encerradas'
  );
  const filtroProdTxt = filtroProdutoLabel
    ? `<br/><strong>Filtro produto:</strong> ${esc(filtroProdutoLabel)}`
    : '';
  const sepTxt =
    modoSep !== 'nao' && camposQuebra.length
      ? `<br/><strong>Separadores:</strong> ${esc(rotuloModoSeparadores(modoSep, camposQuebra))} (cadastro WMS)`
      : '';
  const ordemTxt = rotuloOrdemCampos(ordem)
    ? `<br/><strong>Ordenação:</strong> ${esc(rotuloOrdemCampos(ordem))}`
    : '';
  const skusSet = new Set(lista.map((r) => chaveSku(r)));
  const ocultarTxt =
    ocultarZerados === false
      ? '<br/><strong>Zerados:</strong> incluídos (histórico)'
      : `<br/><strong>Zerados:</strong> ocultos` +
        (skusOcultosZerados != null
          ? ` (${esc(skusOcultosZerados)} SKU` +
            (Number(skusOcultosZerados) === 1 ? '' : 's') +
            ')'
          : '');
  const contagemTxt =
    `<br/><strong>SKUs:</strong> ${skusVisiveis != null ? esc(skusVisiveis) : skusSet.size}` +
    ` · <strong>Linhas de validade:</strong> ${lista.length}`;

  const nomesDonosRel = [];
  const seenDono = new Set();
  for (const r of lista) {
    const k = r.CD_DONO != null ? String(r.CD_DONO) : '';
    if (!k || seenDono.has(k)) continue;
    seenDono.add(k);
    nomesDonosRel.push(labelDonoLinha(r));
  }
  const donosRelTxt =
    nomesDonosRel.length === 0
      ? '0'
      : nomesDonosRel.length === 1
        ? esc(nomesDonosRel[0])
        : `${donosUnicos.size} (${esc(nomesDonosRel.join('; '))})`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Posição de estoque — WMS</title>
<style>
@page { size: A4 portrait; margin: 12mm; }
body { font-family: system-ui, "Segoe UI", sans-serif; font-size: 10pt; color: #0f172a; margin: 0; padding-bottom: 48px; }
h1 { font-size: 16pt; margin: 0 0 6px; }
h2.grupo-dono { font-size: 12pt; margin: 18px 0 8px; padding: 6px 8px; background: #f1f5f9; border-left: 4px solid #0ea5e9; }
.meta { font-size: 9.5pt; line-height: 1.45; color: #334155; margin-bottom: 10px; }
.aviso { font-size: 9pt; color: #475569; margin: 0 0 12px 18px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
th, td { border: 1px solid #cbd5e1; padding: 5px 6px; text-align: left; vertical-align: top; }
th { background: #f1f5f9; font-size: 9pt; }
td.num, th.num { text-align: right; white-space: nowrap; }
td.fefo { font-weight: 600; color: #0f766e; }
td.muted { color: #94a3b8; border-color: #e2e8f0; }
.sku-indent { padding-left: 14px !important; font-size: 8.5pt; }
tr.sku-cab td { background: #f8fafc; border-top: 2px solid #94a3b8; font-weight: 600; }
tr.sku-cab-zero td { background: #f1f5f9; color: #64748b; }
tr.sku-val-zero td { color: #94a3b8; }
.sku-cod { white-space: nowrap; }
.sku-totais { font-weight: 500; }
.sku-badges { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.sku-badge { display: inline-block; font-size: 8pt; font-weight: 600; padding: 2px 7px; border-radius: 999px; background: #e2e8f0; color: #334155; white-space: nowrap; }
.sku-badge-saldo { background: #ccfbf1; color: #0f766e; }
.sku-badge-saldo.is-zero { background: #e2e8f0; color: #64748b; }
.sku-badge-hist { background: #fee2e2; color: #991b1b; }
.tag-origem { color: #1d4ed8; font-size: 8pt; font-weight: 600; }
.tag-alerta { color: #b45309; }
.saldo-grp-sep td {
  background: #eff6ff; font-weight: 700; font-size: 9.5pt; color: #1e3a8a;
  border-top: 2px solid #93c5fd; padding: 6px 8px;
}
.saldo-grp-bullet { color: #1d4ed8; margin-right: 4px; }
@media print {
  .saldo-grp-sep td, tr.sku-cab td, .sku-badge {
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .saldo-grp-sep td { background: #eff6ff !important; }
  tr.sku-cab td { background: #f8fafc !important; }
}
.toolbar { position: fixed; bottom: 0; left: 0; right: 0; padding: 10px; background: #f8fafc; border-top: 1px solid #cbd5e1; text-align: center; z-index: 9; }
.btn-diag { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; margin-left: 4px; border: 1px solid #cbd5e1; background: #f1f5f9; border-radius: 4px; cursor: pointer; font-size: 11pt; vertical-align: middle; line-height: 1; }
.btn-diag:hover { background: #e2e8f0; border-color: #94a3b8; }
.btn-diag-alerta { background: #fef3c7; border-color: #fbbf24; }
.btn-diag-alerta:hover { background: #fde68a; }
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
@media print { .toolbar, .btn-diag, .diag-overlay { display: none !important; } body { padding-bottom: 0; } h2.grupo-dono { break-after: avoid; } tr.sku-cab { break-after: avoid; } }
</style>
</head>
<body>
<h1>Posição de estoque (WMS)</h1>
<p class="meta"><strong>Gerado em:</strong> ${dhBr}<br/>
<strong>Filtro dono:</strong> ${filtroTxt}${filtroProdTxt}${sepTxt}${ordemTxt}${ocultarTxt}${contagemTxt}<br/>
<strong>Donos no relatório:</strong> ${donosRelTxt}</p>
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
    var loginAlt = localStorage.getItem('usuario login') || localStorage.getItem('usuarioLogin');
    if (loginAlt && !h['user-login']) h['user-login'] = loginAlt;
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
    return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }
  function fmtDh(v) {
    if (!v) return '—';
    try { return new Date(v).toLocaleString('pt-BR'); } catch (e) { return String(v); }
  }
  function classeCausa(code) {
    return code === 'OK' ? 'diag-causa-ok' : 'diag-causa-erro';
  }

  function renderResumo(d) {
    var html = '';
    html += '<div style="font-size:10pt; color:#475569; margin-bottom:8px;">';
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
      html += '<div class="diag-acao ' + cls + '">';
      html += '<div class="diag-acao-codigo">' + esc(a.codigo) + '</div>';
      html += '<div>' + esc(a.texto) + '</div>';
      if (a.nfs && a.nfs.length) {
        html += '<div style="margin-top:6px; font-size:9.5pt;">NF-e: ';
        html += a.nfs.map(function (n) {
          return '#' + esc(n.CD_NFE_ENTRADA) + ' NF ' + esc(n.NU_NF) + ' (' + esc(n.ST_RECEBIMENTO) + ')';
        }).join('; ');
        html += '</div>';
      }
      if (a.linhas && a.linhas.length) {
        html += '<div style="margin-top:6px; font-size:9.5pt; color:#475569;">' + a.linhas.length + ' linha(s) com problema — veja detalhes na tabela "Conferência" abaixo.</div>';
      }
      html += '</div>';
    });
    return html;
  }

  function renderNfs(label, nfs, mostrarMsgVazio) {
    if (!nfs || !nfs.length) {
      if (mostrarMsgVazio) return '<h3>' + label + '</h3><p style="font-size:10pt; color:#64748b;">Nenhuma.</p>';
      return '';
    }
    var rows = nfs.map(function (n) {
      return '<tr>' +
        '<td>#' + esc(n.CD_NFE_ENTRADA) + '</td>' +
        '<td>' + esc(n.NU_NF) + '/' + esc(n.NU_SERIE) + '</td>' +
        '<td>' + esc(fmtDh(n.DH_RECEBIMENTO)) + '</td>' +
        '<td>' + esc(n.ST_RECEBIMENTO) + '</td>' +
        '<td class="num">' + esc(n.qtd_linhas_nfe != null ? n.qtd_linhas_nfe : (n.qtd_linhas != null ? n.qtd_linhas : '—')) + '</td>' +
        '<td class="num">' + esc(n.qtd_linhas_conf != null ? n.qtd_linhas_conf : '—') + '</td>' +
      '</tr>';
    }).join('');
    return '<h3>' + label + ' (' + nfs.length + ')</h3>' +
      '<table><thead><tr><th>CD_NFE</th><th>NF/Série</th><th>Recebido em</th><th>Status</th><th class="num">Linhas JSON</th><th class="num">Linhas conferência</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  function renderNfsAmpliadas(label, nfs) {
    /** Igual a renderNfs mas com coluna extra de dono e mostra mensagem
     *  específica quando vazio (resultado positivo: "nada em outro dono"). */
    if (!nfs || !nfs.length) {
      return '<h3>' + label + '</h3><p style="font-size:10pt; color:#15803d;">✓ Nenhuma NF deste código em outros donos do tenant.</p>';
    }
    var rows = nfs.map(function (n) {
      return '<tr>' +
        '<td>#' + esc(n.CD_NFE_ENTRADA) + '</td>' +
        '<td><strong>' + esc(n.CD_DONO) + ' — ' + esc(n.NM_DONO) + '</strong></td>' +
        '<td>' + esc(n.NU_NF) + '/' + esc(n.NU_SERIE) + '</td>' +
        '<td>' + esc(fmtDh(n.DH_RECEBIMENTO)) + '</td>' +
        '<td>' + esc(n.ST_RECEBIMENTO) + '</td>' +
      '</tr>';
    }).join('');
    return '<h3 style="border-left-color:#dc2626; background:#fef2f2;">' + label + ' (' + nfs.length + ')</h3>' +
      '<table><thead><tr><th>CD_NFE</th><th>Dono</th><th>NF/Série</th><th>Recebido em</th><th>Status</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  function renderCadastrosDuplicados(produtos) {
    if (!produtos || !produtos.length) return '';
    var rows = produtos.map(function (p) {
      return '<tr>' +
        '<td>#' + esc(p.CD_PRODUTO) + '</td>' +
        '<td>' + esc(p.CODIGO) + '</td>' +
        '<td>' + esc(p.NOME) + '</td>' +
        '<td>' + esc(p.UNIDADE) + '</td>' +
        '<td>' + esc(p.FGACTIVE) + '</td>' +
      '</tr>';
    }).join('');
    return '<h3 style="border-left-color:#dc2626; background:#fef2f2;">Cadastros DUPLICADOS no mesmo dono (' + produtos.length + ')</h3>' +
      '<p style="font-size:10pt; color:#475569;">Mesma chave de código OL em mais de um CD_PRODUTO (não confundir com mesmo nome e códigos diferentes).</p>' +
      '<table><thead><tr><th>CD_PRODUTO</th><th>Código</th><th>Nome</th><th>Unid.</th><th>Ativo</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  function renderConferencia(linhas) {
    if (!linhas || !linhas.length) return '';
    var rows = linhas.map(function (l) {
      return '<tr>' +
        '<td>#' + esc(l.CD_NFE_ENTRADA) + '</td>' +
        '<td>' + esc(l.NU_NF) + '</td>' +
        '<td>' + esc(l.nItem) + '</td>' +
        '<td>' + esc(l.codigoProduto) + '</td>' +
        '<td>' + esc(l.cdProdutoRaw) + '</td>' +
        '<td>' + esc(l.lote) + '</td>' +
        '<td>' + esc(l.validade) + '</td>' +
        '<td class="num">' + esc(l.qtdRecebida) + '</td>' +
        '<td class="num">' + esc(l.fatorConversao) + '</td>' +
        '<td class="num">' + esc(l.qtdConvertida) + '</td>' +
        '<td class="' + classeCausa(l.diagnostico.code) + '">' + esc(l.diagnostico.txt) + '</td>' +
      '</tr>';
    }).join('');
    return '<h3>Linhas da conferência</h3>' +
      '<table><thead><tr><th>CD_NFE</th><th>NF</th><th>nItem</th><th>codigoProduto</th><th>cdProduto</th><th>Lote</th><th>Validade</th><th class="num">QtdReceb.</th><th class="num">Fator</th><th class="num">QtdConv.</th><th>Diagnóstico</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
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
      return '<tr>' +
        '<td>#' + esc(m.CD_MOVIMENTO) + '</td>' +
        '<td>' + esc(fmtDh(m.DH_REGISTRO)) + '</td>' +
        '<td>' + esc(m.TP_MOVIMENTO) + '</td>' +
        '<td class="num">' + fmtQ(m.QTD) + '</td>' +
        '<td>' + esc(m.REF_CD_CARGA) + '</td>' +
        '<td>' + esc(m.SG_USER) + '</td>' +
      '</tr>';
    }).join('');
    return '<h3>Movimentos do ledger</h3>' +
      '<table><thead><tr><th>CD_MOV</th><th>Data/hora</th><th>Tipo</th><th class="num">Qtd</th><th>Carga</th><th>Usuário</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  async function abrirDiagnostico(cdDono, codigo) {
    var ov = document.getElementById('diagOverlay');
    var conteudo = document.getElementById('diagConteudo');
    var tit = document.getElementById('diagTitulo');
    tit.textContent = 'Diagnóstico do SKU ' + codigo + ' (dono ' + cdDono + ')';
    conteudo.innerHTML = 'Consultando…';
    ov.setAttribute('data-open', '1');
    try {
      var url = '/api/wms/diagnostico-sku?cdDono=' + encodeURIComponent(cdDono) +
                '&codigo=' + encodeURIComponent(codigo);
      var r = await fetch(url, { headers: authHeaders() });
      var data = await r.json();
      if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
      conteudo.innerHTML =
        renderResumo(data) +
        renderAcoes(data.acoes) +
        renderNfsAmpliadas('NF-e em OUTROS donos do mesmo tenant (provável dono errado)', data.nfsOutrosDonos, true) +
        renderNfs('NF-e abertas (não encerradas)', data.nfsAbertas, true) +
        renderNfs('NF-e encerradas', data.nfsEncerradas, true) +
        renderNfs('NF-e do dono com NOME parecido mas sem o código (provável código de fornecedor)', data.nfsPorNome, false) +
        renderCadastrosDuplicados(data.cadastrosDuplicados) +
        renderReservasOpl(data.reservasOpl) +
        renderConferencia(data.conferencias) +
        renderMovimentos(data.movimentos);
    } catch (e) {
      conteudo.innerHTML = '<p style="color:#b91c1c; font-weight:600;">Erro: ' + esc(e.message || 'falha no diagnóstico') + '</p>';
    }
  }

  document.getElementById('diagClose').addEventListener('click', function () {
    document.getElementById('diagOverlay').removeAttribute('data-open');
  });
  document.getElementById('diagOverlay').addEventListener('click', function (ev) {
    if (ev.target === this) this.removeAttribute('data-open');
  });

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

module.exports = { buildPosicaoEstoqueHtml, labelDonoLinha };
