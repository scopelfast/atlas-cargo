'use strict';

/**
 * Etiquetas de identificação a partir do saldo (posição de estoque).
 * Layout idêntico ao Recebimento (A4, 2 etiquetas/página).
 * Quando possível, enriquece com a última NF encerrada do SKU/lote/validade.
 */

const { pool } = require('../config/db');

const ETQ_MAX_POR_ITEM = 500;
const ETQ_MAX_TOTAL = 2000;

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatQtdEtq(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDataBr(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = d.getFullYear();
    return `${dd}/${mm}/${yy}`;
  }
  return s;
}

function validadeBr(r) {
  const br = String(r.VALIDADE_BR || '').trim();
  if (br) return br;
  return formatDataBr(r.VALIDADE) || '—';
}

function labelDono(r) {
  const cd = r.CD_DONO != null ? String(r.CD_DONO) : '';
  const nm = String(r.NM_DONO || '').trim();
  if (cd && nm) return `${cd} — ${nm}`;
  if (nm) return nm;
  return cd || '—';
}

function origemLinha(r) {
  if (r.ORIGEM_INVENTARIO) return 'Inventário';
  if (r.SEM_ENTRADA_ENCERRADA) return 'Só movimento';
  return 'NF encerrada';
}

function barcodeSvgPlaceholder(data, alt) {
  const d = String(data || '').trim() || '-';
  return (
    '<svg class="bc-svg" role="img" aria-label="' +
    esc(alt || 'barcode') +
    '" data-bc="' +
    esc(d) +
    '"></svg>'
  );
}

function cssEtiquetas() {
  return (
    '@page{size:A4 portrait;margin:10mm}' +
    'body{font-family:system-ui,Segoe UI,sans-serif;font-size:10pt;color:#000;margin:0;padding-bottom:52px}' +
    '.toolbar{position:fixed;bottom:0;left:0;right:0;padding:10px;background:#f1f5f9;border-top:1px solid #cbd5e1;text-align:center;z-index:9}' +
    '@media print{.toolbar{display:none!important}body{padding-bottom:0}' +
    '.etq-sheet{page-break-after:always;page-break-inside:avoid}' +
    '.etq-sheet:last-of-type{page-break-after:auto}}' +
    '.meta-top{font-size:9pt;color:#334155;margin:0 0 8px;line-height:1.4}' +
    '.etq-sheet{display:flex;flex-direction:column;align-items:center;gap:6mm;width:190mm;max-width:100%;margin:0 auto 10mm;box-sizing:border-box}' +
    '.label{width:190mm;height:130mm;border:2px solid #000;padding:5mm;margin:0;box-sizing:border-box;page-break-inside:avoid;break-inside:avoid;display:flex;flex-direction:column;flex-shrink:0}' +
    '.etq-top{display:grid;grid-template-columns:1fr 66mm;gap:5mm;align-items:start}' +
    '.cod{font-size:34pt;font-weight:900;font-family:ui-monospace,Consolas,monospace;line-height:1.03;text-align:center;letter-spacing:0.4px}' +
    '.desc{margin-top:2mm;text-align:center;line-height:1.25}' +
    '.desc .forn{font-size:13pt;font-weight:500;text-transform:uppercase}' +
    '.desc .int{font-size:13pt;font-weight:800;text-transform:uppercase}' +
    '.meta{font-size:11pt;line-height:1.4;text-align:right}' +
    '.meta .nf{font-size:22pt;font-weight:900;line-height:1.1}' +
    '.meta .dt{font-size:10pt;text-transform:uppercase;letter-spacing:0.3px}' +
    '.meta .dtv{font-size:20pt;font-weight:900;line-height:1.05}' +
    '.etq-mid{display:flex;align-items:flex-end;justify-content:space-between;margin-top:3mm}' +
    '.vol{font-size:22pt;font-weight:900}.vol small{font-size:11pt;font-weight:600;margin-right:1mm}' +
    '.validade{font-size:11pt;text-transform:uppercase}.validade .v{font-size:28pt;font-weight:900;line-height:1}' +
    '.etq-bars{margin-top:auto}.bars-row{display:flex;gap:6mm;align-items:flex-end}' +
    '.bar-wrap{flex:1}.bar-wrap svg.bc-svg{width:100%;height:18mm}' +
    '.bar-wrap .bc-fallback{font-size:9pt;font-family:ui-monospace,Consolas,monospace;word-break:break-all}' +
    '.dono-lote{display:flex;justify-content:space-between;align-items:flex-end;margin-top:2mm}' +
    '.dono{font-size:11pt}.dono .nome{font-size:24pt;font-weight:900;line-height:1.05}' +
    '.lote{font-size:11pt;text-transform:uppercase;text-align:right}.lote .valor{font-size:20pt;font-weight:900;line-height:1.05}' +
    '.rodape{font-size:10pt;margin-top:1mm;text-align:left}'
  );
}

