'use strict';

const {
  classificarConservacao,
  digitosCodigoOl,
  mascaraCodigoOl,
} = require('./wms-opl-relatorio-romaneio.service');
const {
  nomeEntregaUnidadeOuLocalDestino,
} = require('./wms-nfe-saida-destino-display.service');

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDocBr(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  return esc(v);
}

function formatDhBr(iso) {
  if (!iso) return '—';
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return esc(String(iso));
  return esc(d.toLocaleString('pt-BR'));
}

function nomeDestinoExibicao(n) {
  return nomeEntregaUnidadeOuLocalDestino(n) || '—';
}

function ncmDigits(ncm) {
  return String(ncm != null ? ncm : '')
    .replace(/\D/g, '')
    .slice(0, 8);
}

/** @returns {'CONGELADO' | 'RESFRIADO' | null} */
function classificarFrioPorNcm(ncmRaw) {
  const d = ncmDigits(ncmRaw);
  if (d.length < 4) return null;
  const p4 = d.slice(0, 4);
  /** 1604 = preparações/conservas (enlatado) — ambiente, não câmara. */
  const cong = ['0203', '0204', '0303', '0304'];
  const refri = ['0201', '0202', '0206', '0210', '0302', '0305', '0207', '0208'];
  if (cong.some((p) => p4.startsWith(p))) return 'CONGELADO';
  if (refri.some((p) => p4.startsWith(p))) return 'RESFRIADO';
  return null;
}

