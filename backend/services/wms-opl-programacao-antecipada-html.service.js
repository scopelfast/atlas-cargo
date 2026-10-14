'use strict';

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtNum(n, dec) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString('pt-BR', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
}

function fmtKg(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return '—';
  return `${fmtNum(x, 3)} kg`;
}

function fmtFiltros(f) {
  if (!f || typeof f !== 'object') return '—';
  const parts = [];
  if (f.dataDe) parts.push(`Entrega de: ${esc(f.dataDe)}`);
  if (f.dataAte) parts.push(`Entrega até: ${esc(f.dataAte)}`);
  if (f.cdDono != null && f.cdDono !== '') parts.push(`Dono: ${esc(f.cdDono)}`);
  if (f.nmArquivo) parts.push(`Arquivo contém: ${esc(f.nmArquivo)}`);
  if (f.uf) parts.push(`UF entrega: ${esc(f.uf)}`);
  return parts.length ? parts.join(' · ') : 'Sem filtros adicionais';
}

function htmlVeiculoSugestao(sug) {
  if (!sug) return '';
  const parts = (sug.sugestoes || []).map((s) => {
    const ok = s.cabe !== false;
    const exced =
      !ok && s.kgMax != null
        ? ` <span class="veic-exced">(acima de ${fmtNum(s.kgMax, 0)} kg)</span>`
        : '';
    return `<strong>${esc(s.rotulo)}</strong>: ~${esc(fmtKg(s.pesoKg))}${exced}`;
  });
  const alertas = (sug.alertas || []).map((a) => esc(a)).join(' ');
  const cls = alertas ? 'veic veic-warn' : 'veic';
  return `<div class="${cls}"><strong>Sugestão de veículo (referência):</strong> ${
    parts.length ? parts.join(' · ') : 'Sem peso para estimar.'
  }${alertas ? `<div class="veic-alertas">${alertas}</div>` : ''}</div>`;
}

function htmlKpiRow(items) {
  return `<div class="kpi-row">${items
    .map(
      (it) =>
        `<div class="kpi"><div class="kpi-lbl">${esc(it.lbl)}</div><div class="kpi-val${it.cls ? ' ' + it.cls : ''}">${it.val}</div>${
          it.sub ? `<div class="kpi-sub">${esc(it.sub)}</div>` : ''
        }</div>`
    )
    .join('')}</div>`;
}

function rowDono(d) {
  const td = d.totais || {};
  return `<tr>
    <td>${esc(d.NM_DONO || '')}</td>
    <td class="num"><strong>${esc(fmtKg(td.pesoKg))}</strong></td>
    <td class="num">${esc(fmtKg(td.pesoKgSeco))}</td>
    <td class="num">${esc(fmtKg(td.pesoKgFrio))}</td>
    <td class="num">${esc(fmtNum(td.unidades, 0))}</td>
    <td>${esc((d.espelhosIds || []).join(', '))}</td>
  </tr>`;
}

function rowRota(r, detalharDestinos) {
  const tr = r.totais || {};
  let html = `<tr class="row-rota">
    <td><strong>${esc(r.rotulo || '')}</strong></td>
    <td class="num">${esc(fmtNum(r.qtdParadas, 0))}</td>
    <td class="num"><strong>${esc(fmtKg(tr.pesoKg))}</strong></td>
    <td class="num">${esc(fmtKg(tr.pesoKgSeco))}</td>
    <td class="num">${esc(fmtKg(tr.pesoKgFrio))}</td>
  </tr>`;
  if (!detalharDestinos) return html;
  for (const dest of r.destinatarios || []) {
    const td = dest.totais || {};
    const nome = dest.RAZ_SOC_DEST || dest.rotulo || '—';
    html += `<tr class="row-dest">
      <td>
        <span class="dest-cod">${esc(dest.COD_DESTINATARIO || '—')}</span>
        ${esc(nome)}
        ${dest.cidadeUf ? `<span class="dest-cidade">${esc(dest.cidadeUf)}</span>` : ''}
      </td>
      <td class="num">${esc(fmtNum(dest.qtdPedidos, 0))}</td>
      <td class="num">${esc(fmtKg(td.pesoKg))}</td>
      <td class="num">${esc(fmtKg(td.pesoKgSeco))}</td>
      <td class="num">${esc(fmtKg(td.pesoKgFrio))}</td>
    </tr>`;
  }
  return html;
}

