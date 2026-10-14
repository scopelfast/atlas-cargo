'use strict';

const { pool } = require('../config/db');
const { chaveLinhaShelf, normLote, isoValidade, marcarLinhasApontadas } = require('./wms-shelf-apontado.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function schemaErr(msg) {
  const e = new Error(msg);
  e.code = 'SCHEMA';
  return e;
}

function parseQtd(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function chaveBaixaLinha(cdDono, cdProduto, lote, validadeIso) {
  return `${cdDono}|${cdProduto}|${normLote(lote)}|${validadeIso || ''}`;
}

function parseLinhaEntradaBaixa(r, cdDonoFallback) {
  if (!r) return null;
  const cdDono = parseInt(r.CD_DONO != null ? r.CD_DONO : cdDonoFallback, 10);
  const cdProduto = parseInt(r.CD_PRODUTO, 10);
  const validade = isoValidade(r.VALIDADE || r.DT_VALIDADE || r.validade);
  const lote = normLote(r.LOTE != null ? r.LOTE : r.lote);
  if (!Number.isFinite(cdDono) || !Number.isFinite(cdProduto)) return null;
  const qtdSug =
    r.QTD_BAIXA != null
      ? parseQtd(r.QTD_BAIXA)
      : parseQtd(r.QTD_SALDO_ESTIMADO ?? r.QTD_SALDO_EST_FEFO ?? r.qtdBaixa);
  return {
    cdDono,
    cdProduto,
    lote,
    validade: validade || null,
    qtdSugerida: qtdSug,
    qtdSaldoEst: parseQtd(r.QTD_SALDO_ESTIMADO ?? r.QTD_SALDO_EST_FEFO),
    qtdSaldoSku: parseQtd(r.QTD_SALDO_SKU),
    codigoProduto: String(r.CODIGO_PRODUTO || r.codigo_prod || '').trim() || null,
    nmProduto: String(r.NM_PRODUTO || '').trim() || null,
    diasAteVencimento:
      r.DIAS_ATE_VENCIMENTO != null && Number.isFinite(Number(r.DIAS_ATE_VENCIMENTO))
        ? Number(r.DIAS_ATE_VENCIMENTO)
        : null,
    chaveShelf: chaveLinhaShelf(r),
  };
}

async function listarMotivosBaixa() {
  try {
    const r = await pool.query(
      `SELECT "CD_MOTIVO_BAIXA", "CODIGO", "DESCRICAO", "ROTULO_MOVIMENTO", "CODIGO_OL",
              "TP_MOVIMENTO", "EXIGE_LOTE_VALIDADE", "ORDEM"
         FROM "WMS_MOTIVO_BAIXA"
        WHERE "FGACTIVE" = 'S'
        ORDER BY "ORDEM", "DESCRICAO"`
    );
    return r.rows || [];
  } catch (e) {
    if (schemaMissing(e)) {
      throw schemaErr(
        'Estrutura de baixas ausente. Execute backend/scripts/adicionar_wms_baixa_estoque_postgres.sql.'
      );
    }
    throw e;
  }
}

async function carregarMotivoBaixa(cdMotivo) {
  const id = parseInt(cdMotivo, 10);
  if (!Number.isFinite(id)) return null;
  const r = await pool.query(
    `SELECT * FROM "WMS_MOTIVO_BAIXA" WHERE "CD_MOTIVO_BAIXA" = $1::integer AND "FGACTIVE" = 'S'`,
    [id]
  );
  return r.rows[0] || null;
}

async function carregarMotivoPorCodigo(codigo) {
  const c = String(codigo || '').trim();
  if (!c) return null;
  const r = await pool.query(
    `SELECT * FROM "WMS_MOTIVO_BAIXA" WHERE "CODIGO" = $1 AND "FGACTIVE" = 'S'`,
    [c]
  );
  return r.rows[0] || null;
}

/** Chaves dono|prod|lote|validade já baixadas (documento confirmado). */
async function carregarChavesBaixaAtivas(tenantId, cdDonoOpt) {
  const tid = String(tenantId || '').trim();
  const params = [tid];
  let clause = '';
  if (cdDonoOpt != null && String(cdDonoOpt).trim() !== '') {
    const n = parseInt(cdDonoOpt, 10);
    if (Number.isFinite(n)) {
      params.push(n);
      clause = ` AND h."CD_DONO" = $${params.length}::integer`;
    }
  }
  try {
    const r = await pool.query(
      `SELECT h."CD_DONO", l."CD_PRODUTO", l."LOTE", to_char(l."VALIDADE", 'YYYY-MM-DD') AS val
         FROM "WMS_BAIXA_ESTOQUE_LINHA" l
         JOIN "WMS_BAIXA_ESTOQUE" h ON h."CD_BAIXA" = l."CD_BAIXA"
        WHERE h."TENANT_ID" = $1
          AND h."ST_BAIXA" = 'CONFIRMADO'${clause}`,
      params
    );
    const set = new Set();
    for (const row of r.rows || []) {
      set.add(chaveBaixaLinha(row.CD_DONO, row.CD_PRODUTO, row.LOTE, row.val || ''));
    }
    return set;
  } catch (e) {
    if (schemaMissing(e)) return new Set();
    throw e;
  }
}

async function proximoNrDocumento(client, tenantId) {
  const r = await client.query(
    `SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace("NR_DOCUMENTO", '[^0-9]', '', 'g'), '') AS bigint)), 0) + 1 AS n
       FROM "WMS_BAIXA_ESTOQUE"
      WHERE "TENANT_ID" = $1`,
    [tenantId]
  );
  const n = Number(r.rows[0] && r.rows[0].n) || 1;
  return String(n).padStart(10, '0');
}

/**
 * Monta prévia de baixa a partir de linhas shelf-life (ou entrada manual).
 * @param {string} tenantId
 * @param {number} cdMotivoBaixa
 * @param {object[]} linhasRaw
 * @param {{ cdDonoUnico?: number }} opts
 */
async function previewBaixaEstoque(tenantId, cdMotivoBaixa, linhasRaw, opts = {}) {
  const motivo = await carregarMotivoBaixa(cdMotivoBaixa);
  if (!motivo) return { ok: false, erro: 'Motivo de baixa inválido ou inativo.' };

  const exigeLv = motivo.EXIGE_LOTE_VALIDADE === 'S';
  const chavesBaixadas = await carregarChavesBaixaAtivas(tenantId, opts.cdDonoUnico);
  const vistos = new Set();
  const linhas = [];
  const avisos = [];
  let cdDonoDoc = null;

  const cdProdutos = [
    ...new Set(
      (linhasRaw || [])
        .map((r) => parseInt(r && (r.CD_PRODUTO != null ? r.CD_PRODUTO : r.cdProduto), 10))
        .filter((n) => Number.isFinite(n))
    ),
  ];
  const ctrlPorProduto = new Map();
  if (cdProdutos.length) {
    try {
      const rCtrl = await pool.query(
        `SELECT "CD_PRODUTO",
                COALESCE("FG_CONTROLA_LOTE", 'N') AS fl,
                COALESCE("FG_CONTROLA_VALIDADE", 'N') AS fv
           FROM "WMS_PRODUTO_DONO"
          WHERE "CD_PRODUTO" = ANY($1::integer[])`,
        [cdProdutos]
      );
      for (const row of rCtrl.rows || []) {
        ctrlPorProduto.set(Number(row.CD_PRODUTO), {
          lote: String(row.fl || 'N').toUpperCase() === 'S',
          validade: String(row.fv || 'N').toUpperCase() === 'S',
        });
      }
    } catch (e) {
      if (!schemaMissing(e)) throw e;
    }
  }

  for (const raw of linhasRaw || []) {
    const p = parseLinhaEntradaBaixa(raw, opts.cdDonoUnico);
    if (!p) {
      avisos.push('Linha ignorada: produto/dono inválido.');
      continue;
    }
    if (cdDonoDoc == null) cdDonoDoc = p.cdDono;
    else if (cdDonoDoc !== p.cdDono) {
      return { ok: false, erro: 'Selecione um único dono do estoque por documento de baixa.' };
    }
    const ctrl = ctrlPorProduto.get(p.cdProduto) || { lote: false, validade: false };
    const precisaValidade = ctrl.validade;
    const precisaLote = ctrl.lote;
    if (precisaValidade && !p.validade) {
      avisos.push(`Sem validade: ${p.codigoProduto || p.cdProduto} — produto controla validade.`);
      continue;
    }
    if (precisaLote && !p.lote) {
      avisos.push(`Sem lote: ${p.codigoProduto || p.cdProduto} — produto controla lote.`);
      continue;
    }
    // Motivo com EXIGE_LOTE_VALIDADE=S: usa chave shelf-life quando informado;
    // produto sem controle (ex. descartável) segue por SKU.
    const usaShelf = exigeLv && !!(p.validade || p.lote);
    const ck = chaveBaixaLinha(p.cdDono, p.cdProduto, p.lote, p.validade || '');
    if (vistos.has(ck)) continue;
    vistos.add(ck);

    const qtd = p.qtdSugerida > 1e-9 ? p.qtdSugerida : p.qtdSaldoEst;
    if (qtd <= 1e-9) {
      avisos.push(`Qtd zero: ${p.codigoProduto || p.cdProduto}.`);
      continue;
    }
    const jaBaixada = chavesBaixadas.has(ck);
    const qtdMaxSku = Math.max(0, p.qtdSaldoSku);
    const qtdMax = usaShelf
      ? Math.min(qtd, p.qtdSaldoEst > 0 ? p.qtdSaldoEst : qtd, qtdMaxSku || qtd)
      : Math.min(qtd, qtdMaxSku || qtd);
    const qtdFinal = Math.min(qtd, qtdMax);
    if (qtdFinal <= 1e-9) {
      avisos.push(`Saldo insuficiente: ${p.codigoProduto || p.cdProduto}.`);
      continue;
    }

    linhas.push({
      cdDono: p.cdDono,
      cdProduto: p.cdProduto,
      lote: p.lote,
      validade: p.validade,
      codigoProduto: p.codigoProduto,
      nmProduto: p.nmProduto,
      qtdBaixa: Number(qtdFinal.toFixed(6)),
      qtdSaldoSku: p.qtdSaldoSku,
      qtdSaldoEst: p.qtdSaldoEst,
      diasAteVencimento: p.diasAteVencimento,
      jaBaixada,
      bloqueada: jaBaixada,
    });
  }

  const porSku = new Map();
  for (const l of linhas) {
    if (l.bloqueada) continue;
    const k = `${l.cdDono}|${l.cdProduto}`;
    porSku.set(k, (porSku.get(k) || 0) + l.qtdBaixa);
  }
  const movimentosSku = [...porSku.entries()].map(([k, qtd]) => {
    const [cdDono, cdProduto] = k.split('|');
    return { cdDono: parseInt(cdDono, 10), cdProduto: parseInt(cdProduto, 10), qtdSaida: Number(qtd.toFixed(6)) };
  });

  return {
    ok: true,
    motivo: {
      cdMotivoBaixa: motivo.CD_MOTIVO_BAIXA,
      codigo: motivo.CODIGO,
      descricao: motivo.DESCRICAO,
      rotuloMovimento: motivo.ROTULO_MOVIMENTO,
      codigoOl: motivo.CODIGO_OL,
      tpMovimento: motivo.TP_MOVIMENTO,
    },
    cdDono: cdDonoDoc,
    linhas,
    movimentosSku,
    avisos,
    totalLinhas: linhas.length,
    linhasElegiveis: linhas.filter((l) => !l.bloqueada).length,
    linhasBloqueadas: linhas.filter((l) => l.bloqueada).length,
  };
}

/**
 * Confirma documento de baixa + movimentos ledger (agrupados por SKU).
 */
async function confirmarBaixaEstoque(tenantId, sgUser, payload) {
  const tid = String(tenantId || '').trim();
  const user = sgUser != null ? String(sgUser).slice(0, 64) : null;
  const cdMotivo = parseInt(payload.cdMotivoBaixa, 10);
  const observacao = String(payload.observacao || '').trim().slice(0, 500) || null;
  const origem = String(payload.origem || 'SHELF_LIFE').trim().slice(0, 24) || 'SHELF_LIFE';
  const marcarApontados = payload.marcarApontados === true;

  const preview = await previewBaixaEstoque(tid, cdMotivo, payload.linhas || [], {
    cdDonoUnico: payload.cdDono,
  });
  if (!preview.ok) return preview;
  if (!preview.linhasElegiveis) {
    return { ok: false, erro: 'Nenhuma linha elegível para baixa.', preview };
  }

  const motivo = await carregarMotivoBaixa(cdMotivo);
  const elegiveis = preview.linhas.filter((l) => !l.bloqueada);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const nrDoc = await proximoNrDocumento(client, tid);
    const insH = await client.query(
      `INSERT INTO "WMS_BAIXA_ESTOQUE"
        ("TENANT_ID", "CD_DONO", "CD_MOTIVO_BAIXA", "NR_DOCUMENTO", "ST_BAIXA", "SG_USER", "OBSERVACAO", "ORIGEM")
       VALUES ($1, $2::integer, $3::integer, $4, 'CONFIRMADO', $5, $6, $7)
       RETURNING "CD_BAIXA", "NR_DOCUMENTO", "DH_BAIXA"`,
      [tid, preview.cdDono, motivo.CD_MOTIVO_BAIXA, nrDoc, user, observacao, origem]
    );
    const cdBaixa = insH.rows[0].CD_BAIXA;
    const tpMov = String(motivo.TP_MOVIMENTO || 'BAIXA_ESTOQUE').slice(0, 32);

    const qtdPorProd = new Map();
    for (const l of elegiveis) {
      qtdPorProd.set(l.cdProduto, (qtdPorProd.get(l.cdProduto) || 0) + l.qtdBaixa);
    }

    const movPorProd = new Map();
    for (const [cdProd, qtdTotal] of qtdPorProd) {
      const key = `BAIXA_EST|B${cdBaixa}|P${cdProd}`.slice(0, 128);
      const insM = await client.query(
        `INSERT INTO "WMS_MOVIMENTO_ESTOQUE"
          ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "QTD", "TP_MOVIMENTO", "IDEMPOTENCY_KEY", "SG_USER", "REF_CD_BAIXA")
         VALUES ($1, $2::integer, $3::integer, $4::numeric, $5, $6, $7, $8::bigint)
         ON CONFLICT ("TENANT_ID", "IDEMPOTENCY_KEY") DO NOTHING
         RETURNING "CD_MOVIMENTO"`,
        [tid, preview.cdDono, cdProd, -Math.abs(Number(qtdTotal.toFixed(6))), tpMov, key, user, cdBaixa]
      );
      if (insM.rows[0]) movPorProd.set(cdProd, insM.rows[0].CD_MOVIMENTO);
    }

    let nLinhas = 0;
    for (const l of elegiveis) {
      const refMov = movPorProd.get(l.cdProduto) || null;
      await client.query(
        `INSERT INTO "WMS_BAIXA_ESTOQUE_LINHA"
          ("CD_BAIXA", "CD_PRODUTO", "LOTE", "VALIDADE", "QTD_BAIXA",
           "QTD_SALDO_SKU_ANTES", "QTD_SALDO_EST_ANTES", "CODIGO_PRODUTO", "NM_PRODUTO",
           "REF_CD_MOVIMENTO", "DIAS_ATE_VENCIMENTO")
         VALUES ($1::bigint, $2::integer, $3, $4::date, $5::numeric, $6::numeric, $7::numeric, $8, $9, $10::bigint, $11::integer)`,
        [
          cdBaixa,
          l.cdProduto,
          l.lote || '',
          l.validade,
          l.qtdBaixa,
          l.qtdSaldoSku,
          l.qtdSaldoEst,
          l.codigoProduto,
          l.nmProduto,
          refMov,
          l.diasAteVencimento,
        ]
      );
      nLinhas += 1;
    }

    await client.query('COMMIT');

    let apontados = null;
    if (marcarApontados) {
      const shelfRows = elegiveis.map((l) => ({
        CD_DONO: l.cdDono,
        CD_PRODUTO: l.cdProduto,
        LOTE: l.lote,
        VALIDADE: l.validade,
        CODIGO_PRODUTO: l.codigoProduto,
        NM_PRODUTO: l.nmProduto,
      }));
      apontados = await marcarLinhasApontadas(tid, user, shelfRows, 'MANUAL');
    }

    return {
      ok: true,
      cdBaixa,
      nrDocumento: insH.rows[0].NR_DOCUMENTO,
      dhBaixa: insH.rows[0].DH_BAIXA,
      linhas: nLinhas,
      movimentos: movPorProd.size,
      motivo: preview.motivo,
      apontados,
    };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) {
      throw schemaErr(
        'Estrutura de baixas ausente. Execute backend/scripts/adicionar_wms_baixa_estoque_postgres.sql.'
      );
    }
    throw e;
  } finally {
    client.release();
  }
}