function parseLinhasJson(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function qtdLinha(linha) {
  const q = Number(linha.quantidade ?? linha.qCom ?? linha.qTrib ?? 0);
  return Number.isFinite(q) && q > 0 ? q : 0;
}

/** Peso em kg (cadastro WMS PESO_KG × quantidade), ou 0 se não cadastrado. */
function pesoItemKg(it) {
  const cad = it && it._cadWms;
  const q = Number(it && it.quantidade) || 0;
  if (!cad || cad.PESO_KG == null) return 0;
  const w = Number(cad.PESO_KG);
  if (!Number.isFinite(w) || w <= 0) return 0;
  return q * w;
}

function formatPesoKgBr(kg) {
  if (!Number.isFinite(kg) || kg < 0) return '—';
  const s = kg.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  return `${esc(s)} kg`;
}

function rotuloCadWms(cad) {
  if (!cad) return '—';
  const t = (cad.TIPO_ARMAZENAGEM || '').trim() || '—';
  const c = (cad.NM_CATEGORIA || '').trim();
  return c ? `${t} / ${c}` : t;
}

/** Inclui linha se NCM frio OU cadastro/heurística OPL = refrigerado/congelado. */
function classificarLinhaFrio(linha, produtoPorDigitos) {
  const desc = (linha.xProd || linha.descricao || '').toString();
  const cod = (linha.cProd || linha.codigo || '').toString();
  const dkey = digitosCodigoOl(cod);
  const cad = dkey && produtoPorDigitos && typeof produtoPorDigitos === 'object' ? produtoPorDigitos[dkey] : null;
  const bucketOpl = classificarConservacao(desc, cad);
  const tipoNcm = classificarFrioPorNcm(linha.NCM != null ? linha.NCM : linha.ncm);
  if (bucketOpl === 'REFRIG_CONG') {
    return {
      cad,
      rotuloCons: tipoNcm === 'CONGELADO' ? 'Congelado' : tipoNcm === 'RESFRIADO' ? 'Resfriado' : 'Refrig./cong. (cad.)',
      sortCons: tipoNcm === 'CONGELADO' ? '0' : tipoNcm === 'RESFRIADO' ? '1' : '2',
    };
  }
  if (!tipoNcm) return null;
  return {
    cad,
    rotuloCons: tipoNcm === 'CONGELADO' ? 'Congelado' : 'Resfriado',
    sortCons: tipoNcm === 'CONGELADO' ? '0' : '1',
  };
}

function cmpText(a, b) {
  return String(a || '').localeCompare(String(b || ''), 'pt-BR', { sensitivity: 'base' });
}

function chaveDestNf(n) {
  const uf = (n.UF_DEST || '').trim();
  const mun = (n.XMUN_DEST || '').trim();
  const cnpj = String(n.CNPJ_ENTREGA || n.CNPJ_DEST || '').replace(/\D/g, '');
  return `${uf}|${mun}|${cnpj}`;
}

/** Chave de unidade de destino (cidade/UF), alinhada ao filtro `unidades` do romaneio OPL. */
function chaveUnidadeDestinoNf(n) {
  const cid = normChaveDestinoTexto(n.XMUN_DEST);
  const uf = String(n.UF_DEST || '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  if (!cid && !uf) return '';
  return `${cid}|${uf}`;
}

function normalizarChaveUnidadeQuery(chaveRaw) {
  const parts = String(chaveRaw || '').split('|');
  if (parts.length < 2) return String(chaveRaw || '').trim().toUpperCase();
  const cid = normChaveDestinoTexto(parts[0]);
  const uf = String(parts[1] || '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  return `${cid}|${uf}`;
}

/** Mantém só NF-e cuja unidade de destino está na lista (vazio = sem filtro). */
function filtrarNfRowsPorUnidades(nfRows, unidades) {
  const lista = Array.isArray(unidades) ? unidades : [];
  if (!lista.length) return nfRows || [];
  const set = new Set();
  for (const raw of lista) {
    const t = String(raw || '').trim();
    if (!t) continue;
    set.add(t.toUpperCase());
    set.add(normalizarChaveUnidadeQuery(t));
  }
  if (!set.size) return nfRows || [];
  return (nfRows || []).filter((n) => {
    const k = chaveUnidadeDestinoNf(n);
    return k && set.has(k);
  });
}

/** Normaliza texto para chave de destino (maiúsculas, sem acento, espaços colapsados). */
function normChaveDestinoTexto(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Chave do local de entrega / destino (alinhada ao modal de romaneio nas telas Cargas/Expedição). */
function chaveDestinoEntregaNf(n) {
  const uf = String(n.UF_DEST || '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const mun = normChaveDestinoTexto(n.XMUN_DEST);
  const nome = normChaveDestinoTexto(nomeEntregaUnidadeOuLocalDestino(n));
  const cnpj = String(n.CNPJ_ENTREGA || n.CNPJ_DEST || '').replace(/\D/g, '');
  return `${uf}|${mun}|${cnpj}|${nome}`;
}

/** Reaplica a mesma normalização em chave vinda da URL (combo do front). */
function normalizarChaveDestinoQuery(chaveRaw) {
  const parts = String(chaveRaw || '').split('|');
  if (parts.length < 4) return String(chaveRaw || '').trim();
  const uf = String(parts[0] || '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const cnpj = String(parts[parts.length - 2] || '').replace(/\D/g, '');
  const nome = normChaveDestinoTexto(parts[parts.length - 1]);
  const mun = normChaveDestinoTexto(parts.slice(1, -2).join('|'));
  return `${uf}|${mun}|${cnpj}|${nome}`;
}

/** UF + município + CNPJ (sem nome) — fallback quando o rótulo do combo diverge levemente. */
function chaveDestinoEntregaParcialNf(n) {
  const uf = String(n.UF_DEST || '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const mun = normChaveDestinoTexto(n.XMUN_DEST);
  const cnpj = String(n.CNPJ_ENTREGA || n.CNPJ_DEST || '').replace(/\D/g, '');
  return `${uf}|${mun}|${cnpj}`;
}

function nomesDestinoEquivalentes(nomeQuery, nomeNf) {
  const q = normChaveDestinoTexto(nomeQuery);
  const n = normChaveDestinoTexto(nomeNf);
  if (!q || !n) return !q && !n;
  if (q === n) return true;
  if (q.length >= 10 && n.includes(q)) return true;
  if (n.length >= 10 && q.includes(n)) return true;
  return false;
}

/** Mantém só NF-e cujo destino (local de entrega) está na lista de chaves (vazio = sem filtro). */
function filtrarNfRowsPorDestinos(nfRows, destinos) {
  const lista = Array.isArray(destinos) ? destinos : [];
  if (!lista.length) return nfRows || [];
  const setFull = new Set();
  /** @type {Map<string, string[]>} */
  const parcialParaNomes = new Map();
  for (const raw of lista) {
    const t = String(raw || '').trim();
    if (!t) continue;
    const full = normalizarChaveDestinoQuery(t);
    setFull.add(t);
    setFull.add(full);
    const parts = full.split('|');
    if (parts.length >= 4) {
      const parcial = `${parts[0]}|${parts[1]}|${parts[2]}`;
      const nome = parts[parts.length - 1];
      if (!parcialParaNomes.has(parcial)) parcialParaNomes.set(parcial, []);
      parcialParaNomes.get(parcial).push(nome);
    }
  }
  if (!setFull.size && !parcialParaNomes.size) return nfRows || [];
  return (nfRows || []).filter((n) => {
    const k = chaveDestinoEntregaNf(n);
    if (k && setFull.has(k)) return true;
    const parcial = chaveDestinoEntregaParcialNf(n);
    const nomesQ = parcialParaNomes.get(parcial);
    if (!nomesQ || !nomesQ.length) return false;
    const nomeNf = nomeEntregaUnidadeOuLocalDestino(n);
    return nomesQ.some((qn) => nomesDestinoEquivalentes(qn, nomeNf));
  });
}

/** Chave de endereço de entrega (logradouro + nº + compl. + bairro + cidade + UF + CEP). */
function chaveEnderecoEntregaNf(n) {
  const norm = (v) =>
    String(v || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');
  const cep = String(n.CEP_DEST || '').replace(/\D/g, '').slice(0, 8);
  return [
    norm(n.XLGR_DEST),
    norm(n.NRO_DEST),
    norm(n.XCPL_DEST),
    norm(n.XBAIRRO_DEST),
    norm(n.XMUN_DEST),
    norm(n.UF_DEST),
    cep,
  ].join('|');
}

function formatEnderecoEntregaNf(n) {
  const log = [n.XLGR_DEST, n.NRO_DEST].filter((x) => String(x || '').trim()).join(', ');
  const parts = [];
  if (log) parts.push(String(log).trim());
  if (n.XCPL_DEST && String(n.XCPL_DEST).trim()) parts.push(String(n.XCPL_DEST).trim());
  if (n.XBAIRRO_DEST && String(n.XBAIRRO_DEST).trim()) parts.push(String(n.XBAIRRO_DEST).trim());
  const loc = [n.XMUN_DEST, n.UF_DEST].filter(Boolean).join(' / ');
  if (loc) parts.push(loc);
  const cep = String(n.CEP_DEST || '').replace(/\D/g, '');
  if (cep) parts.push(`CEP ${cep}`);
  return parts.join(' — ') || '—';
}

function valorOrdemLinhaFrio(L, campo) {
  const nf = L._nf || {};
  if (campo === 'unidade') return [nf.XMUN_DEST || '', nf.UF_DEST || ''].filter(Boolean).join(' ').trim();
  if (campo === 'destino') return [nomeDestinoExibicao(nf), nf.CNPJ_ENTREGA || nf.CNPJ_DEST || ''].join(' ').trim();
  if (campo === 'conservacao') return L._sortCons || '';
  if (campo === 'categoria') return rotuloCadWms(L._cadWms);
  if (campo === 'nome') return L.descricao || '';
  if (campo === 'codigo') return L.codigo || '';
  return '';
}

function valorOrdemSecao(sec, campo) {
  const n = sec.nf || {};
  if (campo === 'unidade') return [n.XMUN_DEST || '', n.UF_DEST || ''].filter(Boolean).join(' ').trim();
  if (campo === 'destino') return [nomeDestinoExibicao(n), n.CNPJ_ENTREGA || n.CNPJ_DEST || ''].join(' ').trim();
  if (campo === 'conservacao') {
    const first = sec.linhas && sec.linhas[0];
    return first ? first._sortCons || '' : '';
  }
  if (campo === 'categoria') {
    const first = sec.linhas && sec.linhas[0];
    return first ? rotuloCadWms(first._cadWms) : '';
  }
  if (campo === 'nome') return String(n.NUMERO_NF || '');
  if (campo === 'codigo') return String(n.CHAVE_NFE || '').slice(-8);
  return '';
}

function agregarLinhasPorCodigo(linhas) {
  const map = new Map();
  for (const L of linhas) {
    const cod = (L.codigo || '').trim();
    const key = cod || `__${(L.descricao || '').slice(0, 48)}`;
    const prev = map.get(key);
    const q = L.quantidade || 0;
    if (!prev) {
      map.set(key, { ...L, quantidade: q });
    } else {
      prev.quantidade += q;
    }
  }
  return Array.from(map.values());
}

function ordenarLinhas(linhas, ordem) {
  const campos = Array.isArray(ordem) && ordem.length ? ordem : ['unidade', 'destino', 'conservacao', 'categoria', 'nome', 'codigo'];
  return [...linhas].sort((a, b) => {
    for (const campo of campos) {
      const c = cmpText(valorOrdemLinhaFrio(a, campo), valorOrdemLinhaFrio(b, campo));
      if (c !== 0) return c;
    }
    return cmpText(a.codigo || '', b.codigo || '');
  });
}

function ordenarSecoes(secoes, ordem) {
  const campos = Array.isArray(ordem) && ordem.length ? ordem : ['unidade', 'destino', 'conservacao', 'categoria', 'nome', 'codigo'];
  return [...secoes].sort((a, b) => {
    for (const campo of campos) {
      const c = cmpText(valorOrdemSecao(a, campo), valorOrdemSecao(b, campo));
      if (c !== 0) return c;
    }
    const oa = Number.isFinite(a.ordem) ? a.ordem : 999999;
    const ob = Number.isFinite(b.ordem) ? b.ordem : 999999;
    if (oa !== ob) return oa - ob;
    return cmpText(String(a.nf.NUMERO_NF || ''), String(b.nf.NUMERO_NF || ''));
  });
}

function packSheets(secoes, folhas) {
  const f = String(folhas || 'nota').toLowerCase();
  if (f === 'continuo') return [{ secoes: [...secoes] }];
  if (f === 'nota') return secoes.map((s) => ({ secoes: [s] }));
  const keyFn = f === 'endereco' ? chaveEnderecoEntregaNf : chaveDestNf;
  const sheets = [];
  let cur = [];
  let lastK = null;
  for (const s of secoes) {
    const k = keyFn(s.nf);
    if (cur.length && k !== lastK) {
      sheets.push({ secoes: cur });
      cur = [];
    }
    cur.push(s);
    lastK = k;
  }
  if (cur.length) sheets.push({ secoes: cur });
  return sheets;
}

/**
 * Conjunto de códigos para filtro do romaneio, normalizados por dígitos (aceita
 * `6.03.14.577.20`, `6031457720` ou o código da NF-e indiferentemente).
 * @param {string[]|undefined} codigos
 * @returns {Set<string>|null} null = sem filtro
 */
function montarSetCodigosFiltro(codigos) {
  const lista = Array.isArray(codigos) ? codigos : [];
  const set = new Set();
  for (const raw of lista) {
    const t = String(raw || '').trim();
    if (!t) continue;
    const d = digitosCodigoOl(t);
    if (d) set.add(d);
    const soDigitos = t.replace(/\D/g, '');
    if (soDigitos) set.add(soDigitos);
  }
  return set.size ? set : null;
}

/** Código do produto passa no filtro (compara por dígitos). */
function codigoPassaFiltro(codigo, setCodigos) {
  if (!setCodigos) return true;
  const cod = String(codigo || '');
  const d = digitosCodigoOl(cod);
  if (d && setCodigos.has(d)) return true;
  const soDigitos = cod.replace(/\D/g, '');
  return !!(soDigitos && setCodigos.has(soDigitos));
}

/**
 * Códigos de produto presentes nas NF-e da carga (para popular combo de filtro).
 * @param {object[]} rowsNf
 * @returns {{ codigo: string, digitos: string, descricao: string }[]}
 */
function coletarProdutosCargaNfe(rowsNf) {
  /** @type {Map<string, { codigo: string, digitos: string, descricao: string }>} */
  const m = new Map();
  for (const n of rowsNf || []) {
    for (const linha of parseLinhasJson(n.LINHAS_JSON)) {
      const cod = (linha.cProd || linha.codigo || '').toString().trim();
      if (!cod) continue;
      const d = digitosCodigoOl(cod) || cod.replace(/\D/g, '');
      if (!d) continue;
      if (m.has(d)) continue;
      m.set(d, {
        codigo: mascaraCodigoOl(cod) || cod,
        digitos: d,
        descricao: (linha.xProd || linha.descricao || '').toString().trim(),
      });
    }
  }
  return Array.from(m.values()).sort((a, b) => cmpText(a.codigo, b.codigo));
}

/**
 * Coleta dígitos de código de produto (OL / NF-e) para mapa WMS_PRODUTO_DONO.
 * @param {object[]} rowsNf
 */
function collectDigitosCargaNfe(rowsNf) {
  const s = new Set();
  for (const n of rowsNf || []) {
    for (const linha of parseLinhasJson(n.LINHAS_JSON)) {
      const cod = (linha.cProd || linha.codigo || '').toString();
      const d = digitosCodigoOl(cod);
      if (d) s.add(d);
    }
  }
  return Array.from(s);
}

/**
 * Romaneio Modelo 2 (expedição) — layout por NF, alinhado ao OPL.
 * opts.conservacao: `refri` só itens frios (NCM/cad.); `seco` só seco/ambiente; `todos` inclui frios + secos (mesma ideia do Resumo de picking).
 * @param {{
 *   carga: object,
 *   nfRows: object[],
 *   produtoPorDigitos?: Record<string, { TIPO_ARMAZENAGEM?: string, NM_CATEGORIA?: string }>,
 *   opts?: { conservacao?: string, agruparItens?: boolean, folhas?: 'dest'|'endereco'|'nota'|'continuo', ordem?: string[] },
 *   geradoEm: string
 * }} param0
 */
function buildRomaneioCargaFriosOplHtml({ carga, nfRows, produtoPorDigitos, opts, geradoEm }) {
  const c = carga || {};
  const cd = c.CD_CARGA != null ? String(c.CD_CARGA) : '';
  const placa = esc((c.PLACA || '').trim() || '—');
  const descCarga = esc((c.NM_DESCRICAO || '').trim() || `Carga #${cd}`);
  const agruparItens = !(opts && (opts.agruparItens === false || opts.agruparItens === '0'));
  const folhas = (opts && opts.folhas) || 'nota';
  const conservacaoRaw = String((opts && opts.conservacao) || 'todos').toLowerCase();
  const conservacaoFilt =
    conservacaoRaw === 'refri' || conservacaoRaw === 'seco' ? conservacaoRaw : 'todos';
  const ordemPadrao = ['unidade', 'destino', 'conservacao', 'categoria', 'nome', 'codigo'];
  const ordem = Array.isArray(opts && opts.ordem) && opts.ordem.length ? opts.ordem : ordemPadrao;
  const mapCad = produtoPorDigitos && typeof produtoPorDigitos === 'object' ? produtoPorDigitos : {};
  const setCodigos = montarSetCodigosFiltro(opts && opts.filtrosCodigos);

  const secoes = [];
  for (const n of nfRows || []) {
    const linhasOut = [];
    for (const linha of parseLinhasJson(n.LINHAS_JSON)) {
      const q = qtdLinha(linha);
      if (!q) continue;
      const codigo = (linha.cProd || linha.codigo || '').toString().trim();
      if (!codigoPassaFiltro(codigo, setCodigos)) continue;
      const descricao = (linha.xProd || linha.descricao || '').toString().trim();
      const unidade = (linha.uCom || linha.unidade || '').toString().trim();
      const dkey = digitosCodigoOl(codigo);
      const cad = dkey && mapCad && typeof mapCad === 'object' ? mapCad[dkey] : null;
      const _bucket = classificarConservacao(descricao, cad);

      let meta = classificarLinhaFrio(linha, mapCad);
      if (!meta) {
        if (conservacaoFilt === 'refri') continue;
        if (conservacaoFilt === 'seco') {
          if (_bucket !== 'SECO_AMB') continue;
          meta = { cad, rotuloCons: 'Seco / ambiente', sortCons: '5' };
        } else if (conservacaoFilt === 'todos') {
          meta = {
            cad,
            rotuloCons: _bucket === 'SECO_AMB' ? 'Seco / ambiente' : 'Refrig./cong. (cad.)',
            sortCons: _bucket === 'SECO_AMB' ? '5' : '2',
          };
        } else {
          continue;
        }
      }

      linhasOut.push({
        codigo,
        descricao,
        unidade,
        quantidade: q,
        rotuloCons: meta.rotuloCons,
        _sortCons: meta.sortCons,
        _cadWms: meta.cad || null,
        _bucket,
        _nf: n,
      });
    }
    let L = filtrarConservacaoResumo(linhasOut, conservacaoFilt);
    if (!L.length) continue;
    if (agruparItens) L = agregarLinhasPorCodigo(L);
    L = ordenarLinhas(L, ordem);
    secoes.push({
      nf: n,
      ordem: n.ORDEM != null ? Number(n.ORDEM) : null,
      linhas: L,
    });
  }

  const secoesOrd = ordenarSecoes(secoes, ordem);
  let sheets = packSheets(secoesOrd, folhas);
  if (!sheets.length) sheets = [{ secoes: [] }];

  const unidsFilt =
    opts && Array.isArray(opts.filtrosUnidades) && opts.filtrosUnidades.length
      ? opts.filtrosUnidades
      : [];
  const subtFiltFrios = htmlSubtituloFiltrosPicking(
    conservacaoFilt,
    folhas,
    agruparItens,
    'frios',
    unidsFilt,
    opts && opts.filtrosDestinos,
    opts && opts.filtrosCodigos
  );

  let page = 0;
  const sheetsHtml = [];
  for (const sh of sheets) {
    page += 1;
    const breakClass = page < sheets.length ? ' sheet-break' : '';
    let blocosHtml = '';
    let idx = 0;
    for (const sec of sh.secoes || []) {
      const n = sec.nf;
      const uf = (n.UF_DEST || '').trim();
      const mun = (n.XMUN_DEST || '').trim();
      const localLinha = [uf, mun].filter(Boolean).join(' | ') || '—';
      const cliNome = nomeDestinoExibicao(n);
      const cnpj = formatDocBr(n.CNPJ_ENTREGA || n.CNPJ_DEST);
      const numNf = esc(String(n.NUMERO_NF || '—'));
      let sumVol = 0;
      let rows = '';
      for (const it of sec.linhas || []) {
        sumVol += Number(it.quantidade) || 0;
        const rawCod = (it.codigo || '').trim();
        const codEx = esc(mascaraCodigoOl(rawCod) || rawCod);
        rows += `<tr>
          <td>${codEx}</td>
          <td>${esc(it.descricao || '')}</td>
          <td class="cen">${esc(it.unidade || '')}</td>
          <td class="num">${esc(String(it.quantidade))}</td>
        </tr>`;
      }
      const zebra = idx % 2 === 1 ? ' nf-zebra' : '';
      idx += 1;
      blocosHtml += `<div class="nf-sec${zebra}">
  <div class="nf-loc"><strong>Local:</strong> ${esc(localLinha)}</div>
  <div class="nf-cli"><strong>Cliente de Entrega:</strong> ${esc(cliNome)} — ${cnpj}</div>
  <div class="nf-nota"><strong>Nota:</strong> ${numNf}</div>
  <table class="rom-tbl">
    <thead><tr><th style="width:14%">Código</th><th>Descrição</th><th style="width:10%" class="cen">Uníd.</th><th style="width:12%" class="num">Volumes</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="nf-vol"><strong>${esc(String(sumVol))} Vol.</strong></div>
</div>`;
    }

    sheetsHtml.push(`<section class="romaneio-sheet${breakClass}">
  <header class="pick-hdr">
    <div class="pick-hdr-left">GESTÃO DE ESTOQUE</div>
    <div class="pick-hdr-mid">Atlas Cargo</div>
    <div class="pick-hdr-carga">
      <div class="pick-hdr-carga-lbl">Número da Carga</div>
      <div class="pick-hdr-carga-num">${esc(cd)}</div>
    </div>
  </header>
  <h1 class="pick-title">PICKING — Romaneio de carga</h1>
  <div class="pick-subtit">${subtFiltFrios}</div>
  <div class="pick-meta">Impresso em: <strong>${formatDhBr(geradoEm)}</strong></div>
  <div class="pick-meta">Placa: <strong>${placa}</strong> &nbsp;|&nbsp; Carga: <strong>${descCarga}</strong></div>
  <div class="pick-box">
    <div><strong>Separação / Conferência</strong></div>
    <div class="pick-box-line">Data: ___ / ___ / ______ &nbsp; Início: ___:___ &nbsp; Término: ___:___</div>
    <div class="pick-box-line">Responsável: ________________________________________________</div>
  </div>
  ${blocosHtml || '<p>Nenhuma linha fria para os filtros atuais.</p>'}
  <footer class="pick-foot">Página ${page} de __TOTAL__ — WMS Cargas programadas / Expedição</footer>
</section>`);
  }

  const total = sheets.length;
  const body = sheetsHtml.join('\n').replace(/__TOTAL__/g, String(total));

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Romaneio frios — Carga ${esc(cd)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 10px; color: #111; font-size: 10pt; }
    .romaneio-sheet { max-width: 190mm; margin: 0 auto 12px; padding: 0 4px 12px; }
    .sheet-break { page-break-after: always; }
    @media print {
      body { padding: 0; margin: 0; }
      .romaneio-sheet { max-width: none; margin: 0; page-break-inside: avoid; }
      .sheet-break { page-break-after: always; }
    }
    .pick-hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #222; padding-bottom: 8px; margin-bottom: 10px; gap: 8px; }
    .pick-hdr-left { font-size: 8pt; font-weight: 700; color: #333; }
    .pick-hdr-mid { font-size: 11pt; font-weight: 700; text-align: center; flex: 1; }
    .pick-hdr-carga { text-align: right; min-width: 100px; }
    .pick-hdr-carga-lbl { font-size: 8pt; text-decoration: underline; }
    .pick-hdr-carga-num { font-size: 22pt; font-weight: 800; line-height: 1.1; }
    .pick-title { font-size: 11pt; font-weight: 700; margin: 10px 0 4px; line-height: 1.35; text-align: center; }
    .pick-subtit { font-size: 8.5pt; color: #444; margin: 0 0 10px; line-height: 1.35; text-align: center; }
    .pick-meta { font-size: 9.5pt; margin-bottom: 4px; }
    .pick-box { border: 1px solid #333; padding: 8px 10px; margin: 10px 0 14px; border-radius: 4px; font-size: 9pt; }
    .pick-box-line { margin-top: 6px; }
    .nf-sec { margin-bottom: 18px; padding: 10px 0; border-bottom: 1px solid #bbb; }
    .nf-sec.nf-zebra { background: #f4f4f4; padding-left: 8px; padding-right: 8px; margin-left: -4px; margin-right: -4px; border-radius: 4px; border-bottom-color: #ccc; }
    .nf-loc, .nf-cli, .nf-nota { margin-bottom: 5px; font-size: 9.5pt; }
    .rom-tbl { width: 100%; border-collapse: collapse; margin-top: 8px; }
    .rom-tbl th, .rom-tbl td { border: 1px solid #333; padding: 5px 7px; vertical-align: top; }
    .rom-tbl th { background: #e8e8e8; text-align: left; font-size: 8.5pt; }
    .rom-tbl .num { text-align: right; font-variant-numeric: tabular-nums; }
    .rom-tbl .cen { text-align: center; }
    .nf-vol { text-align: right; margin-top: 8px; font-size: 9.5pt; }
    .pick-foot { margin-top: 14px; padding-top: 8px; border-top: 1px solid #999; font-size: 8.5pt; color: #444; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

function valorOrdemLinhaPick(L, campo) {
  const nf = L._nf || {};
  if (campo === 'unidade') return [nf.XMUN_DEST || '', nf.UF_DEST || ''].filter(Boolean).join(' ').trim();
  if (campo === 'destino') return [nomeDestinoExibicao(nf), nf.CNPJ_ENTREGA || nf.CNPJ_DEST || ''].join(' ').trim();
  if (campo === 'conservacao') return L._bucket === 'REFRIG_CONG' ? '0' : '1';
  if (campo === 'categoria') return rotuloCadWms(L._cadWms);
  if (campo === 'nome') return L.descricao || '';
  if (campo === 'codigo') return L.codigo || '';
  return '';
}

function ordenarLinhasPick(linhas, ordem) {
  const campos = Array.isArray(ordem) && ordem.length ? ordem : ['unidade', 'destino', 'conservacao', 'categoria', 'nome', 'codigo'];
  return [...linhas].sort((a, b) => {
    for (const campo of campos) {
      const c = cmpText(valorOrdemLinhaPick(a, campo), valorOrdemLinhaPick(b, campo));
      if (c !== 0) return c;
    }
    return cmpText(a.codigo || '', b.codigo || '');
  });
}

function agregarLinhasPorCodigoUnidade(linhas) {
  const map = new Map();
  for (const L of linhas) {
    const key = `${(L.codigo || '').trim()}|${(L.unidade || '').trim()}`;
    const prev = map.get(key);
    const q = Number(L.quantidade) || 0;
    if (!prev) map.set(key, { ...L, quantidade: q });
    else prev.quantidade += q;
  }
  return Array.from(map.values());
}

function expandLinhasResumoPick(nfRows, produtoPorDigitos) {
  const map = produtoPorDigitos && typeof produtoPorDigitos === 'object' ? produtoPorDigitos : {};
  const out = [];
  for (const n of nfRows || []) {
    for (const linha of parseLinhasJson(n.LINHAS_JSON)) {
      const q = qtdLinha(linha);
      if (!q) continue;
      const codigo = (linha.cProd || linha.codigo || '').toString().trim();
      const descricao = (linha.xProd || linha.descricao || '').toString().trim();
      const unidade = (linha.uCom || linha.unidade || '').toString().trim();
      const dkey = digitosCodigoOl(codigo);
      const cad = dkey ? map[dkey] : null;
      /** Mesma regra do card Seco/Frio da carga (cadastro + NCM XML, sem 1604 conserva). */
      let bucket = classificarConservacao(descricao, cad);
      if (bucket !== 'REFRIG_CONG') {
        const tipoCad = String((cad && cad.TIPO_ARMAZENAGEM) || '').toUpperCase();
        const secoCad = tipoCad.includes('SECO') || tipoCad.includes('AMBIENT');
        if (!secoCad && classificarFrioPorNcm(linha.NCM != null ? linha.NCM : linha.ncm)) {
          bucket = 'REFRIG_CONG';
        }
      }
      const rawD = n.CD_DONO != null && n.CD_DONO !== '' ? Number(n.CD_DONO) : null;
      const cdDono = Number.isFinite(rawD) ? rawD : 0;
      out.push({
        codigo,
        descricao,
        unidade,
        quantidade: q,
        _bucket: bucket,
        _cadWms: cad || null,
        _nf: n,
        cdDono,
      });
    }
  }
  return out;
}

function filtrarConservacaoResumo(linhas, conservacao) {
  const c = String(conservacao || 'todos').toLowerCase();
  if (c === 'refri') return linhas.filter((L) => L._bucket === 'REFRIG_CONG');
  if (c === 'seco') return linhas.filter((L) => L._bucket === 'SECO_AMB');
  return linhas;
}

/** Rodapé: cidades da rota (ordem NF) e unidades (clientes) por cidade. */
function buildRotaUnidadesPorCidadeHtml(nfRows, geradoEmIso) {
  const sorted = [...(nfRows || [])].sort((a, b) => {
    const oa = Number.isFinite(Number(a.ORDEM)) ? Number(a.ORDEM) : 999999;
    const ob = Number.isFinite(Number(b.ORDEM)) ? Number(b.ORDEM) : 999999;
    if (oa !== ob) return oa - ob;
    return cmpText(String(a.NUMERO_NF || ''), String(b.NUMERO_NF || ''));
  });
  const byCity = new Map();
  for (const n of sorted) {
    const city = [n.XMUN_DEST, n.UF_DEST].filter(Boolean).join(' / ').trim() || '(Sem cidade)';
    const unit = nomeEntregaUnidadeOuLocalDestino(n);
    if (!byCity.has(city)) byCity.set(city, []);
    const arr = byCity.get(city);
    if (unit && arr.indexOf(unit) === -1) arr.push(unit);
  }
  let html =
    '<div class="rota-blk"><div class="rota-hr">================================================================</div>';
  html += `<div class="rota-tit">Unidades atendidas na rota (por cidade) — ${formatDhBr(geradoEmIso || new Date().toISOString())}</div>`;
  html += '<div class="rota-hr">================================================================</div>';
  html += '<div class="rota-cidades-cols">';
  for (const [city, units] of byCity) {
    html += `<div class="rota-cid"><strong>${esc(city)}</strong>`;
    if (units.length) {
      html += '<ul class="rota-ul">';
      for (const u of units) html += `<li>${esc(u)}</li>`;
      html += '</ul>';
    } else {
      html += '<p class="rota-empty">—</p>';
    }
    html += '</div>';
  }
  html += '</div><div class="rota-hr">================================================================</div></div>';
  return html;
}

function sheetMinOrdemResumo(sh) {
  let m = 999999;
  for (const L of sh.lines || []) {
    const n = L._nf;
    const o = n && n.ORDEM != null && Number.isFinite(Number(n.ORDEM)) ? Number(n.ORDEM) : 999999;
    if (o < m) m = o;
  }
  return m;
}

/** @param {object[]} todas Linhas já filtradas por conservação
 *  @param {string} folhasMode
 *  @param {object[]} [nfRows] NFs da carga (garante 1 folha por dono mesmo sem item no filtro) */
function agruparSheetsResumoPicking(todas, folhasMode, nfRows) {
  const f = String(folhasMode || 'dono').toLowerCase();
  if (f === 'continuo') {
    return todas.length ? [{ lines: [...todas], cdDono: null }] : [];
  }
  const keyFn =
    f === 'nota'
      ? (L) => {
          const id = L._nf && L._nf.CD_NFE_SAIDA != null ? String(L._nf.CD_NFE_SAIDA) : '_';
          return `${L.cdDono}\t${id}`;
        }
      : f === 'endereco'
        ? (L) => `${L.cdDono}\t${chaveEnderecoEntregaNf(L._nf || {})}`
        : f === 'dest'
          ? (L) => `${L.cdDono}\t${chaveDestNf(L._nf || {})}`
          : (L) => String(L.cdDono);
  const map = new Map();
  for (const L of todas) {
    const k = keyFn(L);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(L);
  }
  /** Folhas por dono: inclui dono presente nas NF mesmo sem linha após filtro (ex.: Nutri sem frios). */
  if (f === 'dono') {
    for (const n of nfRows || []) {
      const rawD = n.CD_DONO != null && n.CD_DONO !== '' ? Number(n.CD_DONO) : null;
      const d = Number.isFinite(rawD) ? rawD : 0;
      const k = String(d);
      if (!map.has(k)) map.set(k, []);
    }
  }
  return Array.from(map.entries()).map(([k, lines]) => ({
    lines,
    cdDono: lines[0] ? lines[0].cdDono : f === 'dono' ? Number(k) || 0 : null,
  }));
}

function sortSheetsResumoPicking(sheets, folhasMode, donoNomes) {
  const f = String(folhasMode || 'dono').toLowerCase();
  if (f === 'dono') {
    return [...sheets].sort((sa, sb) => {
      const da =
        sa.cdDono != null && Number.isFinite(Number(sa.cdDono))
          ? Number(sa.cdDono)
          : sa.lines[0]
            ? sa.lines[0].cdDono
            : 0;
      const db =
        sb.cdDono != null && Number.isFinite(Number(sb.cdDono))
          ? Number(sb.cdDono)
          : sb.lines[0]
            ? sb.lines[0].cdDono
            : 0;
      const na = donoNomes[da] || (da === 0 ? '\uffff' : String(da));
      const nb = donoNomes[db] || (db === 0 ? '\uffff' : String(db));
      const t = cmpText(na, nb);
      if (t !== 0) return t;
      return da - db;
    });
  }
  return [...sheets].sort((sa, sb) => {
    const oa = sheetMinOrdemResumo(sa);
    const ob = sheetMinOrdemResumo(sb);
    if (oa !== ob) return oa - ob;
    const a0 = sa.lines[0];
    const b0 = sb.lines[0];
    const na = a0 && a0._nf && a0._nf.CD_NFE_SAIDA != null ? Number(a0._nf.CD_NFE_SAIDA) : 0;
    const nb = b0 && b0._nf && b0._nf.CD_NFE_SAIDA != null ? Number(b0._nf.CD_NFE_SAIDA) : 0;
    if (na !== nb) return na - nb;
    const ka = a0 && a0._nf ? (f === 'endereco' ? chaveEnderecoEntregaNf(a0._nf) : chaveDestNf(a0._nf)) : '';
    const kb = b0 && b0._nf ? (f === 'endereco' ? chaveEnderecoEntregaNf(b0._nf) : chaveDestNf(b0._nf)) : '';
    return cmpText(ka, kb);
  });
}

/** NFs que entram no rodapé «Unidades atendidas» desta folha. */
function nfRowsParaRodapeFolha(sh, allNfRows, folhasMode) {
  const f = String(folhasMode || 'dono').toLowerCase();
  const all = Array.isArray(allNfRows) ? allNfRows : [];
  if (f === 'continuo') return all;
  if (f === 'dono') {
    const d =
      sh.cdDono != null && Number.isFinite(Number(sh.cdDono))
        ? Number(sh.cdDono)
        : sh.lines && sh.lines[0]
          ? sh.lines[0].cdDono
          : null;
    if (d == null) return all;
    return all.filter((n) => {
      const rawD = n.CD_DONO != null && n.CD_DONO !== '' ? Number(n.CD_DONO) : null;
      const cd = Number.isFinite(rawD) ? rawD : 0;
      return cd === d;
    });
  }
  const ids = new Set();
  for (const L of sh.lines || []) {
    if (L._nf && L._nf.CD_NFE_SAIDA != null) ids.add(Number(L._nf.CD_NFE_SAIDA));
  }
  if (!ids.size) return [];
  return all.filter((n) => ids.has(Number(n.CD_NFE_SAIDA)));
}

function rotuloDonosUnicosParaSheet(lines, donoNomes) {
  const set = new Map();
  for (const L of lines || []) {
    const nm = donoNomes[L.cdDono] || (L.cdDono === 0 ? 'Dono não informado na NF' : `Dono #${L.cdDono}`);
    set.set(L.cdDono, nm);
  }
  return Array.from(set.entries())
    .sort((a, b) => cmpText(a[1], b[1]) || a[0] - b[0])
    .map(([, n]) => n);
}

/** Quantos CD_DONO distintos nas linhas (0 = ausente). */
function contagemDonosDistintos(lines) {
  const s = new Set();
  for (const L of lines || []) s.add(L.cdDono);
  return s.size;
}

/** Agrupa linhas por cdDono; ordena blocos pelo nome do dono (igual às folhas por dono). */
function chunkLinhasPorDonoOrdenado(lines, donoNomes) {
  const map = new Map();
  for (const L of lines || []) {
    if (!map.has(L.cdDono)) map.set(L.cdDono, []);
    map.get(L.cdDono).push(L);
  }
  const entries = Array.from(map.entries());
  entries.sort((a, b) => {
    const da = a[0];
    const db = b[0];
    const na = donoNomes[da] || (da === 0 ? '\uffff' : String(da));
    const nb = donoNomes[db] || (db === 0 ? '\uffff' : String(db));
    const t = cmpText(na, nb);
    if (t !== 0) return t;
    return da - db;
  });
  return entries;
}

function htmlMetaFolhaResumo(lines, folhas, donoNomes, cdDonoSheet) {
  const f = String(folhas || 'dono').toLowerCase();
  const cdFromLines = lines && lines[0] ? lines[0].cdDono : null;
  const cdDono =
    cdFromLines != null && Number.isFinite(Number(cdFromLines))
      ? Number(cdFromLines)
      : cdDonoSheet != null && Number.isFinite(Number(cdDonoSheet))
        ? Number(cdDonoSheet)
        : 0;
  const nomeDono =
    donoNomes[cdDono] || (cdDono === 0 ? 'Dono não informado na NF' : `Dono #${cdDono}`);

  if (f === 'continuo') {
    if (!lines || !lines.length) {
      return `<div class="res-meta res-dono"><strong>Dono do estoque:</strong> ${esc(nomeDono)}</div>`;
    }
    const todos = rotuloDonosUnicosParaSheet(lines, donoNomes);
    if (todos.length > 1) {
      return `<div class="res-meta res-dono"><strong>Donos nesta folha:</strong> ${esc(todos.join(' · '))}</div>
<div class="res-meta res-dono-hint">Itens do picking abaixo aparecem em blocos separados por dono do estoque.</div>`;
    }
    return `<div class="res-meta res-dono"><strong>Dono do estoque:</strong> ${esc(todos[0] || nomeDono)}</div>`;
  }

  let bloc = `<div class="res-meta res-dono"><strong>Dono do estoque:</strong> ${esc(nomeDono)}</div>`;
  if (!lines || !lines.length) return bloc;
  const n = lines[0]._nf || {};
  if (f === 'nota') {
    const num = esc(String(n.NUMERO_NF || '—'));
    const ser =
      n.SERIE != null && String(n.SERIE).trim() ? ` / série ${esc(String(n.SERIE).trim())}` : '';
    bloc += `<div class="res-meta"><strong>NF:</strong> ${num}${ser}</div>`;
  } else if (f === 'dest') {
    const cli = esc(nomeDestinoExibicao(n));
    const loc = esc([n.XMUN_DEST, n.UF_DEST].filter(Boolean).join(' / ') || '—');
    const cnpj = formatDocBr(n.CNPJ_ENTREGA || n.CNPJ_DEST);
    bloc += `<div class="res-meta"><strong>Destino:</strong> ${cli} &nbsp;|&nbsp; ${loc} &nbsp;|&nbsp; CNPJ ${cnpj}</div>`;
  } else if (f === 'endereco') {
    const cli = esc(nomeDestinoExibicao(n));
    const end = esc(formatEnderecoEntregaNf(n));
    bloc += `<div class="res-meta"><strong>Endereço de entrega:</strong> ${cli} &nbsp;|&nbsp; ${end}</div>`;
  }
  return bloc;
}

/**
 * Linha de opções do relatório (Conservação · Folhas · Linhas).
 * @param {'resumo'|'frios'} variant — em frios, "todos" não menciona blocos por tipo (só itens frios).
 */
function htmlSubtituloFiltrosPicking(
  cFilt,
  folhas,
  agruparItens,
  variant,
  filtrosUnidades,
  filtrosDestinos,
  filtrosCodigos
) {
  const v = variant === 'frios' ? 'frios' : 'resumo';
  const bits = [];
  if (cFilt === 'refri') bits.push('Conservação: só refrig./congelado');
  else if (cFilt === 'seco') bits.push('Conservação: só seco/ambiente');
  else
    bits.push(
      v === 'frios' ? 'Conservação: todos os produtos' : 'Conservação: todos (blocos por tipo)'
    );
  const fLab = {
    dono: 'Folhas: por dono do estoque',
    nota: 'Folhas: por NF',
    dest: 'Folhas: por destino',
    endereco: 'Folhas: por endereço de entrega',
    continuo: 'Folhas: listagem contínua',
  };
  const fKey = folhas && fLab[folhas] ? folhas : v === 'frios' ? 'nota' : 'dono';
  bits.push(fLab[fKey] || fLab.dono);
  bits.push(agruparItens ? 'Linhas: somadas por código/unidade' : 'Linhas: detalhadas por NF');
  const unids = Array.isArray(filtrosUnidades) ? filtrosUnidades : [];
  if (unids.length) {
    const lista = unids
      .slice(0, 2)
      .map((u) => String(u || '').replace('|', '/'))
      .join(', ');
    const sufixo = unids.length > 2 ? ` (+${unids.length - 2})` : '';
    bits.push(`Unidade(s): ${lista}${sufixo}`);
  }
  const dests = Array.isArray(filtrosDestinos) ? filtrosDestinos : [];
  if (dests.length) {
    const lista = dests
      .slice(0, 1)
      .map((d) => {
        const p = String(d || '').split('|');
        if (p.length >= 4) return p[p.length - 1];
        return d;
      })
      .join(', ');
    const sufixo = dests.length > 1 ? ` (+${dests.length - 1})` : '';
    bits.push(`Destino(s): ${lista}${sufixo}`);
  }
  const cods = Array.isArray(filtrosCodigos) ? filtrosCodigos.filter(Boolean) : [];
  if (cods.length) {
    const lista = cods
      .slice(0, 3)
      .map((c) => mascaraCodigoOl(String(c)) || String(c))
      .join(', ');
    const sufixo = cods.length > 3 ? ` (+${cods.length - 3})` : '';
    bits.push(`Código(s): ${lista}${sufixo}`);
  }
  return esc(bits.join(' · '));
}

/**
 * Resumo picking: folhas configuráveis, blocos por conservação, A4 vertical.
 * @param {{
 *   carga: object,
 *   nfRows: object[],
 *   produtoPorDigitos?: Record<string, { TIPO_ARMAZENAGEM?: string, NM_CATEGORIA?: string, PESO_KG?: number | null }>,
 *   donoNomes?: Record<number, string>,
 *   opts?: { conservacao?: string, agruparItens?: boolean, ordem?: string[], folhas?: string },
 *   geradoEm: string
 * }} p
 */
function buildRomaneioResumoPickingHtml(p) {
  const c = p.carga || {};
  const cd = c.CD_CARGA != null ? String(c.CD_CARGA) : '';
  const placa = esc((c.PLACA || '').trim() || '—');
  const descCarga = esc((c.NM_DESCRICAO || '').trim() || '—');
  const nmRota = esc((c.NM_ROTA || '').trim() || '—');
  const conservacao = String((p.opts && p.opts.conservacao) || 'todos').toLowerCase();
  const cFilt = conservacao === 'refri' || conservacao === 'seco' ? conservacao : 'todos';
  const agruparItens = !(p.opts && (p.opts.agruparItens === false || p.opts.agruparItens === '0'));
  const ordem = Array.isArray(p.opts && p.opts.ordem) && p.opts.ordem.length ? p.opts.ordem : ['unidade', 'destino', 'conservacao', 'categoria', 'nome', 'codigo'];
  const donoNomes = p.donoNomes && typeof p.donoNomes === 'object' ? p.donoNomes : {};
  const folhasNorm = String((p.opts && p.opts.folhas) || 'dono').toLowerCase();
  const folhasValid = new Set(['nota', 'dest', 'endereco', 'continuo', 'dono']);
  const folhas = folhasValid.has(folhasNorm) ? folhasNorm : 'dono';
  const unidsFiltResumo =
    p.opts && Array.isArray(p.opts.filtrosUnidades) && p.opts.filtrosUnidades.length
      ? p.opts.filtrosUnidades
      : [];
  const destsFiltResumo =
    p.opts && Array.isArray(p.opts.filtrosDestinos) && p.opts.filtrosDestinos.length
      ? p.opts.filtrosDestinos
      : [];

  const codsFiltResumo =
    p.opts && Array.isArray(p.opts.filtrosCodigos) && p.opts.filtrosCodigos.length
      ? p.opts.filtrosCodigos
      : [];
  const setCodigosResumo = montarSetCodigosFiltro(codsFiltResumo);

  const nfCount = (p.nfRows || []).length;
  let todas = expandLinhasResumoPick(p.nfRows, p.produtoPorDigitos);
  if (setCodigosResumo) {
    todas = todas.filter((it) => codigoPassaFiltro(it.codigo, setCodigosResumo));
  }
  const linhasAntesCons = todas.length;
  todas = filtrarConservacaoResumo(todas, cFilt);

  const rotaHtml = buildRotaUnidadesPorCidadeHtml(p.nfRows, p.geradoEm);

  let sheets = [];
  if (!todas.length && folhas !== 'dono') {
    sheets = [{ lines: [], cdDono: null }];
  } else {
    const raw = agruparSheetsResumoPicking(todas, folhas, p.nfRows);
    sheets = raw.length ? sortSheetsResumoPicking(raw, folhas, donoNomes) : [{ lines: [], cdDono: null }];
  }

  const isContinuo = folhas === 'continuo';
  const lastIdx = sheets.length - 1;

  function mkInnerPickingRows(lines) {
    if (!lines.length) return { rows: '', vol: 0, peso: 0 };
    let L = ordenarLinhasPick(lines, ordem);
    if (agruparItens) L = agregarLinhasPorCodigoUnidade(L);
    let sum = 0;
    let sumPeso = 0;
    let rows = '';
    for (const it of L) {
      sum += Number(it.quantidade) || 0;
      sumPeso += pesoItemKg(it);
      const rawCod = (it.codigo || '').trim();
      const codEx = esc(mascaraCodigoOl(rawCod) || rawCod);
      rows += `<tr><td>${codEx}</td><td>${esc(it.descricao || '')}</td><td class="cen">${esc(
        it.unidade || ''
      )}</td><td class="num">${esc(String(it.quantidade))}</td></tr>`;
    }
    return { rows, vol: sum, peso: sumPeso };
  }

  /** Uma tabela única (folha já é de um só dono, ou contínuo com um dono). */
  function mkTablePicking(lines, tituloSec) {
    if (!lines.length) return { html: '', vol: 0, peso: 0 };
    const inner = mkInnerPickingRows(lines);
    const html = `<div class="tipo-bloco">
  <h2 class="tipo-tit">${esc(tituloSec)}</h2>
  <table class="rom-tbl-res">
    <thead><tr><th style="width:14%">Código</th><th>Descrição</th><th style="width:10%" class="cen">Unid.</th><th style="width:12%" class="num">Volumes</th></tr></thead>
    <tbody>${inner.rows}</tbody>
  </table>
  <div class="tipo-tot"><strong>${esc(String(inner.vol))} vol.</strong> &nbsp;|&nbsp; <strong>Peso:</strong> ${formatPesoKgBr(inner.peso)}</div>
</div>`;
    return { html, vol: inner.vol, peso: inner.peso };
  }

  /**
   * Listagem contínua com vários donos: um bloco por dono (evita misturar estoque na separação).
   */
  function mkTablePickingPorDono(lines, tituloSec) {
    if (!lines.length) return { html: '', vol: 0, peso: 0 };
    const chunks = chunkLinhasPorDonoOrdenado(lines, donoNomes);
    let totVol = 0;
    let totPeso = 0;
    let secoes = '';
    for (const [cdD, chunk] of chunks) {
      if (!chunk.length) continue;
      const inner = mkInnerPickingRows(chunk);
      totVol += inner.vol;
      totPeso += inner.peso;
      const nm =
        donoNomes[cdD] || (cdD === 0 ? 'Dono não informado na NF' : `Dono #${cdD}`);
      secoes += `<div class="pick-dono-sec">
  <div class="pick-dono-hd"><strong>Dono do estoque:</strong> ${esc(nm)}</div>
  <table class="rom-tbl-res">
    <thead><tr><th style="width:14%">Código</th><th>Descrição</th><th style="width:10%" class="cen">Unid.</th><th style="width:12%" class="num">Volumes</th></tr></thead>
    <tbody>${inner.rows}</tbody>
  </table>
  <div class="tipo-tot tipo-tot-dono"><strong>${esc(String(inner.vol))} vol.</strong> (este dono) &nbsp;|&nbsp; <strong>Peso:</strong> ${formatPesoKgBr(inner.peso)}</div>
</div>`;
    }
    const html = `<div class="tipo-bloco">
  <h2 class="tipo-tit">${esc(tituloSec)}</h2>
${secoes}
  <div class="tipo-tot"><strong>${esc(String(totVol))} vol.</strong> &nbsp;|&nbsp; <strong>Peso:</strong> ${formatPesoKgBr(totPeso)}</div>
</div>`;
    return { html, vol: totVol, peso: totPeso };
  }

  function mkTablePickingConservacao(lines, tituloSec) {
    if (!lines.length) return { html: '', vol: 0, peso: 0 };
    const multiDono = isContinuo && contagemDonosDistintos(lines) > 1;
    return multiDono ? mkTablePickingPorDono(lines, tituloSec) : mkTablePicking(lines, tituloSec);
  }

  const sheetsHtml = [];
  let page = 0;
  let grandVol = 0;
  let grandPeso = 0;
  sheets.forEach((sh, idx) => {
    const linesDono = sh.lines || [];
    page += 1;
    const breakAfter = !isContinuo && idx < lastIdx ? ' sheet-break' : '';
    const refLines = linesDono.filter((L) => L._bucket === 'REFRIG_CONG');
    const secoLines = linesDono.filter((L) => L._bucket === 'SECO_AMB');
    const showRef = cFilt === 'todos' || cFilt === 'refri';
    const showSeco = cFilt === 'todos' || cFilt === 'seco';

    let sheetVol = 0;
    let sheetPeso = 0;
    let bodyTipo = '';
    if (showRef && refLines.length) {
      const r = mkTablePickingConservacao(refLines, 'RESFRIADO / CONGELADO');
      bodyTipo += r.html;
      sheetVol += r.vol;
      sheetPeso += r.peso;
    }
    if (showSeco && secoLines.length) {
      const s = mkTablePickingConservacao(secoLines, 'SECO');
      bodyTipo += s.html;
      sheetVol += s.vol;
      sheetPeso += s.peso;
    }
    if (!bodyTipo) {
      let msg = 'Nenhum produto nesta folha para o filtro de conservação atual.';
      if (!nfCount) {
        msg =
          'Nenhuma NF-e encontrada para os filtros de unidade/destino selecionados. Confira a combinação ou limpe os filtros.';
      } else if (!linhasAntesCons && folhas !== 'dono') {
        msg = 'As NF-e do filtro não possuem itens em LINHAS_JSON.';
      } else if (folhas === 'dono' && !linesDono.length && (cFilt === 'refri' || cFilt === 'seco')) {
        const nmD =
          donoNomes[sh.cdDono] ||
          (sh.cdDono === 0 ? 'este dono' : `dono #${sh.cdDono}`);
        msg =
          `Nenhum item ${
            cFilt === 'refri' ? 'refrigerado/congelado' : 'seco/ambiente'
          } nas NF-e de ${nmD} nesta carga. Unidades abaixo são só deste dono.`;
      } else if (cFilt === 'refri' || cFilt === 'seco') {
        msg =
          `Nenhum item ${
            cFilt === 'refri' ? 'refrigerado/congelado' : 'seco/ambiente'
          } para os filtros de unidade/destino (${linhasAntesCons} linha(s) antes do filtro de conservação). Tente «Todos os produtos» ou outro destino.`;
      }
      bodyTipo = `<p class="pick-vazio">${esc(msg)}</p>`;
    }

    grandVol += sheetVol;
    grandPeso += sheetPeso;

    const totFolha =
      linesDono.length && (sheetVol > 0 || sheetPeso > 0)
        ? `<div class="res-tot-folha"><strong>Totais nesta folha:</strong> ${esc(String(sheetVol))} vol. &nbsp;|&nbsp; <strong>Peso:</strong> ${formatPesoKgBr(sheetPeso)}</div>`
        : '';

    const metaBlock = htmlMetaFolhaResumo(linesDono, folhas, donoNomes, sh.cdDono);
    const nfRodape = nfRowsParaRodapeFolha(sh, p.nfRows, folhas);
    const rotaBlock =
      folhas === 'continuo'
        ? idx === lastIdx
          ? rotaHtml
          : ''
        : buildRotaUnidadesPorCidadeHtml(nfRodape, p.geradoEm);
    const temFiltroGeo = unidsFiltResumo.length > 0 || destsFiltResumo.length > 0;
    const temFiltroSubset = temFiltroGeo || cFilt !== 'todos';
    const labelTotGeral = temFiltroSubset ? 'Total filtrado (subset da carga)' : 'Total geral (carga)';
    const notaTotGeral = temFiltroSubset
      ? ' · Peso parcial — total da carga inteira: tela «Peso estimado» ou «Resumo programação».'
      : ' · Mesmo peso do «Resumo programação» e da tela da carga (PESO_KG × qCom).';
    const totGeralBlock =
      idx === lastIdx && sheets.length && (grandVol > 0 || grandPeso > 0)
        ? `<div class="res-tot-geral"><strong>${esc(labelTotGeral)}:</strong> ${esc(String(grandVol))} vol. &nbsp;|&nbsp; <strong>Peso:</strong> ${formatPesoKgBr(grandPeso)}<span class="res-tot-geral-nota">${esc(notaTotGeral)}</span></div>`
        : '';

    const subtFilt = htmlSubtituloFiltrosPicking(
      cFilt,
      folhas,
      agruparItens,
      'resumo',
      unidsFiltResumo,
      destsFiltResumo,
      codsFiltResumo
    );

    sheetsHtml.push(`<section class="rom-sheet-resumo${breakAfter}">
  <header class="pick-hdr">
    <div class="pick-hdr-left">GESTÃO DE ESTOQUE</div>
    <div class="pick-hdr-mid">Atlas Cargo</div>
    <div class="pick-hdr-carga">
      <div class="pick-hdr-carga-lbl">Número da Carga</div>
      <div class="pick-hdr-carga-num">${esc(cd)}</div>
    </div>
  </header>
  <h1 class="pick-title">PICKING — Romaneio de carga</h1>
  <div class="pick-subtit">${subtFilt}</div>
  <div class="res-meta">Impresso em: <strong>${formatDhBr(p.geradoEm)}</strong></div>
  <div class="res-meta">Placa: <strong>${placa}</strong> &nbsp;|&nbsp; <strong>Descrição da carga:</strong> ${descCarga}</div>
  <div class="res-meta"><strong>Rota:</strong> ${nmRota}</div>
  ${metaBlock}
  <div class="pick-box">
    <div><strong>Conferência / Separação</strong></div>
    <div class="pick-box-line">Data: ___ / ___ / ______ &nbsp; Início: ___:___ &nbsp; Término: ___:___</div>
    <div class="pick-box-line">Responsável: ________________________________________________</div>
  </div>
  ${bodyTipo}
  ${totFolha}
  ${rotaBlock}
  ${totGeralBlock}
  <footer class="res-foot">Página ${page} de __TOTAL__ — Resumo carga WMS</footer>
</section>`);
  });

  if (!sheetsHtml.length) {
    sheetsHtml.push(`<section class="rom-sheet-resumo"><p>Nenhum item na carga para o filtro selecionado.</p>${rotaHtml}</section>`);
  }
  const total = sheetsHtml.length;
  const body = sheetsHtml.join('\n').replace(/__TOTAL__/g, String(total));

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Resumo picking — Carga ${esc(cd)}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 8px; color: #111; font-size: 9.5pt; }
    .rom-sheet-resumo { max-width: 190mm; margin: 0 auto 10px; padding: 0 4px 10px; }
    .sheet-break { page-break-after: always; }
    @media print {
      body { padding: 0; margin: 0; }
      .rom-sheet-resumo { max-width: none; margin: 0; }
      .sheet-break { page-break-after: always; }
    }
    .pick-hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #222; padding-bottom: 8px; margin-bottom: 10px; gap: 8px; }
    .pick-hdr-left { font-size: 8pt; font-weight: 700; color: #333; }
    .pick-hdr-mid { font-size: 11pt; font-weight: 700; text-align: center; flex: 1; }
    .pick-hdr-carga { text-align: right; min-width: 100px; }
    .pick-hdr-carga-lbl { font-size: 8pt; text-decoration: underline; }
    .pick-hdr-carga-num { font-size: 22pt; font-weight: 800; line-height: 1.1; }
    .pick-title { font-size: 11pt; font-weight: 700; margin: 10px 0 4px; line-height: 1.35; text-align: center; }
    .pick-subtit { font-size: 8.5pt; color: #444; margin: 0 0 10px; line-height: 1.35; text-align: center; }
    .res-meta { font-size: 9pt; margin-bottom: 3px; }
    .res-dono { margin-top: 6px; padding: 6px 8px; background: #f0f9ff; border: 1px solid #93c5fd; border-radius: 4px; }
    .pick-box { border: 1px solid #333; padding: 8px 10px; margin: 10px 0 12px; border-radius: 4px; font-size: 8.5pt; }
    .pick-box-line { margin-top: 5px; }
    .tipo-bloco { margin-top: 14px; page-break-inside: avoid; }
    .tipo-tit { font-size: 10pt; font-weight: 800; margin: 0 0 6px; text-transform: uppercase; letter-spacing: 0.02em; }
    .rom-tbl-res { width: 100%; border-collapse: collapse; }
    .rom-tbl-res th, .rom-tbl-res td { border: 1px solid #333; padding: 4px 6px; vertical-align: top; }
    .rom-tbl-res th { background: #e8e8e8; font-size: 8pt; text-align: left; }
    .rom-tbl-res .num { text-align: right; font-variant-numeric: tabular-nums; }
    .rom-tbl-res .cen { text-align: center; }
    .tipo-tot { text-align: right; margin-top: 6px; font-size: 9pt; }
    .pick-dono-sec { margin-top: 14px; page-break-inside: avoid; border-left: 3px solid #0369a1; padding-left: 10px; }
    .pick-dono-hd { font-size: 9.5pt; font-weight: 700; margin-bottom: 6px; color: #0c4a6e; }
    .tipo-tot-dono { text-align: right; margin-top: 4px; font-size: 8.5pt; color: #334155; }
    .res-dono-hint { margin-top: 4px; font-size: 8pt; color: #475569; font-weight: 400; border: 0; background: transparent; padding: 0; }
    .res-tot-folha { margin-top: 12px; padding: 8px 10px; border: 1px solid #222; border-radius: 4px; font-size: 9.5pt; background: #fafafa; }
    .res-tot-geral { margin-top: 12px; padding: 10px 12px; border: 2px solid #111; border-radius: 4px; font-size: 10pt; font-weight: 700; background: #f1f5f9; }
    .res-tot-geral-nota { display: block; margin-top: 6px; font-size: 8.5pt; font-weight: 500; color: #475569; line-height: 1.35; }
    .rota-blk { margin-top: 18px; font-size: 9pt; page-break-inside: avoid; }
    .rota-hr { font-family: ui-monospace, Consolas, monospace; font-size: 8pt; color: #333; margin: 4px 0; overflow: hidden; }
    .rota-tit { font-weight: 700; margin: 6px 0; }
    .rota-cidades-cols { column-count: 2; column-gap: 22px; }
    .rota-cid { margin-top: 10px; break-inside: avoid; }
    .rota-ul { margin: 4px 0 0 18px; padding: 0; }
    .rota-empty { margin: 4px 0 0; color: #666; }
    .res-foot { margin-top: 12px; padding-top: 6px; border-top: 1px solid #999; font-size: 8pt; color: #444; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

/**
 * @param {{ carga: object, totais: object, itensConsolidados: object[], destinos: object[], geradoEm: string }} payload
 */
function buildRomaneioResumoHtml(payload) {
  const c = payload.carga || {};
  const titulo = esc(c.NM_DESCRICAO || `Carga #${c.CD_CARGA || ''}`);
  const cd = esc(c.CD_CARGA != null ? String(c.CD_CARGA) : '');
  const motorista = esc((c.NM_MOTORISTA || '').trim() || '—');
  const placa = esc((c.PLACA || '').trim() || '—');
  const rota = esc((c.NM_ROTA || '').trim() || '—');
  const st = esc((c.ST_CARGA || '').trim() || '—');
  const stEx = esc((c.ST_EXPEDICAO || '').trim() || '—');
  const conf = esc((c.NM_CONFERENTE || '').trim() || '—');
  const dhIni = formatDhBr(c.DH_INICIO);
  const dhSaida = formatDhBr(c.DH_SAIDA);
  const tot = payload.totais || {};
  const itens = Array.isArray(payload.itensConsolidados) ? payload.itensConsolidados : [];
  const destinos = Array.isArray(payload.destinos) ? payload.destinos : [];

  let destHtml = '';
  for (const d of destinos) {
    const nfs = esc([d.numeroNf, d.serie].filter(Boolean).join(' / ') || '—');
    destHtml += `<section class="blk">
  <div class="blk-hd">Ordem ${esc(d.ordem != null ? String(d.ordem) : '—')} — NF ${nfs}</div>
  <div><strong>${esc(d.nomeDest || '—')}</strong></div>
  <div class="muted">CNPJ ${formatDocBr(d.cnpjDest)}</div>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Código</th><th>Descrição</th><th>Un.</th><th class="num">Qtd</th></tr></thead><tbody>`;
    const arr = Array.isArray(d.itens) ? d.itens : [];
    if (!arr.length) {
      destHtml += '<tr><td colspan="4">Sem itens no JSON desta NF.</td></tr>';
    } else {
      for (const it of arr) {
        destHtml += `<tr><td>${esc(it.codigo || '')}</td><td>${esc(it.descricao || '')}</td><td>${esc(
          it.unidade || ''
        )}</td><td class="num">${esc(String(it.quantidade != null ? it.quantidade : ''))}</td></tr>`;
      }
    }
    destHtml += '</tbody></table></div></section>';
  }

  let consHtml = '';
  if (itens.length) {
    consHtml = `<h2>Itens consolidados (toda a carga)</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Código</th><th>Descrição</th><th>Un.</th><th class="num">Qtd total</th></tr></thead><tbody>`;
    for (const it of itens) {
      consHtml += `<tr><td>${esc(it.codigo || '')}</td><td>${esc(it.descricao || '')}</td><td>${esc(
        it.unidade || ''
      )}</td><td class="num">${esc(String(it.quantidade != null ? it.quantidade : ''))}</td></tr>`;
    }
    consHtml += '</tbody></table></div>';
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>Resumo da carga — ${titulo}</title>
  <style>
    @page { size: A4 portrait; margin: 10mm; }
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 14px; color: #111; font-size: 10.5pt; }
    h1 { font-size: 14pt; margin: 0 0 6px; }
    h2 { font-size: 11pt; margin: 18px 0 8px; border-bottom: 1px solid #333; padding-bottom: 4px; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; margin: 12px 0; font-size: 9.5pt; }
    .meta div { border: 1px solid #ccc; padding: 6px 8px; border-radius: 4px; background: #fafafa; }
    .muted { color: #444; font-size: 9pt; margin-top: 4px; }
    .blk { margin-top: 14px; padding: 10px 12px; border: 1px solid #333; border-radius: 6px; page-break-inside: avoid; }
    .blk-hd { font-weight: 700; margin-bottom: 8px; font-size: 10pt; }
    .tbl { width: 100%; border-collapse: collapse; margin-top: 6px; }
    .tbl th, .tbl td { border: 1px solid #333; padding: 5px 7px; vertical-align: top; }
    .tbl th { background: #e8e8e8; text-align: left; font-size: 9pt; }
    .tbl .num { text-align: right; font-variant-numeric: tabular-nums; }
    .tbl-wrap { overflow-x: auto; }
    .foot { margin-top: 16px; font-size: 8.5pt; color: #555; border-top: 1px solid #999; padding-top: 8px; }
    @media print { body { padding: 0; } .blk { page-break-inside: avoid; } }
  </style>
</head>
<body>
  <h1>Resumo agrupado da carga</h1>
  <div class="muted">Gerado em ${formatDhBr(payload.geradoEm)} — Atlas Cargo / WMS</div>
  <div class="meta">
    <div><strong>Carga</strong><br/>#${cd} — ${titulo}</div>
    <div><strong>Situação</strong><br/>Carga: ${st}<br/>Expedição: ${stEx}</div>
    <div><strong>Motorista / placa</strong><br/>${motorista}<br/>${placa}</div>
    <div><strong>Rota</strong><br/>${rota}</div>
    <div><strong>Conferente (expedição)</strong><br/>${conf}</div>
    <div><strong>Início / saída</strong><br/>${dhIni}<br/>${dhSaida}</div>
  </div>
  <p><strong>Total NF-e:</strong> ${esc(String(tot.nfes != null ? tot.nfes : 0))} &nbsp;|&nbsp; <strong>Itens distintos:</strong> ${esc(
    String(tot.itensDistintos != null ? tot.itensDistintos : 0)
  )} &nbsp;|&nbsp; <strong>Soma quantidades:</strong> ${esc(String(tot.volumes != null ? tot.volumes : 0))}</p>
  <h2>Destinos e notas (ordem de entrega)</h2>
  ${destHtml || '<p>Nenhuma NF vinculada a esta carga.</p>'}
  ${consHtml}
  <div class="foot">Documento para conferência de carregamento. Conferir volumes fisicamente com as NF-e originais.</div>
</body>
</html>`;
}

module.exports = {
  esc,
  buildRomaneioResumoHtml,
  buildRomaneioResumoPickingHtml,
  buildRomaneioCargaFriosOplHtml,
  collectDigitosCargaNfe,
  classificarFrioPorNcm,
  parseLinhasJson,
  chaveUnidadeDestinoNf,
  filtrarNfRowsPorUnidades,
  chaveDestinoEntregaNf,
  filtrarNfRowsPorDestinos,
  coletarProdutosCargaNfe,
};
