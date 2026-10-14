'use strict';

const { pool } = require('../config/db');
const { collectDigitosCargaNfe } = require('./wms-carga-relatorio-html.service');
const { digitosCodigoOl } = require('./wms-opl-relatorio-romaneio.service');
const { carregarMapaProdutosDonoPorDigitos } = require('./wms-produto-mapa-codigo.service');
const { nomeEntregaUnidadeOuLocalDestino } = require('./wms-nfe-saida-destino-display.service');
const {
  cnpj14Pad,
  carregarMapaNrRotaPorChaveImport,
  carregarIndiceRotaPorCodigoDestinatario,
  resolverNrRotaNfSaida,
  extrairNrRotaDescricaoCarga,
} = require('./cadastro-endereco-entrega-match.service');
const { buildWhereCargasProgramadas } = require('./wms-carga-programada-filtro.service');
const { bucketConservacaoLinha } = require('./wms-carga-resumo-logistico.service');

const MAX_CARGAS_RESUMO = 150;

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function toNumber(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function fmtQtdAviso(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '0';
  return x.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
}

function parseLinhasJson(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

async function carregarMapaProdutosDono(tenantId, cdDono, digitosList) {
  return carregarMapaProdutosDonoPorDigitos(tenantId, cdDono, digitosList);
}

/** Quantidade comercial da linha (não usar qTrib — em muitas NF-e é peso/volume tributável em kg). */
function qtdComercialLinha(ln) {
  const q = toNumber(ln.qCom ?? ln.quantidade);
  return q > 0 ? q : 0;
}

/** vProd na NF-e é valor total da linha; senão vUnCom × qCom. */
function valorLinhaNf(ln) {
  const vProd = toNumber(ln.vProd);
  if (vProd > 0) return vProd;
  const vu = toNumber(ln.vUnCom);
  const q = qtdComercialLinha(ln);
  if (vu > 0 && q > 0) return vu * q;
  return 0;
}

function valorNfNota(n, linhas) {
  const vnfCol = n.VNF_TOTAL != null ? toNumber(n.VNF_TOTAL) : 0;
  if (vnfCol > 0) return vnfCol;
  let sum = 0;
  for (const ln of linhas) {
    if (!ln || typeof ln !== 'object' || ln._meta) continue;
    sum += valorLinhaNf(ln);
  }
  return sum;
}

/**
 * Peso (kg) = PESO_KG do WMS_PRODUTO_DONO × qCom (XML), com split seco/frio
 * (mesma regra do resumo logístico da tela da carga).
 * @returns {{ qt: number, peso: number, pesoSeco: number, pesoFrio: number, linhasSemPesoCad: number, qtdSemPesoCad: number }}
 */
function pesoPesoLinhas(linhas, produtoPorDigitos) {
  let pesoSeco = 0;
  let pesoFrio = 0;
  let qt = 0;
  let linhasSemPesoCad = 0;
  let qtdSemPesoCad = 0;
  for (const ln of linhas) {
    if (!ln || typeof ln !== 'object' || ln._meta) continue;
    const dkey = digitosCodigoOl(ln.cProd || ln.codigo || '');
    if (!dkey) continue;
    const q = qtdComercialLinha(ln);
    if (q <= 0) continue;
    qt += q;
    const cad = produtoPorDigitos && produtoPorDigitos[dkey] ? produtoPorDigitos[dkey] : null;
    const w = cad && cad.PESO_KG != null ? Number(cad.PESO_KG) : NaN;
    if (Number.isFinite(w) && w > 0) {
      const pw = q * w;
      if (bucketConservacaoLinha(ln, produtoPorDigitos) === 'REFRIG_CONG') pesoFrio += pw;
      else pesoSeco += pw;
    } else {
      linhasSemPesoCad += 1;
      qtdSemPesoCad += q;
    }
  }
  const peso = pesoSeco + pesoFrio;
  return { qt, peso, pesoSeco, pesoFrio, linhasSemPesoCad, qtdSemPesoCad };
}

/** Peso da NF: planilha PesoNF (PESO_RESUMO_KG) se existir; senão PESO_KG × qCom.
 *  Com planilha, seco/frio são rateados pela composição das linhas. */
function pesoDaNf(n, linhas, produtoPorDigitos) {
  const linhaCalc = pesoPesoLinhas(linhas, produtoPorDigitos);
  const pr = n.PESO_RESUMO_KG != null ? Number(n.PESO_RESUMO_KG) : NaN;
  if (Number.isFinite(pr) && pr >= 0) {
    const base = linhaCalc.peso > 1e-9 ? linhaCalc.peso : 0;
    let pesoSeco = 0;
    let pesoFrio = 0;
    if (base > 0) {
      const f = pr / base;
      pesoSeco = linhaCalc.pesoSeco * f;
      pesoFrio = linhaCalc.pesoFrio * f;
    } else {
      pesoSeco = pr;
      pesoFrio = 0;
    }
    return {
      qt: linhaCalc.qt,
      peso: pr,
      pesoSeco,
      pesoFrio,
      linhasSemPesoCad: 0,
      qtdSemPesoCad: 0,
      fontePeso: 'PESO_RESUMO_KG',
    };
  }
  return { ...linhaCalc, fontePeso: 'cadastro_qCom' };
}

/** Mapa de produtos por CD_DONO (evita PESO_KG de outro dono quando o código se repete). */
async function carregarMapasProdutosPorDonos(tenantId, cdDonos, digitosList) {
  const donos = [...new Set((cdDonos || []).map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
  const mapas = {};
  if (donos.length) {
    for (const cd of donos) {
      mapas[cd] = await carregarMapaProdutosDono(tenantId, cd, digitosList);
    }
  } else {
    mapas._fallback = await carregarMapaProdutosDono(tenantId, null, digitosList);
  }
  return mapas;
}

function mapaProdutosParaDono(mapas, cdDono) {
  if (cdDono != null && Number.isFinite(Number(cdDono)) && mapas[Number(cdDono)]) {
    return mapas[Number(cdDono)];
  }
  return mapas._fallback || {};
}

function resolveCdDonoNf(nfRow, cargaRow) {
  if (nfRow && nfRow.CD_DONO != null && Number.isFinite(Number(nfRow.CD_DONO))) {
    return Number(nfRow.CD_DONO);
  }
  if (cargaRow && cargaRow.CD_DONO != null && Number.isFinite(Number(cargaRow.CD_DONO))) {
    return Number(cargaRow.CD_DONO);
  }
  return null;
}


/** Resumo usa os mesmos filtros da lista de cargas (sem forçar “não expedida”). */
function normalizarQueryResumoProgramacao(query) {
  return query && typeof query === 'object' ? { ...query } : {};
}

function subtotalFromLinhas(linhas) {
  return linhas.reduce(
    (acc, r) => {
      acc.qt += r.qt;
      acc.vlNf += r.vlNf;
      acc.pesoProduto += r.pesoProduto;
      acc.pesoSeco += Number(r.pesoSeco) || 0;
      acc.pesoFrio += Number(r.pesoFrio) || 0;
      return acc;
    },
    { qt: 0, vlNf: 0, pesoProduto: 0, pesoSeco: 0, pesoFrio: 0 }
  );
}

function roundSub(s) {
  return {
    qtdNfes: s.qtdNfes != null ? Number(s.qtdNfes) : undefined,
    qt: Number(s.qt.toFixed(4)),
    vlNf: Number(s.vlNf.toFixed(2)),
    pesoProduto: Number(s.pesoProduto.toFixed(3)),
    pesoSeco: Number((s.pesoSeco != null ? s.pesoSeco : 0).toFixed(3)),
    pesoFrio: Number((s.pesoFrio != null ? s.pesoFrio : 0).toFixed(3)),
  };
}

function subtotalFromLinhasComContagem(linhas) {
  const base = subtotalFromLinhas(linhas);
  base.qtdNfes = (linhas || []).length;
  return base;
}

/**
 * Resumo consolidado (planilha Valores): rotas (NM_DESCRICAO), cargas (CD_CARGA), uma linha por NF.
 */
async function montarResumoProgramacaoCargas(tenantId, query) {
  const queryEfetiva = normalizarQueryResumoProgramacao(query);
  const { where, params } = buildWhereCargasProgramadas(tenantId, queryEfetiva);
  const wc = `WHERE ${where.join(' AND ')}`;

  let rC;
  try {
    rC = await pool.query(
      `SELECT c."CD_CARGA", c."NM_DESCRICAO", c."CD_DONO", c."ST_CARGA", c."DH_CRIACAO"
         FROM "WMS_CARGA_PROGRAMADA" c
        ${wc}
        ORDER BY COALESCE(NULLIF(trim(c."NM_DESCRICAO"), ''), '(sem descrição)'), c."CD_CARGA"
        LIMIT ${MAX_CARGAS_RESUMO}`,
      params
    );
  } catch (e) {
    if (schemaMissing(e)) return { err: 'schema', message: e.message };
    throw e;
  }

  const cargas = rC.rows || [];
  if (!cargas.length) {
    return {
      filtros: query,
      limiteCargas: MAX_CARGAS_RESUMO,
      qtdCargas: 0,
      rotas: [],
      totalGeral: roundSub({ qt: 0, vlNf: 0, pesoProduto: 0, pesoSeco: 0, pesoFrio: 0 }),
      aviso: 'Nenhuma carga encontrada com os filtros informados.',
    };
  }

  const ids = cargas.map((c) => c.CD_CARGA);
  const rN = await pool.query(
    `SELECT j."CD_CARGA", j."ORDEM", n.*
       FROM "WMS_CARGA_PROGRAMADA_NFE" j
       JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
      WHERE j."CD_CARGA" = ANY($1::integer[]) AND n."TENANT_ID" = $2
      ORDER BY j."CD_CARGA", j."ORDEM", j."CD_NFE_SAIDA"`,
    [ids, tenantId]
  );
  const nfesPorCarga = new Map();
  for (const row of rN.rows || []) {
    const id = row.CD_CARGA;
    if (!nfesPorCarga.has(id)) nfesPorCarga.set(id, []);
    nfesPorCarga.get(id).push(row);
  }

  const allNfes = rN.rows || [];
  const cargaPorId = new Map(cargas.map((c) => [c.CD_CARGA, c]));
  const cdDonosUsados = new Set();
  for (const c of cargas) {
    if (c.CD_DONO != null && Number.isFinite(Number(c.CD_DONO))) cdDonosUsados.add(Number(c.CD_DONO));
  }
  for (const n of allNfes) {
    const cd = resolveCdDonoNf(n, cargaPorId.get(n.CD_CARGA));
    if (cd != null) cdDonosUsados.add(cd);
  }
  const digitos = collectDigitosCargaNfe(allNfes);
  const mapasProdutosPorDono = await carregarMapasProdutosPorDonos(tenantId, [...cdDonosUsados], digitos);
  let totalLinhasSemPesoCad = 0;
  let totalQtdSemPesoCad = 0;
  const cnpjsEntrega = allNfes.map((n) => cnpj14Pad(n.CNPJ_ENTREGA || n.CNPJ_DEST)).filter((c) => c.length === 14);
  const mapaNrRota = await carregarMapaNrRotaPorChaveImport(pool, tenantId, cnpjsEntrega);
  /** Fallback: pelo código no nome do ponto (ex.: "1002 - KRONA"), pega NR_ROTA mesmo
   *  quando a chave exata XML×cadastro diverge (logradouro/número distinto). */
  const indiceRotaPorCod = await carregarIndiceRotaPorCodigoDestinatario(pool, tenantId);

  const rotaMap = new Map();

  for (const c of cargas) {
    const dsCarga = String(c.NM_DESCRICAO || '').trim() || '(sem descrição)';
    const cdCarga = c.CD_CARGA;
    const nfes = nfesPorCarga.get(cdCarga) || [];

    if (!rotaMap.has(dsCarga)) {
      rotaMap.set(dsCarga, { dsCarga, cargas: [], subtotal: null });
    }
    const rota = rotaMap.get(dsCarga);

    const linhasCarga = [];
    for (const n of nfes) {
      const linhas = parseLinhasJson(n.LINHAS_JSON);
      const cdDonoNf = resolveCdDonoNf(n, c);
      const produtoPorDigitos = mapaProdutosParaDono(mapasProdutosPorDono, cdDonoNf);
      const { qt, peso, pesoSeco, pesoFrio, linhasSemPesoCad, qtdSemPesoCad } = pesoDaNf(
        n,
        linhas,
        produtoPorDigitos
      );
      totalLinhasSemPesoCad += linhasSemPesoCad;
      totalQtdSemPesoCad += qtdSemPesoCad;
      const vlNf = valorNfNota(n, linhas);
      const { nrRota: nrRotaCad } = await resolverNrRotaNfSaida(
        pool,
        tenantId,
        n,
        mapaNrRota,
        indiceRotaPorCod,
        { nrRotaHint: extrairNrRotaDescricaoCarga(c.NM_DESCRICAO) }
      );
      const cnpjEnt = cnpj14Pad(n.CNPJ_ENTREGA || n.CNPJ_DEST);
      linhasCarga.push({
        dsCarga,
        id: cdCarga,
        numeroNf: n.NUMERO_NF != null ? String(n.NUMERO_NF) : null,
        serieNf: n.SERIE != null ? String(n.SERIE).trim() : null,
        nrRotaCad: nrRotaCad != null ? nrRotaCad : null,
        enxMun: String(n.XMUN_DEST || '').trim() || '—',
        enxUf: String(n.UF_DEST || '').trim().toUpperCase().slice(0, 2) || '—',
        enxNome: nomeEntregaUnidadeOuLocalDestino(n) || '—',
        cnpjEntrega: cnpjEnt.length === 14 ? cnpjEnt : null,
        enderecoLogradouro: String(n.XLGR_DEST || '').trim(),
        enderecoNumero: String(n.NRO_DEST == null ? '' : n.NRO_DEST).trim() || 'S/N',
        enderecoComplemento: String(n.XCPL_DEST || '').trim(),
        enderecoCep: String(n.CEP_DEST || '').replace(/\D/g, ''),
        qt: Number(qt.toFixed(4)),
        vlNf: Number(vlNf.toFixed(2)),
        pesoProduto: Number(peso.toFixed(3)),
        pesoSeco: Number((pesoSeco || 0).toFixed(3)),
        pesoFrio: Number((pesoFrio || 0).toFixed(3)),
      });
    }

    linhasCarga.sort((a, b) => {
      const ra = a.nrRotaCad != null ? a.nrRotaCad : 99999;
      const rb = b.nrRotaCad != null ? b.nrRotaCad : 99999;
      if (ra !== rb) return ra - rb;
      const cm = String(a.enxMun).localeCompare(String(b.enxMun), 'pt-BR');
      if (cm !== 0) return cm;
      return String(a.enxNome).localeCompare(String(b.enxNome), 'pt-BR');
    });

    const subCarga = roundSub(subtotalFromLinhasComContagem(linhasCarga));
    rota.cargas.push({
      id: cdCarga,
      dsCarga,
      stCarga: c.ST_CARGA,
      qtdNfes: nfes.length,
      linhas: linhasCarga,
      subtotal: subCarga,
    });
  }

  const rotas = [];
  let totalGeral = { qtdNfes: 0, qt: 0, vlNf: 0, pesoProduto: 0, pesoSeco: 0, pesoFrio: 0 };

  for (const rota of rotaMap.values()) {
    const subRota = roundSub(
      rota.cargas.reduce(
        (acc, cg) => {
          acc.qtdNfes += cg.subtotal.qtdNfes || 0;
          acc.qt += cg.subtotal.qt;
          acc.vlNf += cg.subtotal.vlNf;
          acc.pesoProduto += cg.subtotal.pesoProduto;
          acc.pesoSeco += cg.subtotal.pesoSeco || 0;
          acc.pesoFrio += cg.subtotal.pesoFrio || 0;
          return acc;
        },
        { qtdNfes: 0, qt: 0, vlNf: 0, pesoProduto: 0, pesoSeco: 0, pesoFrio: 0 }
      )
    );
    rota.subtotal = subRota;
    rotas.push(rota);
    totalGeral.qtdNfes += subRota.qtdNfes || 0;
    totalGeral.qt += subRota.qt;
    totalGeral.vlNf += subRota.vlNf;
    totalGeral.pesoProduto += subRota.pesoProduto;
    totalGeral.pesoSeco += subRota.pesoSeco || 0;
    totalGeral.pesoFrio += subRota.pesoFrio || 0;
  }

  rotas.sort((a, b) => a.dsCarga.localeCompare(b.dsCarga, 'pt-BR'));
  for (const r of rotas) {
    r.cargas.sort((a, b) => a.id - b.id);
  }

  totalGeral = roundSub(totalGeral);

  let aviso = null;
  if (cargas.length >= MAX_CARGAS_RESUMO) {
    aviso = `Limite de ${MAX_CARGAS_RESUMO} cargas no relatório. Refine os filtros se faltar alguma carga.`;
  }
  const semValor = allNfes.some((n) => {
    const linhas = parseLinhasJson(n.LINHAS_JSON);
    return valorNfNota(n, linhas) <= 0;
  });
  if (semValor && allNfes.length) {
    aviso = (aviso ? aviso + ' ' : '') +
      'Algumas NF-e não têm valor (vProd/vNF): reimporte o XML de saída para preencher Vl NF.';
  }
  if (totalLinhasSemPesoCad > 0) {
    aviso =
      (aviso ? aviso + ' ' : '') +
      `${totalLinhasSemPesoCad} linha(s) de item sem PESO_KG no cadastro WMS (≈ ${fmtQtdAviso(totalQtdSemPesoCad)} un. qCom omitidas do peso). Revise Cadastros WMS → Produtos.`;
  }
  if (cdDonosUsados.size === 0 && allNfes.length) {
    aviso =
      (aviso ? aviso + ' ' : '') +
      'Cargas/NF-e sem CD_DONO: o peso usa cadastro sem filtrar dono (pode divergir do seu controle por dono).';
  }

  let qtdNfSemEnderecoCad = 0;
  for (const rota of rotas) {
    for (const cg of rota.cargas || []) {
      for (const ln of cg.linhas || []) {
        if (ln.nrRotaCad == null) qtdNfSemEnderecoCad += 1;
      }
    }
  }
  if (qtdNfSemEnderecoCad > 0) {
    aviso =
      (aviso ? aviso + ' ' : '') +
      `${qtdNfSemEnderecoCad} NF-e sem ponto de entrega no Cadastro Geral (Gerenciar Cadastro Geral → Endereços de entrega). Veja a lista por carga no resumo executivo e no detalhe «Sem cadastro».`;
  }

  return {
    filtros: query,
    filtrosEfetivos: queryEfetiva,
    limiteCargas: MAX_CARGAS_RESUMO,
    qtdCargas: cargas.length,
    rotas,
    totalGeral,
    aviso,
    legenda: {
      dsCarga: 'Descrição da carga (rota / programação).',
      id: 'Código CD_CARGA.',
      qt: 'Soma das quantidades (qCom) dos itens da NF.',
      vlNf: 'Valor da NF (vNF do XML ou soma vProd das linhas).',
      pesoProduto:
        'Com PESO_RESUMO_KG na NF (planilha PesoNF): usa esse valor. Senão: PESO_KG do cadastro × qCom do XML. Não usa pesoB da NF-e.',
      pesoSeco:
        'Peso ambiente/seco — mesma classificação do card Seco (kg) ao abrir a carga (TIPO_ARMAZENAGEM + NCM + descrição).',
      pesoFrio:
        'Peso refrigerado/congelado — mesma classificação do card Refrig./cong. (kg) ao abrir a carga.',
      nrRotaCad:
        'Nº rota do Cadastro Geral → Endereços de entrega (match por CNPJ + nome do ponto + logradouro + nº + CEP). Sem match: badge «Sem cadastro» e lista da NF no relatório.',
      enxMun: 'Município de entrega da NF-e (XML).',
      enxNome: 'Nome do ponto/unidade de entrega na NF-e.',
    },
  };
}

/**
 * Totais de peso (seco/frio/geral) por carga — para enriquecer a lista da grid.
 * Mesma regra do resumo/detalhe; sem resolução de rota (mais leve).
 */
async function agregarPesosConservacaoPorCargas(tenantId, cdCargas) {
  const ids = [...new Set((cdCargas || []).map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n)))];
  const out = new Map();
  if (!ids.length) return out;

  /** PESO_RESUMO_KG é opcional (script adicionar_wms_nfe_saida_peso_resumo_postgres.sql). */
  let rN;
  try {
    rN = await pool.query(
      `SELECT j."CD_CARGA", n."CD_DONO", n."LINHAS_JSON", n."PESO_RESUMO_KG", n."VNF_TOTAL"
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
        WHERE j."CD_CARGA" = ANY($1::integer[]) AND n."TENANT_ID" = $2`,
      [ids, tenantId]
    );
  } catch (eCol) {
    if (!schemaMissing(eCol)) throw eCol;
    rN = await pool.query(
      `SELECT j."CD_CARGA", n."CD_DONO", n."LINHAS_JSON", n."VNF_TOTAL"
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
        WHERE j."CD_CARGA" = ANY($1::integer[]) AND n."TENANT_ID" = $2`,
      [ids, tenantId]
    );
  }
  const nfesPorCarga = new Map();
  const cdDonos = new Set();
  for (const row of rN.rows || []) {
    const id = row.CD_CARGA;
    if (!nfesPorCarga.has(id)) nfesPorCarga.set(id, []);
    nfesPorCarga.get(id).push(row);
    if (row.CD_DONO != null && Number.isFinite(Number(row.CD_DONO))) cdDonos.add(Number(row.CD_DONO));
  }
  const digitos = collectDigitosCargaNfe(rN.rows || []);
  const mapas = await carregarMapasProdutosPorDonos(tenantId, [...cdDonos], digitos);

  for (const id of ids) {
    let pesoProduto = 0;
    let pesoSeco = 0;
    let pesoFrio = 0;
    for (const n of nfesPorCarga.get(id) || []) {
      const linhas = parseLinhasJson(n.LINHAS_JSON);
      const cdDono = n.CD_DONO != null && Number.isFinite(Number(n.CD_DONO)) ? Number(n.CD_DONO) : null;
      const mapa = mapaProdutosParaDono(mapas, cdDono);
      const p = pesoDaNf(n, linhas, mapa);
      pesoProduto += p.peso || 0;
      pesoSeco += p.pesoSeco || 0;
      pesoFrio += p.pesoFrio || 0;
    }
    out.set(id, {
      pesoProduto: Number(pesoProduto.toFixed(3)),
      pesoSeco: Number(pesoSeco.toFixed(3)),
      pesoFrio: Number(pesoFrio.toFixed(3)),
    });
  }
  return out;
}

module.exports = {
  montarResumoProgramacaoCargas,
  agregarPesosConservacaoPorCargas,
  MAX_CARGAS_RESUMO,
};
