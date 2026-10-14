'use strict';

const {
  esc,
  contarDonosUnicos,
  agruparLinhasPorDono,
  labelDonoLinha,
} = require('./wms-relatorio-html-agrupamento');

function faixaShelfLife(dias, horizonteDono) {
  const d = Number(dias);
  const h = Number(horizonteDono);
  if (!Number.isFinite(d)) return { cod: 'SEM_DATA', rotulo: 'Sem validade' };
  if (d < 0) return { cod: 'VENCIDO', rotulo: 'Vencido' };
  const limCritico = Number.isFinite(h) && h > 0 && h < 30 ? h : 30;
  if (d <= limCritico) {
    return { cod: 'CRITICO', rotulo: `Crítico (≤ ${limCritico} dias)` };
  }
  if (Number.isFinite(h) && d <= h) return { cod: 'CURTO', rotulo: 'Curto (no horizonte)' };
  if (Number.isFinite(h) && d > h) return { cod: 'OK', rotulo: 'Longo prazo' };
  return { cod: 'OK', rotulo: 'Dentro do horizonte' };
}

function formatValidadeShelf(r) {
  const br = r.VALIDADE_BR;
  if (br) return esc(br);
  const raw = r.DT_VALIDADE || r.VALIDADE;
  const s = String(raw || '').trim();
  if (!s) return '—';
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return esc(`${m[3]}/${m[2]}/${m[1]}`);
  return esc(s);
}

function formatQtdShelf(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return esc(n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 }));
}

const ORDEM_CONS = { CONGELADO: 1, REFRIGERADO: 2, SECO: 3 };
const ORDEM_FAIXA = { VENCIDO: 1, CRITICO: 2, CURTO: 3, OK: 4, SEM_DATA: 5 };