async function listarHistoricoBaixas(tenantId, opts = {}) {
  const tid = String(tenantId || '').trim();
  const params = [tid];
  let clause = '';
  if (opts.cdDono != null && String(opts.cdDono).trim() !== '') {
    const n = parseInt(opts.cdDono, 10);
    if (Number.isFinite(n)) {
      params.push(n);
      clause += ` AND h."CD_DONO" = $${params.length}::integer`;
    }
  }
  if (opts.stBaixa != null && String(opts.stBaixa).trim() !== '') {
    params.push(String(opts.stBaixa).trim().toUpperCase().slice(0, 16));
    clause += ` AND h."ST_BAIXA" = $${params.length}`;
  }
  if (opts.dataInicio) {
    params.push(opts.dataInicio);
    clause += ` AND h."DH_BAIXA" >= $${params.length}::timestamptz`;
  }
  if (opts.dataFim) {
    params.push(opts.dataFim);
    clause += ` AND h."DH_BAIXA" < ($${params.length}::date + interval '1 day')`;
  }
  let lim = parseInt(opts.limit, 10);
  if (!Number.isFinite(lim) || lim < 1) lim = 100;
  if (lim > 300) lim = 300;
  params.push(lim);

  try {
    const r = await pool.query(
      `SELECT h."CD_BAIXA", h."NR_DOCUMENTO", h."DH_BAIXA", h."ST_BAIXA", h."SG_USER", h."OBSERVACAO", h."ORIGEM",
              h."CD_DONO", d."NOME" AS "NM_DONO",
              m."CD_MOTIVO_BAIXA", m."CODIGO" AS "COD_MOTIVO", m."DESCRICAO" AS "DS_MOTIVO", m."ROTULO_MOVIMENTO",
              COUNT(l."CD_BAIXA_LINHA")::int AS "Q_LINHAS",
              COALESCE(SUM(l."QTD_BAIXA"), 0)::numeric AS "QTD_TOTAL"
         FROM "WMS_BAIXA_ESTOQUE" h
         JOIN "WMS_MOTIVO_BAIXA" m ON m."CD_MOTIVO_BAIXA" = h."CD_MOTIVO_BAIXA"
         JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = h."CD_DONO" AND d."TENANT_ID" = h."TENANT_ID"
         LEFT JOIN "WMS_BAIXA_ESTOQUE_LINHA" l ON l."CD_BAIXA" = h."CD_BAIXA"
        WHERE h."TENANT_ID" = $1${clause}
        GROUP BY h."CD_BAIXA", d."NOME", m."CD_MOTIVO_BAIXA", m."CODIGO", m."DESCRICAO", m."ROTULO_MOVIMENTO"
        ORDER BY h."DH_BAIXA" DESC
        LIMIT $${params.length}`,
      params
    );
    return { rows: r.rows || [], ok: true };
  } catch (e) {
    if (schemaMissing(e)) {
      return {
        rows: [],
        ok: false,
        aviso: 'Estrutura de baixas ausente. Execute backend/scripts/adicionar_wms_baixa_estoque_postgres.sql.',
      };
    }
    throw e;
  }
}

