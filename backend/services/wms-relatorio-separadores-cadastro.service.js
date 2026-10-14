'use strict';

/** Separadores de lista (faixas ▌) alinhados ao romaneio de separação — cadastro WMS. */

function niveisCategoriaWms(cad) {
  const full = cad && (cad.NM_CATEGORIA || '').trim() ? String(cad.NM_CATEGORIA).trim() : '';
  const grupo = cad && (cad.NM_GRUPO || '').trim() ? String(cad.NM_GRUPO).trim() : '';
  const sep = full.indexOf(' › ');
  const nv3 = sep >= 0 ? full.slice(0, sep).trim() : full;
  const nv4 = sep >= 0 ? full.slice(sep + 3).trim() : '';
  return { grupo, nv3, nv4, full };
}

function rotuloGrupoWms(cad) {
  const { grupo } = niveisCategoriaWms(cad || {});
  return grupo || 'Sem grupo';
}

function rotuloSubcategoriaWms(cad) {
  const { nv3, full } = niveisCategoriaWms(cad || {});
  if (nv3) return nv3;
  if (full) return full;
  return 'Sem categoria';
}

function rotuloGrupoRomaneioN23(cad) {
  const { grupo, nv3 } = niveisCategoriaWms(cad || {});
  if (!grupo && !nv3) return 'Sem categoria';
  if (grupo && nv3 && grupo.localeCompare(nv3, 'pt-BR', { sensitivity: 'base' }) !== 0) {
    return `${grupo} › ${nv3}`;
  }
  return grupo || nv3;
}

function chaveGrupoRomaneioN23(cad) {
  const { grupo, nv3 } = niveisCategoriaWms(cad || {});
  return `${grupo}\u0001${nv3}`;
}

function classificarDetalheConservacao(descricao, cad) {
  const t = String((cad && cad.TIPO_ARMAZENAGEM) || '').toUpperCase();
  if (t.includes('CONGEL')) return { bucket: 'REFRIG_CONG', frioTipo: 'CONGELADO' };
  if (t.includes('REFRIG')) return { bucket: 'REFRIG_CONG', frioTipo: 'RESFRIADO' };
  const u = String(descricao || '').toUpperCase();
  if (/CONGEL/i.test(u)) return { bucket: 'REFRIG_CONG', frioTipo: 'CONGELADO' };
  if (/REFRIGERAD|RESFRI/i.test(u)) return { bucket: 'REFRIG_CONG', frioTipo: 'RESFRIADO' };
  return { bucket: 'SECO_AMB', frioTipo: null };
}

function chaveConservacaoLinha(linha) {
  if (!linha || linha._bucket !== 'REFRIG_CONG') return '0';
  if (linha._frioTipo === 'CONGELADO') return '2';
  if (linha._frioTipo === 'RESFRIADO') return '1';
  const t = linha._cadWms && String(linha._cadWms.TIPO_ARMAZENAGEM || '').toUpperCase();
  if (t.includes('CONGEL')) return '2';
  return '1';
}

function rotuloConservacaoSeparador(linha, abreviado) {
  if (!linha || linha._bucket !== 'REFRIG_CONG') return 'SECO';
  if (linha._frioTipo === 'CONGELADO') return abreviado ? 'CONG.' : 'CONGELADO';
  if (linha._frioTipo === 'RESFRIADO') return abreviado ? 'REFRIG.' : 'REFRIGERADO';
  const t = linha._cadWms && (linha._cadWms.TIPO_ARMAZENAGEM || '').trim();
  if (t) {
    const u = t.toUpperCase();
    if (u.includes('CONGEL')) return abreviado ? 'CONG.' : 'CONGELADO';
    return abreviado ? 'REFRIG.' : t;
  }
  return abreviado ? 'REFRIG.' : 'REFRIGERADO / CONGELADO';
}

function rotuloClasseRomaneioN23(linha) {
  const t = rotuloConservacaoSeparador(linha, false);
  const g = rotuloGrupoRomaneioN23(linha && linha._cadWms);
  return g && g !== 'Sem categoria' ? `${t} / ${g}` : t;
}

const CAMPOS_QUEBRA = new Set([
  'conservacao',
  'conservacao_faixas',
  'grupo',
  'subcategoria',
  'categoria',
  'classe',
  'codigo',
  'lote',
  'validade',
]);

