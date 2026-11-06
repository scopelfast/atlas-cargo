'use strict';

const { pool } = require('../config/db');
const {
  digitosCodigoOl,
  classificarConservacaoDetalhe,
} = require('./wms-opl-relatorio-romaneio.service');
const { carregarMapaProdutosDonoPorDigitos } = require('./wms-produto-mapa-codigo.service');
const { classificarFrioPorNcm } = require('./wms-carga-relatorio-html.service');

/** Cache curto em memória (evita recalcular a cada clique na reunião). */
let _cache = { key: null, at: 0, payload: null };
const CACHE_MS = 60 * 1000;

function toNumber(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
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
  if (raw && typeof raw === 'object') return Array.isArray(raw) ? raw : [];
  return [];
}

function qtdComercialLinha(ln) {
  const q = toNumber(ln.qCom ?? ln.quantidade);
  return q > 0 ? q : 0;
}

/** Conservação em 3 faixas (mesma regra do romaneio/OPL). */
function pesoSplitLinhas(linhas, produtoPorDigitos) {
  let pesoSeco = 0;
  let pesoResfriado = 0;
  let pesoCongelado = 0;
  for (const ln of linhas) {
    if (!ln || typeof ln !== 'object' || ln._meta) continue;
    const dkey = digitosCodigoOl(ln.cProd || ln.codigo || '');
    if (!dkey) continue;
    const q = qtdComercialLinha(ln);
    if (q <= 0) continue;
    const cad = produtoPorDigitos && produtoPorDigitos[dkey] ? produtoPorDigitos[dkey] : null;
    const w = cad && cad.PESO_KG != null ? Number(cad.PESO_KG) : NaN;
    if (!(Number.isFinite(w) && w > 0)) continue;
    const pw = q * w;
    const desc = String(ln.xProd || ln.descricao || '').trim();
    let det = classificarConservacaoDetalhe(desc, cad);
    /** Alinha com resumo de carga: NCM da linha pode abrir frio se cadastro não fechou seco */
    if (det.bucket === 'SECO_AMB') {
      const tipoNcm = classificarFrioPorNcm(ln.NCM != null ? ln.NCM : ln.ncm);
      if (tipoNcm) det = { bucket: 'REFRIG_CONG', frioTipo: tipoNcm };
    }
    if (det.bucket === 'REFRIG_CONG') {
      if (det.frioTipo === 'CONGELADO') pesoCongelado += pw;
      else pesoResfriado += pw;
    } else {
      pesoSeco += pw;
    }
  }
  const pesoFrio = pesoResfriado + pesoCongelado;
  return {
    pesoSeco,
    pesoResfriado,
    pesoCongelado,
    pesoFrio,
    peso: pesoSeco + pesoFrio,
  };
}

function pesoDaNf(n, linhas, mapa) {
  const calc = pesoSplitLinhas(linhas, mapa);
  const pr = n.PESO_RESUMO_KG != null ? Number(n.PESO_RESUMO_KG) : NaN;
  if (Number.isFinite(pr) && pr > 0) {
    const base = calc.peso > 1e-9 ? calc.peso : 0;
    if (base > 0) {
      const f = pr / base;
      return {
        peso: pr,
        pesoSeco: calc.pesoSeco * f,
        pesoResfriado: calc.pesoResfriado * f,
        pesoCongelado: calc.pesoCongelado * f,
        pesoFrio: calc.pesoFrio * f,
      };
    }
    return {
      peso: pr,
      pesoSeco: pr,
      pesoResfriado: 0,
      pesoCongelado: 0,
      pesoFrio: 0,
    };
  }
  return calc;
}

function nomeCurto(ponto) {
  const s = String(ponto || '');
  const m = s.match(/[-–]\s*[0-9]{3,5}\s*[-–]\s*(.+)$/);
  if (m) return m[1].trim();
  return (
    s
      .replace(/^MANA DO BRASIL[^.]*?\.\s*A\.?\s*[-–]?\s*/i, '')
      .replace(/^NUTRIVILLE RESTAURANTE LTDA\s*[-–]?\s*/i, '')
      .trim() || s
  );
}

function codOl(ponto) {
  const m = String(ponto || '').match(/[-–]\s*([0-9]{3,5})\s*[-–]/);
  return m ? m[1] : null;
}