async function listarLinhasBaixa(tenantId, cdBaixa) {
  const tid = String(tenantId || '').trim();
  const cd = parseInt(cdBaixa, 10);
  if (!Number.isFinite(cd)) return { ok: false, erro: 'Código inválido.' };
  const r = await pool.query(
    `SELECT l."CD_BAIXA_LINHA", l."CD_BAIXA", l."CD_PRODUTO", l."LOTE",
            to_char(l."VALIDADE", 'YYYY-MM-DD') AS "VALIDADE",
            l."QTD_BAIXA", l."QTD_SALDO_SKU_ANTES", l."QTD_SALDO_EST_ANTES",
            l."CODIGO_PRODUTO", l."NM_PRODUTO", l."DIAS_ATE_VENCIMENTO", l."REF_CD_MOVIMENTO",
            h."NR_DOCUMENTO", h."DH_BAIXA", m."DESCRICAO" AS "DS_MOTIVO", m."ROTULO_MOVIMENTO"
       FROM "WMS_BAIXA_ESTOQUE_LINHA" l
       JOIN "WMS_BAIXA_ESTOQUE" h ON h."CD_BAIXA" = l."CD_BAIXA"
       JOIN "WMS_MOTIVO_BAIXA" m ON m."CD_MOTIVO_BAIXA" = h."CD_MOTIVO_BAIXA"
      WHERE h."TENANT_ID" = $1 AND h."CD_BAIXA" = $2::bigint
      ORDER BY l."CD_BAIXA_LINHA"`,
    [tid, cd]
  );
  if (!r.rows.length) {
    const h = await pool.query(
      `SELECT 1 FROM "WMS_BAIXA_ESTOQUE" WHERE "TENANT_ID" = $1 AND "CD_BAIXA" = $2::bigint`,
      [tid, cd]
    );
    if (!h.rows.length) return { ok: false, erro: 'Baixa não encontrada.' };
  }
  return { ok: true, linhas: r.rows };
}

