'use strict';

/**
 * Atlas Pay Fase 3 — fechamento periódico USO_PLATAFORMA.
 * Regras D1–D7 (docs/ATLAS_PAY_FASE3_DECISOES_COMERCIAIS.md).
 * Não gera cobrança na aprovação; geração explícita e idempotente.
 */

const crypto = require('crypto');
const { pool } = require('../config/db');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const { ErroFinanceiro, ipDe } = require('./financeiro-cobranca.service');
const fusoSp = require('./financeiro-fuso-sp');

const TZ = fusoSp.TZ;
const STATUS_DISP = new Set(['PENDENTE', 'ACEITA', 'CONFIRMADA', 'RECUSADA', 'ACEITA_DESCARTADA']);

function parseCompetencia(raw) {
  const s = String(raw || '').trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) {
    throw new ErroFinanceiro('Competência inválida. Use AAAA-MM.', 400, 'COMPETENCIA');
  }
  return s;
}

/** Limites semiabertos [inicio, fim) em horário de parede America/Sao_Paulo (naive, padrão Atlas). */
function boundsCompetencia(competencia) {
  const [ys, ms] = competencia.split('-');
  const y = Number(ys);
  const m = Number(ms);
  const pad = (n) => String(n).padStart(2, '0');
  const inicio = `${y}-${pad(m)}-01 00:00:00`;
  let y2 = y;
  let m2 = m + 1;
  if (m2 > 12) {
    m2 = 1;
    y2 += 1;
  }
  const fim = `${y2}-${pad(m2)}-01 00:00:00`;
  const diasMes = diasEntre(inicio, fim);
  return { inicio, fim, diasMes, fuso: TZ };
}

/** Chave monotônica de parede SP (não usa Date.parse / fuso do host). */
function parseTs(s) {
  return fusoSp.wallToOrderMs(s);
}

function diasEntre(a, b) {
  return fusoSp.diasEntre(a, b);
}

function addDiasCorridos(tsStr, dias) {
  return fusoSp.addDiasCorridos(tsStr, dias);
}

function cicloUsoId(tenantId, competencia) {
  const raw = `USO:${tenantId}:${competencia}`;
  if (raw.length <= 64) return { id: raw, completo: raw };
  const h = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 40);
  return { id: `USO:${h}:${competencia}`.slice(0, 64), completo: raw };
}

function reaisParaCentavosFrete(vl) {
  const n = Number(vl);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100 + Number.EPSILON);
}

async function qPool(sql, params) {
  return pool.query(sql, params);
}

/**
 * Evidência de disparo efetivo (inspeção 26/11):
 * - CONVOCACAO nasce PENDENTE com DHCONVOCACAO no momento da convocação pela torre.
 * - Não há status de rascunho pré-disparo no modelo.
 * - DHENVIOMETA / LOG_ENVIO_WHATSAPP.ENVIADO confirmam canal WhatsApp (opcional).
 * Critério D1: primeira convocação operacional por (TENANT_ID, IDVIAGEM), ordenada por DHCONVOCACAO, IDCONVOCACAO.
 * Exclui viagem-mãe que possui filhas (agrupadora). Filhas contam; canceladas/inativas da viagem continuam.
 */
async function listarAnunciosCompetencia(q, tenantId, inicio, fim) {
  const r = await q(
    `
    WITH candidatos AS (
      SELECT
        c."IDCONVOCACAO",
        c."IDVIAGEM",
        c."TENANT_ID",
        c."STATUS",
        c."DHCONVOCACAO",
        c."DHENVIOMETA",
        v."VLFRETE",
        v."FGACTIVE",
        v."IDVIAGEM_MAE",
        EXISTS (
          SELECT 1 FROM "VIAGEMMESTRE" f
           WHERE f."TENANT_ID" = v."TENANT_ID"
             AND f."IDVIAGEM_MAE" = v."IDVIAGEM"
        ) AS "EH_MAE_AGRUPADORA",
        EXISTS (
          SELECT 1 FROM "LOG_ENVIO_WHATSAPP" lw
           WHERE lw."IDCONVOCACAO" = c."IDCONVOCACAO"
             AND UPPER(TRIM(COALESCE(lw."STATUS_ENVIO", ''))) = 'ENVIADO'
        ) AS "WHATS_ENVIADO"
      FROM "CONVOCACAO" c
      INNER JOIN "VIAGEMMESTRE" v
        ON v."IDVIAGEM" = c."IDVIAGEM" AND v."TENANT_ID" = c."TENANT_ID"
      WHERE c."TENANT_ID" = $1
        AND c."DHCONVOCACAO" >= $2::timestamp
        AND c."DHCONVOCACAO" < $3::timestamp
        AND UPPER(TRIM(COALESCE(c."STATUS", ''))) = ANY($4::text[])
    ),
    efetivos AS (
      SELECT *
      FROM candidatos
      WHERE "EH_MAE_AGRUPADORA" IS FALSE
        AND (
          "DHENVIOMETA" IS NOT NULL
          OR "WHATS_ENVIADO" IS TRUE
          OR UPPER(TRIM(COALESCE("STATUS", ''))) IN ('PENDENTE','ACEITA','CONFIRMADA','RECUSADA','ACEITA_DESCARTADA')
        )
    ),
    primeiros AS (
      SELECT DISTINCT ON ("TENANT_ID", "IDVIAGEM")
        *
      FROM efetivos
      ORDER BY "TENANT_ID", "IDVIAGEM", "DHCONVOCACAO" ASC, "IDCONVOCACAO" ASC
    )
    SELECT * FROM primeiros
    ORDER BY "DHCONVOCACAO" ASC, "IDVIAGEM" ASC
    `,
    [tenantId, inicio, fim, Array.from(STATUS_DISP)]
  );
  return r.rows || [];
}