/** Campos aceitos na ordenação (inclui quebra + nome/saldo). */
const CAMPOS_ORDENACAO = new Set([...CAMPOS_QUEBRA, 'nome', 'saldo']);

const MODOS_SEPARADORES_FIXOS = new Set([
  'faixas_cons',
  'conservacao',
  'cons_grupo',
  'cons_grupo_cat',
  'sim',
]);

function normalizarModoSeparadores(modo) {
  const m = String(modo || 'nao').toLowerCase();
  if (m === 'faixas' || m === 'cons_faixas' || m === 'só_faixas') return 'faixas_cons';
  if (m === 'cons' || m === 'conservacao') return 'conservacao';
  if (m === 'conservacao_grupo' || m === 'cons+grupo') return 'cons_grupo';
  if (m === 'conservacao_grupo_categoria' || m === 'cons+grupo+cat') return 'cons_grupo_cat';
  return m;
}

function resolverCamposQuebra(ordem, modoSeparadores) {
  const modo = normalizarModoSeparadores(modoSeparadores);
  if (modo === 'nao') return [];
  if (modo === 'faixas_cons') return ['conservacao_faixas'];
  if (modo === 'conservacao') return ['conservacao'];
  if (modo === 'cons_grupo') return ['conservacao', 'grupo'];
  if (modo === 'cons_grupo_cat') return ['conservacao', 'grupo', 'subcategoria'];
  let list = (Array.isArray(ordem) ? ordem : []).filter((c) => CAMPOS_QUEBRA.has(c));
  if (list.includes('classe')) {
    list = list.filter((c) => c !== 'conservacao' && c !== 'categoria');
  }
  if (!list.length && modo === 'sim') list = ['classe'];
  return list;
}

function enriquecerOrdemParaSeparadores(ordem, camposQuebra, modoSeparadores) {
  const modo = normalizarModoSeparadores(modoSeparadores);
  if (!MODOS_SEPARADORES_FIXOS.has(modo) || !camposQuebra.length) {
    return ordem && ordem.length ? ordem : ['conservacao', 'grupo', 'subcategoria', 'codigo', 'lote', 'validade'];
  }
  const base = Array.isArray(ordem) ? ordem.filter(Boolean) : [];
  const usaGrupoWms = camposQuebra.includes('grupo') || camposQuebra.includes('subcategoria');
  const camposInjetados = new Set(
    camposQuebra.flatMap((c) => (c === 'conservacao_faixas' ? ['conservacao'] : [c]))
  );
  const resto = base.filter(
    (c) =>
      !camposInjetados.has(c) &&
      !(usaGrupoWms && (c === 'categoria' || c === 'classe'))
  );
  const injetar = [...camposInjetados].filter(Boolean);
  return [...injetar, ...resto];
}

function valorOrdemLinhaSaldo(linha, campo) {
  if (campo === 'conservacao' || campo === 'conservacao_faixas') return chaveConservacaoLinha(linha);
  if (campo === 'grupo') return rotuloGrupoWms(linha && linha._cadWms);
  if (campo === 'subcategoria') return rotuloSubcategoriaWms(linha && linha._cadWms);
  if (campo === 'categoria') return chaveGrupoRomaneioN23(linha && linha._cadWms);
  if (campo === 'classe') {
    const cons = linha && linha._bucket === 'REFRIG_CONG' ? '1' : '2';
    return `${cons}\u0001${chaveGrupoRomaneioN23(linha && linha._cadWms)}`;
  }
  if (campo === 'codigo') return linha ? linha.CODIGO_PRODUTO || '' : '';
  if (campo === 'nome') return linha ? linha.NM_PRODUTO || '' : '';
  if (campo === 'lote') return linha ? linha.LOTE || '' : '';
  if (campo === 'validade') return linha ? linha.VALIDADE || '' : '';
  if (campo === 'saldo') {
    const n = Number(
      linha &&
        (linha.QTD_SALDO_SKU ??
          linha.QTD_SISTEMA_SNAPSHOT ??
          linha.QTD_SISTEMA ??
          linha.QTD_ENTRADA ??
          0)
    );
    return Number.isFinite(n) ? n : 0;
  }
  return '';
}

function cmpText(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'pt-BR', { sensitivity: 'base' });
}

