'use strict';

const { labelDonoLinha } = require('./wms-relatorio-posicao-estoque-html.service');

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function agruparLinhasPorDono(linhas) {
  const byDono = new Map();
  (linhas || []).forEach((r) => {
    const k = r.CD_DONO != null ? String(r.CD_DONO) : '0';
    if (!byDono.has(k)) byDono.set(k, []);
    byDono.get(k).push(r);
  });
  return Array.from(byDono.entries()).sort(
    (a, b) => (parseInt(a[0], 10) || 0) - (parseInt(b[0], 10) || 0)
  );
}

/**
 * @param {object[]} linhas
 * @param {string} theadHtml
 * @param {(rows: object[]) => string} buildTbody
 * @param {number} colspan
 * @param {string} emptyMsg
 */
function buildTabelasHtmlPorDono(linhas, theadHtml, buildTbody, colspan, emptyMsg) {
  const grupos = agruparLinhasPorDono(linhas);
  if (!grupos.length) {
    return `<table>${theadHtml}<tbody><tr><td colspan="${colspan}">${esc(
      emptyMsg
    )}</td></tr></tbody></table>`;
  }
  return grupos
    .map(([, rows]) => {
      const tit = labelDonoLinha(rows[0]);
      return (
        `<h2 class="grupo-dono">${esc(tit)}</h2>` +
        `<table>${theadHtml}${buildTbody(rows)}</table>`
      );
    })
    .join('');
}

function contarDonosUnicos(linhas) {
  return new Set((linhas || []).map((r) => (r.CD_DONO != null ? String(r.CD_DONO) : ''))).size;
}

function metaPeriodoHtml(filtroPeriodoLabel) {
  const s = String(filtroPeriodoLabel || '').trim();
  if (!s) return '';
  return `<br/><strong>Período:</strong> ${esc(s)}`;
}

module.exports = {
  esc,
  labelDonoLinha,
  agruparLinhasPorDono,
  buildTabelasHtmlPorDono,
  contarDonosUnicos,
  metaPeriodoHtml,
};
