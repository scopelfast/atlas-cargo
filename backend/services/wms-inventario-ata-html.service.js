'use strict';

const { applyProductMask } = require('../utils/wms-codigo-produto-mask');
const {
  normalizarModoSeparadores,
  resolverCamposQuebra,
  ordenarLinhasSaldo,
  chaveSeparadorLinha,
  rotuloSeparadorGrupo,
  rotuloModoSeparadores,
  rotuloOrdemCampos,
} = require('./wms-relatorio-separadores-cadastro.service');

function codigoExibicao(codigo, mascaraDono) {
  const c = String(codigo || '').trim();
  if (!c) return '';
  const m = String(mascaraDono || '').trim();
  return m ? applyProductMask(c, m) : c;
}

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
  return esc(n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 6 }));
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
  if (!v) return '—';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return esc(`${d}/${m}/${y}`);
  }
  return esc(s);
}

function labelUsuarioEmitente(u) {
  if (!u) return '—';
  const nome = String(u.nome || '').trim();
  const login = String(u.login || '').trim();
  if (nome && login) return `${nome} (${login})`;
  return nome || login || '—';
}

function labelStatus(st, previa) {
  const s = String(st || '').toUpperCase();
  if (previa && s !== 'ENCERRADO' && s !== 'CANCELADO') {
    return `${s} — PRÉVIA (sem valor oficial até encerrar)`;
  }
  return s || '—';
}

function linhaRowHtml(l, mascaraDono) {
  const qtdCont = l.QTD_CONTADA != null && l.QTD_CONTADA !== '' ? formatQtd(l.QTD_CONTADA) : '—';
  return (
    '<tr>' +
    `<td>${esc(codigoExibicao(l.CODIGO_PRODUTO, mascaraDono))}</td>` +
    `<td>${esc(l.NM_PRODUTO || '—')}</td>` +
    `<td>${esc(l.LOTE || '—')}</td>` +
    `<td>${fmtValidade(l.VALIDADE)}</td>` +
    `<td class="num">${formatQtd(l.QTD_SISTEMA_SNAPSHOT)}</td>` +
    `<td class="num">${qtdCont}</td>` +
    `<td>${esc(l.ORIGEM || '—')}</td>` +
  '</tr>'
  );
}

function resumoRowHtml(r, mascaraDono) {
  const aj = Number(r.QTD_AJUSTE_SKU);
  const zero = Math.abs(aj) < 1e-9;
  const cls = zero ? 'ajuste-ok' : aj > 0 ? 'ajuste-pos' : 'ajuste-neg';
  const ajTxt = zero ? '0 · OK' : formatQtd(r.QTD_AJUSTE_SKU);
  const snapNote =
    r.DIVERGENCIA_SNAPSHOT && r.QTD_SNAPSHOT_REF != null
      ? `<br/><small style="color:#92400e">snap. linha: ${formatQtd(r.QTD_SNAPSHOT_REF)}</small>`
      : '';
  return (
    '<tr>' +
    `<td>${esc(codigoExibicao(r.CODIGO_PRODUTO, mascaraDono))}</td>` +
    `<td>${esc(r.NM_PRODUTO)}</td>` +
    `<td class="num">${formatQtd(r.QTD_SISTEMA_SKU)}${snapNote}</td>` +
    `<td class="num">${formatQtd(r.QTD_CONTADA_SKU)}</td>` +
    `<td class="num ${cls}"><strong>${esc(ajTxt)}</strong></td>` +
    '</tr>'
  );
}

