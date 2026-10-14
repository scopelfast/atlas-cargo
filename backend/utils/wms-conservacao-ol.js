'use strict';

/** @typedef {'SECO'|'REFRIGERADO'|'CONGELADO'} TipoConservacao */

const PRIORIDADE = { CONGELADO: 3, REFRIGERADO: 2, SECO: 1 };

/**
 * Prefixos OL (nível 2/3 — CDPRODUTO) com conservação fixa para toda a subárvore.
 * 60507 = REFRIGERANTE (bebida) → SECO, não câmara fria.
 */
const PREFIXO_OL_CONSERVACAO = [
  { prefix: '60306', tipo: 'CONGELADO', motivo: 'Grupo OL CONGELADOS' },
  { prefix: '60507', tipo: 'SECO', motivo: 'Grupo OL REFRIGERANTE (bebidas)' },
];

/**
 * Inferência por texto (nome OL). Ordem: congelado > resfriado > seco.
 * @param {string} texto
 * @returns {TipoConservacao|null} null = neutro (herdar)
 */
function inferirConservacaoPorNome(texto) {
  const u = String(texto || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!u.trim()) return null;

  if (
    /\bCONGELAD[OA]S?\b/.test(u) ||
    /\bCONGEL\b/.test(u) ||
    /\bCONG\s/.test(u) ||
    u.includes(' CONG ') ||
    /\bIQF\b/.test(u)
  ) {
    return 'CONGELADO';
  }

  if (
    /\bREFRIGERAD[OA]S?\b/.test(u) ||
    /\bREFRIG\b/.test(u) ||
    /\bRESFRI/.test(u) ||
    /\bFRESC[OA]?\b/.test(u) ||
    /\bFRESCO\b/.test(u) ||
    /\bSATURAC/.test(u) ||
    /\bFITAS?\s+SATUR/.test(u) ||
    /\bSATUR\b/.test(u)
  ) {
    return 'REFRIGERADO';
  }

  if (/\bSECO\b/.test(u) || /\bAMBIENTE\b/.test(u)) {
    return 'SECO';
  }

  /** Bebida “refrigerante” não é câmara fria. */
  if (/\bREFRIGERANTE\b/.test(u) && !/\bREFRIGERAD[OA]\b/.test(u)) {
    return 'SECO';
  }

  return null;
}

function conservacaoPorPrefixoCodigo(codProduto) {
  const cod = String(codProduto || '').trim();
  if (!cod) return null;
  let best = null;
  for (const regra of PREFIXO_OL_CONSERVACAO) {
    if (cod.startsWith(regra.prefix) && (!best || regra.prefix.length > best.prefix.length)) {
      best = regra;
    }
  }
  return best ? best.tipo : null;
}

function maisRestritiva(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (PRIORIDADE[a] || 0) >= (PRIORIDADE[b] || 0) ? a : b;
}

/**
 * Monta mapa CDPRODUTO (níveis 2 e 3) → conservação inferida do nome do nó.
 * @param {Array<{ CDPRODUTO?: string, CDNVPRODUTO?: string, NMPRODUTO?: string }>} rows
 */
function montarMapaConservacaoClasseGrupo(rows) {
  const mapa = new Map();
  for (const row of rows) {
    const nv = parseInt(String(row.CDNVPRODUTO ?? '').trim(), 10);
    if (nv !== 2 && nv !== 3) continue;
    const cod = String(row.CDPRODUTO || '').trim();
    if (!cod) continue;
    const porNome = inferirConservacaoPorNome(row.NMPRODUTO);
    const porPrefixo = conservacaoPorPrefixoCodigo(cod);
    const tipo = maisRestritiva(porPrefixo, porNome);
    if (tipo) mapa.set(cod, tipo);
  }
  return mapa;
}

/**
 * Conservação obrigatória: nunca retorna vazio (padrão SECO com motivo).
 * @param {object} opts
 * @param {string} opts.nomeProduto
 * @param {{ n2?: object, n3?: object, n4?: object }} opts.ancestrais
 * @param {Map<string, TipoConservacao>} [opts.mapaClasseGrupo]
 * @returns {{ tipo: TipoConservacao, origem: string }}
 */
function resolverConservacaoProdutoOl(opts) {
  const nomeProduto = opts.nomeProduto || '';
  const a = opts.ancestrais || {};
  const mapa = opts.mapaClasseGrupo || new Map();

  const códigos = [
    a.n4 && String(a.n4.CDPRODUTO || '').trim(),
    a.n3 && String(a.n3.CDPRODUTO || '').trim(),
    a.n2 && String(a.n2.CDPRODUTO || '').trim(),
    String(nomeProduto).trim(),
  ].filter(Boolean);

  for (const cod of códigos) {
    const fix = conservacaoPorPrefixoCodigo(cod);
    if (fix) return { tipo: fix, origem: 'prefixo_ol:' + cod };
  }

  for (const cod of [a.n3, a.n2].map((n) => n && String(n.CDPRODUTO || '').trim()).filter(Boolean)) {
    if (mapa.has(cod)) return { tipo: mapa.get(cod), origem: 'mapa_nv2_3:' + cod };
  }

  const textos = [
    nomeProduto,
    a.n4 && a.n4.NMPRODUTO,
    a.n3 && a.n3.NMPRODUTO,
    a.n2 && a.n2.NMPRODUTO,
  ];
  for (const t of textos) {
    const inf = inferirConservacaoPorNome(t);
    if (inf) return { tipo: inf, origem: 'nome:' + String(t).slice(0, 40) };
  }

  return { tipo: 'SECO', origem: 'padrao_seco' };
}

module.exports = {
  PREFIXO_OL_CONSERVACAO,
  inferirConservacaoPorNome,
  conservacaoPorPrefixoCodigo,
  montarMapaConservacaoClasseGrupo,
  resolverConservacaoProdutoOl,
  maisRestritiva,
};