async function obterBaixaEstoque(tenantId, cdBaixa) {
  const tid = String(tenantId || '').trim();
  const cd = parseInt(cdBaixa, 10);
  if (!Number.isFinite(cd)) return { ok: false, erro: 'Código inválido.' };
  const r = await pool.query(
    `SELECT h.*, d."NOME" AS "NM_DONO",
            m."CODIGO" AS "COD_MOTIVO", m."DESCRICAO" AS "DS_MOTIVO", m."ROTULO_MOVIMENTO", m."CODIGO_OL"
       FROM "WMS_BAIXA_ESTOQUE" h
       JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = h."CD_DONO" AND d."TENANT_ID" = h."TENANT_ID"
       JOIN "WMS_MOTIVO_BAIXA" m ON m."CD_MOTIVO_BAIXA" = h."CD_MOTIVO_BAIXA"
      WHERE h."TENANT_ID" = $1 AND h."CD_BAIXA" = $2::bigint`,
    [tid, cd]
  );
  if (!r.rows[0]) return { ok: false, erro: 'Baixa não encontrada.' };
  const det = await listarLinhasBaixa(tid, cd);
  return { ok: true, cabecalho: r.rows[0], linhas: det.linhas || [] };
}

/**
 * Estorna documento confirmado: movimentos positivos inversos + ST_BAIXA = ESTORNADO.
 */
