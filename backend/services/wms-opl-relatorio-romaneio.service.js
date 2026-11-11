'use strict';

const { inferirConservacaoPorNome } = require('../utils/wms-conservacao-ol');

/**
 * Monta HTML imprimível estilo romaneio (separação / conferência), A4 vertical, alinhado ao modelo operacional Mana.
 * Conservação (romaneio): NCM do cadastro → tipo frio no cadastro → heurística na descrição → SECO.
 * Cadastro com TIPO=SECO não “puxa” linguiça/frango etc. para o romaneio seco se NCM ou descrição indicarem frio.
 */

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Corrige nome de arquivo UTF-8 lido como Latin-1 (ex.: no romaneio, registros antigos). */
function corrigirNomeArquivoExibicao(name) {
  if (name == null || typeof name !== 'string') return '';
  const s = name;
  if (/Ã.|Â./.test(s)) {
    try {
      const fixed = Buffer.from(s, 'latin1').toString('utf8');
      if (fixed && !/\uFFFD/.test(fixed)) return fixed;
    } catch (_) {}
  }
  return s;
}

/**
 * Código OL Mana / Teknisa: 10 caracteres alfanuméricos → máscara d.dd.dd.ddd.dd
 * Ex.: 6010305100 → 6.01.03.051.00 / 63109100AA → 6.31.09.100.AA
 * Se não tiver exatamente 10 caracteres alfanuméricos, devolve o valor original (sem máscara).
 */
function mascaraCodigoOl(cod) {
  const original = String(cod != null ? cod : '').trim();
  if (!original) return '';
  const raw = original.replace(/[^0-9A-Za-z]/g, '');
  if (raw.length !== 10) return original;
  return `${raw[0]}.${raw.slice(1, 3)}.${raw.slice(3, 5)}.${raw.slice(5, 8)}.${raw.slice(8, 10)}`;
}

function dadosJsonPedido(p) {
  const dj = p.DADOS_JSON ?? p.dados_json;
  if (dj == null) return {};
  if (typeof dj === 'string') {
    try {
      return JSON.parse(dj);
    } catch (_) {
      return {};
    }
  }
  return typeof dj === 'object' && !Array.isArray(dj) ? dj : {};
}

function dadosJsonItem(it) {
  const dj = it && (it.DADOS_JSON ?? it.dados_json);
  if (dj == null) return {};
  if (typeof dj === 'string') {
    try {
      return JSON.parse(dj);
    } catch (_) {
      return {};
    }
  }
  return typeof dj === 'object' && !Array.isArray(dj) ? dj : {};
}

/** Itens cancelados / substituídos não entram na listagem geral (visão de carga). */
function itemForaListagemGeral(it) {
  const d = dadosJsonItem(it);
  const motivo = String(d.motivoDiverg || d.MOTIVO_DIVERG || '')
    .trim()
    .toUpperCase();
  return motivo === 'CANCELADO_CLIENTE' || motivo === 'SUBSTITUIDO';
}

/** Qtd efetiva: coletada (ajustada) se já gravada; senão pedida. */
function qtdEfetivaListagemGeral(it) {
  const qc = parseQtdRomaneio(it && it.QT_COLETADA);
  if (qc != null) return qc;
  return parseQtdRomaneio(it && it.QT_PEDIDA) || 0;
}

function fldLinha2(p, inicio1, tam) {
  const raw = p.LINHA2_RAW ?? p.linha2_raw ?? '';
  if (!raw) return '';
  const start = inicio1 - 1;
  const padded = raw.length < start + tam ? raw.padEnd(start + tam, ' ') : raw;
  return padded.slice(start, start + tam);
}

/** DATA_ENTREGA no tipo 2: pos. 276, 8 pos., DDMMAAAA (doc Teknisa). */
function formatarDDMMAAAA8(raw) {
  const s = raw != null ? String(raw).trim().replace(/\D/g, '') : '';
  if (s.length === 8) {
    const dd = parseInt(s.slice(0, 2), 10);
    const mm = parseInt(s.slice(2, 4), 10);
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
      return `${s.slice(0, 2)}/${s.slice(2, 4)}/${s.slice(4, 8)}`;
    }
  }
  return '';
}

/** DDMMAA (6) na pos. 178 — data do pedido no OPL. */
function formatarDDMMAA6(raw) {
  const s = raw != null ? String(raw).trim().replace(/\D/g, '') : '';
  if (s.length === 6) {
    const dd = parseInt(s.slice(0, 2), 10);
    const mm = parseInt(s.slice(2, 4), 10);
    const yy = parseInt(s.slice(4, 6), 10);
    if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && Number.isFinite(yy)) {
      const yyyy = yy <= 50 ? 2000 + yy : 1900 + yy;
      return `${s.slice(0, 2)}/${s.slice(2, 4)}/${yyyy}`;
    }
  }
  return '';
}

/** DATA_PEDIDO na tabela / linha 2: DDMMAA (6 dígitos). */
function formatarDataPedidoCol(p) {
  const col = (p.DATA_PEDIDO != null ? String(p.DATA_PEDIDO) : '').trim();
  const fromCol = formatarDDMMAA6(col);
  if (fromCol) return fromCol;
  return formatarDDMMAA6(fldLinha2(p, 178, 6));
}

/**
 * Extrai data de entrega do pedido OPL (tipo 2).
 * Prioridade: DADOS_JSON → pos. 276 (DDMMAAAA) → pos. 268 (DATA_NF) → varredura no trecho 250+ → DATA_PEDIDO (178).
 * @returns {{ data: string, fonte: string }}
 */
function extrairDataEntregaPedidoOpl(p) {
  const dj = dadosJsonPedido(p);
  const candJson = [
    dj.dataEntrega,
    dj.DATA_ENTREGA,
    dj.data_entrega,
  ];
  for (const c of candJson) {
    const f = formatarDDMMAAAA8(c);
    if (f) return { data: f, fonte: 'programacao' };
  }

  const from276 = formatarDDMMAAAA8(fldLinha2(p, 276, 8));
  if (from276) return { data: from276, fonte: 'programacao' };

  const from268 = formatarDDMMAAAA8(fldLinha2(p, 268, 8));
  if (from268) return { data: from268, fonte: 'data_nf' };

  const raw = p.LINHA2_RAW ?? p.linha2_raw ?? '';
  if (raw.length > 250) {
    const tail = raw.slice(249);
    const re = /\d{8}/g;
    let m;
    let lastValid = '';
    while ((m = re.exec(tail)) !== null) {
      const f = formatarDDMMAAAA8(m[0]);
      if (f) lastValid = f;
    }
    if (lastValid) return { data: lastValid, fonte: 'scan' };
  }

  const fromPed = formatarDataPedidoCol(p);
  if (fromPed) return { data: fromPed, fonte: 'data_pedido' };

  return { data: '', fonte: '' };
}

/** @deprecated use extrairDataEntregaPedidoOpl — mantém compatibilidade */
function formatarDataEntregaOuPedido(p) {
  return extrairDataEntregaPedidoOpl(p).data;
}

/**
 * Chave de match do código OL / NF / cadastro WMS.
 * Mantém dígitos + sufixo alfabético (AK, BE, AA…): 6.03.14.529.AK → 60314529AK.
 * Antes removia letras e colidia .AK com .BE / .DA (peso errado na carga).
 */
function digitosCodigoOl(cod) {
  return String(cod != null ? cod : '')
    .replace(/[^0-9A-Za-z]/g, '')
    .toUpperCase();
}

/** Variantes do código OL para cruzar espelho (TXT, 10 pos.) com cadastro mascarado.
 *  Padding 9↔10 só para chaves puramente numéricas — nunca entre .AK e .BE. */
function expandirChavesDigitosCodigoOl(cod) {
  const d = digitosCodigoOl(cod);
  if (!d) return [];
  const set = new Set([d]);
  if (/^\d+$/.test(d)) {
    if (d.length === 9) set.add(`${d}0`);
    if (d.length === 8) set.add(`${d}00`);
    if (d.length === 10 && d.endsWith('0')) set.add(d.slice(0, 9));
    if (d.length === 10 && d.endsWith('00')) set.add(d.slice(0, 8));
  }
  return Array.from(set);
}

/** Chave preferida na auditoria / mapa (forma mais completa entre as variantes). */
function chaveCanonicaDigitosOl(cod) {
  const vars = expandirChavesDigitosCodigoOl(cod);
  if (!vars.length) return '';
  return vars.slice().sort((a, b) => b.length - a.length)[0];
}

/** NCM (cap. 02/03) — carne/pescado in natura ou congelado.
 *  NÃO usar 1604 (preparações/conservas de peixe — enlatado = seco/ambiente). */
function classificarFrioPorNcm(ncmRaw) {
  const d = String(ncmRaw != null ? ncmRaw : '').replace(/\D/g, '');
  if (d.length < 4) return null;
  const p4 = d.slice(0, 4);
  const cong = ['0203', '0204', '0303', '0304'];
  const refri = ['0201', '0202', '0206', '0210', '0302', '0305', '0207', '0208'];
  if (cong.some((p) => p4.startsWith(p))) return 'CONGELADO';
  if (refri.some((p) => p4.startsWith(p))) return 'RESFRIADO';
  return null;
}

/** @param {string | null | undefined} tipo */
function bucketFromTipoArmazenagem(tipo) {
  const t = (tipo || '').toUpperCase().trim();
  if (!t) return null;
  if (t.includes('CONGEL')) return 'REFRIG_CONG';
  if (t.includes('REFRIG') || t.includes('RESFRI')) return 'REFRIG_CONG';
  if (t.includes('SECO') || t.includes('AMBIENT')) return 'SECO_AMB';
  return null;
}