/**
 * BI ao vivo: volume/valor/seco-frio por unidade × mês (PR/SC, Mana+Nutriville).
 * @param {string} tenantId
 * @param {{ forceRefresh?: boolean }} [opts]
 */
async function montarBiVolumePrSc(tenantId, opts = {}) {
  const tid = String(tenantId || 'default');
  /** v5: dia operacional = saída/início da expedição da carga (não emissão da NF) */
  const cacheKey = tid + ':v5-dia-expedicao';
  const now = Date.now();
  if (!opts.forceRefresh && _cache.key === cacheKey && _cache.payload && now - _cache.at < CACHE_MS) {
    return { ..._cache.payload, cache: true, cacheAgeMs: now - _cache.at };
  }

  const t0 = Date.now();
  const nfs = await pool.query(
    `
    SELECT
      n."CD_NFE_SAIDA",
      n."CD_DONO",
      n."DH_EMISSAO",
      /* Visita/viagem = dia da operação de expedição (Confirmar saída / Início exp.), não emissão da NF.
         Ex.: carga 416 criada/emitida 01/09, início exp. 02/09 → conta em 02/09. */
      COALESCE(ex."DH_SAIDA", ex."DH_INICIO", n."DH_SAIDA", n."DH_EMISSAO") AS dh_operacional,
      UPPER(TRIM(COALESCE(n."UF_DEST",''))) AS uf,
      n."CD_ENDERECO_ENTREGA" AS cd_end,
      n."XMUN_DEST",
      n."XNOME_ENTREGA",
      n."XNOME_DEST",
      n."VNF_TOTAL",
      n."PESO_RESUMO_KG",
      n."LINHAS_JSON",
      e."DS_PONTO_ENTREGA" AS ponto,
      COALESCE(e."NM_MUNICIPIO", n."XMUN_DEST") AS cidade,
      e."LATITUDE" AS lat,
      e."LONGITUDE" AS lng,
      e."NR_ROTA" AS rota,
      CASE
        WHEN c."CD_CARGA" IS NOT NULL
          AND UPPER(COALESCE(c."NM_DESCRICAO", '')) NOT LIKE '%BAIXA%'
        THEN c."CD_CARGA"
        ELSE NULL
      END AS cd_carga,
      CASE
        WHEN c."CD_CARGA" IS NOT NULL
          AND UPPER(COALESCE(c."NM_DESCRICAO", '')) LIKE '%BAIXA%'
        THEN TRUE
        ELSE FALSE
      END AS fg_baixa
    FROM "WMS_NFE_SAIDA" n
    LEFT JOIN "CADASTRO_ENDERECO_ENTREGA" e
      ON e."CD_ENDERECO_ENTREGA" = n."CD_ENDERECO_ENTREGA"
    LEFT JOIN "WMS_CARGA_PROGRAMADA_NFE" j
      ON j."CD_NFE_SAIDA" = n."CD_NFE_SAIDA"
    LEFT JOIN "WMS_CARGA_PROGRAMADA" c
      ON c."CD_CARGA" = j."CD_CARGA"
    LEFT JOIN "WMS_EXPEDICAO_CARGA" ex
      ON ex."CD_CARGA" = j."CD_CARGA"
     AND ex."TENANT_ID" = n."TENANT_ID"
    WHERE n."TENANT_ID" = $1
      AND n."CD_DONO" IN (1, 2)
      AND UPPER(TRIM(COALESCE(n."UF_DEST",''))) IN ('PR','SC')
      AND COALESCE(ex."DH_SAIDA", ex."DH_INICIO", n."DH_SAIDA", n."DH_EMISSAO") IS NOT NULL
  `,
    [tid]
  );

  const digitos = new Set();
  for (const n of nfs.rows) {
    for (const ln of parseLinhasJson(n.LINHAS_JSON)) {
      if (!ln || ln._meta) continue;
      const d = digitosCodigoOl(ln.cProd || ln.codigo || '');
      if (d) digitos.add(d);
    }
  }
  const digitosList = [...digitos];
  const mapa1 = await carregarMapaProdutosDonoPorDigitos(tid, 1, digitosList);
  const mapa2 = await carregarMapaProdutosDonoPorDigitos(tid, 2, digitosList);

  const agg = new Map();
  let pesoTotal = 0;
  let secoTotal = 0;
  let frioTotal = 0;
  let valorTotal = 0;
  let ini = null;
  let fim = null;

  let nfsBaixaIgnoradas = 0;
  for (const n of nfs.rows) {
    // NFs só em carga "Baixa estoque" não são entrega operacional (não contam peso/NF/dia)
    if (n.fg_baixa === true || n.fg_baixa === 't' || n.fg_baixa === 'true') {
      nfsBaixaIgnoradas += 1;
      continue;
    }
    const linhas = parseLinhasJson(n.LINHAS_JSON);
    const mapa = Number(n.CD_DONO) === 2 ? mapa2 : mapa1;
    const { peso, pesoSeco, pesoResfriado, pesoCongelado, pesoFrio } = pesoDaNf(n, linhas, mapa);
    const valor = toNumber(n.VNF_TOTAL);
    pesoTotal += peso;
    secoTotal += pesoSeco || 0;
    frioTotal += pesoFrio || 0;
    valorTotal += valor;

    const dhRaw = n.dh_operacional || n.DH_OPERACIONAL || n.DH_EMISSAO;
    const dh = dhRaw ? new Date(dhRaw) : null;
    if (dh && !Number.isNaN(dh.getTime())) {
      if (!ini || dh < ini) ini = dh;
      if (!fim || dh > fim) fim = dh;
    }
    const mes = dh
      ? `${dh.getFullYear()}-${String(dh.getMonth() + 1).padStart(2, '0')}`
      : null;
    if (!mes) continue;

    const dono = Number(n.CD_DONO) === 2 ? 'Nutriville' : 'Mana';
    const key = [
      mes,
      n.uf,
      n.cd_end != null
        ? `E${n.cd_end}`
        : `X|${n.uf}|${n.cidade || ''}|${n.ponto || n.XNOME_ENTREGA || n.XNOME_DEST || ''}`,
    ].join('||');

    if (!agg.has(key)) {
      agg.set(key, {
        mes,
        uf: n.uf,
        cdDono: Number(n.CD_DONO),
        dono,
        cdEnd: n.cd_end,
        ponto: n.ponto || n.XNOME_ENTREGA || n.XNOME_DEST || null,
        cidade: n.cidade || n.XMUN_DEST || null,
        lat: n.lat != null ? Number(n.lat) : null,
        lng: n.lng != null ? Number(n.lng) : null,
        rota: n.rota,
        qtdNf: 0,
        /** dias distintos com NF (unidade×dia = 1 visita/entrega operacional) */
        _dias: new Set(),
        /** dias com pelo menos 1 carga operacional (excl. baixa estoque) */
        _diasCarga: new Set(),
        /** cargas operacionais — união no front = viagens da frota no recorte */
        _cargas: new Set(),
        /** detalhe dia → NF/peso/cargas (agenda do mês no front) */
        _porDia: new Map(),
        valor: 0,
        pesoKg: 0,
        pesoSecoKg: 0,
        pesoFrioKg: 0,
      });
    }
    const a = agg.get(key);
    a.qtdNf += 1;
    // YYYY-MM-DD em horário local (evita UTC deslocar o dia)
    const diaKey =
      dh.getFullYear() +
      '-' +
      String(dh.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(dh.getDate()).padStart(2, '0');
    a._dias.add(diaKey);
    if (!a._porDia.has(diaKey)) {
      a._porDia.set(diaKey, {
        dia: diaKey,
        qtdNf: 0,
        valor: 0,
        pesoKg: 0,
        pesoSecoKg: 0,
        pesoResfriadoKg: 0,
        pesoCongeladoKg: 0,
        _cargas: new Set(),
        /** por carga no dia — árvore Agenda (carga → rota → cidade → unidade) */
        _porCarga: new Map(),
      });
    }
    const diaAgg = a._porDia.get(diaKey);
    diaAgg.qtdNf += 1;
    diaAgg.valor += valor;
    diaAgg.pesoKg += peso;
    diaAgg.pesoSecoKg += pesoSeco || 0;
    diaAgg.pesoResfriadoKg += pesoResfriado || 0;
    diaAgg.pesoCongeladoKg += pesoCongelado || 0;
    const cargaId = n.cd_carga != null ? Number(n.cd_carga) : 0;
    if (!diaAgg._porCarga.has(cargaId)) {
      diaAgg._porCarga.set(cargaId, {
        cdCarga: cargaId || null,
        qtdNf: 0,
        valor: 0,
        pesoKg: 0,
        pesoSecoKg: 0,
        pesoResfriadoKg: 0,
        pesoCongeladoKg: 0,
      });
    }
    const cAgg = diaAgg._porCarga.get(cargaId);
    cAgg.qtdNf += 1;
    cAgg.valor += valor;
    cAgg.pesoKg += peso;
    cAgg.pesoSecoKg += pesoSeco || 0;
    cAgg.pesoResfriadoKg += pesoResfriado || 0;
    cAgg.pesoCongeladoKg += pesoCongelado || 0;
    if (n.cd_carga != null) {
      a._cargas.add(Number(n.cd_carga));
      a._diasCarga.add(diaKey);
      diaAgg._cargas.add(Number(n.cd_carga));
    }
    a.valor += valor;
    a.pesoKg += peso;
    a.pesoSecoKg += pesoSeco || 0;
    a.pesoFrioKg += pesoFrio || 0;
    if (n.lat != null) a.lat = Number(n.lat);
    if (n.lng != null) a.lng = Number(n.lng);
  }

  const series = [...agg.values()].map((r) => {
    const qtdEntregas = r._dias ? r._dias.size : 0;
    const cargas = r._cargas ? [...r._cargas] : [];
    /** Por unidade: 1 viagem = 1 dia com carga (nunca > entregas; 2 cargas no mesmo dia = 1) */
    const qtdViagens = r._diasCarga ? r._diasCarga.size : 0;
    const dias = r._porDia
      ? [...r._porDia.values()]
          .map((d) => ({
            dia: d.dia,
            qtdNf: d.qtdNf,
            /** 1 visita nesta unidade neste dia */
            qtdEntregas: 1,
            qtdViagens: d._cargas ? d._cargas.size : 0,
            cargas: d._cargas ? [...d._cargas] : [],
            valor: Math.round(d.valor * 100) / 100,
            pesoKg: Math.round(d.pesoKg * 100) / 100,
            pesoSecoKg: Math.round((d.pesoSecoKg || 0) * 100) / 100,
            pesoResfriadoKg: Math.round((d.pesoResfriadoKg || 0) * 100) / 100,
            pesoCongeladoKg: Math.round((d.pesoCongeladoKg || 0) * 100) / 100,
            porCarga: d._porCarga
              ? [...d._porCarga.values()]
                  .map((c) => ({
                    cdCarga: c.cdCarga,
                    qtdNf: c.qtdNf,
                    valor: Math.round(c.valor * 100) / 100,
                    pesoKg: Math.round(c.pesoKg * 100) / 100,
                    pesoSecoKg: Math.round((c.pesoSecoKg || 0) * 100) / 100,
                    pesoResfriadoKg: Math.round((c.pesoResfriadoKg || 0) * 100) / 100,
                    pesoCongeladoKg: Math.round((c.pesoCongeladoKg || 0) * 100) / 100,
                  }))
                  .sort((a, b) => {
                    if (a.cdCarga == null && b.cdCarga == null) return 0;
                    if (a.cdCarga == null) return 1;
                    if (b.cdCarga == null) return -1;
                    return a.cdCarga - b.cdCarga;
                  })
              : [],
          }))
          .sort((a, b) => a.dia.localeCompare(b.dia))
      : [];
    const { _dias, _diasCarga, _cargas, _porDia, ...rest } = r;
    return {
      ...rest,
      nome: nomeCurto(r.ponto),
      cod: codOl(r.ponto),
      /** Entrega operacional = 1 unidade em 1 dia (mesmo com várias NFs) */
      qtdEntregas,
      /** Viagem na unidade = dia com carga operacional (baixa estoque excluída) */
      qtdViagens,
      /** IDs de carga — união no front = viagens da frota (visão geral) */
      cargas,
      /** Dias com movimento no mês (para agenda) */
      dias,
      valor: Math.round(r.valor * 100) / 100,
      pesoKg: Math.round(r.pesoKg * 100) / 100,
      pesoSecoKg: Math.round(r.pesoSecoKg * 100) / 100,
      pesoFrioKg: Math.round(r.pesoFrioKg * 100) / 100,
      pctSeco: r.pesoKg > 0 ? Math.round((1000 * r.pesoSecoKg) / r.pesoKg) / 10 : 0,
      pctFrio: r.pesoKg > 0 ? Math.round((1000 * r.pesoFrioKg) / r.pesoKg) / 10 : 0,
    };
  });
  series.sort(
    (a, b) =>
      a.mes.localeCompare(b.mes) ||
      a.uf.localeCompare(b.uf) ||
      (a.cidade || '').localeCompare(b.cidade || '')
  );

  const unidades = await pool.query(
    `
    SELECT
      e."CD_ENDERECO_ENTREGA" AS id,
      e."DS_PONTO_ENTREGA" AS ponto,
      e."NM_MUNICIPIO" AS cidade,
      UPPER(TRIM(e."UF_ENTREGA")) AS uf,
      e."LATITUDE" AS lat,
      e."LONGITUDE" AS lng,
      e."NR_ROTA" AS rota,
      CASE WHEN UPPER(e."DS_PONTO_ENTREGA") LIKE '%NUTRIVILLE%' THEN 'Nutriville' ELSE 'Mana' END AS dono
    FROM "CADASTRO_ENDERECO_ENTREGA" e
    WHERE e."TENANT_ID" = $1
      AND e."FGACTIVE" = 'A'
      AND UPPER(TRIM(COALESCE(e."UF_ENTREGA",''))) IN ('PR','SC')
      AND (
        UPPER(COALESCE(e."DS_PONTO_ENTREGA",'')) LIKE '%MANA%'
        OR UPPER(COALESCE(e."DS_PONTO_ENTREGA",'')) LIKE '%NUTRIVILLE%'
      )
    ORDER BY uf, cidade, ponto
  `,
    [tid]
  );

  const meses = [...new Set(series.map((s) => s.mes))].sort();
  const cargasGlobais = new Set();
  for (const s of series) for (const c of s.cargas || []) cargasGlobais.add(c);
  const qtdNfOp = nfs.rows.length - nfsBaixaIgnoradas;
  const qtdEnt = series.reduce((a, s) => a + (s.qtdEntregas || 0), 0);
  const payload = {
    aoVivo: true,
    cache: false,
    geradoEm: new Date().toISOString(),
    elapsedMs: Date.now() - t0,
    fonte:
      'WMS_NFE_SAIDA + expedição · dia=DH_SAIDA/DH_INICIO (não emissão NF) · exclui Baixa · entrega=unid×dia · viagem=carga',
    criterio:
      'UF_DEST PR/SC; ignora NF em carga BAIXA; entrega=dias/unidade; viagem unid=dia c/ carga; frota=CD_CARGA',
    range: {
      ini,
      fim,
      nfs: qtdNfOp,
      nfsBaixaIgnoradas,
      entregas: qtdEnt,
      viagens: cargasGlobais.size,
    },
    totais: {
      pesoKg: Math.round(pesoTotal),
      pesoSecoKg: Math.round(secoTotal),
      pesoFrioKg: Math.round(frioTotal),
      pctSeco: pesoTotal > 0 ? Math.round((1000 * secoTotal) / pesoTotal) / 10 : 0,
      pctFrio: pesoTotal > 0 ? Math.round((1000 * frioTotal) / pesoTotal) / 10 : 0,
      valor: Math.round(valorTotal * 100) / 100,
      qtdNf: qtdNfOp,
      qtdEntregas: qtdEnt,
      qtdViagens: cargasGlobais.size,
    },
    meses,
    unidades: unidades.rows.map((u) => ({
      id: u.id,
      ponto: u.ponto,
      nome: nomeCurto(u.ponto),
      cod: codOl(u.ponto),
      cidade: u.cidade,
      uf: u.uf,
      lat: u.lat != null ? Number(u.lat) : null,
      lng: u.lng != null ? Number(u.lng) : null,
      rota: u.rota,
      dono: u.dono,
    })),
    series,
  };

  _cache = { key: cacheKey, at: Date.now(), payload };
  return payload;
}

function invalidarCacheBiVolumePrSc() {
  _cache = { key: null, at: 0, payload: null };
}

module.exports = {
  montarBiVolumePrSc,
  invalidarCacheBiVolumePrSc,
};