function buildLinhasAtaCorpo(lista, mascaraDono, optsSeparadores) {
  const cols = 7;
  if (!lista || !lista.length) {
    return '<tr><td colspan="7">Nenhuma linha registrada neste inventário.</td></tr>';
  }
  const modo = normalizarModoSeparadores(optsSeparadores && optsSeparadores.modo);
  const camposQuebra = resolverCamposQuebra([], modo);
  const usarSeparadores = modo !== 'nao' && camposQuebra.length > 0;
  let html = '';
  let chaveAnterior = null;
  for (const l of lista) {
    if (usarSeparadores) {
      const chaveAtual = chaveSeparadorLinha(l, camposQuebra);
      if (chaveAtual !== chaveAnterior) {
        const rotulo = rotuloSeparadorGrupo(l, camposQuebra);
        html +=
          `<tr class="lista-grp-sep"><td colspan="${cols}">` +
          `<span class="lista-grp-bullet" aria-hidden="true">▌</span>${esc(rotulo)}</td></tr>`;
        chaveAnterior = chaveAtual;
      }
    }
    html += linhaRowHtml(l, mascaraDono);
  }
  return html;
}

/**
 * HTML imprimível — ata / espelho de inventário (A4).
 * @param {{ cabecalho: object, linhas: object[], resumoSku: object[], geradoEm: string, previa?: boolean, usuarioGeracao?: { login?: string, nome?: string }, separadoresGrupo?: string, ordem?: string[] }} payload
 */