/**
 * Busca a última NF encerrada por (dono, produto) para preencher NF/emissão/chegada/chave.
 * Match preferencial por lote+validade; senão, última NF do SKU no dono.
 */
async function enriquecerComUltimaNf(tenantId, linhas) {
  const list = Array.isArray(linhas) ? linhas : [];
  if (!list.length) return list;

  const donos = [...new Set(list.map((r) => parseInt(r.CD_DONO, 10)).filter(Number.isFinite))];
  if (!donos.length) return list;

  try {
    const r = await pool.query(
      `SELECT e."CD_DONO", e."NUMERO_NF", e."SERIE", e."CHAVE_NFE",
              e."DH_EMISSAO", e."DT_RECEBIMENTO", e."DH_CONFERENCIA",
              e."NM_CONFERENTE", e."CONFERENCIA_JSON"
         FROM "WMS_NFE_ENTRADA" e
        WHERE e."TENANT_ID" = $1
          AND e."CD_DONO" = ANY($2::integer[])
          AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) = 'ENCERRADA'
          AND e."CONFERENCIA_JSON" IS NOT NULL
        ORDER BY e."CD_DONO", COALESCE(e."DT_RECEBIMENTO", e."DH_CONFERENCIA", e."DH_EMISSAO") DESC NULLS LAST
        LIMIT 800`,
      [tenantId, donos]
    );

    /** @type {Map<string, object[]>} */
    const byDonoProd = new Map();
    for (const nf of r.rows || []) {
      const elems = Array.isArray(nf.CONFERENCIA_JSON)
        ? nf.CONFERENCIA_JSON
        : typeof nf.CONFERENCIA_JSON === 'string'
          ? JSON.parse(nf.CONFERENCIA_JSON || '[]')
          : [];
      for (const elem of elems) {
        const cdProd = parseInt(elem && elem.cdProduto, 10);
        if (!Number.isFinite(cdProd)) continue;
        const key = `${nf.CD_DONO}|${cdProd}`;
        if (!byDonoProd.has(key)) byDonoProd.set(key, []);
        byDonoProd.get(key).push({
          NUMERO_NF: nf.NUMERO_NF,
          SERIE: nf.SERIE,
          CHAVE_NFE: nf.CHAVE_NFE,
          DH_EMISSAO: nf.DH_EMISSAO,
          DT_RECEBIMENTO: nf.DT_RECEBIMENTO || nf.DH_CONFERENCIA,
          NM_CONFERENTE: nf.NM_CONFERENTE,
          nItem: elem.nItem,
          lote: String(elem.lote || '').trim(),
          validade: String(elem.validade || '').trim(),
          xProd: String(elem.xProd || '').trim(),
          uCom: String(elem.uCom || '').trim().toUpperCase(),
          qtdRecebida: elem.qtdRecebida,
          qtdConvertida: elem.qtdConvertida,
          unidadeEstoque: String(elem.unidadeEstoque || elem.umConvertida || '').trim().toUpperCase(),
        });
      }
    }

    return list.map((linha) => {
      const cdDono = parseInt(linha.CD_DONO, 10);
      const cdProd = parseInt(linha.CD_PRODUTO, 10);
      if (!Number.isFinite(cdDono) || !Number.isFinite(cdProd)) return linha;
      const cands = byDonoProd.get(`${cdDono}|${cdProd}`) || [];
      if (!cands.length) return linha;
      const lote = String(linha.LOTE || '').trim();
      const val = String(linha.VALIDADE || '').trim();
      let hit =
        cands.find(
          (c) =>
            (!lote || c.lote === lote || (!c.lote && lote === 'UNICO')) &&
            (!val || c.validade === val || c.validade.startsWith(val) || val.startsWith(c.validade))
        ) || cands[0];
      return {
        ...linha,
        _nf: hit,
        XPROD_NF: hit.xProd || linha.XPROD_NF,
      };
    });
  } catch (e) {
    console.warn('[WMS etiquetas saldo] enriquecer NF:', e && e.message);
    return list;
  }
}