/**
 * @param {string} descricao
 * @param {{ TIPO_ARMAZENAGEM?: string, NCM?: string } | null | undefined} cadProdutoDono
 * @returns {{ bucket: 'REFRIG_CONG' | 'SECO_AMB', frioTipo: 'CONGELADO' | 'RESFRIADO' | null }}
 */
function classificarConservacaoDetalhe(descricao, cadProdutoDono) {
  /** Cadastro explícito SECO/AMBIENTE prevalece sobre NCM enganoso (ex.: 1604 conserva). */
  const fromCad = cadProdutoDono && bucketFromTipoArmazenagem(cadProdutoDono.TIPO_ARMAZENAGEM);
  if (fromCad === 'SECO_AMB') return { bucket: 'SECO_AMB', frioTipo: null };

  const tipoNcm = cadProdutoDono && classificarFrioPorNcm(cadProdutoDono.NCM);
  if (tipoNcm) return { bucket: 'REFRIG_CONG', frioTipo: tipoNcm };

  if (fromCad === 'REFRIG_CONG') {
    const t = (cadProdutoDono.TIPO_ARMAZENAGEM || '').toUpperCase();
    const frioTipo = t.includes('CONGEL') ? 'CONGELADO' : 'RESFRIADO';
    return { bucket: 'REFRIG_CONG', frioTipo };
  }

  const u = (descricao || '').toUpperCase();
  if (/CONGEL|CONGELAD/i.test(u)) return { bucket: 'REFRIG_CONG', frioTipo: 'CONGELADO' };
  if (/REFRIGERAD|RESFRI/i.test(u)) return { bucket: 'REFRIG_CONG', frioTipo: 'RESFRIADO' };
  if (
    /\bFRANGO\b|\bPESCADA\b|\bLINGUICA\b|\bBACON\b|\bSALAME\b|\bMORTADELA\b|\bPRESUNTO\b|\bFILE\b|\bHAMBURGUER\b|\bHAMBÚRGUER\b/i.test(
      u
    )
  ) {
    return { bucket: 'REFRIG_CONG', frioTipo: 'RESFRIADO' };
  }

  /** Mesma heurística da importação OL (fresca, resfriado, refrigerante=seco, etc.). */
  const infNome = inferirConservacaoPorNome(descricao);
  if (infNome === 'CONGELADO') return { bucket: 'REFRIG_CONG', frioTipo: 'CONGELADO' };
  if (infNome === 'REFRIGERADO') return { bucket: 'REFRIG_CONG', frioTipo: 'RESFRIADO' };
  if (infNome === 'SECO') return { bucket: 'SECO_AMB', frioTipo: null };

  return { bucket: 'SECO_AMB', frioTipo: null };
}

/**
 * @param {string} descricao
 * @param {{ TIPO_ARMAZENAGEM?: string, NCM?: string } | null | undefined} cadProdutoDono
 * @returns {'REFRIG_CONG' | 'SECO_AMB'}
 */
function classificarConservacao(descricao, cadProdutoDono) {
  return classificarConservacaoDetalhe(descricao, cadProdutoDono).bucket;
}

function linhaPassaFiltroConservacao(conservacao, det) {
  if (!conservacao || conservacao === 'todos') return true;
  if (conservacao === 'seco') return det.bucket === 'SECO_AMB';
  if (conservacao === 'refri') return det.bucket === 'REFRIG_CONG';
  if (conservacao === 'refrigerado') {
    return det.bucket === 'REFRIG_CONG' && det.frioTipo !== 'CONGELADO';
  }
  if (conservacao === 'congelado') {
    return det.bucket === 'REFRIG_CONG' && det.frioTipo === 'CONGELADO';
  }
  return true;
}

/** Chave estável para filtro multi de conservação (alinhada aos separadores). */
function chaveConservacaoFiltro(det) {
  if (!det || det.bucket !== 'REFRIG_CONG') return 'SECO';
  if (det.frioTipo === 'CONGELADO') return 'CONGELADO';
  return 'REFRIGERADO';
}

/**
 * Opções distintas de conservação / grupo / categoria presentes no espelho
 * (para popular multi-selects de impressão específica).
 * Inclui `combinacoes` para filtro encadeado Conservação → Grupo → Categoria.
 * @param {Array} pedidos
 * @param {Record<string, object>} produtoPorDigitos
 */
function montarOpcoesFiltroRomaneioEspelho(pedidos, produtoPorDigitos) {
  const mapa = produtoPorDigitos && typeof produtoPorDigitos === 'object' ? produtoPorDigitos : {};
  const grupos = new Set();
  const categorias = new Set();
  const conservacoes = new Set();
  const comboSet = new Set();
  /** @type {{ conservacao: string, grupo: string, categoria: string }[]} */
  const combinacoes = [];
  for (const p of Array.isArray(pedidos) ? pedidos : []) {
    for (const it of Array.isArray(p.itens) ? p.itens : []) {
      const dkey = digitosCodigoOl(it.COD_PRODUTO_OL);
      const cad = dkey ? mapa[dkey] : null;
      const det = classificarConservacaoDetalhe(it.DESCRICAO || '', cad);
      const cons = chaveConservacaoFiltro(det);
      const grupo = rotuloGrupoWms(cad);
      const categoria = rotuloSubcategoriaWms(cad);
      conservacoes.add(cons);
      grupos.add(grupo);
      categorias.add(categoria);
      const ck = `${cons}\u0001${grupo}\u0001${categoria}`;
      if (!comboSet.has(ck)) {
        comboSet.add(ck);
        combinacoes.push({ conservacao: cons, grupo, categoria });
      }
    }
  }
  const cmp = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' });
  const ordemCons = { SECO: 0, REFRIGERADO: 1, CONGELADO: 2 };
  return {
    conservacoes: Array.from(conservacoes).sort(
      (a, b) => (ordemCons[a] != null ? ordemCons[a] : 9) - (ordemCons[b] != null ? ordemCons[b] : 9) || cmp(a, b)
    ),
    grupos: Array.from(grupos).sort(cmp),
    categorias: Array.from(categorias).sort(cmp),
    combinacoes,
  };
}

/**
 * Hierarquia OL no cadastro WMS:
 * - NM_GRUPO = nível 2 (classe → WMS_GRUPO_PRODUTO)
 * - NM_CATEGORIA = "nv3 › nv4" (grupo › família) — separadores usam só nv2 + nv3.
 */
function niveisCategoriaWms(cad) {
  const full = cad && (cad.NM_CATEGORIA || '').trim() ? String(cad.NM_CATEGORIA).trim() : '';
  const grupo = cad && (cad.NM_GRUPO || '').trim() ? String(cad.NM_GRUPO).trim() : '';
  const sep = full.indexOf(' › ');
  const nv3 = sep >= 0 ? full.slice(0, sep).trim() : full;
  const nv4 = sep >= 0 ? full.slice(sep + 3).trim() : '';
  return { grupo, nv3, nv4, full };
}

/** Chave de agrupamento/ordenação por grupo OL (nv2) + subgrupo (nv3), sem família (nv4). */
function chaveGrupoRomaneioN23(cad) {
  const { grupo, nv3 } = niveisCategoriaWms(cad || {});
  return `${grupo}\u0001${nv3}`;
}

/** Rótulo de faixa no romaneio: grupo (nv2) e subgrupo (nv3), sem família (nv4). */
function rotuloGrupoRomaneioN23(cad) {
  const { grupo, nv3 } = niveisCategoriaWms(cad || {});
  if (!grupo && !nv3) return 'Sem categoria';
  if (grupo && nv3 && grupo.localeCompare(nv3, 'pt-BR', { sensitivity: 'base' }) !== 0) {
    return `${grupo} › ${nv3}`;
  }
  return grupo || nv3;
}

/** Coluna romaneio / exibição: conservação + grupo OL (nv2–3), sem família nv4. */
function rotuloCadWms(cad) {
  if (!cad) return '—';
  const t = (cad.TIPO_ARMAZENAGEM || '').trim() || '—';
  const g = rotuloGrupoRomaneioN23(cad);
  return g !== 'Sem categoria' ? `${t} / ${g}` : t;
}

function rotuloClasseRomaneioN23(linha) {
  const t = rotuloConservacaoLinha(linha);
  const g = rotuloGrupoRomaneioN23(linha && linha._cadWms);
  return g && g !== 'Sem categoria' ? `${t} / ${g}` : t;
}