async function estornarBaixaEstoque(tenantId, cdBaixa, sgUser, opts = {}) {
  const tid = String(tenantId || '').trim();
  const user = sgUser != null ? String(sgUser).slice(0, 64) : null;
  const cd = parseInt(cdBaixa, 10);
  if (!Number.isFinite(cd)) return { ok: false, erro: 'Código inválido.' };
  const motivoObs = String(opts.observacao || opts.motivoEstorno || '').trim().slice(0, 500) || null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const h = await client.query(
      `SELECT h.*, m."TP_MOVIMENTO"
         FROM "WMS_BAIXA_ESTOQUE" h
         JOIN "WMS_MOTIVO_BAIXA" m ON m."CD_MOTIVO_BAIXA" = h."CD_MOTIVO_BAIXA"
        WHERE h."TENANT_ID" = $1 AND h."CD_BAIXA" = $2::bigint
        FOR UPDATE`,
      [tid, cd]
    );
    const doc = h.rows[0];
    if (!doc) {
      await client.query('ROLLBACK');
      return { ok: false, erro: 'Baixa não encontrada.' };
    }
    if (String(doc.ST_BAIXA).toUpperCase() !== 'CONFIRMADO') {
      await client.query('ROLLBACK');
      return { ok: false, erro: 'Somente documentos confirmados podem ser estornados.' };
    }

    const movs = await client.query(
      `SELECT "CD_MOVIMENTO", "CD_PRODUTO", "QTD", "TP_MOVIMENTO"
         FROM "WMS_MOVIMENTO_ESTOQUE"
        WHERE "TENANT_ID" = $1 AND "REF_CD_BAIXA" = $2::bigint`,
      [tid, cd]
    );

    const tpBase = String(doc.TP_MOVIMENTO || 'BAIXA_ESTOQUE').slice(0, 32);
    const tpEst = (tpBase.endsWith('_ESTORNO') ? tpBase : `${tpBase}_ESTORNO`).slice(0, 32);
    let nMov = 0;
    for (const m of movs.rows || []) {
      const qtdRev = Math.abs(Number(m.QTD) || 0);
      if (qtdRev <= 1e-9) continue;
      const key = `BAIXA_ESTORN|B${cd}|M${m.CD_MOVIMENTO}`.slice(0, 128);
      await client.query(
        `INSERT INTO "WMS_MOVIMENTO_ESTOQUE"
          ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "QTD", "TP_MOVIMENTO", "IDEMPOTENCY_KEY", "SG_USER", "REF_CD_BAIXA")
         VALUES ($1, $2::integer, $3::integer, $4::numeric, $5, $6, $7, $8::bigint)
         ON CONFLICT ("TENANT_ID", "IDEMPOTENCY_KEY") DO NOTHING`,
        [tid, doc.CD_DONO, m.CD_PRODUTO, qtdRev, tpEst, key, user, cd]
      );
      nMov += 1;
    }

    const obsNova = motivoObs
      ? [doc.OBSERVACAO, `Estorno: ${motivoObs}`].filter(Boolean).join(' · ').slice(0, 500)
      : doc.OBSERVACAO;

    await client.query(
      `UPDATE "WMS_BAIXA_ESTOQUE"
          SET "ST_BAIXA" = 'ESTORNADO', "OBSERVACAO" = $3
        WHERE "TENANT_ID" = $1 AND "CD_BAIXA" = $2::bigint`,
      [tid, cd, obsNova]
    );

    await client.query('COMMIT');
    return { ok: true, cdBaixa: cd, nrDocumento: doc.NR_DOCUMENTO, movimentosEstorno: nMov };
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    if (schemaMissing(e)) {
      throw schemaErr(
        'Estrutura de baixas ausente. Execute backend/scripts/adicionar_wms_baixa_estoque_postgres.sql.'
      );
    }
    throw e;
  } finally {
    client.release();
  }
}

