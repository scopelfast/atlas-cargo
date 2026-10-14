'use strict';

const { pool } = require('../config/db');
const { listarPosicaoEstoque, formatValidadeBr } = require('./wms-relatorio-posicao-estoque.service');
const {
  parseApontadoModo,
  carregarChavesApontadasAtivas,
  filtrarLinhasPorApontado,
  avisoFiltroApontado,
} = require('./wms-shelf-apontado.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

const AVISO_FONTE_SALDO = [
  'Rateio FEFO: baixas sem lote consomem primeiro as validades mais próximas; o restante fica nos lotes mais longos.',
  'Estimativa operacional — expedição não grava lote no ledger; não substitui contagem física.',
  'Cabeçalho do SKU: saldo e saídas do produto (ledger). Linhas filhas: só entrada e saldo estimado daquela validade.',
  'Saldo SKU pode ser maior que a soma das validades neste relatório — o restante está em lotes fora do horizonte (ou sem data).',
  'Omitidas: saldo estimado ≤ 0 e validades além do horizonte (filtro da tela ou NU_DIAS_REL_VENCIMENTO do dono).',
  'Faixas: Vencido (< 0 dias), Crítico (≤ 30 dias), Curto (dentro do horizonte escolhido).',
];

const AVISO_FONTE_COBRANCA = [
  'Lista todas as validades com saldo FEFO > 0 (sem corte pelo horizonte do dono).',
  'Priorize a faixa Vencido para cobrança; confira fisicamente antes de faturar.',
  'Saldo estimado por validade é FEFO — não substitui contagem física por lote.',
  'SKUs sem nenhuma validade rastreada: use «Sem validade (coleta)».',
];

async function carregarHorizontePorDono(tenantId, cdDonoOpt) {
  const params = [tenantId];
  let clause = '';
  if (cdDonoOpt != null && String(cdDonoOpt).trim() !== '') {
    const n = parseInt(cdDonoOpt, 10);
    if (Number.isFinite(n)) {
      params.push(n);
      clause = ` AND "CD_DONO" = $${params.length}::integer`;
    }
  }
  const r = await pool.query(
    `SELECT "CD_DONO", COALESCE("NU_DIAS_REL_VENCIMENTO", 60)::integer AS horizonte
       FROM "WMS_DONO_ESTOQUE"
      WHERE "TENANT_ID" = $1${clause}`,
    params
  );
  const map = new Map();
  for (const row of r.rows) {
    map.set(parseInt(row.CD_DONO, 10), Number(row.horizonte) || 60);
  }
  return map;
}

function parseValidadeIso(raw) {
  const s = String(raw || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T12:00:00');
  return Number.isNaN(d.getTime()) ? null : s;
}

/**
 * Data a partir da qual contar os dias até o vencimento (AAAA-MM-DD).
 * Aceita também DD/MM/AAAA. Vazio = usa a data de hoje.
 * @param {unknown} raw
 * @returns {string|null}
 */
function parseDataReferenciaIso(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : s;
  }
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = String(m[1]).padStart(2, '0');
    const mm = String(m[2]).padStart(2, '0');
    const iso = `${m[3]}-${mm}-${dd}`;
    const d = new Date(`${iso}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : iso;
  }
  return null;
}

function formatDataBrFromIso(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}

function addDaysIso(iso, days) {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + Number(days || 0));
  const y = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

/** @param {string} iso @param {string|null} [dataBaseIso] */
function diasAteValidade(iso, dataBaseIso) {
  let base;
  if (dataBaseIso && /^\d{4}-\d{2}-\d{2}$/.test(dataBaseIso)) {
    base = new Date(`${dataBaseIso}T12:00:00`);
  } else {
    base = new Date();
    base.setHours(12, 0, 0, 0);
  }
  const v = new Date(`${iso}T12:00:00`);
  return Math.round((v - base) / (24 * 60 * 60 * 1000));
}

function dentroHorizonteShelf(dias, horizonte, opts = {}) {
  const h = Number(horizonte);
  const okH = Number.isFinite(h) && h >= 0;
  /** Com data base na tela: só o que vence daquela data em diante (não traz vencido antigo). */
  if (opts.somentePraFrente === true) {
    if (dias < 0) return false;
    return okH && dias <= h;
  }
  if (dias < 0) return true; // sem data base: já vencido sempre entra
  return okH && dias <= h;
}

/** @param {unknown} raw @returns {number|null} */
function parseHorizonteDiasOverride(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const n = parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1 || n > 1095) return null;
  return n;
}

/**
 * Rateio FEFO do saldo SKU restante por lote/validade.
 * Baixas sem lote no ledger → assume consumo do vencimento mais próximo; saldo remanescente nos lotes mais longos.
 * @param {Array<object>} linhasPosicao — saída de listarPosicaoEstoque (mapLinhaPosicao)
 */
function aplicarSaldoEstimadoPorLote(linhasPosicao) {
  const porSku = new Map();
  for (const r of linhasPosicao) {
    if (!r.VALIDADE) continue;
    if (r.SEM_ENTRADA_ENCERRADA && !r.ORIGEM_INVENTARIO && !r.ORIGEM_TRANSFERENCIA) continue;
    const iso = parseValidadeIso(r.VALIDADE);
    if (!iso) continue;
    const k = `${r.CD_DONO}|${r.CD_PRODUTO}`;
    if (!porSku.has(k)) porSku.set(k, []);
    porSku.get(k).push({ ...r, VALIDADE: iso });
  }

  const out = [];
  for (const grupo of porSku.values()) {
    const saldoSku = Number(grupo[0].QTD_SALDO_SKU) || 0;
    const reservaSku = Number(grupo[0].QTD_RESERVA_SKU) || 0;
    const saidaSku = Number(grupo[0].QTD_SAIDA_SKU) || 0;
    const entradaSku = grupo.reduce((s, r) => s + (Number(r.QTD_ENTRADA) || 0), 0);

    /** Validade ASC = ordem de consumo; aloca saldo remanescente do fim (lotes mais longos) para o início. */
    const fefo = [...grupo].sort((a, b) => {
      const c = String(a.VALIDADE).localeCompare(String(b.VALIDADE));
      if (c !== 0) return c;
      return String(a.LOTE || '').localeCompare(String(b.LOTE || ''), 'pt-BR');
    });

    const caps = fefo.map((r) => Number(r.QTD_ENTRADA) || 0);
    const aloc = new Array(fefo.length).fill(0);
    let rem = Math.max(0, saldoSku);

    for (let i = fefo.length - 1; i >= 0 && rem > 1e-9; i -= 1) {
      const take = Math.min(rem, caps[i]);
      aloc[i] = Number(take.toFixed(6));
      rem = Number((rem - take).toFixed(6));
    }

    for (let i = 0; i < fefo.length; i += 1) {
      const r = fefo[i];
      out.push({
        ...r,
        QTD_SALDO_ESTIMADO: aloc[i],
        QTD_ENTRADA_SKU: entradaSku,
        QTD_SAIDA_SKU: saidaSku,
        QTD_RESERVA_SKU: reservaSku,
        QTD_SALDO_SKU: saldoSku,
        QTD_DISPONIVEL_SKU: Number((saldoSku - reservaSku).toFixed(6)),
      });
    }
  }
  return out;
}

/**
 * Anexa QTD_SALDO_EST_FEFO em todas as linhas de posição (mesma regra do shelf-life).
 * Linhas sem validade / só movimento ficam com null (exibir "—").
 */
function anexarSaldoEstimadoFefoNasLinhasPosicao(linhasPosicao) {
  const lista = Array.isArray(linhasPosicao) ? linhasPosicao : [];
  const estimados = aplicarSaldoEstimadoPorLote(lista);
  const filaPorChave = new Map();
  for (const e of estimados) {
    const k = [
      e.CD_DONO,
      e.CD_PRODUTO,
      e.VALIDADE || '',
      e.LOTE || '',
      e.ORIGEM_INVENTARIO ? '1' : '0',
      e.ORIGEM_TRANSFERENCIA ? '1' : '0',
      Number(e.QTD_ENTRADA) || 0,
    ].join('|');
    if (!filaPorChave.has(k)) filaPorChave.set(k, []);
    filaPorChave.get(k).push(Number(e.QTD_SALDO_ESTIMADO) || 0);
  }
  return lista.map((r) => {
    if (!r.VALIDADE || (r.SEM_ENTRADA_ENCERRADA && !r.ORIGEM_INVENTARIO && !r.ORIGEM_TRANSFERENCIA)) {
      return { ...r, QTD_SALDO_EST_FEFO: null };
    }
    const iso = parseValidadeIso(r.VALIDADE) || String(r.VALIDADE).trim();
    const k = [
      r.CD_DONO,
      r.CD_PRODUTO,
      iso,
      r.LOTE || '',
      r.ORIGEM_INVENTARIO ? '1' : '0',
      r.ORIGEM_TRANSFERENCIA ? '1' : '0',
      Number(r.QTD_ENTRADA) || 0,
    ].join('|');
    const fila = filaPorChave.get(k);
    const est = fila && fila.length ? fila.shift() : null;
    return { ...r, QTD_SALDO_EST_FEFO: est };
  });
}

/**
 * Shelf-life com saldo estimado por lote/validade (desconta baixas no nível SKU).
 * @param {string} tenantId
 * @param {number|string|null} cdDonoOpt
 * @param {{ somenteComSaldo?: boolean, ignorarHorizonte?: boolean, somenteVencidos?: boolean, horizonteDias?: number|null, dataReferencia?: string|null, apontadoModo?: string }} opts
 */
async function listarShelfLifeSaldoPorValidade(tenantId, cdDonoOpt, opts = {}) {
  const somenteComSaldo = opts.somenteComSaldo !== false;
  const ignorarHorizonte = opts.ignorarHorizonte === true;
  const somenteVencidos = opts.somenteVencidos === true;
  const horizonteOverride = parseHorizonteDiasOverride(opts.horizonteDias);
  const dataReferencia = parseDataReferenciaIso(opts.dataReferencia);
  const [posOut, horizonteMap] = await Promise.all([
    listarPosicaoEstoque(tenantId, cdDonoOpt),
    carregarHorizontePorDono(tenantId, cdDonoOpt).catch((e) => {
      if (schemaMissing(e)) return new Map();
      throw e;
    }),
  ]);

  if (horizonteOverride != null) {
    for (const k of horizonteMap.keys()) horizonteMap.set(k, horizonteOverride);
    // Se o mapa veio vazio (schema) ou dono sem linha, ainda assim aplica o override no filtro
  }

  function horizonteEfetivo(cdDono) {
    if (horizonteOverride != null) return horizonteOverride;
    return horizonteMap.get(parseInt(cdDono, 10)) ?? 60;
  }

  let linhas = aplicarSaldoEstimadoPorLote(posOut.linhas || []);

  linhas = linhas.filter((r) => {
    const dias = diasAteValidade(r.VALIDADE, dataReferencia);
    const h = horizonteEfetivo(r.CD_DONO);
    if (
      !ignorarHorizonte &&
      !dentroHorizonteShelf(dias, h, { somentePraFrente: !!dataReferencia })
    ) {
      return false;
    }
    if (somenteVencidos && dias >= 0) return false;
    if (somenteComSaldo && (Number(r.QTD_SALDO_ESTIMADO) || 0) <= 1e-6) return false;
    return true;
  });

  linhas.sort((a, b) => {
    const dv = String(a.VALIDADE).localeCompare(String(b.VALIDADE));
    if (dv !== 0) return dv;
    const dd = (a.CD_DONO || 0) - (b.CD_DONO || 0);
    if (dd !== 0) return dd;
    return String(a.CODIGO_PRODUTO || '').localeCompare(String(b.CODIGO_PRODUTO || ''), 'pt-BR');
  });

  if (linhas.length > 5000) linhas = linhas.slice(0, 5000);

  for (const r of linhas) {
    r.DIAS_ATE_VENCIMENTO = diasAteValidade(r.VALIDADE, dataReferencia);
    r.NU_DIAS_REL_VENCIMENTO_DONO = horizonteEfetivo(r.CD_DONO);
    r.VALIDADE_BR = formatValidadeBr(r.VALIDADE);
    if (dataReferencia) r.DATA_REFERENCIA = dataReferencia;
  }

  const avisosBase = ignorarHorizonte ? AVISO_FONTE_COBRANCA : AVISO_FONTE_SALDO;
  const avisos = [...avisosBase];
  if (dataReferencia && ignorarHorizonte) {
    avisos.unshift(
      `Dias até o vencimento calculados a partir de ${formatDataBrFromIso(dataReferencia)} (não da data de hoje).`
    );
  }
  if (!ignorarHorizonte && (horizonteOverride != null || dataReferencia)) {
    const br = dataReferencia ? formatDataBrFromIso(dataReferencia) : 'hoje';
    if (horizonteOverride != null && dataReferencia) {
      const ateIso = addDaysIso(dataReferencia, horizonteOverride);
      const ateBr = ateIso ? formatDataBrFromIso(ateIso) : '';
      avisos.unshift(
        `Janela à frente: de ${br} até ${ateBr || br + ' + ' + horizonteOverride + 'd'} ` +
          `(${horizonteOverride} dia(s)) — só validades neste período (não inclui o que já venceu antes de ${br}).`
      );
    } else if (horizonteOverride != null) {
      avisos.unshift(
        `Horizonte escolhido na consulta: ${horizonteOverride} dia(s) a partir de ${br} — lista o que já venceu e o que vence nesse período.`
      );
    } else if (dataReferencia) {
      avisos.unshift(
        `Janela à frente a partir de ${br} (horizonte = política do dono) — não inclui o que já venceu antes dessa data.`
      );
    }
  }

  const apontadoModo = parseApontadoModo(opts.apontadoModo);
  try {
    const chaves = await carregarChavesApontadasAtivas(tenantId, cdDonoOpt);
    linhas = filtrarLinhasPorApontado(linhas, chaves, apontadoModo);
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  const avisoAp = avisoFiltroApontado(apontadoModo);
  if (avisoAp) avisos.unshift(avisoAp);

  return {
    rows: linhas,
    avisos,
    filtroDonoLabel: posOut.filtroDonoLabel,
    modoCobranca: ignorarHorizonte,
    horizonteDias: horizonteOverride,
    dataReferencia,
    apontadoModo,
  };
}

/** Shelf-life para cobrança de vencidos: todas as validades com saldo FEFO > 0 (sem horizonte). */
async function listarShelfLifeCobranca(tenantId, cdDonoOpt, opts = {}) {
  return listarShelfLifeSaldoPorValidade(tenantId, cdDonoOpt, {
    somenteComSaldo: true,
    ignorarHorizonte: true,
    somenteVencidos: opts.somenteVencidos === true,
    apontadoModo: opts.apontadoModo,
    dataReferencia: opts.dataReferencia,
  });
}

function linhasSaldoParaCsv(rows) {
  const cols = [
    'CD_DONO',
    'NM_DONO',
    'CODIGO_PRODUTO',
    'NM_PRODUTO',
    'TIPO_ARMAZENAGEM',
    'LOTE',
    'DT_VALIDADE',
    'DIAS_ATE_VENCIMENTO',
    'QTD_ENTRADA_LOTE',
    'QTD_SALDO_ESTIMADO_LOTE',
    'QTD_SALDO_SKU',
    'QTD_SAIDA_SKU',
    'QTD_RESERVA_SKU',
    'APONTADO',
  ];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = cols.join(';');
  const body = (rows || [])
    .map((row) =>
      cols
        .map((c) => {
          if (c === 'DT_VALIDADE') return esc(row.VALIDADE || row.DT_VALIDADE);
          if (c === 'QTD_ENTRADA_LOTE') return esc(row.QTD_ENTRADA);
          if (c === 'QTD_SALDO_ESTIMADO_LOTE') return esc(row.QTD_SALDO_ESTIMADO);
          if (c === 'APONTADO') return esc(row.FG_APONTADO === 'S' ? 'S' : 'N');
          return esc(row[c]);
        })
        .join(';')
    )
    .join('\n');
  return `${head}\n${body}`;
}

module.exports = {
  listarShelfLifeSaldoPorValidade,
  listarShelfLifeCobranca,
  linhasSaldoParaCsv,
  AVISO_FONTE_SALDO,
  AVISO_FONTE_COBRANCA,
  aplicarSaldoEstimadoPorLote,
  anexarSaldoEstimadoFefoNasLinhasPosicao,
  parseHorizonteDiasOverride,
  parseDataReferenciaIso,
  formatDataBrFromIso,
  addDaysIso,
  dentroHorizonteShelf,
};