async function listarContratosPeriodo(q, tenantId, inicio, fim) {
  const r = await q(
    `
    SELECT c.*,
           (SELECT COALESCE(json_agg(x ORDER BY x."ORDEM", x."ID"), '[]'::json)
              FROM (
                SELECT comp.*
                  FROM "FIN_CONTRATO_COMPONENTE" comp
                 WHERE comp."ID_CONTRATO" = c."ID"
                   AND comp."GRUPO" = 'USO_PLATAFORMA'
                   AND comp."FG_ATIVO" = 'S'
              ) x
           ) AS COMPONENTES_USO
      FROM "FIN_CONTRATO" c
     WHERE c."TENANT_ID" = $1
       AND c."FGACTIVE" IN ('S', 'A')
       AND c."DH_INICIO" < $3::timestamp
       AND (c."DH_FIM" IS NULL OR c."DH_FIM" > $2::timestamp)
     ORDER BY c."DH_INICIO" ASC, c."ID" ASC
    `,
    [tenantId, inicio, fim]
  );
  return (r.rows || []).map((row) => {
    let comps = row.COMPONENTES_USO || row.componentes_uso || [];
    if (typeof comps === 'string') {
      try {
        comps = JSON.parse(comps);
      } catch (_) {
        comps = [];
      }
    }
    if (!Array.isArray(comps)) comps = [];
    return Object.assign({}, row, { componentesUso: comps });
  });
}

/**
 * Remove sobreposição de vigências: versão mais alta vence o pedaço do tempo.
 * Evita FIXO/% em dobro quando alguém antecipa DH_INICIO sobre histórico antigo.
 */
function resolverSobreposicoesIntervalos(intervals) {
  if (!intervals || intervals.length < 2) return intervals || [];
  const ranked = intervals.slice().sort((a, b) => {
    const dv = Number(b.versao) - Number(a.versao);
    if (dv) return dv;
    return Number(b.idContrato) - Number(a.idContrato);
  });
  const ocupado = [];
  const out = [];
  for (const iv of ranked) {
    let segs = [[parseTs(iv.inicio), parseTs(iv.fim)]];
    if (segs[0][0] == null || segs[0][1] == null) continue;
    for (const [ts, te] of ocupado) {
      const novo = [];
      for (const [s, e] of segs) {
        if (te <= s || ts >= e) {
          novo.push([s, e]);
          continue;
        }
        if (s < ts) novo.push([s, ts]);
        if (e > te) novo.push([te, e]);
      }
      segs = novo;
    }
    for (const [s, e] of segs) {
      if (e <= s) continue;
      const wallInicio = fusoSp.orderMsToWall(s);
      const wallFim = fusoSp.orderMsToWall(e);
      out.push(
        Object.assign({}, iv, {
          inicio: wallInicio,
          fim: wallFim,
          dias: diasEntre(wallInicio, wallFim),
        })
      );
      ocupado.push([s, e]);
    }
  }
  out.sort((x, y) => parseTs(x.inicio) - parseTs(y.inicio) || Number(x.versao) - Number(y.versao));
  return out;
}

/** Intervalos [max(inicioComp, DH_INICIO), min(fimComp, DH_FIM||inf)) semiaberto, sem overlap. */
function montarIntervalosContrato(contratos, inicio, fim) {
  const intervals = [];
  const inicioMs = parseTs(inicio);
  const fimMs = parseTs(fim);
  for (const c of contratos) {
    const di = c.DH_INICIO || c.dh_inicio;
    const df = c.DH_FIM != null ? c.DH_FIM : c.dh_fim;
    const diMs = parseTs(di);
    const dfMs = df != null ? parseTs(df) : fimMs;
    if (inicioMs == null || fimMs == null || diMs == null || dfMs == null) continue;
    const aMs = Math.max(inicioMs, diMs);
    const bMs = Math.min(fimMs, dfMs);
    if (bMs <= aMs) continue;
    const wallInicio = fusoSp.orderMsToWall(aMs);
    const wallFim = fusoSp.orderMsToWall(bMs);
    intervals.push({
      idContrato: c.ID || c.id,
      versao: c.VERSAO || c.versao,
      fgRegra: String(c.FG_REGRA_ATIVA || c.fg_regra_ativa || 'N').toUpperCase(),
      inicio: wallInicio,
      fim: wallFim,
      dias: diasEntre(wallInicio, wallFim),
      componentesUso: c.componentesUso || [],
    });
  }
  return resolverSobreposicoesIntervalos(intervals);
}