function montarUmaEtiqueta(r, seqInfo) {
  const nf = r._nf || {};
  const cod = String(r.CODIGO_PRODUTO || '').trim() || '—';
  const descInt = String(r.NM_PRODUTO || '').trim() || 'Sem descrição';
  const descForn = String(r.XPROD_NF || nf.xProd || descInt).trim() || descInt;
  const loteTxt = String(r.LOTE || '').trim() || 'UNICO';
  const valTxt = validadeBr(r);
  const donoTxt = labelDono(r);
  const origem = origemLinha(r);

  const numeroNf = nf.NUMERO_NF != null ? String(nf.NUMERO_NF) : '';
  const serie = nf.SERIE != null ? String(nf.SERIE) : '';
  const nfRef = numeroNf ? numeroNf + (serie ? '/' + serie : '') : '';
  const chave = String(nf.CHAVE_NFE || '').replace(/\s/g, '');
  const suf = chave.length >= 8 ? chave.slice(-8) : chave;
  const emissao = formatDataBr(nf.DH_EMISSAO) || '—';
  const chegada = formatDataBr(nf.DT_RECEBIMENTO) || '—';
  const conf = String(nf.NM_CONFERENTE || '').trim();

  const umEst = String(
    (r._cadWms && r._cadWms.UNIDADE) || nf.unidadeEstoque || ''
  )
    .trim()
    .toUpperCase();
  const umNf = String(nf.uCom || '').trim().toUpperCase();
  const qtdSaldo = formatQtdEtq(r.QTD_SALDO_SKU);
  const qtdEnt = formatQtdEtq(r.QTD_ENTRADA);
  const qtdNf = formatQtdEtq(nf.qtdRecebida);
  const qtdConv = formatQtdEtq(nf.qtdConvertida);

  let volTxt = '—';
  if (qtdConv || qtdSaldo) {
    volTxt = (qtdConv || qtdSaldo) + (umEst ? ' ' + umEst : '');
  }
  if (qtdNf) {
    volTxt += (volTxt === '—' ? '' : ' | ') + qtdNf + (umNf ? ' ' + umNf : '');
  } else if (qtdEnt && qtdEnt !== qtdSaldo) {
    volTxt += (volTxt === '—' ? '' : ' | ') + 'Entr. ' + qtdEnt;
  }

  let rodape = nfRef ? 'NF ' + nfRef : 'Saldo WMS • ' + origem;
  if (nf.nItem != null && nf.nItem !== '') rodape += ' • Item ' + nf.nItem;
  if (seqInfo && seqInfo.total > 1) rodape += ' • Etq. ' + seqInfo.atual + '/' + seqInfo.total;
  if (suf) rodape += ' • …' + suf;
  if (conf) rodape += ' • Conf.: ' + conf;
  if (!nfRef) rodape += ' • ' + origem;

  const barcodeChave = chave || nfRef || [r.CD_DONO, cod, loteTxt].join('|');

  return (
    '<div class="label">' +
    '<div class="etq-top">' +
    '<div>' +
    '<div class="cod">' +
    esc(cod) +
    '</div>' +
    '<div class="desc">' +
    '<div class="forn">' +
    esc(descForn.slice(0, 120)) +
    '</div>' +
    '<div class="int">' +
    esc(descInt.slice(0, 120)) +
    '</div>' +
    '</div></div>' +
    '<div class="meta">' +
    '<div>Nota fiscal</div><div class="nf">' +
    esc(numeroNf || '—') +
    '</div>' +
    '<div class="dt">Emissão</div><div class="dtv">' +
    esc(emissao) +
    '</div>' +
    '<div class="dt">Chegada</div><div class="dtv">' +
    esc(chegada) +
    '</div>' +
    '</div></div>' +
    '<div class="etq-mid">' +
    '<div class="vol"><small>Vol.</small>' +
    esc(volTxt) +
    '</div>' +
    '<div class="validade">Validade<div class="v">' +
    esc(valTxt) +
    '</div></div>' +
    '</div>' +
    '<div class="etq-bars">' +
    '<div class="bars-row">' +
    '<div class="bar-wrap">' +
    barcodeSvgPlaceholder(barcodeChave, 'barcode chave') +
    '</div>' +
    '<div class="bar-wrap">' +
    barcodeSvgPlaceholder(cod, 'barcode produto') +
    '</div>' +
    '</div>' +
    '<div class="dono-lote">' +
    '<div class="dono">Dono do estoque<div class="nome">' +
    esc(donoTxt.toUpperCase()) +
    '</div></div>' +
    '<div class="lote">Lote<div class="valor">' +
    esc(loteTxt) +
    '</div></div>' +
    '</div></div>' +
    '<div class="rodape">' +
    esc(rodape) +
    '</div>' +
    '</div>'
  );
}

