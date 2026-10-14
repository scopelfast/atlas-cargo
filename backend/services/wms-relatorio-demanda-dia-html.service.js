'use strict';

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function kg(n) {
  if (n == null || n === '') return '—';
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return esc(x.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })) + ' kg';
}

function brl(n) {
  if (n == null || n === '') return '—';
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return esc(x.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
}

function km(n) {
  const x = Number(n);
  if (n == null || !Number.isFinite(x)) return '—';
  return esc(x.toLocaleString('pt-BR', { maximumFractionDigits: 1 })) + ' km';
}

function buildDemandaDiaHtml(data) {
  const dh = data && data.geradoEm ? new Date(data.geradoEm) : new Date();
  const dhBr = esc(dh.toLocaleString('pt-BR'));
  const f = (data && data.filtros) || {};
  const dias = (data && data.dias) || [];
  const avisos = (data && data.avisos) || [];
  let body = '';
  if (!dias.length) {
    body = '<tr><td colspan="13" class="vazio">Nenhuma carga com entrega no período e nos filtros informados.</td></tr>';
  }
  for (const dia of dias) {
    const cargas = dia.cargas || [];
    const t = dia.total || {};
    for (const c of cargas) {
      body += '<tr>';
      body += `<td>${esc(dia.dataBr)}</td>`;
      body += `<td class="num">${esc(c.cdCarga)}</td>`;
      body += `<td>${esc(c.situacao)}</td>`;
      body += `<td>${esc(c.rotasTexto)}<div class="parte ${esc(c.leitura && c.leitura.tom)}">${esc(
        c.leitura && c.leitura.texto ? c.leitura.texto : ''
      )}</div></td>`;
      body += `<td class="num">${esc(c.entregas)}</td>`;
      body += `<td class="num">${km(c.km)}</td>`;
      body += `<td class="num">${kg(c.pesoFrio)}</td>`;
      body += `<td class="num">${kg(c.pesoSeco)}</td>`;
      body += `<td class="num">${kg(c.pesoTotal)}</td>`;
      body += `<td class="num">${brl(c.valorFrio)}</td>`;
      body += `<td class="num">${brl(c.valorSeco)}</td>`;
      body += `<td class="num">${brl(c.valorTotal)}</td>`;
      body += `<td class="num">${brl(c.receita)}</td>`;
      body += '</tr>';
    }
    const rotasTxt = (t.qtdRotas || 0) + ((t.qtdRotas || 0) === 1 ? ' rota' : ' rotas');
    body += `<tr class="total">`;
    body += `<td>Total ${esc(dia.dataBr)}</td>`;
    body += `<td>${esc((t.qtdCargas || 0) + ' cargas')}</td>`;
    body += '<td></td>';
    body += `<td>${esc(rotasTxt)}</td>`;
    body += `<td class="num">${esc(t.entregas || 0)}</td>`;
    body += `<td class="num">${km(t.km)}</td>`;
    body += `<td class="num">${kg(t.pesoFrio)}</td>`;
    body += `<td class="num">${kg(t.pesoSeco)}</td>`;
    body += `<td class="num">${kg(t.pesoTotal)}</td>`;
    body += `<td class="num">${brl(t.valorFrio)}</td>`;
    body += `<td class="num">${brl(t.valorSeco)}</td>`;
    body += `<td class="num">${brl(t.valorTotal)}</td>`;
    body += `<td class="num">${brl(t.receita)}</td>`;
    body += '</tr>';
    if (dia.leitura && dia.leitura.texto) {
      body += `<tr class="leitura ${esc(dia.leitura.tom)}"><td colspan="13">${esc(dia.leitura.texto)}</td></tr>`;
    }
  }
  const avisosHtml = avisos.length
    ? '<ul class="avisos">' + avisos.map((a) => '<li>' + esc(a) + '</li>').join('') + '</ul>'
    : '';
  const abertura =
    data && data.totais && data.totais.leitura && data.totais.leitura.texto
      ? `<p class="abertura ${esc(data.totais.leitura.tom)}">${esc(data.totais.leitura.texto)}</p>`
      : '';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Demanda do dia</title>
  <style>
    @page { size: A4 landscape; margin: 12mm; }
    body { font-family: "Segoe UI", sans-serif; color: #0f172a; font-size: 11px; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    .meta { margin: 0 0 10px; color: #475569; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #cbd5e1; padding: 4px 6px; vertical-align: top; }
    th { background: #f1f5f9; text-align: left; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    tr.total td { font-weight: 700; background: #f8fafc; }
    tr.leitura td { font-weight: 600; background: #f8fafc; }
    tr.leitura.seco td { background: #fef3c7; }
    tr.leitura.frio td { background: #dbeafe; }
    .parte { margin-top: 2px; font-size: 10px; color: #475569; }
    .parte.seco { color: #92400e; }
    .parte.frio { color: #1d4ed8; }
    .abertura { margin: 0 0 12px; padding: 8px 10px; background: #f8fafc; border: 1px solid #cbd5e1; font-weight: 600; }
    .abertura.seco { background: #fef3c7; }
    .abertura.frio { background: #dbeafe; }
    .avisos { margin: 8px 0 12px; padding-left: 18px; }
    .vazio { color: #64748b; }
    footer { margin-top: 14px; color: #64748b; font-size: 11px; }
  </style>
</head>
<body>
  <h1>Demanda do dia</h1>
  <p class="meta"><strong>Impresso em:</strong> ${dhBr}<br />
    Período da entrega: ${esc(f.periodoLabel || '—')} · Situação: ${esc(f.situacaoLabel || '—')} · Rota: ${esc(
      f.rotaLabel || '—'
    )} · Dono: ${esc(f.donoLabel || 'Todos')}</p>
  ${avisosHtml}
  ${abertura}
  <table>
    <thead>
      <tr>
        <th rowspan="2">Data</th>
        <th rowspan="2" class="num">Carga</th>
        <th rowspan="2">Situação</th>
        <th rowspan="2">Rotas</th>
        <th rowspan="2" class="num">Entregas</th>
        <th rowspan="2" class="num">Km</th>
        <th colspan="3" class="num">Peso</th>
        <th colspan="3" class="num">Valor da nota</th>
        <th rowspan="2" class="num">Receita</th>
      </tr>
      <tr>
        <th class="num">Frio</th>
        <th class="num">Seco</th>
        <th class="num">Peso total</th>
        <th class="num">Frio</th>
        <th class="num">Seco</th>
        <th class="num">Nota total</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>
  <footer>Impresso em ${dhBr} — Atlas Cargo / WMS. Uma linha por carga. Rotas da mesma carga juntas. Entrega é a parada distinta. Receita = valor das notas × percentual de expedição do dono. Frio junta resfriado e congelado.</footer>
</body>
</html>`;
}

module.exports = { buildDemandaDiaHtml };