function detectarLacunas(intervals, inicio, fim) {
  const gaps = [];
  let cursor = parseTs(inicio);
  const end = parseTs(fim);
  if (cursor == null || end == null) return gaps;
  for (const iv of intervals) {
    const a = parseTs(iv.inicio);
    if (a == null) continue;
    if (a > cursor) {
      gaps.push({ inicio: fusoSp.orderMsToWall(cursor), fim: fusoSp.toSpWall(iv.inicio) || iv.inicio });
    }
    const b = parseTs(iv.fim);
    if (b != null) cursor = Math.max(cursor, b);
  }
  if (cursor < end) {
    gaps.push({
      inicio: fusoSp.orderMsToWall(cursor),
      fim: fusoSp.toSpWall(fim) || fim,
    });
  }
  return gaps;
}

function contratoNoInstante(intervals, ts) {
  const t = parseTs(ts);
  for (const iv of intervals) {
    const a = parseTs(iv.inicio);
    const b = parseTs(iv.fim);
    if (t >= a && t < b) return iv;
  }
  return null;
}

function calcularPreview({ tenantId, competencia, anuncios, intervals, gaps, bounds }) {
  const excecoes = [];
  const viagens = [];
  const memoriaComponentes = [];
  let totalCentavos = 0;
  let basePercentual = 0;
  let qtdValidas = 0;
  let qtdFreteInvalido = 0;

  for (const g of gaps) {
    excecoes.push({
      codigo: 'INTERVALO_SEM_CONTRATO',
      inicio: g.inicio,
      fim: g.fim,
      mensagem: 'Intervalo da competência sem contrato vigente.',
    });
  }

  const temQualquerUso = intervals.some((iv) => (iv.componentesUso || []).length > 0);
  if (!temQualquerUso && intervals.length === 0) {
    // sem contrato e sem componente
  }

  // FIXO proporcional por intervalo
  for (const iv of intervals) {
    const fixos = (iv.componentesUso || []).filter((c) => String(c.TIPO || c.tipo).toUpperCase() === 'FIXO');
    for (const f of fixos) {
      const valor = Math.round(Number(f.VALOR_CENTAVOS ?? f.valor_centavos ?? 0));
      const parcela =
        bounds.diasMes > 0 ? Math.round((valor * iv.dias) / bounds.diasMes) : 0;
      totalCentavos += parcela;
      memoriaComponentes.push({
        tipo: 'FIXO',
        idContrato: iv.idContrato,
        versao: iv.versao,
        valorContratoCentavos: valor,
        diasIntervalo: iv.dias,
        diasCompetencia: bounds.diasMes,
        valorCentavos: parcela,
        intervalo: { inicio: iv.inicio, fim: iv.fim },
      });
    }
  }

  const usoIvs = intervals.filter((iv) => (iv.componentesUso || []).length > 0);
  let regraSnapshot =
    usoIvs.length > 0 && usoIvs.every((iv) => iv.fgRegra === 'S') ? 'S' : 'N';

  for (const a of anuncios) {
    const idViagem = a.IDVIAGEM != null ? a.IDVIAGEM : a.idviagem;
    const dh = a.DHCONVOCACAO || a.dhconvocacao;
    const iv = contratoNoInstante(intervals, dh);
    const vlFrete = a.VLFRETE != null ? a.VLFRETE : a.vlfrete;
    const freteNum = vlFrete == null || vlFrete === '' ? NaN : Number(vlFrete);
    const freteInvalido = !Number.isFinite(freteNum) || freteNum <= 0;

    const item = {
      idViagem: Number(idViagem),
      idConvocacao: a.IDCONVOCACAO || a.idconvocacao,
      dhAnuncio: dh,
      vlFrete: freteNum,
      freteInvalido,
      idContrato: iv ? iv.idContrato : null,
      versaoContrato: iv ? iv.versao : null,
      parcelas: [],
    };

    if (!iv) {
      excecoes.push({
        codigo: 'EVENTO_SEM_CONTRATO',
        idViagem: item.idViagem,
        dhAnuncio: dh,
        mensagem: 'Anúncio sem contrato vigente na data/hora do evento.',
      });
      viagens.push(item);
      continue;
    }

    if (freteInvalido) {
      qtdFreteInvalido += 1;
      excecoes.push({
        codigo: 'VLFRETE_INVALIDO',
        idViagem: item.idViagem,
        vlFrete: vlFrete,
        mensagem: 'VLFRETE nulo, zero ou negativo. Corrija a viagem e recalcule.',
      });
    } else {
      qtdValidas += 1;
      basePercentual += freteNum;
    }

    const comps = iv.componentesUso || [];
    for (const c of comps) {
      const tipo = String(c.TIPO || c.tipo).toUpperCase();
      if (tipo === 'POR_CARGA_ANUNCIADA') {
        const v = Math.round(Number(c.VALOR_CENTAVOS ?? c.valor_centavos ?? 0));
        totalCentavos += v;
        item.parcelas.push({ tipo, valorCentavos: v, idContrato: iv.idContrato });
        memoriaComponentes.push({
          tipo,
          idViagem: item.idViagem,
          idContrato: iv.idContrato,
          versao: iv.versao,
          valorCentavos: v,
        });
      } else if (tipo === 'PERCENTUAL') {
        if (freteInvalido) {
          item.parcelas.push({ tipo, valorCentavos: null, bloqueado: true });
          continue;
        }
        const pct = Number(c.PERCENTUAL ?? c.percentual);
        const parcelaReais = Math.round(freteNum * (pct / 100) * 100 + Number.EPSILON) / 100;
        const parcelaCent = Math.round(parcelaReais * 100 + Number.EPSILON);
        totalCentavos += parcelaCent;
        item.parcelas.push({ tipo, percentual: pct, baseVlFrete: freteNum, valorCentavos: parcelaCent });
        memoriaComponentes.push({
          tipo,
          idViagem: item.idViagem,
          idContrato: iv.idContrato,
          versao: iv.versao,
          percentual: pct,
          baseVlFrete: freteNum,
          valorCentavos: parcelaCent,
        });
      }
    }
    viagens.push(item);
  }

  const temUsoAtivo = intervals.some((iv) => (iv.componentesUso || []).length > 0);
  let codigoResultado = null;
  let status;

  if (!temUsoAtivo) {
    status = 'SEM_COMPONENTE_USO_PLATAFORMA';
    codigoResultado = 'SEM_COMPONENTE_USO_PLATAFORMA';
    totalCentavos = 0;
  } else if (excecoes.length) {
    status = 'COM_EXCECOES';
  } else if (regraSnapshot !== 'S') {
    status = 'RASCUNHO';
    codigoResultado = 'REGRA_DESATIVADA';
  } else {
    status = 'AGUARDANDO_APROVACAO';
  }

  const memoria = {
    versaoMemoria: 1,
    fuso: TZ,
    competencia,
    tenantId,
    bounds,
    intervalosContrato: intervals.map((iv) => ({
      idContrato: iv.idContrato,
      versao: iv.versao,
      fgRegra: iv.fgRegra,
      inicio: iv.inicio,
      fim: iv.fim,
      dias: iv.dias,
      qtdComponentesUso: (iv.componentesUso || []).length,
      resumoUso: resumoTextoComponentesUso(iv.componentesUso),
    })),
    // Breakdown amigável para a UI (centavos).
    breakdown: (() => {
      const fixo = memoriaComponentes
        .filter((c) => String(c.tipo).toUpperCase() === 'FIXO')
        .reduce((s, c) => s + (Number(c.valorCentavos) || 0), 0);
      const percentual = memoriaComponentes
        .filter((c) => String(c.tipo).toUpperCase() === 'PERCENTUAL')
        .reduce((s, c) => s + (Number(c.valorCentavos) || 0), 0);
      const porAnuncio = memoriaComponentes
        .filter((c) => String(c.tipo).toUpperCase() === 'POR_CARGA_ANUNCIADA')
        .reduce((s, c) => s + (Number(c.valorCentavos) || 0), 0);
      return { fixoCentavos: fixo, percentualCentavos: percentual, anuncioCentavos: porAnuncio };
    })(),
    lacunas: gaps,
    componentes: memoriaComponentes,
    viagens,
    totais: {
      qtdAnunciadas: anuncios.length,
      qtdValidas,
      qtdFreteInvalido,
      basePercentual,
      totalCentavos,
    },
    fgRegraSnapshot: regraSnapshot,
    criterioD1:
      'Primeira CONVOCACAO operacional por viagem (DHCONVOCACAO); exclui mãe agrupadora; filhas contam; cancelamento posterior da viagem não remove.',
  };

  return {
    status,
    codigoResultado,
    totalCentavos,
    qtdAnunciadas: anuncios.length,
    qtdValidas,
    qtdFreteInvalido,
    basePercentual,
    fgRegraSnapshot: regraSnapshot,
    excecoes,
    memoria,
  };
}