/** Rótulo de conservação para separadores (não para ordenação). */
function chaveConservacaoLinha(linha) {
  if (!linha || linha._bucket !== 'REFRIG_CONG') return '0';
  if (linha._frioTipo === 'CONGELADO') return '2';
  if (linha._frioTipo === 'RESFRIADO') return '1';
  const t = String((linha._cadWms && linha._cadWms.TIPO_ARMAZENAGEM) || '').toUpperCase();
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

function rotuloConservacaoLinha(linha) {
  return rotuloConservacaoSeparador(linha, false);
}

/** Rótulo só do grupo WMS (nv2 — ex.: CARNES, GENEROS). */
function rotuloGrupoWms(cad) {
  const { grupo } = niveisCategoriaWms(cad || {});
  return grupo || 'Sem grupo';
}

/** Rótulo só da categoria WMS (nv3 — subgrupo, sem família nv4). */
function rotuloSubcategoriaWms(cad) {
  const { nv3, full } = niveisCategoriaWms(cad || {});
  if (nv3) return nv3;
  if (full) return full;
  return 'Sem categoria';
}

const CAMPOS_QUEBRA_ROMANEIO = new Set([
  'conservacao',
  'conservacao_faixas',
  'grupo',
  'subcategoria',
  'categoria',
  'classe',
]);

/** Modos de separador com faixas fixas (independem da ordenação). */
const MODOS_SEPARADORES_FIXOS = new Set([
  'faixas_cons',
  'conservacao',
  'cons_grupo',
  'cons_grupo_cat',
  'sim',
]);

function normalizarModoSeparadores(modo) {
  const m = String(modo || 'auto').toLowerCase();
  if (m === 'faixas' || m === 'cons_faixas' || m === 'só_faixas') return 'faixas_cons';
  if (m === 'cons' || m === 'conservacao') return 'conservacao';
  if (m === 'conservacao_grupo' || m === 'cons+grupo') return 'cons_grupo';
  if (m === 'conservacao_grupo_categoria' || m === 'cons+grupo+cat') return 'cons_grupo_cat';
  return m;
}

/**
 * Campos que disparam linha separadora, na ordem da impressão.
 * Modos fixos usam cadastro WMS (grupo 601 CARNES… + categoria nv3).
 * Modo `auto` segue a ordenação (legado OL 2–3 via categoria/classe).
 */
function resolverCamposQuebraRomaneio(ordem, modoSeparadores) {
  const modo = normalizarModoSeparadores(modoSeparadores);
  if (modo === 'nao') return [];
  if (modo === 'faixas_cons') return ['conservacao_faixas'];
  if (modo === 'conservacao') return ['conservacao'];
  if (modo === 'cons_grupo') return ['conservacao', 'grupo'];
  if (modo === 'cons_grupo_cat') return ['conservacao', 'grupo', 'subcategoria'];
  let list = (Array.isArray(ordem) ? ordem : []).filter((c) => CAMPOS_QUEBRA_ROMANEIO.has(c));
  if (list.includes('classe')) {
    list = list.filter((c) => c !== 'conservacao' && c !== 'categoria');
  }
  if (!list.length && modo === 'sim') list = ['classe'];
  return list;
}

/** Garante que itens fiquem agrupados nas faixas dos separadores fixos (cadastro WMS). */
function enriquecerOrdemParaSeparadores(ordem, camposQuebra, modoSeparadores) {
  const modo = normalizarModoSeparadores(modoSeparadores);
  if (!MODOS_SEPARADORES_FIXOS.has(modo) || !camposQuebra.length) return ordem;
  const base = Array.isArray(ordem) ? ordem.filter(Boolean) : [];
  const topoFixo = ['unidade', 'destino'];
  let insertAt = 0;
  while (insertAt < base.length && topoFixo.includes(base[insertAt])) insertAt += 1;
  const usaGrupoWms = camposQuebra.includes('grupo') || camposQuebra.includes('subcategoria');
  const camposInjetados = new Set(
    camposQuebra.flatMap((c) => (c === 'conservacao_faixas' ? ['conservacao'] : [c]))
  );
  const resto = base
    .slice(insertAt)
    .filter(
      (c) =>
        !camposInjetados.has(c) &&
        !(usaGrupoWms && (c === 'categoria' || c === 'classe'))
    );
  const injetar = [...camposInjetados].filter((c) => !topoFixo.includes(c));
  return [...base.slice(0, insertAt), ...injetar, ...resto];
}

function chaveGrupoRomaneio(linha, camposQuebra) {
  return camposQuebra.map((c) => valorOrdemLinha(linha, c)).join('\u0001');
}

function rotuloSeparadorGrupo(linha, camposQuebra) {
  const partes = [];
  for (const c of camposQuebra) {
    if (c === 'conservacao') partes.push(rotuloConservacaoSeparador(linha, false));
    else if (c === 'conservacao_faixas') partes.push(rotuloConservacaoSeparador(linha, true));
    else if (c === 'grupo') partes.push(rotuloGrupoWms(linha && linha._cadWms));
    else if (c === 'subcategoria') partes.push(rotuloSubcategoriaWms(linha && linha._cadWms));
    else if (c === 'categoria') {
      partes.push(rotuloGrupoRomaneioN23(linha && linha._cadWms));
    } else if (c === 'classe') {
      partes.push(rotuloClasseRomaneioN23(linha));
    }
  }
  return partes.filter(Boolean).join(' — ') || '—';
}

function chaveDestinatario(p) {
  const cod = (p.COD_DESTINATARIO || '').trim();
  const cnpj = (p.CNPJ_DEST || '').replace(/\D/g, '');
  if (cod) return `C:${cod}`;
  if (cnpj) return `J:${cnpj}`;
  return `R:${(p.RAZ_SOC_DEST || '').trim()}|${(p.CIDADE_ENTREGA || '').trim()}|${(p.UF_ENTREGA || '').trim()}`;
}

function cmpText(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'pt-BR', { sensitivity: 'base' });
}

function valorOrdemBloco(bloco, campo) {
  const m = bloco && bloco.meta ? bloco.meta : {};
  if (campo === 'unidade') return [m.CIDADE_ENTREGA || '', m.UF_ENTREGA || ''].join(' ').trim();
  if (campo === 'destino') return [m.RAZ_SOC_DEST || '', m.COD_DESTINATARIO || ''].join(' ').trim();
  return '';
}

function valorOrdemLinha(linha, campo) {
  if (campo === 'classe') {
    const cons = linha && linha._bucket === 'REFRIG_CONG' ? '1' : '2';
    return `${cons}\u0001${chaveGrupoRomaneioN23(linha && linha._cadWms)}`;
  }
  if (campo === 'conservacao' || campo === 'conservacao_faixas') return chaveConservacaoLinha(linha);
  if (campo === 'grupo') return rotuloGrupoWms(linha && linha._cadWms);
  if (campo === 'subcategoria') return rotuloSubcategoriaWms(linha && linha._cadWms);
  if (campo === 'categoria') return chaveGrupoRomaneioN23(linha && linha._cadWms);
  if (campo === 'nome') return linha ? linha.DESCRICAO || '' : '';
  if (campo === 'codigo') return linha ? linha.COD_PRODUTO_OL || '' : '';
  if (campo === 'destino') return linha ? linha._destino || '' : '';
  if (campo === 'unidade') return linha ? linha._unidade || '' : '';
  return '';
}

/** UM operacional vinda do espelho TXT (campo explícito). Não inferir do cadastro nem da descrição. */
function unidadeOlDoArquivoTxt(item) {
  if (!item || typeof item !== 'object') return '';
  const u = item.UNIDADE_OL ?? item.UNIDADE ?? item.unidade ?? '';
  return String(u || '').trim().toUpperCase();
}

/** Inferência de unidade a partir da descrição OL (uso interno / cadastro; não no romaneio impresso). */
function inferirUnidadeDaDescricaoOl(descricao) {
  const s = String(descricao || '').trim();
  if (!s) return '';
  const tail = s.split('-').pop().trim();
  const mTail = tail.match(/^(CX|PC|PCT|PT|UN|FD|LA|GA|FR|KG)\b/i);
  if (mTail) return mTail[1].toUpperCase();
  const mMid = s.match(/\b(CX|PC|PCT|PT)\s+\d/i);
  if (mMid) return mMid[1].toUpperCase();
  return '';
}

/** Unidade operacional (cadastro/heurística) — não usada no romaneio de separação impresso. */
function resolverUnidadeRomaneioOl(codigoOl, descricao, unidadeOplPorDigitos) {
  const mapa = unidadeOplPorDigitos && typeof unidadeOplPorDigitos === 'object' ? unidadeOplPorDigitos : {};
  const d = digitosCodigoOl(codigoOl);
  if (d) {
    let hit = mapa[d];
    if (!hit) {
      for (const v of expandirChavesDigitosCodigoOl(d)) {
        if (mapa[v]) {
          hit = mapa[v];
          break;
        }
      }
    }
    if (hit && hit.UNIDADE) return String(hit.UNIDADE).trim().toUpperCase();
  }
  return inferirUnidadeDaDescricaoOl(descricao);
}

function tituloCelulaUnidadeRomaneio(codigoOl, unidade, unidadeOplPorDigitos) {
  const mapa = unidadeOplPorDigitos && typeof unidadeOplPorDigitos === 'object' ? unidadeOplPorDigitos : {};
  const d = digitosCodigoOl(codigoOl);
  let hit = d ? mapa[d] : null;
  if (!hit && d) {
    for (const v of expandirChavesDigitosCodigoOl(d)) {
      if (mapa[v]) {
        hit = mapa[v];
        break;
      }
    }
  }
  const f = hit && Number(hit.FATOR_CONVERSAO);
  if (Number.isFinite(f) && f > 1) {
    return `1 ${unidade} = ${f} un. de estoque (cadastro operacional)`;
  }
  return unidade ? `Unidade operacional: ${unidade}` : '';
}