/** Estilo compartilhado dos relatórios de datas críticas / shelf-life. */
function cssShelfPadrao(corDono) {
  return `
@page { size: A4 landscape; margin: 10mm; }
body { font-family: system-ui, "Segoe UI", sans-serif; font-size: 9.5pt; color: #0f172a; margin: 0; padding-bottom: 48px; }
h1 { font-size: 16pt; margin: 0 0 6px; }
h2.grupo-dono { font-size: 12pt; margin: 18px 0 8px; padding: 6px 8px; background: #f1f5f9; border-left: 4px solid ${corDono}; }
h3.grupo-conservacao { font-size: 11pt; margin: 14px 0 6px; padding: 5px 8px; background: #eff6ff; border-left: 4px solid #2563eb; }
h4.grupo-faixa { font-size: 10pt; margin: 10px 0 4px; padding: 3px 6px; background: #f8fafc; border-left: 3px solid #64748b; color: #334155; }
.cnt { font-weight: 500; color: #64748b; font-size: 9pt; }
.meta { font-size: 9pt; color: #334155; margin-bottom: 10px; line-height: 1.45; }
.aviso { font-size: 8.5pt; color: #475569; margin: 0 0 10px 18px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
th, td { border: 1px solid #cbd5e1; padding: 4px 5px; text-align: left; vertical-align: middle; }
th { background: #f1f5f9; }
td.num, th.num { text-align: right; }
.fx { font-size: 8.5pt; font-weight: 600; padding: 2px 6px; border-radius: 4px; white-space: nowrap; }
.fx-VENCIDO { background: #fee2e2; color: #991b1b; }
.fx-CRITICO { background: #ffedd5; color: #9a3412; }
.fx-CURTO { background: #fef9c3; color: #854d0e; }
.fx-OK { background: #dcfce7; color: #166534; }
.fx-SEM_DATA { background: #f1f5f9; color: #475569; }
tr.sku-cab td { background: #f8fafc; border-top: 2px solid #94a3b8; font-weight: 600; }
tr.sku-val td.muted { color: #94a3b8; }
.sku-indent { padding-left: 12px !important; font-size: 8pt; }
.sku-badges { display: inline-flex; flex-wrap: wrap; gap: 4px; align-items: center; }
.sku-badge { display: inline-block; font-size: 8pt; font-weight: 600; padding: 2px 6px; border-radius: 999px; background: #e2e8f0; color: #334155; white-space: nowrap; }
.sku-badge-saldo { background: #ccfbf1; color: #0f766e; }
.sku-badge-hint { background: #fef3c7; color: #92400e; }
.sku-badge-apontado { background: #dbeafe; color: #1e40af; }
.toolbar { position: fixed; bottom: 0; left: 0; right: 0; padding: 10px; background: #f8fafc; border-top: 1px solid #cbd5e1; text-align: center; z-index: 9; }
@media print {
  .toolbar { display: none !important; }
  body { padding-bottom: 0; }
  h2.grupo-dono, h3.grupo-conservacao, h4.grupo-faixa, tr.sku-cab { break-after: avoid; }
  tr.sku-cab td, .sku-badge, .fx { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;
}

function toolbarShelfHtml() {
  return `<div class="toolbar">
<button type="button" id="wmsPrintBtn">Imprimir / PDF</button>
<button type="button" id="wmsCloseBtn">Fechar</button>
</div>
<script>
document.getElementById('wmsPrintBtn')?.addEventListener('click', function () { window.focus(); window.print(); });
document.getElementById('wmsCloseBtn')?.addEventListener('click', function () { window.close(); });
</script>`;
}

/**
 * Dono → Conservação → Faixa → linhas.
 * Conservação e Faixa vão no cabeçalho do grupo (não repetem em coluna).
 * @param {function} rowFn — (linha) => html OU, se opts.bodyFromRows, (rows[]) => html
 */
function buildTabelasShelfPorConsFaixa(linhas, theadHtml, rowFn, colspan, emptyMsg, opts) {
  const bodyFromRows = opts && typeof opts.bodyFromRows === 'function' ? opts.bodyFromRows : null;
  const gruposDono = agruparLinhasPorDono(linhas);
  if (!gruposDono.length) {
    return `<table>${theadHtml}<tbody><tr><td colspan="${colspan}">${esc(emptyMsg)}</td></tr></tbody></table>`;
  }

  return gruposDono
    .map(([, rowsDono]) => {
      const titDono = labelDonoLinha(rowsDono[0]);
      const byCons = new Map();
      rowsDono.forEach((r) => {
        const k = String(r.TIPO_ARMAZENAGEM || '—').trim() || '—';
        if (!byCons.has(k)) byCons.set(k, []);
        byCons.get(k).push(r);
      });
      const consKeys = Array.from(byCons.keys()).sort((a, b) => {
        const oa = ORDEM_CONS[String(a).toUpperCase()] || 9;
        const ob = ORDEM_CONS[String(b).toUpperCase()] || 9;
        if (oa !== ob) return oa - ob;
        return a.localeCompare(b, 'pt-BR');
      });

      const blocos = consKeys
        .map((cons) => {
          const rowsCons = byCons.get(cons) || [];
          const byFx = new Map();
          rowsCons.forEach((r) => {
            const fx = faixaShelfLife(r.DIAS_ATE_VENCIMENTO, r.NU_DIAS_REL_VENCIMENTO_DONO);
            const k = fx.cod;
            if (!byFx.has(k)) byFx.set(k, { fx, rows: [] });
            byFx.get(k).rows.push(r);
          });
          const fxKeys = Array.from(byFx.keys()).sort(
            (a, b) => (ORDEM_FAIXA[a] || 9) - (ORDEM_FAIXA[b] || 9)
          );

          const sub = fxKeys
            .map((cod) => {
              const { fx, rows: raw } = byFx.get(cod);
              const rows = raw.slice().sort((a, b) => {
                const ca = String(a.CODIGO_PRODUTO || '').localeCompare(String(b.CODIGO_PRODUTO || ''), 'pt-BR');
                if (ca) return ca;
                const da = Number(a.DIAS_ATE_VENCIMENTO);
                const db = Number(b.DIAS_ATE_VENCIMENTO);
                if (Number.isFinite(da) && Number.isFinite(db) && da !== db) return da - db;
                return String(a.NM_PRODUTO || '').localeCompare(String(b.NM_PRODUTO || ''), 'pt-BR', {
                  sensitivity: 'base',
                });
              });
              const nSku = new Set(rows.map((r) => `${r.CD_DONO}|${r.CD_PRODUTO}`)).size;
              const cntLabel =
                nSku === rows.length
                  ? `(${rows.length})`
                  : `(${rows.length} val. · ${nSku} SKU)`;
              const tbody = bodyFromRows ? bodyFromRows(rows) : rows.map(rowFn).join('');
              return (
                `<h4 class="grupo-faixa"><span class="fx fx-${esc(fx.cod)}">${esc(fx.rotulo)}</span>` +
                ` <span class="cnt">${cntLabel}</span></h4>` +
                `<table>${theadHtml}<tbody>${tbody}</tbody></table>`
              );
            })
            .join('');

          return (
            `<h3 class="grupo-conservacao">${esc(cons)} <span class="cnt">(${rowsCons.length})</span></h3>` +
            sub
          );
        })
        .join('');

      return `<h2 class="grupo-dono">${esc(titDono)}</h2>${blocos}`;
    })
    .join('');
}

function metaShelfHtml({
  dhBr,
  filtroDonoLabel,
  filtroProdutoLabel,
  nuDonos,
  nLinhas,
  nSku,
  organizacao,
}) {
  const filtroProdTxt = filtroProdutoLabel
    ? `<br/><strong>Filtro produto:</strong> ${esc(filtroProdutoLabel)}`
    : '';
  const skuTxt =
    nSku != null
      ? `<br/><strong>SKUs:</strong> ${nSku} · <strong>Validades:</strong> ${nLinhas}`
      : `<br/><strong>Linhas:</strong> ${nLinhas}`;
  return `<p class="meta"><strong>Impresso em:</strong> ${dhBr}<br/>
<strong>Filtro dono:</strong> ${esc(filtroDonoLabel || '—')}${filtroProdTxt}<br/>
<strong>Donos no relatório:</strong> ${nuDonos}${skuTxt}<br/>
<strong>Organização:</strong> ${esc(organizacao || 'Conservação → Faixa → Descrição')}</p>`;
}

/* ── Entrada NF (sem rateio) ── */

const THEAD_SHELF =
  '<thead><tr>' +
  '<th>Código</th><th>Descrição</th><th>Lote</th><th>Validade</th>' +
  '<th class="num">Dias</th><th class="num">Qtd</th><th>NF</th>' +
  '</tr></thead>';

const COLS_SHELF = 7;

function rowShelfHtml(r) {
  const dias = r.DIAS_ATE_VENCIMENTO;
  const apontado =
    r.FG_APONTADO === 'S'
      ? ' <span class="sku-badge sku-badge-apontado" title="Já apontado / passado ao cliente">Apontado</span>'
      : '';
  return (
    '<tr>' +
    `<td>${esc(r.CODIGO_PRODUTO || r.codigo_prod)}</td>` +
    `<td>${esc(r.NM_PRODUTO)}</td>` +
    `<td>${esc(r.LOTE || '—')}${apontado}</td>` +
    `<td>${formatValidadeShelf(r)}</td>` +
    `<td class="num">${esc(dias != null ? String(dias) : '—')}</td>` +
    `<td class="num">${esc(r.QTD_RECEBIDA_UM_CANON)}</td>` +
    `<td>${esc(r.NUMERO_NF || '')}</td>` +
    '</tr>'
  );
}

function buildShelfLifeHtml({ linhas, avisos, geradoEm, filtroDonoLabel, filtroProdutoLabel }) {
  const dh = geradoEm ? new Date(geradoEm) : new Date();
  const dhBr = esc(dh.toLocaleString('pt-BR'));
  const lista = linhas || [];
  const nuDonos = contarDonosUnicos(lista);
  const tabelaHtml = buildTabelasShelfPorConsFaixa(
    lista,
    THEAD_SHELF,
    rowShelfHtml,
    COLS_SHELF,
    'Nenhuma linha no horizonte.'
  );
  const avisoHtml = (avisos || []).map((a) => `<li>${esc(a)}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Datas críticas / shelf-life — WMS</title>
<style>${cssShelfPadrao('#0ea5e9')}</style>
</head>
<body>
<h1>Datas críticas / shelf-life — entrada NF (WMS)</h1>
${metaShelfHtml({ dhBr, filtroDonoLabel, filtroProdutoLabel, nuDonos, nLinhas: lista.length })}
<ul class="aviso">${avisoHtml}</ul>
${tabelaHtml}
${toolbarShelfHtml()}
</body>
</html>`;
}

/* ── Saldo estimado FEFO / cobrança ── */

const THEAD_SHELF_SALDO =
  '<thead><tr>' +
  '<th>Código</th><th>Descrição / totais do SKU</th><th>Lote</th><th>Validade</th>' +
  '<th class="num">Dias</th>' +
  '<th class="num">Entrada nesta validade</th>' +
  '<th class="num">Saldo nesta validade</th>' +
  '</tr></thead>';

const COLS_SHELF_SALDO = 7;

function chaveSkuShelf(r) {
  return `${r.CD_DONO != null ? r.CD_DONO : ''}|${r.CD_PRODUTO != null ? r.CD_PRODUTO : r.CODIGO_PRODUTO || ''}`;
}

function badgesShelfSkuHtml(r, somaFefoNoRelatorio) {
  const saldoSku = Number(r.QTD_SALDO_SKU) || 0;
  const saidaSku = Number(r.QTD_SAIDA_SKU) || 0;
  const soma = Number(somaFefoNoRelatorio);
  const temFora =
    Number.isFinite(soma) && Number.isFinite(saldoSku) && Math.abs(saldoSku - soma) > 0.5;
  const fora = temFora ? Math.max(0, Math.round(saldoSku - soma)) : 0;
  return (
    `<span class="sku-badges">` +
    `<span class="sku-badge" title="Saídas acumuladas no ledger do SKU">Saídas ${formatQtdShelf(saidaSku)}</span>` +
    `<span class="sku-badge sku-badge-saldo" title="Saldo total do produto no ledger (todas as validades)">Saldo SKU <strong>${formatQtdShelf(saldoSku)}</strong></span>` +
    (temFora
      ? `<span class="sku-badge sku-badge-hint" title="Parte do saldo SKU está em validades fora do horizonte deste relatório">FEFO neste relatório ${formatQtdShelf(soma)} · fora do horizonte ≈ ${formatQtdShelf(fora)}</span>`
      : '') +
    `</span>`
  );
}

function rowShelfSaldoCabHtml(r, somaFefoSkuNasLinhasVisiveis) {
  return (
    `<tr class="sku-cab">` +
    `<td>${esc(r.CODIGO_PRODUTO)}</td>` +
    `<td>${esc(r.NM_PRODUTO)} ${badgesShelfSkuHtml(r, somaFefoSkuNasLinhasVisiveis)}</td>` +
    `<td colspan="5"></td>` +
    '</tr>'
  );
}

function rowShelfSaldoValHtml(r) {
  const dias = r.DIAS_ATE_VENCIMENTO;
  const apontado =
    r.FG_APONTADO === 'S'
      ? ' <span class="sku-badge sku-badge-apontado" title="Já apontado / passado ao cliente">Apontado</span>'
      : '';
  return (
    `<tr class="sku-val">` +
    `<td class="muted sku-indent">↳ validade</td>` +
    `<td class="muted"></td>` +
    `<td>${esc(r.LOTE || '—')}${apontado}</td>` +
    `<td>${formatValidadeShelf(r)}</td>` +
    `<td class="num">${esc(dias != null ? String(dias) : '—')}</td>` +
    `<td class="num">${formatQtdShelf(r.QTD_ENTRADA)}</td>` +
    `<td class="num"><strong>${formatQtdShelf(r.QTD_SALDO_ESTIMADO)}</strong></td>` +
    '</tr>'
  );
}

/** Agrupa cabeçalho SKU + linhas de validade (Saldo/Saída SKU só no cabeçalho). */
function bodyShelfSaldoGroupedHtml(rows, somaFefoGlobalPorSku) {
  let prev = null;
  const parts = [];
  for (const r of rows || []) {
    const k = chaveSkuShelf(r);
    if (k !== prev) {
      const soma =
        somaFefoGlobalPorSku && somaFefoGlobalPorSku.has(k)
          ? somaFefoGlobalPorSku.get(k)
          : Number(r.QTD_SALDO_ESTIMADO) || 0;
      parts.push(rowShelfSaldoCabHtml(r, soma));
      prev = k;
    }
    parts.push(rowShelfSaldoValHtml(r));
  }
  return parts.join('');
}

function buildShelfLifeSaldoHtml({ linhas, avisos, geradoEm, filtroDonoLabel, filtroProdutoLabel }) {
  const dh = geradoEm ? new Date(geradoEm) : new Date();
  const dhBr = esc(dh.toLocaleString('pt-BR'));
  const lista = linhas || [];
  const nuDonos = contarDonosUnicos(lista);
  const nSku = new Set(lista.map((r) => chaveSkuShelf(r))).size;
  const somaFefoGlobalPorSku = new Map();
  for (const r of lista) {
    const k = chaveSkuShelf(r);
    somaFefoGlobalPorSku.set(k, (somaFefoGlobalPorSku.get(k) || 0) + (Number(r.QTD_SALDO_ESTIMADO) || 0));
  }
  const tabelaHtml = buildTabelasShelfPorConsFaixa(
    lista,
    THEAD_SHELF_SALDO,
    null,
    COLS_SHELF_SALDO,
    'Nenhuma linha com saldo estimado no horizonte (após rateio das baixas no SKU).',
    { bodyFromRows: (rows) => bodyShelfSaldoGroupedHtml(rows, somaFefoGlobalPorSku) }
  );
  const avisoHtml = (avisos || []).map((a) => `<li>${esc(a)}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Shelf-life — saldo por validade — WMS</title>
<style>${cssShelfPadrao('#059669')}</style>
</head>
<body>
<h1>Shelf-life — saldo estimado por validade (WMS)</h1>
${metaShelfHtml({
  dhBr,
  filtroDonoLabel,
  filtroProdutoLabel,
  nuDonos,
  nLinhas: lista.length,
  nSku,
  organizacao: 'Conservação → Faixa → SKU → Validade',
})}
<ul class="aviso">${avisoHtml}</ul>
${tabelaHtml}
${toolbarShelfHtml()}
</body>
</html>`;
}

function buildShelfLifeCobrancaHtml(ctx) {
  const html = buildShelfLifeSaldoHtml(ctx);
  return html
    .replace(
      '<title>Shelf-life — saldo por validade — WMS</title>',
      '<title>Vencidos / shelf-life para cobrança — WMS</title>'
    )
    .replace(
      '<h1>Shelf-life — saldo estimado por validade (WMS)</h1>',
      '<h1>Vencidos / shelf-life para cobrança (WMS)</h1>'
    )
    .replace(
      'Nenhuma linha com saldo estimado no horizonte (após rateio das baixas no SKU).',
      'Nenhuma linha com saldo estimado por validade (modo cobrança — sem corte de horizonte).'
    );
}

/* ── Sem validade (coleta) ── */

const THEAD_VAL_FALT =
  '<thead><tr>' +
  '<th>Código</th><th>Descrição</th>' +
  '<th class="num">Saldo</th><th class="num">Já c/ val.</th><th class="num">A coletar</th>' +
  '<th class="coleta">Lote</th><th class="coleta">Validade</th><th class="coleta">Qtd</th><th class="coleta">Obs.</th>' +
  '</tr></thead>';

const COLS_VAL_FALT = 9;

function qtdFaltanteValidade(r) {
  const saldo = Number(r.qtd_saldo_sku ?? r.QTD_SALDO_SKU) || 0;
  const comVal =
    (Number(r.qtd_nf_com_validade ?? r.QTD_NF_COM_VALIDADE) || 0) +
    (Number(r.qtd_inv_com_validade ?? r.QTD_INV_COM_VALIDADE) || 0);
  return Math.max(0, saldo - comVal);
}

function rowValidadeFaltanteHtml(r) {
  const saldo = r.qtd_saldo_sku ?? r.QTD_SALDO_SKU;
  const comVal =
    (Number(r.qtd_nf_com_validade ?? r.QTD_NF_COM_VALIDADE) || 0) +
    (Number(r.qtd_inv_com_validade ?? r.QTD_INV_COM_VALIDADE) || 0);
  const falt = qtdFaltanteValidade(r);
  return (
    '<tr>' +
    `<td>${esc(r.CODIGO_PRODUTO)}</td>` +
    `<td>${esc(r.NM_PRODUTO)}</td>` +
    `<td class="num">${formatQtdShelf(saldo)}</td>` +
    `<td class="num">${formatQtdShelf(comVal)}</td>` +
    `<td class="num"><strong>${formatQtdShelf(falt)}</strong></td>` +
    '<td class="coleta">&nbsp;</td>' +
    '<td class="coleta">&nbsp;</td>' +
    '<td class="coleta">&nbsp;</td>' +
    '<td class="coleta">&nbsp;</td>' +
    '</tr>'
  );
}

/** Conservação → Situação → descrição (ordem já vem do SQL; reforça no HTML). */
function buildTabelasValidadeFaltanteHtml(linhas, emptyMsg) {
  const gruposDono = agruparLinhasPorDono(linhas);
  if (!gruposDono.length) {
    return `<table>${THEAD_VAL_FALT}<tbody><tr><td colspan="${COLS_VAL_FALT}">${esc(
      emptyMsg
    )}</td></tr></tbody></table>`;
  }

  const ordemCons = { CONGELADO: 1, REFRIGERADO: 2, SECO: 3 };
  const ordemSit = {
    SO_MOVIMENTO_SEM_NF: 1,
    ENTRADA_SEM_VALIDADE: 2,
    SO_INVENTARIO_SEM_NF: 3,
    VALIDADE_PARCIAL: 4,
  };

  return gruposDono
    .map(([, rowsDono]) => {
      const titDono = labelDonoLinha(rowsDono[0]);
      const byCons = new Map();
      rowsDono.forEach((r) => {
        const k = String(r.TIPO_ARMAZENAGEM || '—').trim() || '—';
        if (!byCons.has(k)) byCons.set(k, []);
        byCons.get(k).push(r);
      });
      const consKeys = Array.from(byCons.keys()).sort((a, b) => {
        const oa = ordemCons[String(a).toUpperCase()] || 9;
        const ob = ordemCons[String(b).toUpperCase()] || 9;
        if (oa !== ob) return oa - ob;
        return a.localeCompare(b, 'pt-BR');
      });

      const blocos = consKeys
        .map((cons) => {
          const rowsCons = byCons.get(cons) || [];
          const bySit = new Map();
          rowsCons.forEach((r) => {
            const sit = r.situacao || r.SITUACAO || 'OUTRO';
            if (!bySit.has(sit)) bySit.set(sit, []);
            bySit.get(sit).push(r);
          });
          const sitKeys = Array.from(bySit.keys()).sort(
            (a, b) => (ordemSit[a] || 9) - (ordemSit[b] || 9)
          );

          const sub = sitKeys
            .map((sit) => {
              const rows = (bySit.get(sit) || []).slice().sort((a, b) =>
                String(a.NM_PRODUTO || '').localeCompare(String(b.NM_PRODUTO || ''), 'pt-BR', {
                  sensitivity: 'base',
                })
              );
              const rotulo =
                rows[0] && rows[0].SITUACAO_LABEL
                  ? rows[0].SITUACAO_LABEL
                  : sit;
              return (
                `<h4 class="grupo-situacao">${esc(rotulo)} <span class="cnt">(${rows.length})</span></h4>` +
                `<table>${THEAD_VAL_FALT}<tbody>${rows
                  .map(rowValidadeFaltanteHtml)
                  .join('')}</tbody></table>`
              );
            })
            .join('');

          return (
            `<h3 class="grupo-conservacao">${esc(cons)} <span class="cnt">(${rowsCons.length} SKUs)</span></h3>` +
            sub
          );
        })
        .join('');

      return `<h2 class="grupo-dono">${esc(titDono)}</h2>${blocos}`;
    })
    .join('');
}

function buildValidadeFaltanteHtml({ linhas, avisos, geradoEm, filtroDonoLabel, filtroProdutoLabel }) {
  const dh = geradoEm ? new Date(geradoEm) : new Date();
  const dhBr = esc(dh.toLocaleString('pt-BR'));
  const filtroProdTxt = filtroProdutoLabel
    ? `<br/><strong>Filtro produto:</strong> ${esc(filtroProdutoLabel)}`
    : '';
  const lista = linhas || [];
  const nuDonos = contarDonosUnicos(lista);
  const tabelaHtml = buildTabelasValidadeFaltanteHtml(
    lista,
    'Nenhum SKU com FG_CONTROLA_VALIDADE=S e saldo sem rastreio adequado de validade.'
  );
  const avisoHtml = (avisos || []).map((a) => `<li>${esc(a)}</li>`).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8"/>
<title>Coleta de validade — WMS</title>
<style>
@page { size: A4 landscape; margin: 10mm; }
body { font-family: system-ui, "Segoe UI", sans-serif; font-size: 9.5pt; color: #0f172a; margin: 0; padding-bottom: 48px; }
h1 { font-size: 16pt; margin: 0 0 6px; }
h2.grupo-dono { font-size: 12pt; margin: 18px 0 8px; padding: 6px 8px; background: #fef2f2; border-left: 4px solid #dc2626; }
h3.grupo-conservacao { font-size: 11pt; margin: 14px 0 6px; padding: 5px 8px; background: #eff6ff; border-left: 4px solid #2563eb; }
h4.grupo-situacao { font-size: 10pt; margin: 10px 0 4px; padding: 3px 6px; background: #f8fafc; border-left: 3px solid #64748b; color: #334155; }
.cnt { font-weight: 500; color: #64748b; font-size: 9pt; }
.meta { font-size: 9pt; color: #334155; margin-bottom: 10px; line-height: 1.45; }
.aviso { font-size: 8.5pt; color: #475569; margin: 0 0 10px 18px; }
.coleta-hint { font-size: 9pt; color: #92400e; background: #fffbeb; border: 1px solid #fcd34d; padding: 6px 10px; margin: 0 0 12px; }
table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
th, td { border: 1px solid #cbd5e1; padding: 4px 5px; text-align: left; vertical-align: middle; }
th { background: #f1f5f9; }
td.num, th.num { text-align: right; }
th.coleta, td.coleta { background: #fffbeb; min-width: 70px; height: 28px; }
td.coleta:nth-child(6), th.coleta:nth-child(6) { min-width: 90px; } /* Lote */
td.coleta:nth-child(7), th.coleta:nth-child(7) { min-width: 90px; } /* Validade */
td.coleta:nth-child(8), th.coleta:nth-child(8) { min-width: 56px; } /* Qtd */
td.coleta:nth-child(9), th.coleta:nth-child(9) { min-width: 72px; } /* Obs */
.toolbar { position: fixed; bottom: 0; left: 0; right: 0; padding: 10px; background: #f8fafc; border-top: 1px solid #cbd5e1; text-align: center; z-index: 9; }
@media print {
  .toolbar { display: none !important; }
  body { padding-bottom: 0; }
  h2.grupo-dono, h3.grupo-conservacao, h4.grupo-situacao { break-after: avoid; }
}
</style>
</head>
<body>
<h1>Coleta de validade — produtos sem rastreio (WMS)</h1>
<p class="meta"><strong>Impresso em:</strong> ${dhBr}<br/>
<strong>Filtro dono:</strong> ${esc(filtroDonoLabel || '—')}${filtroProdTxt}<br/>
<strong>Donos no relatório:</strong> ${nuDonos}<br/>
<strong>SKUs:</strong> ${lista.length}<br/>
<strong>Organização:</strong> Conservação → Situação → Descrição</p>
<p class="coleta-hint"><strong>Preencha à mão:</strong> Lote, Validade (dd/mm/aaaa), Qtd encontrada e Obs. Se houver mais de um lote no mesmo SKU, use a linha seguinte em branco ou anote na Obs.</p>
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
  buildShelfLifeHtml,
  buildShelfLifeSaldoHtml,
  buildShelfLifeCobrancaHtml,
  buildValidadeFaltanteHtml,
  faixaShelfLife,
};