/**
 * Uma etiqueta por (dono + código + lote + validade) com saldo > 0.
 * Evita duplicar a mesma mercadoria quando o saldo lista NF e inventário juntos.
 */
function deduplicarLinhasEtiqueta(linhas) {
  const map = new Map();
  for (const r of linhas || []) {
    const cod = String(r.CODIGO_PRODUTO || '').trim();
    const saldo = Number(r.QTD_SALDO_SKU);
    if (!cod || !Number.isFinite(saldo) || saldo <= 1e-6) continue;
    const lote = String(r.LOTE || '').trim() || '—';
    const val = String(r.VALIDADE || r.VALIDADE_BR || '').trim() || '—';
    const key = `${r.CD_DONO}|${cod}|${lote}|${val}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, r);
      continue;
    }
    /* Preferir linha com validade preenchida; senão a de inventário; senão a que já estava. */
    const prevVal = String(prev.VALIDADE || prev.VALIDADE_BR || '').trim();
    const curVal = String(r.VALIDADE || r.VALIDADE_BR || '').trim();
    if (!prevVal && curVal) map.set(key, r);
    else if (!prev.ORIGEM_INVENTARIO && r.ORIGEM_INVENTARIO && prevVal === curVal) map.set(key, r);
  }
  return Array.from(map.values());
}

/**
 * @param {object} opts
 * @param {object[]} opts.linhas
 * @param {string} [opts.geradoEm]
 * @param {string} [opts.filtroDonoLabel]
 * @param {string} [opts.filtroProdutoLabel]
 * @param {'linha'|'fixo'|'qtd'} [opts.modo]
 * @param {number} [opts.qtdFixa]
 * @param {number|string} [opts.tenantId]
 * @param {boolean} [opts.deduplicar]
 */
async function buildEtiquetasSaldoHtml(opts) {
  const modo = String(opts.modo || 'linha').toLowerCase();
  let qtdFixa = parseInt(opts.qtdFixa, 10);
  if (!Number.isFinite(qtdFixa) || qtdFixa < 1) qtdFixa = 1;
  qtdFixa = Math.min(qtdFixa, ETQ_MAX_POR_ITEM);

  const filtradas = (opts.linhas || []).filter((r) => {
    const cod = String(r.CODIGO_PRODUTO || '').trim();
    const saldo = Number(r.QTD_SALDO_SKU);
    return cod && Number.isFinite(saldo) && saldo > 1e-6;
  });
  const base = opts.deduplicar === false ? filtradas : deduplicarLinhasEtiqueta(filtradas);

  const enriquecidas = opts.tenantId
    ? await enriquecerComUltimaNf(opts.tenantId, base)
    : base;

  const etiquetas = [];
  for (const r of enriquecidas) {
    let n = 1;
    if (modo === 'fixo') n = qtdFixa;
    else if (modo === 'qtd') {
      const s = Math.floor(Number(r.QTD_SALDO_SKU) || 0);
      n = Math.min(s > 0 ? s : 1, ETQ_MAX_POR_ITEM);
    }
    for (let i = 1; i <= n; i++) {
      etiquetas.push(montarUmaEtiqueta(r, n > 1 ? { atual: i, total: n } : null));
    }
  }

  if (etiquetas.length > ETQ_MAX_TOTAL) {
    etiquetas.length = ETQ_MAX_TOTAL;
  }

  const dh = opts.geradoEm ? new Date(opts.geradoEm) : new Date();
  const dhBr = esc(dh.toLocaleString('pt-BR'));
  const filtroProd = opts.filtroProdutoLabel
    ? `<br/><strong>Filtro produto:</strong> ${esc(opts.filtroProdutoLabel)}`
    : '';

  let sheets = '';
  for (let i = 0; i < etiquetas.length; i += 2) {
    sheets +=
      '<div class="etq-sheet">' +
      etiquetas[i] +
      (etiquetas[i + 1] != null ? etiquetas[i + 1] : '') +
      '</div>';
  }

  if (!etiquetas.length) {
    sheets =
      '<p><strong>Nenhuma linha com saldo &gt; 0 e código de produto</strong> nos filtros atuais.</p>';
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Etiquetas — saldo WMS</title>
<style>${cssEtiquetas()}</style>
</head>
<body>
<p class="meta-top"><strong>Impresso em:</strong> ${dhBr}<br/>
<strong>Filtro dono:</strong> ${esc(opts.filtroDonoLabel || '—')}${filtroProd}<br/>
<strong>Linhas origem:</strong> ${base.length} &nbsp;|&nbsp; <strong>Etiquetas:</strong> ${etiquetas.length}
${etiquetas.length >= ETQ_MAX_TOTAL ? ' <em>(limitado a ' + ETQ_MAX_TOTAL + ')</em>' : ''}
<br/><em>Equivalente ao relatório de saldo filtrado · layout do Recebimento · NF preenchida quando houver entrada encerrada do SKU.</em></p>
${sheets}
<div class="toolbar">
<button type="button" id="wmsPrintBtn">Imprimir / PDF</button>
<button type="button" id="wmsCloseBtn">Fechar</button>
</div>
<script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
<script>
(function () {
  function renderBarcodes() {
    var nodes = document.querySelectorAll('svg.bc-svg[data-bc]');
    var hasLib = typeof JsBarcode === 'function';
    nodes.forEach(function (el) {
      var v = el.getAttribute('data-bc') || '-';
      if (hasLib) {
        try {
          JsBarcode(el, v, {
            format: 'CODE128',
            displayValue: true,
            fontSize: 12,
            height: 48,
            margin: 2,
            width: 1.4,
          });
          return;
        } catch (e) {}
      }
      var fb = document.createElement('div');
      fb.className = 'bc-fallback';
      fb.textContent = v;
      el.replaceWith(fb);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderBarcodes);
  else renderBarcodes();
  document.getElementById('wmsPrintBtn')?.addEventListener('click', function () { window.focus(); window.print(); });
  document.getElementById('wmsCloseBtn')?.addEventListener('click', function () { window.close(); });
})();
</script>
</body>
</html>`;
}

function estimarTotalEtiquetas(linhas, modo, qtdFixa, deduplicar) {
  const m = String(modo || 'linha').toLowerCase();
  let fixo = parseInt(qtdFixa, 10);
  if (!Number.isFinite(fixo) || fixo < 1) fixo = 1;
  fixo = Math.min(fixo, ETQ_MAX_POR_ITEM);
  const lista =
    deduplicar === false
      ? (linhas || []).filter((r) => {
          const cod = String(r.CODIGO_PRODUTO || '').trim();
          const saldo = Number(r.QTD_SALDO_SKU);
          return cod && Number.isFinite(saldo) && saldo > 1e-6;
        })
      : deduplicarLinhasEtiqueta(linhas);
  let total = 0;
  for (const r of lista) {
    if (m === 'fixo') total += fixo;
    else if (m === 'qtd') total += Math.min(Math.floor(Number(r.QTD_SALDO_SKU) || 0) || 1, ETQ_MAX_POR_ITEM);
    else total += 1;
  }
  return total;
}

module.exports = {
  buildEtiquetasSaldoHtml,
  estimarTotalEtiquetas,
  enriquecerComUltimaNf,
  deduplicarLinhasEtiqueta,
  ETQ_MAX_POR_ITEM,
  ETQ_MAX_TOTAL,
};