function buildInventarioAtaHtml({
  cabecalho,
  linhas,
  resumoSku,
  geradoEm,
  previa,
  usuarioGeracao,
  separadoresGrupo,
  ordem,
}) {
  const cab = cabecalho || {};
  const modoSep = normalizarModoSeparadores(separadoresGrupo || 'nao');
  const camposQuebra = resolverCamposQuebra(ordem, modoSep);
  const listaBruta = linhas || [];
  const lista =
    modoSep !== 'nao' || (ordem && ordem.length)
      ? ordenarLinhasSaldo(listaBruta, ordem || [], modoSep)
      : listaBruta;
  const resumo = resumoSku || [];
  const donoLabel = [cab.CD_DONO_CODIGO, cab.NM_DONO].filter(Boolean).join(' — ') || String(cab.CD_DONO || '—');
  const mascaraDono = cab.MASCARA_CODIGO_PRODUTO;
  const dh = geradoEm ? new Date(geradoEm) : new Date();
  const dhBr = esc(dh.toLocaleString('pt-BR'));
  const st = String(cab.ST_INVENTARIO || '').toUpperCase();
  const isPrevia = !!previa || (st !== 'ENCERRADO' && st !== 'CANCELADO');

  const linhasBody = buildLinhasAtaCorpo(lista, mascaraDono, { modo: modoSep });

  const resumoBody =
    resumo.length > 0
      ? resumo.map((r) => resumoRowHtml(r, mascaraDono)).join('')
      : '<tr><td colspan="5">Nenhum SKU com quantidade contada.</td></tr>';

  const previaBanner = isPrevia
    ? '<div class="previa-banner">DOCUMENTO DE PRÉVIA — não substitui a ata após encerramento oficial.</div>'
    : '';

  const obsHtml = cab.OBSERVACAO
    ? `<p class="meta"><strong>Observação:</strong> ${esc(cab.OBSERVACAO)}</p>`
    : '';

  const divergencias = resumo.filter((r) => Math.abs(Number(r.QTD_AJUSTE_SKU) || 0) >= 1e-9).length;
  const conferidosOk = resumo.length - divergencias;
  const sepTxt =
    modoSep !== 'nao' && camposQuebra.length
      ? `<br/><strong>Separadores:</strong> ${esc(rotuloModoSeparadores(modoSep, camposQuebra))} (cadastro WMS)`
      : '';
  const ordemTxt = rotuloOrdemCampos(ordem)
    ? `<br/><strong>Ordenação:</strong> ${esc(rotuloOrdemCampos(ordem))}`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Ata de inventário #${esc(cab.CD_INVENTARIO)} — WMS</title>
<style>
@page { size: A4 portrait; margin: 12mm; }
body { font-family: system-ui, "Segoe UI", sans-serif; font-size: 10pt; color: #0f172a; margin: 0; padding-bottom: 48px; }
h1 { font-size: 16pt; margin: 0 0 6px; }
h2 { font-size: 12pt; margin: 20px 0 8px; color: #0f172a; }
.meta { font-size: 9.5pt; line-height: 1.45; color: #334155; margin-bottom: 10px; }
.nota { font-size: 9pt; color: #475569; margin: 0 0 12px 0; }
.previa-banner { background: #fef3c7; border: 1px solid #f59e0b; color: #92400e; padding: 8px 10px; margin-bottom: 12px; font-size: 9.5pt; font-weight: 600; border-radius: 4px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
th, td { border: 1px solid #cbd5e1; padding: 5px 6px; text-align: left; vertical-align: top; }
th { background: #f1f5f9; font-size: 9pt; }
td.num, th.num { text-align: right; white-space: nowrap; }
.ajuste-pos { color: #059669; }
.ajuste-neg { color: #dc2626; }
.ajuste-ok { color: #64748b; }
.lista-grp-sep td {
  background: #eff6ff; font-weight: 700; font-size: 9.5pt; color: #1e3a8a;
  border-top: 2px solid #93c5fd; padding: 6px 8px;
}
.lista-grp-bullet { color: #1d4ed8; margin-right: 4px; }
.assinaturas { margin-top: 28px; page-break-inside: avoid; }
.assinaturas-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 24px 32px; margin-top: 12px; }
.assinatura-box { border-top: 1px solid #334155; padding-top: 6px; min-height: 52px; font-size: 9pt; color: #475569; }
.assinatura-box strong { display: block; color: #0f172a; font-size: 9.5pt; margin-bottom: 28px; }
.toolbar { position: fixed; bottom: 0; left: 0; right: 0; padding: 10px; background: #f8fafc; border-top: 1px solid #cbd5e1; text-align: center; z-index: 9; }
@media print { .toolbar { display: none !important; } body { padding-bottom: 0; } .previa-banner, .lista-grp-sep td { -webkit-print-color-adjust: exact; print-color-adjust: exact; } h2 { break-after: avoid; } }
</style>
</head>
<body>
${previaBanner}
<h1>Ata de inventário (WMS)</h1>
<p class="meta">
<strong>Inventário nº:</strong> ${esc(cab.CD_INVENTARIO)}<br/>
<strong>Dono do estoque:</strong> ${esc(donoLabel)}<br/>
<strong>Tipo:</strong> ${esc(cab.TP_INVENTARIO || '—')} · <strong>Status:</strong> ${esc(labelStatus(st, isPrevia))}<br/>
<strong>Abertura:</strong> ${fmtDhBr(cab.DH_ABERTURA)} · <strong>Corte (snapshot):</strong> ${fmtDhBr(cab.DH_CORTE)}<br/>
<strong>Encerramento:</strong> ${fmtDhBr(cab.DH_ENCERRAMENTO)}<br/>
<strong>Política itens não contados:</strong> ${esc(cab.POLITICA_NAO_CONTADO || '—')}<br/>
<strong>Última alteração no documento:</strong> ${esc(cab.SG_USER || '—')}<br/>
<strong>Ata emitida por:</strong> ${esc(labelUsuarioEmitente(usuarioGeracao))}<br/>
<strong>Relatório gerado em:</strong> ${dhBr}<br/>
<strong>Linhas de contagem:</strong> ${lista.length} · <strong>SKUs contados:</strong> ${resumo.length} · <strong>com ajuste:</strong> ${divergencias} · <strong>conferidos sem movimento:</strong> ${conferidosOk}${sepTxt}${ordemTxt}
</p>
${obsHtml}
<p class="nota">Cada linha abaixo corresponde a um item inventariado (snapshot e/ou importação CSV). O ajuste de saldo no encerramento é aplicado por <strong>produto (SKU)</strong> — ver tabela de resumo. A coluna <strong>Sistema</strong> do resumo usa o saldo atual do ledger (NF encerrada + movimentos), não o snapshot da linha quando estes divergem.</p>

<h2>Itens inventariados</h2>
<table>
<thead><tr>
<th>Código</th><th>Descrição</th><th>Lote</th><th>Validade</th>
<th class="num">Qtd sistema (corte)</th><th class="num">Qtd contada</th><th>Origem</th>
</tr></thead>
<tbody>${linhasBody}</tbody>
</table>

<h2>Resumo de ajustes por produto (SKU)</h2>
<table>
<thead><tr>
<th>Código</th><th>Descrição</th>
<th class="num">Sistema (ledger)</th><th class="num">Contado (SKU)</th><th class="num">Ajuste</th>
</tr></thead>
<tbody>${resumoBody}</tbody>
</table>

<div class="assinaturas">
<h2>Assinaturas</h2>
<p class="nota">Declaro ter participado da contagem / conferência descrita neste documento.</p>
<div class="assinaturas-grid">
<div class="assinatura-box"><strong>Responsável pela contagem</strong>Nome legível · CPF · Data: ____/____/________</div>
<div class="assinatura-box"><strong>Conferência / auditoria</strong>Nome legível · CPF · Data: ____/____/________</div>
<div class="assinatura-box"><strong>Supervisão WMS</strong>Nome legível · CPF · Data: ____/____/________</div>
<div class="assinatura-box"><strong>Gestão / cliente (dono)</strong>Nome legível · CPF · Data: ____/____/________</div>
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

function linhasAtaParaCsv({ cabecalho, linhas, resumoSku, usuarioGeracao }) {
  const cab = cabecalho || {};
  const mascaraDono = cab.MASCARA_CODIGO_PRODUTO;
  const sep = ';';
  const escCsv = (v) => {
    const s = v == null ? '' : String(v);
    if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const rows = [];
  rows.push(
    [
      'INVENTARIO',
      'DONO',
      'TIPO',
      'STATUS',
      'POLITICA_NAO_CONTADO',
      'DH_CORTE',
      'DH_ENCERRAMENTO',
      'SG_USER_DOC',
      'ATA_EMITIDA_POR',
    ].join(sep)
  );
  rows.push(
    [
      cab.CD_INVENTARIO,
      [cab.CD_DONO, cab.NM_DONO].filter(Boolean).join(' - '),
      cab.TP_INVENTARIO,
      cab.ST_INVENTARIO,
      cab.POLITICA_NAO_CONTADO,
      cab.DH_CORTE,
      cab.DH_ENCERRAMENTO,
      cab.SG_USER,
      labelUsuarioEmitente(usuarioGeracao),
    ]
      .map(escCsv)
      .join(sep)
  );
  rows.push('');
  rows.push(
    ['CODIGO', 'DESCRICAO', 'LOTE', 'VALIDADE', 'QTD_SISTEMA_LINHA', 'QTD_CONTADA', 'ORIGEM'].map(escCsv).join(sep)
  );
  for (const l of linhas || []) {
    rows.push(
      [
        codigoExibicao(l.CODIGO_PRODUTO, mascaraDono),
        l.NM_PRODUTO,
        l.LOTE,
        l.VALIDADE,
        l.QTD_SISTEMA_SNAPSHOT,
        l.QTD_CONTADA,
        l.ORIGEM,
      ]
        .map(escCsv)
        .join(sep)
    );
  }
  rows.push('');
  rows.push(['--- RESUMO SKU ---'].join(sep));
  rows.push(
    ['CODIGO', 'DESCRICAO', 'QTD_SISTEMA_SKU', 'QTD_CONTADA_SKU', 'QTD_AJUSTE_SKU'].map(escCsv).join(sep)
  );
  for (const r of resumoSku || []) {
    rows.push(
      [
        codigoExibicao(r.CODIGO_PRODUTO, mascaraDono),
        r.NM_PRODUTO,
        r.QTD_SISTEMA_SKU,
        r.QTD_CONTADA_SKU,
        r.QTD_AJUSTE_SKU,
      ]
        .map(escCsv)
        .join(sep)
    );
  }
  return rows.join('\n');
}

module.exports = { buildInventarioAtaHtml, linhasAtaParaCsv };