function cmpCampoOrdem(a, b, campo) {
  if (campo === 'saldo') {
    const na = Number(valorOrdemLinhaSaldo(a, campo)) || 0;
    const nb = Number(valorOrdemLinhaSaldo(b, campo)) || 0;
    if (na !== nb) return na - nb;
    return 0;
  }
  return cmpText(valorOrdemLinhaSaldo(a, campo), valorOrdemLinhaSaldo(b, campo));
}

function parseOrdemQuery(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s).trim()).filter(Boolean);
  }
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function rotuloOrdemCampos(ordem) {
  const rotulos = {
    conservacao: 'Conservação',
    conservacao_faixas: 'Faixas SECO/REFRIG/CONG',
    grupo: 'Grupo',
    subcategoria: 'Categoria',
    categoria: 'Categoria WMS',
    classe: 'Classe',
    codigo: 'Código',
    nome: 'Descrição',
    lote: 'Lote',
    validade: 'Validade',
    saldo: 'Saldo',
  };
  const list = Array.isArray(ordem) ? ordem : [];
  if (!list.length) return '';
  return list.map((c) => rotulos[c] || c).join(' → ');
}

function ordenarLinhasSaldo(linhas, ordem, modoSeparadores) {
  const modo = normalizarModoSeparadores(modoSeparadores);
  const camposQuebra = resolverCamposQuebra(ordem, modo);
  const ordemPadrao = ['conservacao', 'grupo', 'subcategoria', 'codigo', 'lote', 'validade'];
  const ordemBase = ordem && ordem.length ? ordem : ordemPadrao;
  const ordemSort = enriquecerOrdemParaSeparadores(ordemBase, camposQuebra, modo);
  return [...(linhas || [])].sort((a, b) => {
    for (const campo of ordemSort) {
      if (!CAMPOS_ORDENACAO.has(campo)) continue;
      const c = cmpCampoOrdem(a, b, campo);
      if (c !== 0) return c;
    }
    return cmpText(a.CODIGO_PRODUTO, b.CODIGO_PRODUTO);
  });
}

function chaveSeparadorLinha(linha, camposQuebra) {
  return camposQuebra.map((c) => valorOrdemLinhaSaldo(linha, c)).join('\u0001');
}

function rotuloSeparadorGrupo(linha, camposQuebra) {
  const partes = [];
  for (const c of camposQuebra) {
    if (c === 'conservacao') partes.push(rotuloConservacaoSeparador(linha, false));
    else if (c === 'conservacao_faixas') partes.push(rotuloConservacaoSeparador(linha, true));
    else if (c === 'grupo') partes.push(rotuloGrupoWms(linha && linha._cadWms));
    else if (c === 'subcategoria') partes.push(rotuloSubcategoriaWms(linha && linha._cadWms));
    else if (c === 'categoria') partes.push(rotuloGrupoRomaneioN23(linha && linha._cadWms));
    else if (c === 'classe') partes.push(rotuloClasseRomaneioN23(linha));
  }
  return partes.filter(Boolean).join(' — ') || '—';
}

function rotuloModoSeparadores(modoSeparadores, camposQuebra) {
  const modo = normalizarModoSeparadores(modoSeparadores);
  if (modo === 'nao' || !camposQuebra.length) return '';
  const rotulos = {
    conservacao: 'Conservação',
    conservacao_faixas: 'Faixas SECO/REFRIG/CONG',
    grupo: 'Grupo',
    subcategoria: 'Categoria',
    categoria: 'Categoria WMS',
    classe: 'Classe',
  };
  if (modo === 'faixas_cons') return 'Faixas SECO/REFRIG./CONG.';
  if (modo === 'conservacao') return 'Conservação';
  if (modo === 'cons_grupo') return 'Conservação + Grupo';
  if (modo === 'cons_grupo_cat') return 'Conservação + Grupo + Categoria';
  return camposQuebra.map((c) => rotulos[c] || c).join(', ');
}

module.exports = {
  classificarDetalheConservacao,
  normalizarModoSeparadores,
  resolverCamposQuebra,
  ordenarLinhasSaldo,
  chaveSeparadorLinha,
  rotuloSeparadorGrupo,
  rotuloModoSeparadores,
  parseOrdemQuery,
  rotuloOrdemCampos,
  CAMPOS_ORDENACAO,
};
