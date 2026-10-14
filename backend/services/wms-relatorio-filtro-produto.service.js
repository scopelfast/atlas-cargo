'use strict';

const TIPOS_CONSERVACAO_CONHECIDOS = ['SECO', 'REFRIGERADO', 'CONGELADO'];

function onlyAlphaNum(v) {
  return String(v || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

/** Normaliza `TIPO_ARMAZENAGEM` do cadastro do produto para um dos buckets conhecidos. */
function bucketConservacao(tipoArmazenagem) {
  const t = String(tipoArmazenagem || '').trim().toUpperCase();
  if (t === 'REFRIGERADO' || t === 'RESFRIADO') return 'REFRIGERADO';
  if (t === 'CONGELADO') return 'CONGELADO';
  if (t === 'SECO' || t === 'SECO_AMB' || t === 'AMBIENTE') return 'SECO';
  return 'OUTRO';
}

function bucketLinhaRelatorio(row) {
  return bucketConservacao(row && (row.TIPO_ARMAZENAGEM || row.tipo_armazenagem));
}

function rotuloBucket(b) {
  if (b === 'SECO') return 'Seco/ambiente';
  if (b === 'REFRIGERADO') return 'Refrigerado';
  if (b === 'CONGELADO') return 'Congelado';
  return 'Outros / sem cadastro';
}

function codigosBuscaLinha(row) {
  const vals = [
    row.CODIGO_PRODUTO,
    row.CODIGO_PRODUTO_INTERNO,
    row.CODIGO_INTERNO,
    row.codigo_prod,
    row.CODIGO_PRODUTO,
  ];
  return vals
    .map((v) => onlyAlphaNum(v))
    .filter(Boolean)
    .join('|');
}

/**
 * Filtra linhas já materializadas dos relatórios WMS (parcial, case-insensitive na descrição).
 * @param {object[]} linhas
 * @param {{ codigoProduto?: string|null, descricaoProduto?: string|null }} filtros
 */
function filtrarLinhasPorProduto(linhas, filtros) {
  filtros = filtros || {};
  const cod = String(filtros.codigoProduto ?? '').trim();
  const desc = String(filtros.descricaoProduto ?? '').trim();
  const cons = Array.isArray(filtros.conservacao)
    ? filtros.conservacao.filter(Boolean)
    : [];
  if (!cod && !desc && !cons.length) return linhas || [];
  const codN = cod ? onlyAlphaNum(cod) : '';
  const descL = desc ? desc.toLowerCase() : '';
  const consSet = cons.length ? new Set(cons.map((c) => String(c).toUpperCase())) : null;
  return (linhas || []).filter((row) => {
    if (codN) {
      const hay = codigosBuscaLinha(row);
      if (!hay || !hay.includes(codN)) return false;
    }
    if (descL) {
      const nm = String(row.NM_PRODUTO || row.nm_produto || '').toLowerCase();
      if (!nm.includes(descL)) return false;
    }
    if (consSet) {
      const b = bucketLinhaRelatorio(row);
      if (!consSet.has(b)) return false;
    }
    return true;
  });
}

function rotuloSubcategoriaCadastro(cad) {
  const full = cad && (cad.NM_CATEGORIA || '').trim() ? String(cad.NM_CATEGORIA).trim() : '';
  const sep = full.indexOf(' › ');
  if (sep >= 0) return full.slice(0, sep).trim() || full;
  return full;
}

/**
 * Filtra linhas já enriquecidas com `_cadWms` (grupo/categoria do cadastro WMS).
 * Aceita texto (contém) e/ou IDs exatos (combo).
 */
function filtrarLinhasPorGrupoCategoria(linhas, filtros) {
  filtros = filtros || {};
  const g = String(filtros.grupoProduto ?? '').trim().toLowerCase();
  const c = String(filtros.categoriaProduto ?? '').trim().toLowerCase();
  const cdG = parseInt(filtros.cdGrupo ?? filtros.CD_GRUPO, 10);
  const cdC = parseInt(filtros.cdCategoria ?? filtros.CD_CATEGORIA, 10);
  const temIdG = Number.isFinite(cdG) && cdG > 0;
  const temIdC = Number.isFinite(cdC) && cdC > 0;
  if (!g && !c && !temIdG && !temIdC) return linhas || [];
  return (linhas || []).filter((row) => {
    const cad = row._cadWms || {};
    if (temIdC && Number(cad.CD_CATEGORIA) !== cdC) return false;
    if (temIdG && Number(cad.CD_GRUPO) !== cdG) return false;
    if (g) {
      const grupo = String(cad.NM_GRUPO || '').toLowerCase();
      if (!grupo.includes(g)) return false;
    }
    if (c) {
      const sub = rotuloSubcategoriaCadastro(cad).toLowerCase();
      const full = String(cad.NM_CATEGORIA || '').toLowerCase();
      if (!sub.includes(c) && !full.includes(c)) return false;
    }
    return true;
  });
}

function montarRotuloFiltroProduto(filtros) {
  const c = String(filtros?.codigoProduto ?? '').trim();
  const d = String(filtros?.descricaoProduto ?? '').trim();
  const g = String(filtros?.grupoProduto ?? '').trim();
  const cat = String(filtros?.categoriaProduto ?? '').trim();
  const cdG = parseInt(filtros?.cdGrupo, 10);
  const cdC = parseInt(filtros?.cdCategoria, 10);
  const cons = Array.isArray(filtros?.conservacao) ? filtros.conservacao.filter(Boolean) : [];
  if (!c && !d && !g && !cat && !cons.length && !(cdG > 0) && !(cdC > 0)) return '';
  const parts = [];
  if (c) parts.push(`Código contém: ${c}`);
  if (d) parts.push(`Descrição contém: ${d}`);
  if (cdG > 0) parts.push(`Grupo #${cdG}${g ? ' (' + g + ')' : ''}`);
  else if (g) parts.push(`Grupo contém: ${g}`);
  if (cdC > 0) parts.push(`Categoria #${cdC}${cat ? ' (' + cat + ')' : ''}`);
  else if (cat) parts.push(`Categoria contém: ${cat}`);
  if (cons.length) {
    parts.push(`Conservação: ${cons.map((b) => rotuloBucket(b)).join(', ')}`);
  }
  return parts.join(' · ');
}

function parseConservacaoRaw(raw) {
  if (raw == null) return [];
  let arr = [];
  if (Array.isArray(raw)) arr = raw;
  else arr = String(raw).split(/[,;|\s]+/);
  const out = [];
  const seen = new Set();
  for (const item of arr) {
    const u = String(item || '').trim().toUpperCase();
    if (!u) continue;
    let bucket = '';
    if (u === 'SECO' || u === 'SECO_AMB' || u === 'AMBIENTE') bucket = 'SECO';
    else if (u === 'REFRIGERADO' || u === 'REFRIG' || u === 'RESFRIADO') bucket = 'REFRIGERADO';
    else if (u === 'CONGELADO' || u === 'CONG') bucket = 'CONGELADO';
    else if (u === 'OUTRO' || u === 'OUTROS' || u === 'SEM' || u === 'SEM_CADASTRO') bucket = 'OUTRO';
    else continue;
    if (!seen.has(bucket)) {
      seen.add(bucket);
      out.push(bucket);
    }
  }
  return out;
}

function normalizarFiltrosProdutoQuery(query) {
  const cod = String(query?.codigoProduto ?? query?.codigo_produto ?? '').trim();
  const desc = String(
    query?.descricaoProduto ?? query?.descricao_produto ?? query?.nmProduto ?? query?.nm_produto ?? ''
  ).trim();
  const cons = parseConservacaoRaw(
    query?.conservacao ?? query?.tpConservacao ?? query?.tp_conservacao ?? query?.tipoConservacao
  );
  const grupo = String(
    query?.grupoProduto ?? query?.grupo_produto ?? query?.grupo ?? ''
  ).trim();
  const categoria = String(
    query?.categoriaProduto ??
      query?.categoria_produto ??
      query?.subcategoria ??
      query?.categoria ??
      ''
  ).trim();
  const cdGrupo = parseInt(query?.cdGrupo ?? query?.cd_grupo ?? query?.CD_GRUPO, 10);
  const cdCategoria = parseInt(
    query?.cdCategoria ?? query?.cd_categoria ?? query?.CD_CATEGORIA,
    10
  );
  return {
    codigoProduto: cod || null,
    descricaoProduto: desc || null,
    conservacao: cons,
    grupoProduto: grupo || null,
    categoriaProduto: categoria || null,
    cdGrupo: Number.isFinite(cdGrupo) && cdGrupo > 0 ? cdGrupo : null,
    cdCategoria: Number.isFinite(cdCategoria) && cdCategoria > 0 ? cdCategoria : null,
  };
}

module.exports = {
  filtrarLinhasPorProduto,
  filtrarLinhasPorGrupoCategoria,
  montarRotuloFiltroProduto,
  normalizarFiltrosProdutoQuery,
  bucketConservacao,
  bucketLinhaRelatorio,
  rotuloBucket,
  TIPOS_CONSERVACAO_CONHECIDOS,
};