function htmlDia(dia, sugestaoGeral, detalharDestinos) {
  const t = dia.totais || {};
  let html = `<section class="dia-card">
    <h2><i class="ico">📅</i> Entrega ${esc(dia.dataEntrega)} <span class="badge-total">${esc(fmtKg(t.pesoKg))} total</span></h2>`;
  html += htmlKpiRow([
    { lbl: 'Seco', val: esc(fmtKg(t.pesoKgSeco)), cls: 'kpi-seco' },
    { lbl: 'Frio', val: esc(fmtKg(t.pesoKgFrio)), cls: 'kpi-frio' },
    { lbl: 'Pedidos', val: esc(fmtNum(t.qtdPedidos, 0)) },
    { lbl: 'Paradas', val: esc(fmtNum(t.qtdParadas, 0)) },
  ]);
  html += htmlVeiculoSugestao(dia.sugestaoVeiculo || sugestaoGeral);

  if ((dia.porDono || []).length) {
    html += `<h3>Por dono</h3>
    <table class="tbl">
      <thead><tr>
        <th>Dono</th><th class="num">Peso</th><th class="num">Seco</th><th class="num">Frio</th>
        <th class="num">Unid.</th><th>Espelhos</th>
      </tr></thead>
      <tbody>${dia.porDono.map(rowDono).join('')}</tbody>
    </table>`;
  }

  if ((dia.porRota || []).length) {
    const subRotas = detalharDestinos
      ? ''
      : '<p class="hint-rota">Somente totais por rota (destinatários omitidos). Marque a opção na tela para incluir unidades de destino.</p>';
    html += `<h3>Por rota cadastrada</h3>${subRotas}
    <table class="tbl tbl-rota">
      <thead><tr>
        <th>Rota / destinatário</th><th class="num">Ped.</th><th class="num">Peso</th>
        <th class="num">Seco</th><th class="num">Frio</th>
      </tr></thead>
      <tbody>${dia.porRota.map((r) => rowRota(r, detalharDestinos)).join('')}</tbody>
    </table>`;
  }

  if ((dia.espelhos || []).length) {
    html += `<p class="espelhos">Espelhos: ${dia.espelhos
      .map((e) => `#${esc(e.CD_OPL_ARQUIVO)} ${esc(e.NM_ARQUIVO || '')}`)
      .join(' · ')}</p>`;
  }
  html += '</section>';
  return html;
}

function buildProgramacaoAntecipadaHtml(payload) {
  const {
    totaisGeral = {},
    sugestaoVeiculoGeral,
    porDataEntrega = [],
    geradoEm,
    filtros,
    aviso,
    legenda,
    detalharDestinos = false,
  } = payload;

  const mostrarDestinos = detalharDestinos === true;

  const dh = geradoEm ? new Date(geradoEm).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR');
  const tg = totaisGeral;

  let heroHtml = htmlKpiRow([
    { lbl: 'Peso total', val: esc(fmtKg(tg.pesoKg)), sub: 'Demanda OPL (não NF)' },
    { lbl: 'Seco / ambiente', val: esc(fmtKg(tg.pesoKgSeco)), cls: 'kpi-seco' },
    { lbl: 'Refrig. / congelado', val: esc(fmtKg(tg.pesoKgFrio)), cls: 'kpi-frio' },
    { lbl: 'Unidades', val: esc(fmtNum(tg.unidades, 0)), sub: 'Vol. operacional' },
    {
      lbl: 'Paradas',
      val: esc(fmtNum(tg.qtdParadas != null ? tg.qtdParadas : 0, 0)),
      sub: 'Destinos distintos',
    },
    { lbl: 'Espelhos', val: esc(fmtNum(tg.qtdEspelhos, 0)), sub: 'Arquivos OPL' },
  ]);
  heroHtml += htmlVeiculoSugestao(sugestaoVeiculoGeral);

  const diasHtml = (porDataEntrega || [])
    .map((dia) => htmlDia(dia, sugestaoVeiculoGeral, mostrarDestinos))
    .join('');

  const avisoHtml = aviso ? `<p class="aviso">${esc(aviso)}</p>` : '';
  const legendaTxt =
    (legenda && legenda.pesoKg) ||
    'Estimativa: PESO_KG do cadastro WMS × QT_PEDIDA (via código OL + de-para).';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Programação antecipada OPL</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 11px;
      color: #0f172a;
      margin: 12px 14px;
      max-width: 210mm;
    }
    h1 { font-size: 17px; margin: 0 0 6px; }
    h2 { font-size: 14px; margin: 16px 0 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    h3 { font-size: 12px; margin: 12px 0 6px; color: #334155; text-transform: uppercase; letter-spacing: 0.03em; }
    .meta { color: #64748b; margin-bottom: 12px; font-size: 10px; line-height: 1.45; }
    .aviso { background: #fffbeb; border: 1px solid #fcd34d; padding: 8px 12px; border-radius: 6px; color: #92400e; }
    .sec-tit { font-size: 13px; font-weight: 700; margin: 14px 0 8px; color: #0f172a; }
    .kpi-row { display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0; }
    .kpi {
      flex: 1 1 120px; min-width: 110px;
      border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; background: #f8fafc;
    }
    .kpi-lbl { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.02em; }
    .kpi-val { font-size: 15px; font-weight: 800; margin-top: 2px; }
    .kpi-val.kpi-seco { color: #b45309; }
    .kpi-val.kpi-frio { color: #0369a1; }
    .kpi-sub { font-size: 9px; color: #94a3b8; margin-top: 2px; }
    .veic {
      margin: 10px 0; padding: 8px 12px; border-radius: 6px;
      background: #eff6ff; border: 1px solid #93c5fd; font-size: 11px; line-height: 1.45;
    }
    .veic-warn { background: #fff7ed; border-color: #fdba74; }
    .veic-alertas { margin-top: 6px; color: #9a3412; }
    .veic-exced { color: #b91c1c; font-weight: 600; }
    .badge-total {
      font-size: 12px; font-weight: 700; background: #0f172a; color: #fbbf24;
      padding: 3px 10px; border-radius: 999px;
    }
    .dia-card {
      margin-top: 18px; padding-top: 12px;
      border-top: 2px solid #e2e8f0;
      page-break-inside: avoid;
    }
    table.tbl { width: 100%; border-collapse: collapse; margin: 8px 0 12px; table-layout: fixed; }
    table.tbl th, table.tbl td {
      border: 1px solid #94a3b8; padding: 4px 8px; vertical-align: top;
      word-wrap: break-word; overflow-wrap: anywhere;
    }
    table.tbl th:not(.num), table.tbl td:not(.num) { text-align: left; }
    table.tbl th { background: #1e293b; color: #f8fafc; font-size: 10px; font-weight: 700; }
    table.tbl tbody tr:nth-child(even) td { background: #f8fafc; }
    table.tbl th.num, table.tbl td.num {
      text-align: right;
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    table.tbl-rota th:first-child, table.tbl-rota td:first-child { width: 40%; }
    table.tbl-rota th.num:nth-child(2), table.tbl-rota td.num:nth-child(2) { width: 8%; }
    table.tbl-rota th.num:nth-child(n+3), table.tbl-rota td.num:nth-child(n+3) { width: 17%; }
    table.tbl:not(.tbl-rota) th.num, table.tbl:not(.tbl-rota) td.num { width: 14%; }
    tr.row-rota td { background: #e2e8f0 !important; font-weight: 600; }
    tr.row-dest td { font-size: 10px; }
    tr.row-dest td:first-child { padding-left: 18px; border-left: 3px solid #3b82f6; }
    .dest-cod { display: block; font-size: 9px; color: #64748b; font-weight: 700; }
    .dest-cidade { display: block; font-size: 9px; color: #475569; margin-top: 2px; }
    .espelhos { font-size: 10px; color: #64748b; margin: 8px 0 0; line-height: 1.4; }
    .hint-rota { font-size: 10px; color: #64748b; margin: 0 0 6px; line-height: 1.4; }
    .legenda {
      margin-top: 16px; padding: 10px 12px;
      border: 1px solid #cbd5e1; border-left: 4px solid #2563eb;
      background: #f8fafc; font-size: 10px; line-height: 1.45; color: #334155;
    }
    .toolbar { margin-bottom: 12px; }
    .toolbar button {
      font-size: 12px; padding: 8px 14px; cursor: pointer;
      background: #2563eb; color: #fff; border: none; border-radius: 6px; font-weight: 600;
    }
    @media print {
      body { margin: 0; max-width: none; }
      .no-print { display: none !important; }
      .kpi, tr.row-rota td, table.tbl th, .badge-total, .veic {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  <div class="toolbar no-print">
    <button type="button" onclick="window.print()">Imprimir</button>
  </div>
  <h1>Programação antecipada de embarque (OPL)</h1>
  <p class="meta">Gerado em ${esc(dh)} · <strong>Impressão A4 vertical</strong>${
    mostrarDestinos ? ' · <strong>Com destinatários por rota</strong>' : ' · <strong>Somente rotas (sem destinatários)</strong>'
  }<br />
  Filtros: ${fmtFiltros(filtros)}</p>
  ${avisoHtml}
  <div class="sec-tit">Totais no período</div>
  ${heroHtml}
  ${diasHtml || '<p><em>Sem dados no período.</em></p>'}
  <div class="legenda">${esc(legendaTxt)}</div>
</body>
</html>`;
}

module.exports = { buildProgramacaoAntecipadaHtml };