/** Mapa CD_MOVIMENTO → info baixa (enriquecimento movimentação). */
async function carregarBaixaPorMovimentos(tenantId, cdMovimentos) {
  const ids = [...new Set((cdMovimentos || []).map((x) => parseInt(x, 10)).filter(Number.isFinite))];
  const mapa = new Map();
  if (!ids.length) return mapa;
  try {
    const r = await pool.query(
      `SELECT m."CD_MOVIMENTO", h."CD_BAIXA", h."NR_DOCUMENTO", h."DH_BAIXA",
              mb."CODIGO" AS "COD_MOTIVO", mb."DESCRICAO" AS "DS_MOTIVO", mb."ROTULO_MOVIMENTO", mb."CODIGO_OL"
         FROM "WMS_MOVIMENTO_ESTOQUE" m
         JOIN "WMS_BAIXA_ESTOQUE" h ON h."CD_BAIXA" = m."REF_CD_BAIXA"
         JOIN "WMS_MOTIVO_BAIXA" mb ON mb."CD_MOTIVO_BAIXA" = h."CD_MOTIVO_BAIXA"
        WHERE m."TENANT_ID" = $1 AND m."CD_MOVIMENTO" = ANY($2::bigint[])`,
      [tenantId, ids]
    );
    for (const row of r.rows || []) {
      mapa.set(String(row.CD_MOVIMENTO), row);
    }
    return mapa;
  } catch (e) {
    if (schemaMissing(e)) return mapa;
    throw e;
  }
}

module.exports = {
  schemaMissing,
  listarMotivosBaixa,
  carregarMotivoBaixa,
  carregarMotivoPorCodigo,
  previewBaixaEstoque,
  confirmarBaixaEstoque,
  listarHistoricoBaixas,
  listarLinhasBaixa,
  obterBaixaEstoque,
  estornarBaixaEstoque,
  carregarBaixaPorMovimentos,
  parseLinhaEntradaBaixa,
};
