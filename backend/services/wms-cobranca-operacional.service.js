'use strict';

/**
 * Cobrança operacional WMS — armazenagem (% sobre pico de valor no período) e
 * expedição (% sobre valor das NF-e com saída confirmada no período).
 * Fase 1: apuração em tempo real por intervalo de datas (sem snapshot de expedição).
 */

const { pool } = require('../config/db');
const {
  carregarSerieSnapshots,
  cobrancaSobreValor,
  hojeIsoTz,
  isoDateFromDb,
} = require('./wms-estoque-valor.service');

const AVISOS_PADRAO = [
  'Armazenagem: cobrança sobre o pico de valor de estoque (snapshots diários) no período × % do dono.',
  'Expedição: soma do valor das NF-e (vNF do XML, ou soma vProd) com saída confirmada no módulo. Data de referência: saída no XML da NF (ide.dSaiEnt/dhSaiEnt); se ausente, data da confirmação da expedição (DH_SAIDA da carga).',
  'Configure os percentuais em Cadastros WMS → Dono do estoque.',
  'NF-e sem valor no cadastro não entram no total — confira importação do XML de saída.',
  'Para gerar snapshots de armazenagem, use o módulo Valor de estoque.',
];

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function toNumber(v) {
  if (v == null || v === '') return NaN;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function round4(n) {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

function parseDataIso(v) {
  if (!v) return null;
  const s = String(v).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

function inicioMes(iso) {
  const s = String(iso || hojeIsoTz());
  const [y, m] = s.split('-');
  return `${y}-${m}-01`;
}

function parsePeriodo(opts) {
  opts = opts || {};
  const hoje = hojeIsoTz();
  let dataIni = parseDataIso(opts.dataIni);
  let dataFim = parseDataIso(opts.dataFim);
  if (!dataIni && !dataFim) {
    dataIni = inicioMes(hoje);
    dataFim = hoje;
  } else if (!dataIni) dataIni = dataFim;
  else if (!dataFim) dataFim = dataIni;
  if (dataIni > dataFim) {
    const t = dataIni;
    dataIni = dataFim;
    dataFim = t;
  }
  return { dataIni, dataFim };
}

function qtdComercialLinha(ln) {
  return toNumber(ln.qCom ?? ln.quantidade ?? ln.qTrib) || 0;
}

function valorLinhaNf(ln) {
  const vProd = toNumber(ln.vProd);
  if (vProd > 0) return vProd;
  const vu = toNumber(ln.vUnCom);
  const q = qtdComercialLinha(ln);
  if (vu > 0 && q > 0) return vu * q;
  return 0;
}

function valorNfNota(n) {
  const vnfCol = n.VNF_TOTAL != null ? toNumber(n.VNF_TOTAL) : 0;
  if (vnfCol > 0) return round2(vnfCol);
  let linhas = n.LINHAS_JSON;
  if (typeof linhas === 'string') {
    try {
      linhas = JSON.parse(linhas);
    } catch (_) {
      linhas = [];
    }
  }
  if (!Array.isArray(linhas)) linhas = [];
  let sum = 0;
  for (const ln of linhas) {
    if (!ln || typeof ln !== 'object' || ln._meta) continue;
    sum += valorLinhaNf(ln);
  }
  return round2(sum);
}

function fonteValorNf(n) {
  const vnfCol = n.VNF_TOTAL != null ? toNumber(n.VNF_TOTAL) : 0;
  return vnfCol > 0 ? 'VNF_XML' : 'SOMA_VPROD';
}

/** Data de referência da expedição para cobrança: XML da NF → confirmação no módulo. */
function dataReferenciaExpedicao(row) {
  const xml = row.NF_DH_SAIDA;
  if (xml != null && xml !== '') {
    const dt = isoDateFromDb(xml);
    if (dt) return { dt, fonte: 'XML_NF', dh: xml };
  }
  const conf = row.CARGA_DH_SAIDA;
  if (conf != null && conf !== '') {
    const dt = isoDateFromDb(conf);
    if (dt) return { dt, fonte: 'CONFIRMACAO_EXPEDICAO', dh: conf };
  }
  return { dt: null, fonte: null, dh: null };
}

async function listarDonosCobranca(tenantId, cdDonoOpt) {
  const params = [tenantId];
  let sql = `
    SELECT d."CD_DONO", d."NOME" AS "NM_DONO",
           d."PCT_COBRANCA_ESTOQUE", d."PCT_COBRANCA_EXPEDICAO"
      FROM "WMS_DONO_ESTOQUE" d
     WHERE d."TENANT_ID" = $1
       AND COALESCE(TRIM(UPPER(d."FGACTIVE")), 'S') = 'S'`;
  if (cdDonoOpt != null && String(cdDonoOpt).trim() !== '') {
    const n = parseInt(cdDonoOpt, 10);
    if (Number.isFinite(n)) {
      params.push(n);
      sql += ` AND d."CD_DONO" = $${params.length}::integer`;
    }
  }
  sql += ' ORDER BY d."NOME", d."CD_DONO"';
  try {
    const r = await pool.query(sql, params);
    return r.rows || [];
  } catch (e) {
    if (schemaMissing(e)) return [];
    throw e;
  }
}

async function carregarNfExpedidasPeriodo(tenantId, dataIni, dataFim, cdDonoOpt) {
  const params = [tenantId, dataIni, dataFim];
  let donoClause = '';
  if (cdDonoOpt != null && String(cdDonoOpt).trim() !== '') {
    const n = parseInt(cdDonoOpt, 10);
    if (Number.isFinite(n)) {
      params.push(n);
      donoClause = ` AND n."CD_DONO" = $${params.length}::integer`;
    }
  }
  const sql = `
    SELECT e."CD_CARGA",
           c."NM_DESCRICAO",
           e."DH_SAIDA",
           e."NM_MOTORISTA",
           e."PLACA",
           n."CD_NFE_SAIDA",
           n."NUMERO_NF",
           n."SERIE",
           n."CD_DONO",
           d."NOME" AS "NM_DONO",
           d."PCT_COBRANCA_EXPEDICAO",
           n."VNF_TOTAL",
           n."LINHAS_JSON",
           n."DH_SAIDA" AS "NF_DH_SAIDA",
           e."DH_SAIDA" AS "CARGA_DH_SAIDA",
           n."XNOME_DEST",
           n."XMUN_DEST",
           n."UF_DEST"
      FROM "WMS_EXPEDICAO_CARGA" e
      INNER JOIN "WMS_CARGA_PROGRAMADA" c
        ON c."CD_CARGA" = e."CD_CARGA"
       AND c."TENANT_ID" = e."TENANT_ID"
      INNER JOIN "WMS_CARGA_PROGRAMADA_NFE" j ON j."CD_CARGA" = e."CD_CARGA"
      INNER JOIN "WMS_NFE_SAIDA" n
        ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
       AND n."TENANT_ID" = e."TENANT_ID"
      LEFT JOIN "WMS_DONO_ESTOQUE" d
        ON d."CD_DONO" = n."CD_DONO"
       AND d."TENANT_ID" = e."TENANT_ID"
     WHERE e."TENANT_ID" = $1
       AND UPPER(COALESCE(e."ST_EXPEDICAO", '')) = 'EXPEDIDA'
       AND COALESCE(n."DH_SAIDA", e."DH_SAIDA") IS NOT NULL
       AND COALESCE(n."DH_SAIDA", e."DH_SAIDA")::date >= $2::date
       AND COALESCE(n."DH_SAIDA", e."DH_SAIDA")::date <= $3::date
       ${donoClause}
     ORDER BY COALESCE(n."DH_SAIDA", e."DH_SAIDA") DESC, e."CD_CARGA", n."NUMERO_NF", n."SERIE"`;
  try {
    const r = await pool.query(sql, params);
    return r.rows || [];
  } catch (e) {
    if (schemaMissing(e)) return [];
    throw e;
  }
}

function apurarExpedicaoPeriodo(rows, donosMeta) {
  const pctPorDono = new Map();
  for (const d of donosMeta) {
    pctPorDono.set(Number(d.CD_DONO), toNumber(d.PCT_COBRANCA_EXPEDICAO));
  }

  const porDono = new Map();
  const porCarga = new Map();
  const porDia = new Map();
  const linhasNf = [];
  const cargasSet = new Set();
  let qtdNf = 0;
  let qtdNfSemValor = 0;
  let valorTotal = 0;

  let qtdNfSemDataRef = 0;
  let qtdNfDataXml = 0;
  let qtdNfDataConfirmacao = 0;

  for (const row of rows) {
    const cdDono = row.CD_DONO != null ? Number(row.CD_DONO) : null;
    const valor = valorNfNota(row);
    const temValor = valor > 0;
    const refData = dataReferenciaExpedicao(row);
    if (!refData.dt) qtdNfSemDataRef += 1;
    else if (refData.fonte === 'XML_NF') qtdNfDataXml += 1;
    else if (refData.fonte === 'CONFIRMACAO_EXPEDICAO') qtdNfDataConfirmacao += 1;
    if (!temValor) qtdNfSemValor += 1;
    qtdNf += 1;
    valorTotal = round2(valorTotal + (temValor ? valor : 0));
    cargasSet.add(Number(row.CD_CARGA));

    const dtSaida = refData.dt;

    if (cdDono != null) {
      const aggD = porDono.get(cdDono) || {
        CD_DONO: cdDono,
        NM_DONO: row.NM_DONO || `Dono #${cdDono}`,
        PCT_COBRANCA_EXPEDICAO: pctPorDono.get(cdDono),
        valorNfTotal: 0,
        qtdNf: 0,
        qtdNfSemValor: 0,
        qtdCargas: new Set(),
      };
      aggD.qtdNf += 1;
      if (!temValor) aggD.qtdNfSemValor += 1;
      else aggD.valorNfTotal = round2(aggD.valorNfTotal + valor);
      aggD.qtdCargas.add(Number(row.CD_CARGA));
      porDono.set(cdDono, aggD);
    }

    const cdCarga = Number(row.CD_CARGA);
    const aggC = porCarga.get(cdCarga) || {
      CD_CARGA: cdCarga,
      NM_DESCRICAO: row.NM_DESCRICAO || '',
      DH_SAIDA: row.CARGA_DH_SAIDA,
      NM_MOTORISTA: row.NM_MOTORISTA,
      PLACA: row.PLACA,
      valorNfTotal: 0,
      qtdNf: 0,
      qtdNfSemValor: 0,
      donos: new Set(),
    };
    aggC.qtdNf += 1;
    if (!temValor) aggC.qtdNfSemValor += 1;
    else aggC.valorNfTotal = round2(aggC.valorNfTotal + valor);
    if (cdDono != null) aggC.donos.add(cdDono);
    porCarga.set(cdCarga, aggC);

    if (dtSaida && temValor) {
      const pctDia = cdDono != null ? pctPorDono.get(cdDono) : null;
      const cobDia = cobrancaSobreValor(valor, pctDia);
      const aggDay = porDia.get(dtSaida) || { dt: dtSaida, valorNfTotal: 0, cobrancaEstimada: 0, qtdNf: 0 };
      aggDay.valorNfTotal = round2(aggDay.valorNfTotal + valor);
      aggDay.cobrancaEstimada = round2((aggDay.cobrancaEstimada || 0) + cobDia);
      aggDay.qtdNf += 1;
      porDia.set(dtSaida, aggDay);
    }

    linhasNf.push({
      CD_CARGA: cdCarga,
      NM_DESCRICAO: row.NM_DESCRICAO || '',
      DH_SAIDA: refData.dh,
      DH_SAIDA_REF: refData.dh,
      DT_REFERENCIA: dtSaida,
      FONTE_DATA: refData.fonte,
      DH_SAIDA_NF: row.NF_DH_SAIDA,
      DH_SAIDA_CARGA: row.CARGA_DH_SAIDA,
      CD_NFE_SAIDA: row.CD_NFE_SAIDA,
      NUMERO_NF: row.NUMERO_NF,
      SERIE: row.SERIE,
      CD_DONO: cdDono,
      NM_DONO: row.NM_DONO || (cdDono != null ? `Dono #${cdDono}` : '—'),
      PCT_COBRANCA_EXPEDICAO: cdDono != null ? pctPorDono.get(cdDono) : null,
      VALOR_NF: temValor ? valor : null,
      FONTE_VALOR: temValor ? fonteValorNf(row) : 'SEM_VALOR',
      XNOME_DEST: row.XNOME_DEST,
      XMUN_DEST: row.XMUN_DEST,
      UF_DEST: row.UF_DEST,
    });
  }

  const resumoPorDono = Array.from(porDono.values())
    .map((d) => {
      const pct = d.PCT_COBRANCA_EXPEDICAO;
      const cob = cobrancaSobreValor(d.valorNfTotal, pct);
      return {
        CD_DONO: d.CD_DONO,
        NM_DONO: d.NM_DONO,
        PCT_COBRANCA_EXPEDICAO: pct != null && Number.isFinite(pct) ? pct : null,
        valorNfTotal: d.valorNfTotal,
        cobrancaEstimada: cob,
        qtdNf: d.qtdNf,
        qtdNfSemValor: d.qtdNfSemValor,
        qtdCargas: d.qtdCargas.size,
      };
    })
    .sort((a, b) => b.valorNfTotal - a.valorNfTotal || a.CD_DONO - b.CD_DONO);

  const resumoPorCarga = Array.from(porCarga.values())
    .map((c) => ({
      CD_CARGA: c.CD_CARGA,
      NM_DESCRICAO: c.NM_DESCRICAO,
      DH_SAIDA: c.DH_SAIDA,
      NM_MOTORISTA: c.NM_MOTORISTA,
      PLACA: c.PLACA,
      valorNfTotal: c.valorNfTotal,
      qtdNf: c.qtdNf,
      qtdNfSemValor: c.qtdNfSemValor,
      donos: Array.from(c.donos).sort((a, b) => a - b),
    }))
    .sort((a, b) => {
      const da = a.DH_SAIDA ? String(a.DH_SAIDA) : '';
      const db = b.DH_SAIDA ? String(b.DH_SAIDA) : '';
      return db.localeCompare(da) || b.CD_CARGA - a.CD_CARGA;
    });

  const serieDiaria = Array.from(porDia.values()).sort((a, b) => a.dt.localeCompare(b.dt));

  const cobrancaTotal = round2(resumoPorDono.reduce((s, d) => s + (Number(d.cobrancaEstimada) || 0), 0));

  return {
    valorNfTotal: valorTotal,
    cobrancaEstimada: cobrancaTotal,
    qtdCargas: cargasSet.size,
    qtdNf,
    qtdNfSemValor,
    qtdNfSemDataRef,
    qtdNfDataXml,
    qtdNfDataConfirmacao,
    resumoPorDono,
    resumoPorCarga,
    linhasNf,
    serieDiaria,
  };
}

async function apurarArmazenagemPeriodo(tenantId, dataIni, dataFim, cdDonoOpt) {
  const [serie, donosMeta] = await Promise.all([
    carregarSerieSnapshots(tenantId, cdDonoOpt, dataIni, dataFim),
    listarDonosCobranca(tenantId, cdDonoOpt),
  ]);

  const pctPorDono = new Map();
  const nomePorDono = new Map();
  for (const d of donosMeta) {
    const cd = Number(d.CD_DONO);
    pctPorDono.set(cd, toNumber(d.PCT_COBRANCA_ESTOQUE));
    nomePorDono.set(cd, d.NM_DONO);
  }

  const porDono = new Map();
  const porDia = new Map();
  const diasComSnapshot = new Set();

  for (const row of serie) {
    const cd = Number(row.CD_DONO);
    const dt = isoDateFromDb(row.DT_REFERENCIA);
    if (dt) diasComSnapshot.add(dt);
    const valor = toNumber(row.VALOR_TOTAL) || 0;

    const aggD = porDono.get(cd) || {
      CD_DONO: cd,
      NM_DONO: row.NM_DONO || nomePorDono.get(cd) || `Dono #${cd}`,
      PCT_COBRANCA_ESTOQUE: pctPorDono.get(cd),
      picoValor: 0,
      dtPico: null,
      qtdSkusSemPrecoPico: 0,
    };
    if (valor > aggD.picoValor) {
      aggD.picoValor = round2(valor);
      aggD.dtPico = dt;
      aggD.qtdSkusSemPrecoPico = Number(row.QTD_SKUS_SEM_PRECO || 0);
    }
    porDono.set(cd, aggD);

    const aggDay = porDia.get(dt) || { dt, valorTotal: 0 };
    aggDay.valorTotal = round2(aggDay.valorTotal + valor);
    porDia.set(dt, aggDay);
  }

  for (const d of donosMeta) {
    const cd = Number(d.CD_DONO);
    if (!porDono.has(cd)) {
      porDono.set(cd, {
        CD_DONO: cd,
        NM_DONO: d.NM_DONO,
        PCT_COBRANCA_ESTOQUE: pctPorDono.get(cd),
        picoValor: 0,
        dtPico: null,
        qtdSkusSemPrecoPico: 0,
      });
    }
  }

  const resumoPorDono = Array.from(porDono.values())
    .map((d) => {
      const pct = d.PCT_COBRANCA_ESTOQUE;
      const cob = cobrancaSobreValor(d.picoValor, pct);
      return {
        CD_DONO: d.CD_DONO,
        NM_DONO: d.NM_DONO,
        PCT_COBRANCA_ESTOQUE: pct != null && Number.isFinite(pct) ? pct : null,
        picoValor: d.picoValor,
        dtPico: d.dtPico,
        cobrancaEstimada: cob,
        qtdSkusSemPrecoPico: d.qtdSkusSemPrecoPico,
      };
    })
    .sort((a, b) => b.picoValor - a.picoValor || a.CD_DONO - b.CD_DONO);

  let picoConsolidado = { valor: 0, dt: null };
  for (const aggDay of porDia.values()) {
    const v = Number(aggDay.valorTotal) || 0;
    if (v > picoConsolidado.valor) {
      picoConsolidado = { valor: round2(v), dt: aggDay.dt };
    }
  }
  const picoValorTotal = picoConsolidado.valor;
  const cobrancaTotal = round2(resumoPorDono.reduce((s, d) => s + (Number(d.cobrancaEstimada) || 0), 0));
  const serieDiaria = Array.from(porDia.values()).sort((a, b) => a.dt.localeCompare(b.dt));

  return {
    picoValorTotal,
    picoValorDt: picoConsolidado.dt,
    cobrancaEstimada: cobrancaTotal,
    diasComSnapshot: diasComSnapshot.size,
    resumoPorDono,
    serieDiaria,
    semSnapshots: serie.length === 0,
  };
}

/**
 * Dashboard consolidado de cobrança operacional.
 */
async function obterDashboardCobrancaOperacional(tenantId, opts) {
  const periodo = parsePeriodo(opts);
  const { dataIni, dataFim } = periodo;
  const cdDono = opts.cdDono;

  const [armazenagem, nfRows, donos] = await Promise.all([
    apurarArmazenagemPeriodo(tenantId, dataIni, dataFim, cdDono),
    carregarNfExpedidasPeriodo(tenantId, dataIni, dataFim, cdDono),
    listarDonosCobranca(tenantId, cdDono),
  ]);

  const expedicao = apurarExpedicaoPeriodo(nfRows, donos);
  const avisos = [...AVISOS_PADRAO];
  if (armazenagem.semSnapshots) {
    avisos.push(
      `Nenhum snapshot de armazenagem entre ${dataIni} e ${dataFim}. Gere snapshots no módulo Valor de estoque.`
    );
  }
  if (expedicao.qtdNfSemValor > 0) {
    avisos.push(
      `${expedicao.qtdNfSemValor} NF-e expedida(s) sem valor (vNF/vProd) no período — não entram no total.`
    );
  }
  if (expedicao.qtdNfDataConfirmacao > 0) {
    avisos.push(
      `${expedicao.qtdNfDataConfirmacao} NF-e sem data de saída no XML — usada a data da confirmação da expedição no módulo.`
    );
  }

  const cobrancaTotalEstimada = round2(
    (Number(armazenagem.cobrancaEstimada) || 0) + (Number(expedicao.cobrancaEstimada) || 0)
  );

  return {
    periodo: { dataIni, dataFim },
    resumo: {
      armazenagemPicoValor: armazenagem.picoValorTotal,
      armazenagemPicoDt: armazenagem.picoValorDt || null,
      armazenagemCobrancaEstimada: armazenagem.cobrancaEstimada,
      armazenagemDiasSnapshot: armazenagem.diasComSnapshot,
      expedicaoValorNf: expedicao.valorNfTotal,
      expedicaoCobrancaEstimada: expedicao.cobrancaEstimada,
      expedicaoQtdCargas: expedicao.qtdCargas,
      expedicaoQtdNf: expedicao.qtdNf,
      expedicaoQtdNfSemValor: expedicao.qtdNfSemValor,
      cobrancaTotalEstimada,
    },
    armazenagem,
    expedicao,
    avisos,
  };
}

function linhasExpedicaoParaCsv(linhas) {
  const cols = [
    'CD_CARGA',
    'DT_REFERENCIA',
    'FONTE_DATA',
    'DH_SAIDA',
    'CD_DONO',
    'NM_DONO',
    'NUMERO_NF',
    'SERIE',
    'VALOR_NF',
    'FONTE_VALOR',
    'PCT_COBRANCA_EXPEDICAO',
    'COBRANCA_ESTIMADA',
    'XNOME_DEST',
    'XMUN_DEST',
    'UF_DEST',
  ];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const rows = (linhas || []).map((r) => {
    const pct = r.PCT_COBRANCA_EXPEDICAO;
    const cob = r.VALOR_NF != null ? cobrancaSobreValor(r.VALOR_NF, pct) : 0;
    return {
      CD_CARGA: r.CD_CARGA,
      DT_REFERENCIA: r.DT_REFERENCIA || '',
      FONTE_DATA: r.FONTE_DATA || '',
      DH_SAIDA: r.DH_SAIDA_REF ? String(r.DH_SAIDA_REF).replace('T', ' ').slice(0, 19) : '',
      CD_DONO: r.CD_DONO,
      NM_DONO: r.NM_DONO,
      NUMERO_NF: r.NUMERO_NF,
      SERIE: r.SERIE,
      VALOR_NF: r.VALOR_NF != null ? round2(r.VALOR_NF) : '',
      FONTE_VALOR: r.FONTE_VALOR,
      PCT_COBRANCA_EXPEDICAO: pct != null && Number.isFinite(pct) ? round4(pct) : '',
      COBRANCA_ESTIMADA: r.VALOR_NF != null ? cob : '',
      XNOME_DEST: r.XNOME_DEST,
      XMUN_DEST: r.XMUN_DEST,
      UF_DEST: r.UF_DEST,
    };
  });
  const head = cols.join(';');
  const body = rows.map((row) => cols.map((c) => esc(row[c])).join(';')).join('\n');
  return `\ufeff${head}\n${body}`;
}

function linhasResumoConsolidadoParaCsv(dash) {
  const cols = [
    'TIPO',
    'CD_DONO',
    'NM_DONO',
    'BASE_VALOR',
    'PCT_COBRANCA',
    'COBRANCA_ESTIMADA',
    'OBS',
  ];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const rows = [];
  for (const d of dash.armazenagem.resumoPorDono || []) {
    rows.push({
      TIPO: 'ARMAZENAGEM',
      CD_DONO: d.CD_DONO,
      NM_DONO: d.NM_DONO,
      BASE_VALOR: d.picoValor,
      PCT_COBRANCA: d.PCT_COBRANCA_ESTOQUE,
      COBRANCA_ESTIMADA: d.cobrancaEstimada,
      OBS: d.dtPico ? `Pico em ${d.dtPico}` : 'Sem snapshot no período',
    });
  }
  for (const d of dash.expedicao.resumoPorDono || []) {
    rows.push({
      TIPO: 'EXPEDICAO',
      CD_DONO: d.CD_DONO,
      NM_DONO: d.NM_DONO,
      BASE_VALOR: d.valorNfTotal,
      PCT_COBRANCA: d.PCT_COBRANCA_EXPEDICAO,
      COBRANCA_ESTIMADA: d.cobrancaEstimada,
      OBS: `${d.qtdCargas} carga(s), ${d.qtdNf} NF`,
    });
  }
  const head = cols.join(';');
  const body = rows.map((row) => cols.map((c) => esc(row[c])).join(';')).join('\n');
  return `\ufeff${head}\n${body}`;
}

module.exports = {
  AVISOS_PADRAO,
  parsePeriodo,
  obterDashboardCobrancaOperacional,
  linhasExpedicaoParaCsv,
  linhasResumoConsolidadoParaCsv,
  valorNfNota,
  dataReferenciaExpedicao,
};
