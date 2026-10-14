'use strict';

function nivelOl(row) {
  const nv = String(row.CDNVPRODUTO ?? row.Cdnvproduto ?? '').trim();
  const n = parseInt(nv, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {Array<Record<string, unknown>>} rows
 */
function indexarPlanilhaOl(rows) {
  const byCod = new Map();
  const byLevel = { 1: [], 2: [], 3: [], 4: [], 5: [] };

  for (const row of rows) {
    const cod = String(row.CDPRODUTO || '').trim();
    const nv = nivelOl(row);
    if (!cod || nv == null || nv < 1 || nv > 5) continue;
    const node = { row, cod, nivel: nv, nome: String(row.NMPRODUTO || '').trim() };
    byCod.set(cod, node);
    byLevel[nv].push(node);
  }

  for (const lv of Object.keys(byLevel)) {
    byLevel[lv].sort((a, b) => a.cod.length - b.cod.length);
  }

  return { byCod, byLevel };
}

/**
 * Ancestrais OL pelo prefixo de CDPRODUTO (níveis 2, 3 e 4).
 * @param {string} codProduto
 * @param {{ byLevel: Record<number, object[]> }} index
 */
function ancestraisOl(codProduto, index) {
  const cod = String(codProduto || '').trim();
  const out = { n2: null, n3: null, n4: null };
  if (!cod) return out;

  for (const lv of [2, 3, 4]) {
    const lista = index.byLevel[lv] || [];
    let best = null;
    for (const node of lista) {
      if (cod.startsWith(node.cod) && node.cod.length < cod.length) {
        if (!best || node.cod.length > best.cod.length) best = node;
      }
    }
    out['n' + lv] = best;
  }
  return out;
}

/**
 * Nome de categoria WMS legado: Grupo OL (nv3) › Família (nv4).
 * @deprecated Preferir {@link nomeCategoriaWmsNv3} no cadastro WMS.
 */
function nomeCategoriaWms(anc, nodeNv4) {
  const p3 = anc.n3 && anc.n3.nome;
  const p4 = (nodeNv4 && nodeNv4.nome) || (anc.n4 && anc.n4.nome);
  if (p3 && p4 && p3 !== p4) return (p3 + ' › ' + p4).slice(0, 120);
  return (p4 || p3 || 'SEM NOME').slice(0, 120);
}

/** Categoria WMS operacional: só subgrupo OL (nv3), sem família (nv4). */
function nomeCategoriaWmsNv3(anc) {
  const p3 = anc.n3 && anc.n3.nome;
  if (p3) return String(p3).trim().slice(0, 120);
  const p2 = anc.n2 && anc.n2.nome;
  if (p2) return String(p2).trim().slice(0, 120);
  return 'SEM NOME';
}

module.exports = {
  nivelOl,
  indexarPlanilhaOl,
  ancestraisOl,
  nomeCategoriaWms,
  nomeCategoriaWmsNv3,
};