function parseQtdRomaneio(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Qtd no romaneio: inteiro sem casas decimais; fracionário só quando necessário. */
function formatQtdRomaneio(v) {
  const n = typeof v === 'number' ? v : parseQtdRomaneio(v);
  if (n == null) return '';
  if (Math.abs(n - Math.round(n)) < 1e-6) return String(Math.round(n));
  const s = n.toFixed(6).replace(/\.?0+$/, '');
  return s;
}

/** Coletada gravada no WMS (picking) — prefixo * para não confundir com qtd pedida. Não vem do TXT. */
function formatQtdColetadaCelula(v) {
  const n = typeof v === 'number' ? v : parseQtdRomaneio(v);
  if (n == null) return '';
  return `*${formatQtdRomaneio(n)}`;
}

function acumularQtdColetada(total, linha) {
  const qc = parseQtdRomaneio(linha.QT_COLETADA);
  if (qc == null) return total;
  return total == null ? qc : total + qc;
}

/**
 * @param {Array<{ COD_PRODUTO_OL: string, DESCRICAO: string, QT_PEDIDA: any, QT_COLETADA?: any, NUM_PEDIDO?: string, DATA_ENTREGA?: string }>} linhas
 */
function agregarPorCodigo(linhas) {
  const map = new Map();
  for (const L of linhas) {
    const cod = (L.COD_PRODUTO_OL || '').trim();
    const key = cod || `__${(L.DESCRICAO || '').slice(0, 40)}`;
    const prev = map.get(key);
    const q = parseQtdRomaneio(L.QT_PEDIDA) || 0;
    if (!prev) {
      map.set(key, {
        COD_PRODUTO_OL: L.COD_PRODUTO_OL,
        DESCRICAO: L.DESCRICAO,
        QT_PEDIDA: q,
        QT_COLETADA: parseQtdRomaneio(L.QT_COLETADA),
        DATA_ENTREGA: L.DATA_ENTREGA || '',
        _cadWms: L._cadWms || null,
        _bucket: L._bucket || null,
        _frioTipo: L._frioTipo || null,
        _destino: L._destino || '',
        _unidade: L._unidade || '',
        UNIDADE_OL: L.UNIDADE_OL || '',
        _pedidos: new Set(L.NUM_PEDIDO ? [String(L.NUM_PEDIDO)] : []),
      });
    } else {
      prev.QT_PEDIDA += q;
      prev.QT_COLETADA = acumularQtdColetada(prev.QT_COLETADA, L);
      if (L.NUM_PEDIDO) prev._pedidos.add(String(L.NUM_PEDIDO));
      if (!prev.DATA_ENTREGA && L.DATA_ENTREGA) prev.DATA_ENTREGA = L.DATA_ENTREGA;
      if (!prev._cadWms && L._cadWms) prev._cadWms = L._cadWms;
      if (!prev._bucket && L._bucket) prev._bucket = L._bucket;
      if (!prev._frioTipo && L._frioTipo) prev._frioTipo = L._frioTipo;
      if (!prev._destino && L._destino) prev._destino = L._destino;
      if (!prev._unidade && L._unidade) prev._unidade = L._unidade;
      if (!prev.UNIDADE_OL && L.UNIDADE_OL) prev.UNIDADE_OL = L.UNIDADE_OL;
    }
  }
  return Array.from(map.values()).map((r) => ({
    COD_PRODUTO_OL: r.COD_PRODUTO_OL,
    DESCRICAO: r.DESCRICAO,
    QT_PEDIDA: r.QT_PEDIDA,
    QT_COLETADA: r.QT_COLETADA,
    DATA_ENTREGA: r.DATA_ENTREGA || '',
    NUM_PEDIDO: Array.from(r._pedidos).sort().join(', '),
    _cadWms: r._cadWms || null,
    _bucket: r._bucket || null,
    _frioTipo: r._frioTipo || null,
    _destino: r._destino || '',
    _unidade: r._unidade || '',
    UNIDADE_OL: r.UNIDADE_OL || '',
  }));
}

/**
 * @param {{ arquivo: object, pedidos: object[] }} data
 * @param {{
 *   conservacao: string,
 *   agruparItens: boolean,
 *   folhasPorDestinatario: boolean,
 *   modoFolhas?: 'dest' | 'continuo' | 'geral',
 *   produtoPorDigitos?: Record<string, { TIPO_ARMAZENAGEM?: string, NM_CATEGORIA?: string }>,
 *   ordem?: string[],
 *   separadoresGrupo?: 'auto' | 'nao' | 'sim' | 'faixas_cons' | 'conservacao' | 'cons_grupo' | 'cons_grupo_cat',
 *   exibirColunaCad?: boolean,
 *   nrRotaPorChave?: Map<string, number|null>,
 * }} opts
 */
function buildRomaneioSeparacaoHtml(data, opts) {
  const arquivo = data.arquivo || {};
  const pedidos = Array.isArray(data.pedidos) ? data.pedidos : [];
  const conservacao = (opts.conservacao || 'todos').toLowerCase();
  const agruparItens = !!opts.agruparItens;
  const modoFolhasRaw = String(opts.modoFolhas || '').toLowerCase();
  const modoFolhas = ['dest', 'continuo', 'geral'].includes(modoFolhasRaw)
    ? modoFolhasRaw
    : opts.folhasPorDestinatario === false
      ? 'continuo'
      : 'dest';
  const folhasPorDestinatario = modoFolhas === 'dest';
  const listagemGeral = modoFolhas === 'geral';
  const carimboConferencia = opts.carimboConferencia !== false;
  const produtoPorDigitos = opts.produtoPorDigitos && typeof opts.produtoPorDigitos === 'object' ? opts.produtoPorDigitos : {};
  const nrRotaPorChave =
    opts.nrRotaPorChave instanceof Map
      ? opts.nrRotaPorChave
      : new Map(Object.entries(opts.nrRotaPorChave || {}));
  const ordemPadrao = ['unidade', 'destino', 'conservacao', 'grupo', 'nome', 'codigo'];
  const ordem = Array.isArray(opts.ordem) && opts.ordem.length ? opts.ordem : ordemPadrao;
  const modoSeparadores = normalizarModoSeparadores(opts.separadoresGrupo || 'auto');
  const camposQuebra = resolverCamposQuebraRomaneio(ordem, modoSeparadores);
  const ordemSort = enriquecerOrdemParaSeparadores(ordem, camposQuebra, modoSeparadores);
  const usarSeparadores =
    MODOS_SEPARADORES_FIXOS.has(modoSeparadores) ||
    (modoSeparadores === 'auto' && camposQuebra.length > 0);
  let exibirColunaCad = opts.exibirColunaCad;
  if (exibirColunaCad === undefined || exibirColunaCad === null) {
    exibirColunaCad = !usarSeparadores;
  } else {
    exibirColunaCad = !!exibirColunaCad;
  }

  /** Filtros opcionais para impressão específica (uma carga, alguns pedidos, etc.).
   *  - destinatarios: lista de COD_DESTINATARIO (string trim) — match exato
   *  - pedidos: lista de NUM_PEDIDO — match exato OU substring (caso usuário tenha digitado 33 e o pedido seja 0000000033)
   *  - unidades: lista de strings 'CIDADE|UF' (em CAIXA-ALTA) — match exato
   *  - codigoOl: substring (case-insensitive) que filtra itens dentro de cada pedido
   *  - conservacoes: SECO | REFRIGERADO | CONGELADO (faixas do cadastro/heurística)
   *  - grupos / categorias: rótulos WMS nv2 / nv3 (ex.: GENEROS, DESCARTAVEL) */
  const filtros = opts.filtros && typeof opts.filtros === 'object' ? opts.filtros : {};
  const filtroDestinatarios = new Set(
    (Array.isArray(filtros.destinatarios) ? filtros.destinatarios : [])
      .map((s) => String(s || '').trim())
      .filter(Boolean)
  );
  const filtroPedidos = (Array.isArray(filtros.pedidos) ? filtros.pedidos : [])
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  const filtroUnidades = new Set(
    (Array.isArray(filtros.unidades) ? filtros.unidades : [])
      .map((s) => String(s || '').trim().toUpperCase())
      .filter(Boolean)
  );
  const filtroCodigoOl = String(filtros.codigoOl || '').trim().toUpperCase();
  const filtroConservacoes = new Set(
    (Array.isArray(filtros.conservacoes) ? filtros.conservacoes : [])
      .map((s) => String(s || '').trim().toUpperCase())
      .filter(Boolean)
  );
  const filtroGrupos = new Set(
    (Array.isArray(filtros.grupos) ? filtros.grupos : [])
      .map((s) => String(s || '').trim())
      .filter(Boolean)
  );
  const filtroCategorias = new Set(
    (Array.isArray(filtros.categorias) ? filtros.categorias : [])
      .map((s) => String(s || '').trim())
      .filter(Boolean)
  );
  function setTemRotulo(set, rotulo) {
    if (!set.size) return true;
    const r = String(rotulo || '');
    if (set.has(r)) return true;
    for (const v of set) {
      if (String(v).localeCompare(r, 'pt-BR', { sensitivity: 'base' }) === 0) return true;
    }
    return false;
  }

  function pedidoCasaFiltro(p) {
    if (filtroDestinatarios.size > 0) {
      const cod = String(p.COD_DESTINATARIO || '').trim();
      if (!filtroDestinatarios.has(cod)) return false;
    }
    if (filtroUnidades.size > 0) {
      const u = [
        String(p.CIDADE_ENTREGA || '').trim().toUpperCase(),
        String(p.UF_ENTREGA || '').trim().toUpperCase(),
      ].join('|');
      if (!filtroUnidades.has(u)) return false;
    }
    if (filtroPedidos.length > 0) {
      const num = String(p.NUM_PEDIDO || '').trim();
      const numDig = num.replace(/\D/g, '');
      /** Aceita: exato, substring direta, ou comparação só com dígitos (sem zeros à esquerda).
       *  Ex.: usuário digita "33" → casa "0000000033", "33", "0033". */
      const casa = filtroPedidos.some((q) => {
        const qDig = q.replace(/\D/g, '');
        if (!qDig) return false;
        if (num === q) return true;
        if (num.indexOf(q) >= 0) return true;
        if (numDig === qDig) return true;
        if (numDig.replace(/^0+/, '') === qDig.replace(/^0+/, '')) return true;
        return false;
      });
      if (!casa) return false;
    }
    return true;
  }
  function itemCasaFiltroCodigo(it) {
    if (!filtroCodigoOl) return true;
    const cod = String(it.COD_PRODUTO_OL || '').toUpperCase();
    return cod.indexOf(filtroCodigoOl) >= 0;
  }

  function itemCasaFiltroCadastro(cad, detCons) {
    if (filtroConservacoes.size > 0 && !filtroConservacoes.has(chaveConservacaoFiltro(detCons))) {
      return false;
    }
    if (filtroGrupos.size > 0 && !setTemRotulo(filtroGrupos, rotuloGrupoWms(cad))) return false;
    if (filtroCategorias.size > 0 && !setTemRotulo(filtroCategorias, rotuloSubcategoriaWms(cad))) {
      return false;
    }
    return true;
  }

  /** Resumo legível dos filtros aplicados, para o operador identificar a impressão (auditoria). */
  function montarResumoFiltros() {
    const partes = [];
    if (filtroDestinatarios.size > 0) {
      const lista = Array.from(filtroDestinatarios).slice(0, 3).join(', ');
      const sufixo = filtroDestinatarios.size > 3 ? ` (+${filtroDestinatarios.size - 3})` : '';
      partes.push(`Destinatário(s): ${lista}${sufixo}`);
    }
    if (filtroPedidos.length > 0) {
      const lista = filtroPedidos.slice(0, 4).join(', ');
      const sufixo = filtroPedidos.length > 4 ? ` (+${filtroPedidos.length - 4})` : '';
      partes.push(`Pedido(s): ${lista}${sufixo}`);
    }
    if (filtroUnidades.size > 0) {
      const lista = Array.from(filtroUnidades)
        .slice(0, 2)
        .map((u) => u.replace('|', '/'))
        .join(', ');
      const sufixo = filtroUnidades.size > 2 ? ` (+${filtroUnidades.size - 2})` : '';
      partes.push(`Unidade(s): ${lista}${sufixo}`);
    }
    if (filtroCodigoOl) partes.push(`Código OL contém: ${filtroCodigoOl}`);
    if (filtroConservacoes.size > 0) {
      partes.push(`Conservação (filtro): ${Array.from(filtroConservacoes).join(', ')}`);
    }
    if (filtroGrupos.size > 0) {
      const lista = Array.from(filtroGrupos).slice(0, 4).join(', ');
      const sufixo = filtroGrupos.size > 4 ? ` (+${filtroGrupos.size - 4})` : '';
      partes.push(`Grupo(s): ${lista}${sufixo}`);
    }
    if (filtroCategorias.size > 0) {
      const lista = Array.from(filtroCategorias).slice(0, 4).join(', ');
      const sufixo = filtroCategorias.size > 4 ? ` (+${filtroCategorias.size - 4})` : '';
      partes.push(`Categoria(s): ${lista}${sufixo}`);
    }
    if (conservacao === 'seco') partes.push('Conservação: só seco / ambiente');
    else if (conservacao === 'refri') partes.push('Conservação: refrigerado + congelado');
    else if (conservacao === 'refrigerado') partes.push('Conservação: só refrigerado');
    else if (conservacao === 'congelado') partes.push('Conservação: só congelado');
    if (usarSeparadores) {
      const rotulosModo = {
        faixas_cons: 'Só faixas SECO/REFRIG./CONG.',
        conservacao: 'Conservação',
        cons_grupo: 'Conservação + Grupo (cadastro WMS)',
        cons_grupo_cat: 'Conservação + Grupo + Categoria (cadastro WMS)',
        sim: 'Grupo/subgrupo OL (legado)',
      };
      if (rotulosModo[modoSeparadores]) {
        partes.push(`Separadores: ${rotulosModo[modoSeparadores]}`);
      } else {
        const rotulos = {
          conservacao: 'conservação',
          grupo: 'grupo WMS',
          subcategoria: 'categoria WMS',
          categoria: 'grupo/subgrupo (OL 2–3)',
          classe: 'classe (OL 2–3)',
        };
        partes.push(`Separadores: ${camposQuebra.map((c) => rotulos[c] || c).join(', ')}`);
      }
    }
    if (exibirColunaCad) partes.push('Coluna Conserv./Categoria: sim');
    if (listagemGeral) {
      partes.push('Folhas: listagem geral consolidada (estilo Cargas)');
      partes.push('Linhas: somadas por código OL (todos os destinos)');
    }
    return partes.join(' · ');
  }
  const resumoFiltrosTexto = montarResumoFiltros();

  function nrRotaOrdenacao(meta) {
    const k = chaveDestinatario(meta);
    const nr = nrRotaPorChave.get(k);
    return nr != null && Number.isFinite(Number(nr)) ? Number(nr) : 99999;
  }

  const tituloCons =
    conservacao === 'refri'
      ? 'Refrigerado / Congelado'
      : conservacao === 'seco'
        ? 'Seco / Ambiente'
        : conservacao === 'refrigerado'
          ? 'Só refrigerado'
          : conservacao === 'congelado'
            ? 'Só congelado'
            : 'Todos os produtos';

  /** @type {Map<string, { meta: object, linhas: object[] }>} */
  const grupos = new Map();
  for (const p of pedidos) {
    if (!pedidoCasaFiltro(p)) continue;
    const k = chaveDestinatario(p);
    if (!grupos.has(k)) {
      grupos.set(k, {
        meta: p,
        linhas: [],
      });
    }
    const g = grupos.get(k);
    const itens = Array.isArray(p.itens) ? p.itens : [];
    for (const it of itens) {
      if (listagemGeral && itemForaListagemGeral(it)) continue;
      if (!itemCasaFiltroCodigo(it)) continue;
      const dkey = digitosCodigoOl(it.COD_PRODUTO_OL);
      const cad = dkey ? produtoPorDigitos[dkey] : null;
      const detCons = classificarConservacaoDetalhe(it.DESCRICAO || '', cad);
      if (!linhaPassaFiltroConservacao(conservacao, detCons)) continue;
      if (!itemCasaFiltroCadastro(cad, detCons)) continue;
      const entregaOpl = extrairDataEntregaPedidoOpl(p);
      const unidadeOl = unidadeOlDoArquivoTxt(it);
      let qtPedida = it.QT_PEDIDA;
      let qtColetada = it.QT_COLETADA;
      if (listagemGeral) {
        const qEf = qtdEfetivaListagemGeral(it);
        if (!(qEf > 0)) continue;
        qtPedida = qEf;
        qtColetada = null;
      }
      g.linhas.push({
        COD_PRODUTO_OL: it.COD_PRODUTO_OL,
        DESCRICAO: it.DESCRICAO,
        QT_PEDIDA: qtPedida,
        QT_COLETADA: qtColetada,
        NUM_PEDIDO: p.NUM_PEDIDO,
        DATA_ENTREGA: entregaOpl.data,
        UNIDADE_OL: unidadeOl,
        _fonteDataEntrega: entregaOpl.fonte,
        _bucket: detCons.bucket,
        _frioTipo: detCons.frioTipo,
        _destino: p.RAZ_SOC_DEST || '',
        _unidade: [p.CIDADE_ENTREGA, p.UF_ENTREGA].filter(Boolean).join(' ').trim(),
        _cadWms: cad || null,
      });
    }
  }

  const blocos = [];
  if (listagemGeral) {
    /** Uma única “folha”: soma por código OL em todos os destinatários (como Resumo de picking / Cargas). */
    const todas = [];
    for (const [, g] of grupos) {
      for (const L of g.linhas) todas.push(L);
    }
    let linhasOut = agregarPorCodigo(todas);
    linhasOut.sort((a, b) => {
      for (const campo of ordemSort) {
        const av = valorOrdemLinha(a, campo);
        const bv = valorOrdemLinha(b, campo);
        const c = cmpText(av, bv);
        if (c !== 0) return c;
      }
      return cmpText(a.COD_PRODUTO_OL || '', b.COD_PRODUTO_OL || '');
    });
    if (linhasOut.length) {
      blocos.push({
        meta: {
          COD_DESTINATARIO: '',
          RAZ_SOC_DEST: 'Listagem geral (todos os destinatários)',
          CIDADE_ENTREGA: '',
          UF_ENTREGA: '',
          ENDE_ENTREGA: '',
          BAIRRO_ENTREGA: '',
          CEP_ENTREGA: '',
        },
        linhas: linhasOut,
        _geral: true,
      });
    }
  } else {
    for (const [, g] of grupos) {
      if (!g.linhas.length) continue;
      let linhasOut = g.linhas;
      if (agruparItens) linhasOut = agregarPorCodigo(g.linhas);
      linhasOut.sort((a, b) => {
        for (const campo of ordemSort) {
          const av = valorOrdemLinha(a, campo);
          const bv = valorOrdemLinha(b, campo);
          const c = cmpText(av, bv);
          if (c !== 0) return c;
        }
        return cmpText(a.COD_PRODUTO_OL || '', b.COD_PRODUTO_OL || '');
      });
      blocos.push({ meta: g.meta, linhas: linhasOut });
    }
    blocos.sort((a, b) => {
      const dr = nrRotaOrdenacao(a.meta) - nrRotaOrdenacao(b.meta);
      if (dr !== 0) return dr;
      for (const campo of ordemSort) {
        const av = valorOrdemBloco(a, campo);
        const bv = valorOrdemBloco(b, campo);
        const c = cmpText(av, bv);
        if (c !== 0) return c;
      }
      return cmpText(a.meta.COD_DESTINATARIO || '', b.meta.COD_DESTINATARIO || '');
    });
  }

  const exibirColunaUnid = blocos.some((bl) =>
    bl.linhas.some((l) => String(l.UNIDADE_OL || '').trim())
  );
  const colCount = (exibirColunaCad ? 6 : 5) + (exibirColunaUnid ? 1 : 0);

  const hoje = new Date();
  const dataImp = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`;
  /** Data + hora da impressão. Importante para auditoria: identifica exatamente
   *  qual gerou aquele papel quando há várias impressões do mesmo espelho ao longo do dia. */
  const dhImpressao = `${dataImp} ${String(hoje.getHours()).padStart(2, '0')}:${String(hoje.getMinutes()).padStart(2, '0')}`;

  function buildRodapeDestinosGeralHtml() {
    const byCity = new Map();
    for (const [, g] of grupos) {
      if (!g.linhas.length) continue;
      const pm = g.meta || {};
      const city = [pm.CIDADE_ENTREGA, pm.UF_ENTREGA].filter(Boolean).join(' / ').trim() || '(Sem cidade)';
      const cod = String(pm.COD_DESTINATARIO || '').trim();
      const raz = String(pm.RAZ_SOC_DEST || '').trim();
      const label = [cod, raz].filter(Boolean).join(' — ') || '(sem destino)';
      if (!byCity.has(city)) byCity.set(city, []);
      const arr = byCity.get(city);
      if (arr.indexOf(label) === -1) arr.push(label);
    }
    if (!byCity.size) return '';
    let html =
      '<div class="rom-geral-rota"><div class="rom-geral-hr">================================================================</div>';
    html += `<div class="rom-geral-rota-tit">Destinos do espelho (por cidade) — ${esc(dhImpressao)}</div>`;
    html += '<div class="rom-geral-hr">================================================================</div>';
    html += '<div class="rom-geral-cidades">';
    for (const [city, units] of byCity) {
      html += `<div class="rom-geral-cid"><strong>${esc(city)}</strong>`;
      if (units.length) {
        html += '<ul>';
        for (const u of units) html += `<li>${esc(u)}</li>`;
        html += '</ul>';
      }
      html += '</div>';
    }
    html += '</div><div class="rom-geral-hr">================================================================</div></div>';
    return html;
  }

  const sheets = [];
  let page = 0;

  if (listagemGeral) {
    const bl = blocos[0];
    const linhasG = bl ? bl.linhas : [];
    const donoLbl =
      arquivo.CD_DONO != null && arquivo.CD_DONO !== ''
        ? `Dono do estoque: ${arquivo.CD_DONO}${arquivo.NM_DONO ? ' — ' + arquivo.NM_DONO : ''}`
        : arquivo.CLI_NOME
          ? `Cliente / dono: ${arquivo.CLI_NOME}`
          : 'Dono do estoque: —';

    function mkRowsGeral(linhasSec) {
      let rows = '';
      let chaveGrupoAnterior = null;
      let vol = 0;
      for (const it of linhasSec) {
        if (usarSeparadores && camposQuebra.length) {
          const chaveAtual = chaveGrupoRomaneio(it, camposQuebra);
          if (chaveAtual !== chaveGrupoAnterior) {
            const rotuloGrp = rotuloSeparadorGrupo(it, camposQuebra);
            const span = 3 + (exibirColunaUnid ? 1 : 0);
            rows += `<tr class="rom-grp-sep">
        <td colspan="${span}"><span class="rom-grp-bullet" aria-hidden="true">▌</span>${esc(rotuloGrp)}</td>
      </tr>`;
            chaveGrupoAnterior = chaveAtual;
          }
        }
        const qpR = parseQtdRomaneio(it.QT_PEDIDA) || 0;
        vol += qpR;
        const unidOl = String(it.UNIDADE_OL || '').trim();
        const unidCell = exibirColunaUnid
          ? `<td class="rom-unid cen">${unidOl ? esc(unidOl) : ''}</td>`
          : '';
        rows += `<tr>
        <td>${esc(mascaraCodigoOl(it.COD_PRODUTO_OL))}</td>
        <td>${esc(it.DESCRICAO)}</td>
        ${unidCell}
        <td class="num">${esc(formatQtdRomaneio(qpR))}</td>
      </tr>`;
      }
      return { rows, vol };
    }

    function secaoConservacao(titulo, pred) {
      const linhasSec = linhasG.filter(pred);
      if (!linhasSec.length) return { html: '', vol: 0 };
      const inner = mkRowsGeral(linhasSec);
      const thUnid = exibirColunaUnid ? '<th style="width:10%" class="cen">Unid.</th>' : '';
      const html = `<div class="rom-geral-bloco">
  <h2 class="rom-geral-tit-sec">${esc(titulo)}</h2>
  <table class="rom-tbl rom-tbl-geral">
    <thead><tr>
      <th style="width:14%">Código</th>
      <th>Descrição</th>
      ${thUnid}
      <th style="width:12%" class="num">Volumes</th>
    </tr></thead>
    <tbody>${inner.rows}</tbody>
  </table>
  <div class="rom-geral-tot"><strong>${esc(formatQtdRomaneio(inner.vol))} vol.</strong></div>
</div>`;
      return { html, vol: inner.vol };
    }

    const showRef =
      conservacao === 'todos' ||
      conservacao === 'refri' ||
      conservacao === 'refrigerado' ||
      conservacao === 'congelado';
    const showSeco = conservacao === 'todos' || conservacao === 'seco';

    let bodyTipo = '';
    let totVol = 0;
    if (showRef) {
      const r = secaoConservacao('RESFRIADO / CONGELADO', (L) => L._bucket === 'REFRIG_CONG');
      bodyTipo += r.html;
      totVol += r.vol;
    }
    if (showSeco) {
      const s = secaoConservacao('SECO', (L) => L._bucket === 'SECO_AMB');
      bodyTipo += s.html;
      totVol += s.vol;
    }
    if (!bodyTipo && linhasG.length) {
      const t = secaoConservacao(tituloCons || 'PRODUTOS', () => true);
      bodyTipo += t.html;
      totVol += t.vol;
    }
    if (!bodyTipo) {
      bodyTipo = `<p class="rom-geral-vazio">${
        resumoFiltrosTexto
          ? `Nenhuma linha para os filtros escolhidos.<br><small>${esc(resumoFiltrosTexto)}</small>`
          : 'Nenhuma linha para os filtros escolhidos.'
      }</p>`;
    }

    const rotaHtml = buildRodapeDestinosGeralHtml();
    const subt =
      `Conservação: ${tituloCons}` +
      ' · Folhas: listagem geral consolidada' +
      ' · Linhas: somadas por código OL' +
      ' · Cancelados/substituídos excluídos';

    sheets.push(`
<section class="romaneio-sheet romaneio-sheet-geral">
  <header class="rom-geral-hdr">
    <div class="rom-geral-hdr-l">GESTÃO DE ESTOQUE</div>
    <div class="rom-geral-hdr-m">Atlas Cargo</div>
    <div class="rom-geral-hdr-r">
      <div class="rom-geral-hdr-lbl">Espelho OPL</div>
      <div class="rom-geral-hdr-num">${esc(String(arquivo.CD_OPL_ARQUIVO || '—'))}</div>
    </div>
  </header>
  <h1 class="rom-geral-title">PICKING — Listagem geral (Separação OPL)</h1>
  <div class="rom-geral-subtit">${esc(subt)}</div>
  ${resumoFiltrosTexto ? `<div class="rom-filtros-aplicados"><strong>Impressão filtrada:</strong> ${esc(resumoFiltrosTexto)}</div>` : ''}
  <div class="rom-geral-meta">Impresso em: <strong>${esc(dhImpressao)}</strong></div>
  <div class="rom-geral-meta">${esc(corrigirNomeArquivoExibicao(arquivo.NM_ARQUIVO || ''))}</div>
  <div class="rom-geral-meta"><strong>${esc(donoLbl)}</strong></div>
  <div class="rom-geral-box">
    <div><strong>Conferência / Separação</strong></div>
    <div>Data: ___ / ___ / ______ &nbsp; Início: ___:___ &nbsp; Término: ___:___</div>
    <div>Responsável: ________________________________________________</div>
  </div>
  ${bodyTipo}
  ${
    totVol > 0
      ? `<div class="rom-geral-tot-geral"><strong>Total filtrado:</strong> ${esc(formatQtdRomaneio(totVol))} vol.</div>`
      : ''
  }
  ${rotaHtml}
  <footer class="rom-geral-foot">Listagem geral Separação OPL — visão consolidada antes/durante o picking</footer>
</section>`);
  } else {
  for (const bl of blocos) {
    page += 1;
    const p = bl.meta;
    const codDest = (p.COD_DESTINATARIO || '').trim();
    const tituloDest = [codDest, p.RAZ_SOC_DEST].filter(Boolean).join(' — ');
    const cidadeUf = [p.CIDADE_ENTREGA, p.UF_ENTREGA].filter(Boolean).join(' | ');
    const entrega0 = bl.linhas.find((x) => x.DATA_ENTREGA && String(x.DATA_ENTREGA).trim() !== '') || {};
    let dataEntrega = (entrega0.DATA_ENTREGA && String(entrega0.DATA_ENTREGA).trim()) || '';
    if (!dataEntrega) {
      dataEntrega = extrairDataEntregaPedidoOpl(p).data;
    }
    if (!dataEntrega) dataEntrega = '____/____/________';

    let rows = '';
    let chaveGrupoAnterior = null;
    for (const it of bl.linhas) {
      if (usarSeparadores && camposQuebra.length) {
        const chaveAtual = chaveGrupoRomaneio(it, camposQuebra);
        if (chaveAtual !== chaveGrupoAnterior) {
          const rotuloGrp = rotuloSeparadorGrupo(it, camposQuebra);
          rows += `<tr class="rom-grp-sep">
        <td colspan="${colCount}"><span class="rom-grp-bullet" aria-hidden="true">▌</span>${esc(rotuloGrp)}</td>
      </tr>`;
          chaveGrupoAnterior = chaveAtual;
        }
      }
      const qpR = parseQtdRomaneio(it.QT_PEDIDA);
      const qcRaw = parseQtdRomaneio(it.QT_COLETADA);
      const qcDiverge =
        qcRaw != null && (qpR == null || Math.abs(qcRaw - qpR) >= 1e-6);
      const qc = qcDiverge ? esc(formatQtdColetadaCelula(qcRaw)) : '';
      const colCad = exibirColunaCad
        ? `<td class="rom-cad">${esc(rotuloCadWms(it._cadWms))}</td>`
        : '';
      const unidOl = String(it.UNIDADE_OL || '').trim();
      const unidCell = exibirColunaUnid
        ? `<td class="rom-unid num">${unidOl ? esc(unidOl) : ''}</td>`
        : '';
      rows += `<tr>
        <td>${esc(mascaraCodigoOl(it.COD_PRODUTO_OL))}</td>
        <td>${esc(it.DESCRICAO)}</td>${colCad}
        ${unidCell}
        <td class="num">${esc(formatQtdRomaneio(qpR != null ? qpR : 0))}</td>
        <td class="num">${qc}</td>
        <td>${esc(it.NUM_PEDIDO || '')}</td>
      </tr>`;
    }

    const breakClass = folhasPorDestinatario && page < blocos.length ? ' sheet-break' : '';
    const nrRota = nrRotaPorChave.get(chaveDestinatario(p));
    const codDestLbl = (p.COD_DESTINATARIO || '').trim();
    const nrRotaLbl =
      nrRota != null && Number.isFinite(Number(nrRota))
        ? `<div class="rom-rota-badge">[ Rota de Entrega ${esc(String(nrRota))} ]</div>`
        : `<div class="rom-sem-rota" role="alert">⚠ Rota não encontrada — cadastre o ponto (cód. ${esc(codDestLbl || '—')}) em <strong>Cadastro Geral → Endereços de entrega</strong> com <em>NR_ROTA</em>, ou reimporte a planilha ROTAS.</div>`;
    const carimboHtml = carimboConferencia
      ? `<div class="rom-carimbo" aria-label="Preencher na conferência">
    ${nrRotaLbl}
    <div class="rom-carimbo-tit">Confirmação de Conferência</div>
    <div class="rom-carimbo-ln">Data: ____/____/________</div>
    <div class="rom-carimbo-ln">Nome: ____________________</div>
    <div class="rom-carimbo-ln">Caixa Plástica: ____________</div>
    <div class="rom-carimbo-ln">Pallet: ____________________</div>
    <div class="rom-carimbo-ln rom-entregar-ln">[ Entregar: <strong>${esc(dataEntrega)}</strong> ]</div>
  </div>`
      : '';
    /** Estrutura: <table> esqueleto com <thead> (cabeçalho repetido em CADA página da impressão)
     *  e <tbody> contendo a tabela de itens + rodapé. O navegador repete <thead> nativamente. */
    sheets.push(`
<section class="romaneio-sheet${breakClass}">
  <table class="rom-page-table">
    <thead class="rom-page-header">
      <tr>
        <td class="rom-page-header-cell">
          <div class="rom-hd-block">
            <div class="rom-tit">Separação / Conferência</div>
            <div class="rom-sub">Data: ____/____/________ &nbsp; Início: ___:___ &nbsp; Término: ___:___ &nbsp; Responsável: ________________________________</div>
            ${resumoFiltrosTexto ? `<div class="rom-filtros-aplicados"><strong>Impressão filtrada:</strong> ${esc(resumoFiltrosTexto)}</div>` : ''}
          </div>
          <div class="rom-info-row">
            <div class="rom-info-main">
              <div class="rom-cliente">${esc(arquivo.CLI_NOME || '')}</div>
              <div class="rom-picking">PICKING — Romaneio de Separação &nbsp; <span class="rom-cons">${esc(tituloCons)}</span></div>
              <div class="rom-arq">Impresso em ${esc(dhImpressao)} | ${esc(corrigirNomeArquivoExibicao(arquivo.NM_ARQUIVO || ''))}</div>
              <div class="rom-dest">
                <div><strong>${esc(tituloDest || 'Destinatário')}</strong></div>
                <div class="rom-dest-loc"><span class="lbl">Unidade:</span> ${esc(cidadeUf || '—')}</div>
                <div class="rom-dest-loc"><span class="lbl">Endereço:</span> ${esc(p.ENDE_ENTREGA || '')} ${esc(p.BAIRRO_ENTREGA || '')} ${esc(p.CEP_ENTREGA || '')}</div>
              </div>
            </div>
            ${carimboHtml}
          </div>
        </td>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="rom-page-body-cell">
          <table class="rom-tbl">
            <thead>
              <tr>
                <th style="width:11%">Código OL</th>
                <th>Descrição produto</th>
                ${
                  exibirColunaCad
                    ? '<th style="width:14%" title="Conservação do produto (cadastro) + categoria WMS">Conserv. / Categoria</th>'
                    : ''
                }
                ${
                  exibirColunaUnid
                    ? '<th style="width:6%" class="num" title="Unidade operacional informada no espelho TXT">Unid.</th>'
                    : ''
                }
                <th style="width:8%" class="num">Qtd pedida</th>
                <th style="width:8%" class="num" title="Só aparece quando o picking WMS diverge da qtd pedida (* = coletada diferente). Não vem do TXT.">Qtd coletada</th>
                <th style="width:11%">Nº pedido(s)</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </td>
      </tr>
    </tbody>
    <tfoot class="rom-page-footer">
      <tr>
        <td class="rom-page-footer-cell">
          <div class="rom-foot">
            <span>Nº Pallet: ________________</span>
            <span class="rom-foot-dest">${esc(tituloDest || 'Destinatário')}</span>
            <span class="rom-foot-impr">Impresso em ${esc(dhImpressao)}</span>
          </div>
        </td>
      </tr>
    </tfoot>
  </table>
</section>`);
  }
  }

  if (!sheets.length) {
    const aviso = resumoFiltrosTexto
      ? `Nenhuma linha para os filtros escolhidos. <br><small>${esc(resumoFiltrosTexto)}</small>`
      : 'Nenhuma linha para os filtros escolhidos (conservação / agrupamento).';
    sheets.push(`<section class="romaneio-sheet"><p>${aviso}</p></section>`);
  }

  /* Numeração física (1, 2, 3, ...) fica a cargo do diálogo de impressão do navegador
     (Ctrl+P → habilitar "Cabeçalhos e rodapés"). O Chrome não renderiza @page margin-boxes,
     então não inserimos rótulo "Folha N de Total" interno (evita confusão com a numeração do navegador). */
  const sheetsHtml = sheets.join('\n');

  const semRotaFolhas = listagemGeral
    ? []
    : blocos
        .filter((bl) => {
          const nr = nrRotaPorChave.get(chaveDestinatario(bl.meta));
          return nr == null || !Number.isFinite(Number(nr));
        })
        .map((bl) => {
          const m = bl.meta;
          const cod = (m.COD_DESTINATARIO || '').trim();
          const raz = (m.RAZ_SOC_DEST || '').trim();
          return `${cod ? cod + ' — ' : ''}${raz || '(sem nome)'}`;
        });
  const resumoSemRotaHtml =
    semRotaFolhas.length > 0
      ? `<section class="romaneio-sheet rom-resumo-sem-rota" style="border-color:#d97706">
  <h3 style="margin:0 0 8px;font-size:11pt">Destinatários sem rota no cadastro (${semRotaFolhas.length})</h3>
  <p style="margin:0 0 8px;font-size:9pt">Cadastre ou corrija em <strong>Gerenciar Cadastro Geral → Endereços de entrega</strong> (campo <em>NR_ROTA</em> e nome no padrão <code>… - CÓDIGO - NOME</code>).</p>
  <ul style="margin:0;padding-left:18px;font-size:9pt;columns:2">${semRotaFolhas.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
</section>`
      : '';

  const tituloDoc = listagemGeral
    ? `Listagem geral — ${arquivo.NM_ARQUIVO || 'OPL'}`
    : `Romaneio — ${arquivo.NM_ARQUIVO || 'OPL'}`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${esc(tituloDoc)}</title>
  <style>
    /* A numeração física (1 de 200, 2 de 200, ...) é fornecida pelo próprio diálogo de impressão
       do navegador quando o usuário habilita "Cabeçalhos e rodapés" (Ctrl+P → Mais configurações).
       O Chrome NÃO renderiza @page { @bottom-right { content: counter(page) } } em HTML imprimível,
       então deixamos a numeração a cargo do navegador e mantemos apenas o setup básico de página. */
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 12px; color: #111; font-size: 10pt; }
    /* Aviso de impressão exibido só na tela (não imprime): orienta a habilitar cabeçalho/rodapé. */
    .print-tip {
      position: sticky; top: 8px; z-index: 50; max-width: 190mm; margin: 0 auto 10px;
      background: #ecfdf5; border: 1px solid #10b981; color: #064e3b;
      padding: 10px 14px; border-radius: 8px; font-size: 10pt; line-height: 1.45;
      box-shadow: 0 2px 6px rgba(0,0,0,0.06);
    }
    .print-tip strong { color: #065f46; }
    .print-tip kbd {
      background: #fff; border: 1px solid #10b981; border-bottom-width: 2px;
      border-radius: 4px; padding: 1px 6px; font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 9pt; color: #064e3b;
    }
    .print-tip .print-tip-close {
      float: right; background: transparent; border: 0; color: #064e3b; font-size: 14pt;
      cursor: pointer; line-height: 1; padding: 0 4px; margin-left: 8px;
    }
    .print-tip-print-btn {
      background: #10b981; color: #fff; border: 0; border-radius: 4px;
      padding: 4px 12px; font-size: 9pt; cursor: pointer; margin-left: 8px; font-weight: 600;
    }
    .print-tip-print-btn:hover { background: #059669; }
    @media print { .print-tip { display: none !important; } }
    /** Cada destinatário começa em nova folha. Quando o conteúdo passa de uma página,
     *  o <thead> da rom-page-table é repetido pelo navegador (cabeçalho em todas as páginas). */
    .romaneio-sheet { max-width: 190mm; margin: 0 auto 14px; padding: 12px 10px; border: 1px solid #ccc; }
    .romaneio-sheet:not(:first-of-type) {
      break-before: page; page-break-before: always;
    }
    .sheet-break { break-after: page; page-break-after: always; }
    /** Esqueleto da folha: cabeçalho como <thead> (repete em cada página) + corpo como <tbody>. */
    .rom-page-table {
      width: 100%; border-collapse: collapse; table-layout: auto;
    }
    .rom-page-table > thead { display: table-header-group; }
    .rom-page-table > tbody { display: table-row-group; }
    .rom-page-table > tfoot { display: table-footer-group; }
    .rom-page-table > thead > tr > .rom-page-header-cell,
    .rom-page-table > tbody > tr > .rom-page-body-cell,
    .rom-page-table > tfoot > tr > .rom-page-footer-cell {
      padding: 0; border: 0; vertical-align: top;
    }
    @media print {
      body { padding: 0; margin: 0; font-size: 9.5pt; }
      .romaneio-sheet {
        max-width: none; margin: 0; border: none; padding: 0 2mm;
      }
      .romaneio-sheet:not(:first-of-type) {
        break-before: page; page-break-before: always;
      }
      .sheet-break { break-after: page; page-break-after: always; }
      /** Reforça os grupos de cabeçalho/rodapé no Chrome durante a impressão. */
      .rom-page-table > thead { display: table-header-group; }
      .rom-page-table > tfoot { display: table-footer-group; }
      .rom-page-header-cell { padding-bottom: 6px; }
      .rom-page-footer-cell { padding-top: 6px; }
    }
    .rom-hd-block { border-bottom: 2px solid #333; padding-bottom: 6px; margin-bottom: 8px; }
    .rom-tit { font-size: 12pt; font-weight: 700; }
    .rom-sub { font-size: 9pt; margin-top: 4px; color: #333; }
    .rom-filtros-aplicados {
      font-size: 8.5pt; margin-top: 4px; padding: 3px 6px;
      background: #fffbe6; border: 1px solid #f1c40f; border-radius: 3px;
      color: #6d4c00;
    }
    .rom-info-row {
      display: flex; flex-wrap: nowrap; align-items: flex-start; justify-content: space-between;
      gap: 10px; margin-bottom: 10px;
    }
    .rom-info-main { flex: 1 1 auto; min-width: 0; }
    .rom-carimbo {
      flex: 0 0 188px; width: 188px; max-width: 38%;
      border: 2px solid #2563eb; border-radius: 6px; padding: 8px 10px;
      font-size: 8.5pt; line-height: 1.45; background: #f8fafc;
    }
    .rom-rota-badge {
      font-weight: 700; font-size: 9pt; margin-bottom: 6px; text-align: center;
      color: #0f172a; letter-spacing: 0.02em;
    }
    .rom-sem-rota {
      font-size: 7.5pt; line-height: 1.35; margin-bottom: 6px; padding: 6px;
      background: #fef3c7; border: 1px solid #d97706; border-radius: 4px; color: #92400e;
      text-align: left;
    }
    .rom-entregar-ln { margin-top: 8px; font-weight: 700; text-align: center; font-size: 9pt; }
    .rom-carimbo-tit { font-weight: 700; font-size: 9pt; margin-bottom: 4px; color: #1e3a5f; }
    .rom-carimbo-ln { margin-top: 1px; white-space: nowrap; }
    .rom-cliente { font-size: 12pt; font-weight: 700; margin: 0 0 3px; }
    .rom-picking { font-size: 11pt; font-weight: 600; margin-bottom: 3px; }
    .rom-cons { font-weight: 700; }
    .rom-arq { font-size: 9pt; color: #444; margin-bottom: 8px; }
    .rom-dest { background: #f5f5f5; padding: 8px 10px; margin: 0; border-radius: 6px; }
    .rom-dest-loc { margin-top: 4px; font-size: 10pt; }
    .rom-dest .lbl { color: #555; }
    .rom-tbl { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .rom-tbl th, .rom-tbl td { border: 1px solid #333; padding: 4px 6px; vertical-align: top; }
    .rom-tbl th { background: #e8e8e8; text-align: left; font-size: 8pt; }
    /** Repete o cabeçalho da tabela de itens em cada página da impressão. */
    .rom-tbl > thead { display: table-header-group; }
    .rom-tbl > tbody { display: table-row-group; }
    .rom-tbl .num { text-align: right; font-variant-numeric: tabular-nums; }
    .rom-tbl .rom-unid { text-align: center; font-weight: 700; white-space: nowrap; }
    .rom-tbl .rom-cad { font-size: 8.5pt; color: #333; }
    .rom-tbl tr.rom-grp-sep td {
      background: #e2e8f0; font-weight: 700; font-size: 9pt; padding: 5px 8px;
      border: 1px solid #333; color: #0f172a;
      page-break-after: avoid; page-break-inside: avoid;
    }
    .rom-tbl tr.rom-grp-sep .rom-grp-bullet { color: #1d4ed8; margin-right: 4px; }
    @media print {
      .rom-tbl tr.rom-grp-sep td {
        background: #e8e8e8 !important;
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
    }
    .rom-foot {
      display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 12px;
      margin-top: 14px; font-size: 9pt; border-top: 1px solid #999; padding-top: 8px;
      page-break-inside: avoid;
    }
    .rom-foot-impr { font-size: 8pt; color: #555; }
    /* Listagem geral consolidada (estilo Resumo de picking / Cargas) */
    .romaneio-sheet-geral { max-width: 190mm; }
    .rom-geral-hdr {
      display: flex; justify-content: space-between; align-items: flex-start;
      gap: 10px; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 8px;
      font-size: 9pt; font-weight: 700; letter-spacing: 0.02em;
    }
    .rom-geral-hdr-m { text-align: center; flex: 1; font-size: 11pt; }
    .rom-geral-hdr-r { text-align: right; min-width: 90px; }
    .rom-geral-hdr-lbl { font-size: 7.5pt; font-weight: 600; color: #444; }
    .rom-geral-hdr-num { font-size: 14pt; line-height: 1.1; }
    .rom-geral-title { font-size: 13pt; margin: 6px 0 4px; font-weight: 700; }
    .rom-geral-subtit { font-size: 9pt; color: #333; margin-bottom: 6px; }
    .rom-geral-meta { font-size: 9pt; margin: 2px 0; }
    .rom-geral-box {
      border: 1px solid #333; padding: 8px 10px; margin: 8px 0 12px; font-size: 9pt; line-height: 1.5;
    }
    .rom-geral-tit-sec {
      font-size: 11pt; margin: 12px 0 6px; padding: 4px 8px; background: #e8e8e8;
      border-left: 4px solid #1d4ed8; font-weight: 700;
    }
    .rom-tbl-geral th { text-align: left; }
    .rom-tbl-geral .cen { text-align: center; }
    .rom-geral-tot { margin: 4px 0 8px; font-size: 9pt; }
    .rom-geral-tot-geral {
      margin: 10px 0; padding: 6px 8px; border: 1px solid #333; font-size: 10pt; background: #f8fafc;
    }
    .rom-geral-vazio { color: #666; font-size: 10pt; }
    .rom-geral-rota { margin-top: 14px; font-size: 9pt; page-break-inside: avoid; }
    .rom-geral-hr { font-family: Consolas, monospace; font-size: 8pt; color: #333; }
    .rom-geral-rota-tit { font-weight: 700; margin: 4px 0; }
    .rom-geral-cidades { display: flex; flex-wrap: wrap; gap: 12px 24px; margin: 6px 0; }
    .rom-geral-cid { min-width: 180px; max-width: 46%; }
    .rom-geral-cid ul { margin: 4px 0 0; padding-left: 16px; }
    .rom-geral-foot { margin-top: 12px; font-size: 8pt; color: #555; border-top: 1px solid #999; padding-top: 6px; }
    @media print {
      .rom-hd-block, .rom-info-row { page-break-inside: avoid; }
      .rom-foot { display: flex !important; visibility: visible !important; }
      .rom-carimbo { border-color: #000; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .rom-sem-rota { background: #fffbeb; border-color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .rom-geral-tit-sec {
        background: #e8e8e8 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
<div class="print-tip" id="romaneioPrintTip" role="status" aria-live="polite">
  <button type="button" class="print-tip-close" aria-label="Fechar aviso" onclick="document.getElementById('romaneioPrintTip').style.display='none'">×</button>
  <strong>Numeração de páginas (1, 2, 3, ...):</strong>
  no diálogo de impressão pressione
  <kbd>Ctrl</kbd>+<kbd>P</kbd>, abra <strong>Mais configurações</strong> (ou <em>More settings</em>) e marque
  <strong>"Cabeçalhos e rodapés"</strong> (<em>Headers and footers</em>).
  O navegador insere automaticamente o número físico em cada folha impressa.
  <button type="button" class="print-tip-print-btn" onclick="window.print()">Imprimir agora</button>
</div>
${sheetsHtml}
${resumoSemRotaHtml}
<script>window.onload=function(){/* opcional: window.print(); descomentar se quiser abrir já na impressão */};</script>
</body>
</html>`;
}

module.exports = {
  classificarConservacao,
  classificarConservacaoDetalhe,
  digitosCodigoOl,
  expandirChavesDigitosCodigoOl,
  chaveCanonicaDigitosOl,
  mascaraCodigoOl,
  extrairDataEntregaPedidoOpl,
  formatarDataEntregaOuPedido,
  buildRomaneioSeparacaoHtml,
  montarOpcoesFiltroRomaneioEspelho,
  unidadeOlDoArquivoTxt,
  resolverUnidadeRomaneioOl,
  inferirUnidadeDaDescricaoOl,
  itemForaListagemGeral,
  qtdEfetivaListagemGeral,
};