async function calcularParaTenant(tenantId, competencia) {
  const comp = parseCompetencia(competencia);
  const bounds = boundsCompetencia(comp);
  const anuncios = await listarAnunciosCompetencia(qPool, tenantId, bounds.inicio, bounds.fim);
  const contratos = await listarContratosPeriodo(qPool, tenantId, bounds.inicio, bounds.fim);
  const intervals = montarIntervalosContrato(contratos, bounds.inicio, bounds.fim);
  const gaps = detectarLacunas(intervals, bounds.inicio, bounds.fim);
  return calcularPreview({ tenantId, competencia: comp, anuncios, intervals, gaps, bounds });
}

async function registrarEventoFech(client, idFech, tipo, stAnt, stNovo, usuario, detalhe, ip) {
  await client.query(
    `INSERT INTO "FIN_FECHAMENTO_USO_EVENTO"
      ("ID_FECHAMENTO","TIPO","STATUS_ANTERIOR","STATUS_NOVO","SGUSER","DETALHE","IP")
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [idFech, tipo, stAnt || null, stNovo || null, usuario || null, (detalhe || '').slice(0, 500), ip || null]
  );
}

async function obterFechamento(tenantId, idOrComp) {
  let r;
  if (/^\d{4}-\d{2}$/.test(String(idOrComp || ''))) {
    r = await qPool(
      `SELECT * FROM "FIN_FECHAMENTO_USO" WHERE "TENANT_ID"=$1 AND "COMPETENCIA"=$2`,
      [tenantId, idOrComp]
    );
  } else {
    r = await qPool(
      `SELECT * FROM "FIN_FECHAMENTO_USO" WHERE "TENANT_ID"=$1 AND "ID"=$2`,
      [tenantId, parseInt(idOrComp, 10)]
    );
  }
  const row = r.rows[0];
  if (!row) return null;
  const ev = await qPool(
    `SELECT * FROM "FIN_FECHAMENTO_USO_EVENTO" WHERE "ID_FECHAMENTO"=$1 ORDER BY "DH_EVENTO"`,
    [row.ID]
  );
  return Object.assign({}, row, {
    memoria: safeJson(row.MEMORIA_CALCULO),
    excecoes: safeJson(row.EXCECOES),
    eventos: ev.rows,
  });
}

function safeJson(s) {
  if (s == null) return null;
  if (typeof s === 'object') return s;
  try {
    return JSON.parse(s);
  } catch (_) {
    return s;
  }
}

function resumoTextoComponentesUso(comps) {
  const parts = [];
  for (const c of comps || []) {
    const tipo = String(c.TIPO || c.tipo || '').toUpperCase();
    if (tipo === 'FIXO') {
      const v = Math.round(Number(c.VALOR_CENTAVOS ?? c.valor_centavos ?? c.valorContratoCentavos ?? 0));
      parts.push(`Fixo R$ ${(v / 100).toFixed(2)}`);
    } else if (tipo === 'PERCENTUAL') {
      const p = Number(c.PERCENTUAL ?? c.percentual);
      if (Number.isFinite(p)) {
        const txt = String(p)
          .replace(/(\.\d*?[1-9])0+$/, '$1')
          .replace(/\.0+$/, '');
        parts.push(`${txt}% do frete`);
      } else {
        parts.push('% do frete');
      }
    } else if (tipo === 'POR_CARGA_ANUNCIADA') {
      const v = Math.round(Number(c.VALOR_CENTAVOS ?? c.valor_centavos ?? c.valorContratoCentavos ?? 0));
      parts.push(`R$ ${(v / 100).toFixed(2)}/anúncio`);
    }
  }
  return parts.join(' + ');
}

function resumoContratosFechamento(memRaw) {
  let mem = memRaw;
  if (mem == null) return { versoes: '', tabelaUso: '' };
  if (typeof mem === 'string') {
    try {
      mem = JSON.parse(mem);
    } catch (_) {
      return { versoes: '', tabelaUso: '' };
    }
  }
  if (typeof mem !== 'object') return { versoes: '', tabelaUso: '' };

  const ivs = Array.isArray(mem.intervalosContrato) ? mem.intervalosContrato : [];
  // Na grid, só versões que cobriram dias do mês (ignora publicações no mesmo segundo).
  const relevantes = ivs.filter((iv) => (Number(iv.dias != null ? iv.dias : iv.DIAS) || 0) > 0);
  const baseIvs = relevantes.length ? relevantes : ivs;

  const versoes = baseIvs
    .map((iv) => {
      const v = iv.versao != null ? iv.versao : iv.VERSAO;
      const dias = iv.dias != null ? iv.dias : iv.DIAS;
      return v != null ? `v${v}${dias != null ? ` (${dias}d)` : ''}` : null;
    })
    .filter(Boolean)
    .join(' · ');

  const comResumo = baseIvs
    .map((iv) => {
      const v = iv.versao != null ? iv.versao : iv.VERSAO;
      const ru = iv.resumoUso || iv.RESUMO_USO || '';
      if (!ru) return null;
      return v != null ? `v${v}: ${ru}` : ru;
    })
    .filter(Boolean);

  if (comResumo.length) {
    return { versoes, tabelaUso: comResumo.join(' · ') };
  }

  // Fallback memórias antigas (sem resumoUso nos intervalos)
  const comps = Array.isArray(mem.componentes) ? mem.componentes : [];
  const porChave = Object.create(null);
  for (const c of comps) {
    const tipo = String(c.tipo || c.TIPO || '').toUpperCase();
    const ver = c.versao != null ? c.versao : c.VERSAO;
    const key = tipo + '|' + String(ver == null ? '' : ver);
    if (porChave[key]) continue;
    let rotulo = tipo;
    if (tipo === 'FIXO') {
      const cent = Number(c.valorContratoCentavos != null ? c.valorContratoCentavos : c.valorCentavos) || 0;
      rotulo = `Fixo R$ ${(cent / 100).toFixed(2)}`;
    } else if (tipo === 'PERCENTUAL') {
      const p = c.percentual != null ? c.percentual : c.PERCENTUAL;
      rotulo = p != null ? `${p}% do frete` : '% do frete';
    } else if (tipo === 'POR_CARGA_ANUNCIADA') {
      const cent = Number(c.valorContratoCentavos != null ? c.valorContratoCentavos : c.valorCentavos) || 0;
      rotulo = `R$ ${(cent / 100).toFixed(2)}/anúncio`;
    }
    porChave[key] = ver != null ? `${rotulo} (v${ver})` : rotulo;
  }
  const tabelaUso = Object.keys(porChave)
    .map((k) => porChave[k])
    .join(' + ');
  return { versoes, tabelaUso };
}

async function listarFechamentos(tenantId, limit) {
  const lim = Math.min(100, Math.max(1, parseInt(limit, 10) || 24));
  const r = await qPool(
    `SELECT "ID","COMPETENCIA","STATUS","TOTAL_CENTAVOS","QTD_ANUNCIADAS","QTD_FRETE_INVALIDO",
            "FG_REGRA_SNAPSHOT","CODIGO_RESULTADO","ID_COBRANCA","DH_CRIACAO","DH_APROVACAO","DH_COBRANCA",
            "MEMORIA_CALCULO"
       FROM "FIN_FECHAMENTO_USO"
      WHERE "TENANT_ID"=$1
      ORDER BY "COMPETENCIA" DESC
      LIMIT $2`,
    [tenantId, lim]
  );
  return (r.rows || []).map((row) => {
    const resumo = resumoContratosFechamento(row.MEMORIA_CALCULO);
    const out = Object.assign({}, row);
    delete out.MEMORIA_CALCULO;
    out.RESUMO_VERSOES = resumo.versoes || '';
    out.RESUMO_TABELA_USO = resumo.tabelaUso || '';
    return out;
  });
}

async function criarOuRecalcular(tenantId, competencia, usuario, ip, { forcar } = {}) {
  // Atlas (default) pode pré-visualizar, mas não deve gravar/aprovar dívida SaaS contra si.
  // Recálculo forçado ainda é permitido para limpar lixo operacional.
  if (String(tenantId || '').trim() === String(getDefaultTenantId()).trim() && !forcar) {
    throw new ErroFinanceiro(
      'A instalação padrão (Atlas) não grava fechamento de uso contra si mesma. Selecione o tenant do agenciador.',
      400,
      'USO_DEFAULT_SEM_FECHAMENTO'
    );
  }
  const preview = await calcularParaTenant(tenantId, competencia);
  const ciclo = cicloUsoId(tenantId, parseCompetencia(competencia));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT * FROM "FIN_FECHAMENTO_USO"
        WHERE "TENANT_ID"=$1 AND "COMPETENCIA"=$2
        FOR UPDATE`,
      [tenantId, parseCompetencia(competencia)]
    );
    const existente = cur.rows[0];
    if (existente) {
      const st = String(existente.STATUS || '');
      if (st === 'APROVADO' || st === 'COBRADO') {
        if (!forcar) {
          throw new ErroFinanceiro(
            'Fechamento já aprovado/cobrado. Memória congelada; não recalcula.',
            409,
            'FECHAMENTO_IMUTAVEL'
          );
        }
      }
      const stAnt = existente.STATUS;
      const versao = Number(existente.VERSAO_CALCULO || 1) + 1;
      const upd = await client.query(
        `UPDATE "FIN_FECHAMENTO_USO" SET
           "STATUS"=$3,
           "TOTAL_CENTAVOS"=$4,
           "QTD_ANUNCIADAS"=$5,
           "QTD_VALIDAS"=$6,
           "QTD_FRETE_INVALIDO"=$7,
           "BASE_PERCENTUAL"=$8,
           "FG_REGRA_SNAPSHOT"=$9,
           "CODIGO_RESULTADO"=$10,
           "MEMORIA_CALCULO"=$11,
           "EXCECOES"=$12,
           "VERSAO_CALCULO"=$13,
           "DH_RECALCULO"=CURRENT_TIMESTAMP,
           "SGUSER_RECALCULO"=$14,
           "DH_APROVACAO"=NULL,
           "SGUSER_APROVACAO"=NULL,
           "DH_VENCIMENTO"=NULL,
           "ID_COBRANCA"=NULL,
           "DH_COBRANCA"=NULL,
           "SGUSER_COBRANCA"=NULL
         WHERE "ID"=$1 AND "TENANT_ID"=$2
         RETURNING *`,
        [
          existente.ID,
          tenantId,
          preview.status,
          preview.totalCentavos,
          preview.qtdAnunciadas,
          preview.qtdValidas,
          preview.qtdFreteInvalido,
          preview.basePercentual,
          preview.fgRegraSnapshot,
          preview.codigoResultado,
          JSON.stringify(preview.memoria),
          JSON.stringify(preview.excecoes),
          versao,
          usuario || null,
        ]
      );
      await registrarEventoFech(
        client,
        existente.ID,
        'RECALCULADO',
        stAnt,
        preview.status,
        usuario,
        `Recálculo v${versao}`,
        ip
      );
      await client.query('COMMIT');
      return obterFechamento(tenantId, upd.rows[0].ID);
    }

    const ins = await client.query(
      `INSERT INTO "FIN_FECHAMENTO_USO"
        ("TENANT_ID","COMPETENCIA","STATUS","TOTAL_CENTAVOS","QTD_ANUNCIADAS","QTD_VALIDAS",
         "QTD_FRETE_INVALIDO","BASE_PERCENTUAL","FG_REGRA_SNAPSHOT","CODIGO_RESULTADO",
         "MEMORIA_CALCULO","EXCECOES","ID_CICLO_USO","SGUSER_CRIACAO")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        tenantId,
        parseCompetencia(competencia),
        preview.status,
        preview.totalCentavos,
        preview.qtdAnunciadas,
        preview.qtdValidas,
        preview.qtdFreteInvalido,
        preview.basePercentual,
        preview.fgRegraSnapshot,
        preview.codigoResultado,
        JSON.stringify(preview.memoria),
        JSON.stringify(preview.excecoes),
        ciclo.id,
        usuario || null,
      ]
    );
    await registrarEventoFech(client, ins.rows[0].ID, 'CRIADO', null, preview.status, usuario, 'Prévia criada', ip);
    await client.query('COMMIT');
    return obterFechamento(tenantId, ins.rows[0].ID);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e && e.code === '23505') {
      throw new ErroFinanceiro('Fechamento concorrente para esta competência.', 409, 'CONCORRENCIA');
    }
    throw e;
  } finally {
    client.release();
  }
}

async function aprovarFechamento(tenantId, idFechamento, usuario, ip, confirmacao) {
  if (String(confirmacao || '').toUpperCase() !== 'APROVAR') {
    throw new ErroFinanceiro('Confirme com confirmacao: "APROVAR".', 400, 'CONFIRMACAO_OBRIGATORIA');
  }
  if (String(tenantId || '').trim() === String(getDefaultTenantId()).trim()) {
    throw new ErroFinanceiro(
      'A instalação padrão (Atlas) não aprova fechamento de uso contra si mesma.',
      400,
      'USO_DEFAULT_SEM_FECHAMENTO'
    );
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT * FROM "FIN_FECHAMENTO_USO" WHERE "ID"=$1 AND "TENANT_ID"=$2 FOR UPDATE`,
      [parseInt(idFechamento, 10), tenantId]
    );
    const row = cur.rows[0];
    if (!row) throw new ErroFinanceiro('Fechamento não encontrado.', 404, 'NAO_ENCONTRADO');
    const st = String(row.STATUS || '');
    if (st === 'APROVADO' || st === 'COBRADO') {
      await client.query('COMMIT');
      return obterFechamento(tenantId, row.ID);
    }
    if (st === 'COM_EXCECOES') {
      throw new ErroFinanceiro('Há exceções impeditivas. Corrija e recalcule.', 400, 'COM_EXCECOES');
    }
    if (st === 'SEM_COMPONENTE_USO_PLATAFORMA') {
      throw new ErroFinanceiro('Sem componente USO ativo — não há o que aprovar para cobrança.', 400, 'SEM_COMPONENTE');
    }
    if (String(row.FG_REGRA_SNAPSHOT || 'N') !== 'S') {
      throw new ErroFinanceiro('Regra financeira desativada — prévia só diagnóstica.', 400, 'REGRA_DESATIVADA');
    }
    if (st !== 'AGUARDANDO_APROVACAO' && st !== 'RASCUNHO') {
      throw new ErroFinanceiro(`Status ${st} não permite aprovação.`, 400, 'STATUS');
    }
    // RASCUNHO com regra S e sem exceções (edge) — só AGUARDANDO normalmente
    if (st === 'RASCUNHO') {
      throw new ErroFinanceiro('Fechamento não está pronto para aprovação (regra ou status).', 400, 'STATUS');
    }

    const { dhAprovacao: dhAprovStr, dhVencimento: venc } = fusoSp.aprovacaoEVencimento();

    await client.query(
      `UPDATE "FIN_FECHAMENTO_USO" SET
         "STATUS"='APROVADO',
         "DH_APROVACAO"=CURRENT_TIMESTAMP,
         "SGUSER_APROVACAO"=$2,
         "DH_VENCIMENTO"=$3::timestamp
       WHERE "ID"=$1`,
      [row.ID, usuario || null, venc]
    );
    await registrarEventoFech(
      client,
      row.ID,
      'APROVADO',
      st,
      'APROVADO',
      usuario,
      `Total ${row.TOTAL_CENTAVOS} centavos; vencimento ${venc}`,
      ip
    );
    await client.query('COMMIT');
    return obterFechamento(tenantId, row.ID);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function gerarCobranca(tenantId, idFechamento, usuario, ip, confirmacao) {
  if (String(confirmacao || '').toUpperCase() !== 'GERAR_COBRANCA') {
    throw new ErroFinanceiro('Confirme com confirmacao: "GERAR_COBRANCA".', 400, 'CONFIRMACAO_OBRIGATORIA');
  }
  const beneficiario = getDefaultTenantId();
  const tid = String(tenantId || '').trim();
  // Atlas (default) não gera dívida SaaS contra si mesma.
  if (tid && tid === String(beneficiario).trim()) {
    throw new ErroFinanceiro(
      'A instalação padrão (Atlas) não gera cobrança de uso contra si mesma. Opere o agente (tenant) e gere a cobrança dele.',
      400,
      'USO_DEFAULT_SEM_AUTOCOBRANCA'
    );
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT * FROM "FIN_FECHAMENTO_USO" WHERE "ID"=$1 AND "TENANT_ID"=$2 FOR UPDATE`,
      [parseInt(idFechamento, 10), tid]
    );
    const row = cur.rows[0];
    if (!row) throw new ErroFinanceiro('Fechamento não encontrado.', 404, 'NAO_ENCONTRADO');

    if (row.ID_COBRANCA) {
      const cob = await client.query(`SELECT * FROM "FIN_COBRANCA" WHERE "ID"=$1`, [row.ID_COBRANCA]);
      await client.query('COMMIT');
      return { idempotente: true, fechamento: await obterFechamento(tenantId, row.ID), cobranca: cob.rows[0] };
    }

    if (String(row.STATUS) === 'COBRADO' && row.ID_COBRANCA) {
      await client.query('COMMIT');
      return { idempotente: true, fechamento: await obterFechamento(tenantId, row.ID) };
    }

    if (String(row.STATUS) !== 'APROVADO') {
      throw new ErroFinanceiro('Só fechamento APROVADO gera cobrança.', 400, 'STATUS');
    }
    if (String(row.FG_REGRA_SNAPSHOT || 'N') !== 'S') {
      throw new ErroFinanceiro('Regra desativada — cobrança bloqueada.', 400, 'REGRA_DESATIVADA');
    }
    if (Number(row.TOTAL_CENTAVOS) <= 0) {
      throw new ErroFinanceiro('Total zero — não gera cobrança.', 400, 'TOTAL_ZERO');
    }

    const ciclo = row.ID_CICLO_USO;
    const memoriaAprovada = row.MEMORIA_CALCULO;
    const venc = row.DH_VENCIMENTO;

    let cob;
    try {
      const ins = await client.query(
        `INSERT INTO "FIN_COBRANCA"
          ("MODALIDADE","TENANT_ID","PAGADOR_TIPO","PAGADOR_TENANT_ID","BENEFICIARIO_TENANT_ID",
           "IDVIAGEM","IDCONVOCACAO","ID_CICLO_CONFIRMACAO","ID_CONTRATO","VERSAO_CONTRATO",
           "VALOR_CENTAVOS","MOEDA","MEMORIA_CALCULO","STATUS","SGUSER_CRIACAO","DH_VENCIMENTO")
         VALUES
          ('USO_PLATAFORMA',$1,'TENANT',$1,$2,
           NULL,NULL,$3,NULL,NULL,
           $4,'BRL',$5,'ABERTA',$6,$7)
         RETURNING *`,
        [tenantId, beneficiario, ciclo, row.TOTAL_CENTAVOS, memoriaAprovada, usuario || null, venc]
      );
      cob = ins.rows[0];
    } catch (e) {
      if (e && e.code === '23505') {
        const existing = await client.query(
          `SELECT * FROM "FIN_COBRANCA"
            WHERE "TENANT_ID"=$1 AND "ID_CICLO_CONFIRMACAO"=$2
              AND "MODALIDADE"='USO_PLATAFORMA' AND "STATUS" IN ('ABERTA','PAGA')
            LIMIT 1`,
          [tenantId, ciclo]
        );
        if (existing.rows[0]) {
          await client.query(
            `UPDATE "FIN_FECHAMENTO_USO" SET "STATUS"='COBRADO',"ID_COBRANCA"=$2,"DH_COBRANCA"=CURRENT_TIMESTAMP,"SGUSER_COBRANCA"=$3
              WHERE "ID"=$1`,
            [row.ID, existing.rows[0].ID, usuario || null]
          );
          await client.query('COMMIT');
          return {
            idempotente: true,
            fechamento: await obterFechamento(tenantId, row.ID),
            cobranca: existing.rows[0],
          };
        }
      }
      throw e;
    }

    await client.query(
      `INSERT INTO "FIN_COBRANCA_EVENTO"
        ("ID_COBRANCA","TIPO","STATUS_ANTERIOR","STATUS_NOVO","SGUSER","DETALHE","IP")
       VALUES ($1,'CRIADA',NULL,'ABERTA',$2,$3,$4)`,
      [cob.ID, usuario || null, `Fechamento uso ${row.COMPETENCIA} ciclo ${ciclo}`.slice(0, 500), ip || null]
    );

    await client.query(
      `UPDATE "FIN_FECHAMENTO_USO" SET
         "STATUS"='COBRADO',
         "ID_COBRANCA"=$2,
         "DH_COBRANCA"=CURRENT_TIMESTAMP,
         "SGUSER_COBRANCA"=$3
       WHERE "ID"=$1`,
      [row.ID, cob.ID, usuario || null]
    );
    await registrarEventoFech(client, row.ID, 'COBRANCA_GERADA', 'APROVADO', 'COBRADO', usuario, `Cobrança ${cob.ID}`, ip);
    await client.query('COMMIT');
    return { idempotente: false, fechamento: await obterFechamento(tenantId, row.ID), cobranca: cob };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Prévia sem persistir (diagnóstico). */
async function previaEphemera(tenantId, competencia) {
  return calcularParaTenant(tenantId, competencia);
}

module.exports = {
  TZ,
  parseCompetencia,
  boundsCompetencia,
  cicloUsoId,
  listarAnunciosCompetencia,
  calcularParaTenant,
  previaEphemera,
  criarOuRecalcular,
  obterFechamento,
  listarFechamentos,
  aprovarFechamento,
  gerarCobranca,
  ipDe,
  ErroFinanceiro,
  // exported for tests
  montarIntervalosContrato,
  resolverSobreposicoesIntervalos,
  detectarLacunas,
  calcularPreview,
  addDiasCorridos,
  diasEntre,
  parseTs,
  fusoSp,
};
