'use strict';

const { pool } = require('../config/db');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

const AVISOS_PADRAO = [
  'Cada linha de validade pertence a um dono (CD_DONO). Saldos nunca são misturados entre donos.',
  'Cabeçalho do SKU: Entrada · Saídas acumuladas · Reserva · Saldo (ledger do produto).',
  'Linhas filhas: entrada e saldo estimado só daquela validade/lote (FEFO — saídas consomem a mais curta primeiro).',
  'Fontes de validade: NF encerrada, inventário (saldo por lote) e transferência entre donos EFETIVADA (lote/validade do documento).',
  'Por padrão o relatório oculta SKUs com saldo 0 (histórico). Marque «Incluir zerados» para ver.',
  'Expedição não grava lote: o saldo por validade é estimativa FEFO, não rastreio físico obrigatório.',
];

function montarRotuloFiltroDono(cdDonoOpt, linhas) {
  if (cdDonoOpt != null && String(cdDonoOpt).trim() !== '') {
    const cd = parseInt(cdDonoOpt, 10);
    const hit = (linhas || []).find((r) => parseInt(r.CD_DONO, 10) === cd);
    if (hit && hit.NM_DONO) return `${hit.CD_DONO} — ${hit.NM_DONO}`;
    return `Dono CD ${cdDonoOpt}`;
  }
  const map = new Map();
  (linhas || []).forEach((r) => {
    if (r.CD_DONO == null) return;
    const k = String(r.CD_DONO);
    if (!map.has(k)) map.set(k, String(r.NM_DONO || '').trim() || `CD ${k}`);
  });
  if (map.size === 0) return 'Nenhum dono com saldo';
  if (map.size === 1) {
    const [[cd, nm]] = map.entries();
    return `${cd} — ${nm}`;
  }
  const nomes = Array.from(map.entries())
    .map(([cd, nm]) => `${cd} — ${nm}`)
    .join('; ');
  return `${map.size} donos: ${nomes}`;
}

function onlyAlphaNum(v) {
  return String(v || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

function applyProductMask(value, mask) {
  const m = String(mask || '').trim().toUpperCase();
  if (!m) return String(value || '').trim();
  const src = onlyAlphaNum(value);
  let out = '';
  let p = 0;
  for (let i = 0; i < m.length; i++) {
    const ch = m.charAt(i);
    if (ch === '0' || ch === 'A' || ch === 'X') {
      while (p < src.length) {
        const c = src.charAt(p++);
        const ok =
          (ch === '0' && /[0-9]/.test(c)) ||
          (ch === 'A' && /[A-Z]/.test(c)) ||
          (ch === 'X' && /[0-9A-Z]/.test(c));
        if (ok) {
          out += c;
          break;
        }
      }
    } else {
      out += ch;
    }
  }
  return out;
}

function formatValidadeBr(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, mo, d] = s.split('-');
    return `${d}/${mo}/${y}`;
  }
  return s;
}

async function rotuloDonoRelatorio(tenantId, cdDonoOpt, linhas) {
  const rotulo = montarRotuloFiltroDono(cdDonoOpt, linhas);
  if (cdDonoOpt == null || String(cdDonoOpt).trim() === '') return rotulo;
  const cd = parseInt(cdDonoOpt, 10);
  if (!Number.isFinite(cd)) return rotulo;
  const hit = (linhas || []).find((r) => parseInt(r.CD_DONO, 10) === cd);
  if (hit && hit.NM_DONO) return `${cd} — ${hit.NM_DONO}`;
  if (rotulo !== `Dono CD ${cdDonoOpt}` && rotulo !== 'Nenhum dono com saldo') return rotulo;
  try {
    const r = await pool.query(
      `SELECT "NOME" FROM "WMS_DONO_ESTOQUE" WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer`,
      [tenantId, cd]
    );
    const nm = r.rows[0] && r.rows[0].NOME ? String(r.rows[0].NOME).trim() : '';
    return nm ? `${cd} — ${nm}` : `Dono CD ${cd}`;
  } catch (_) {
    return `Dono CD ${cd}`;
  }
}

async function avisosQuandoPosicaoVazia(tenantId, cdDonoOpt) {
  const extra = [];
  const params = [tenantId];
  let donoSql = '';
  const n = cdDonoOpt != null && String(cdDonoOpt).trim() !== '' ? parseInt(cdDonoOpt, 10) : NaN;
  if (Number.isFinite(n)) {
    params.push(n);
    donoSql = ` AND "CD_DONO" = $${params.length}::integer`;
  }
  try {
    const [rEnt, rMov, rRes, rInv] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS c FROM "WMS_NFE_ENTRADA"
          WHERE "TENANT_ID" = $1${donoSql}
            AND UPPER(TRIM(COALESCE("ST_RECEBIMENTO", ''))) = 'ENCERRADA'`,
        params
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM "WMS_MOVIMENTO_ESTOQUE" WHERE "TENANT_ID" = $1${donoSql}`,
        params
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM "WMS_RESERVA_ESTOQUE_OPL" WHERE "TENANT_ID" = $1${donoSql}`,
        params
      ),
      pool.query(
        `SELECT COUNT(*)::int AS c FROM "WMS_INVENTARIO"
          WHERE "TENANT_ID" = $1${donoSql} AND UPPER(TRIM(COALESCE("ST_INVENTARIO", ''))) = 'ENCERRADO'`,
        params
      ),
    ]);
    const nEnt = Number(rEnt.rows[0]?.c) || 0;
    const nMov = Number(rMov.rows[0]?.c) || 0;
    const nRes = Number(rRes.rows[0]?.c) || 0;
    const nInv = Number(rInv.rows[0]?.c) || 0;
    if (nEnt === 0 && nMov === 0 && nRes === 0) {
      extra.push(
        'Nenhuma linha neste relatório: não há NF-e de recebimento encerrada, movimento de estoque nem reserva OPL para o filtro. Cadastre saldo via recebimento encerrado ou inventário inicial antes de separar/expedir.'
      );
      if (nInv > 0) {
        extra.push(
          `Há ${nInv} inventário(s) encerrado(s) para o dono — confira se os ajustes geraram movimentos com produto mapeado (de-para).`
        );
      }
    } else if (nEnt === 0 && nMov > 0) {
      extra.push(
        `Há ${nMov} movimento(s) de estoque sem NF-e de entrada encerrada no filtro — as linhas abaixo (sem lote) refletem saídas/ajustes. Confira também o relatório Movimentação.`
      );
    }
    if (nEnt === 0 && nRes > 0 && nMov === 0) {
      extra.push(`Há ${nRes} registro(s) de reserva OPL; saldo físico pode ainda não existir em recebimento encerrado.`);
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  return extra;
}

function roundQtdDisplay(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round(v);
}

function mapLinhaPosicao(row) {
  const codInterno = String(row.CODIGO_PRODUTO_INTERNO || '').trim();
  const mask = String(row.MASCARA_CODIGO_PRODUTO || '').trim();
  const codigoExib = mask && codInterno ? applyProductMask(codInterno, mask) : codInterno;
  const qtdEntrada = Number(row.QTD_ENTRADA) || 0;
  const qtdEntradaSku = Number(row.QTD_ENTRADA_SKU) || 0;
  const qtdMov = Number(row.QTD_MOVIMENTO_SKU) || 0;
  const qtdRes = Number(row.QTD_RESERVA_SKU) || 0;
  const qtdSaldoSku = Number(row.QTD_SALDO_SKU) || 0;
  return {
    CD_DONO: row.CD_DONO,
    NM_DONO: row.NM_DONO,
    CD_PRODUTO: row.CD_PRODUTO,
    CODIGO_PRODUTO: codigoExib || codInterno || '',
    NM_PRODUTO: row.NM_PRODUTO || '',
    LOTE: row.LOTE || '',
    VALIDADE: row.VALIDADE || '',
    VALIDADE_BR: formatValidadeBr(row.VALIDADE),
    TIPO_ARMAZENAGEM: row.TIPO_ARMAZENAGEM || '',
    QTD_ENTRADA: roundQtdDisplay(qtdEntrada),
    QTD_ENTRADA_SKU: roundQtdDisplay(qtdEntradaSku),
    QTD_SAIDA_SKU: roundQtdDisplay(qtdMov < 0 ? Math.abs(qtdMov) : 0),
    QTD_RESERVA_SKU: roundQtdDisplay(qtdRes),
    QTD_SALDO_SKU: roundQtdDisplay(qtdSaldoSku),
    QTD_DISPONIVEL_SKU: roundQtdDisplay(qtdSaldoSku - qtdRes),
    SEM_ENTRADA_ENCERRADA: !!row.SEM_ENTRADA_ENCERRADA,
    ORIGEM_INVENTARIO: !!row.ORIGEM_INVENTARIO,
    ORIGEM_TRANSFERENCIA: !!row.ORIGEM_TRANSFERENCIA,
  };
}

/**
 * Posição de estoque: entradas encerradas (lote/validade) + movimentos/reservas por SKU.
 */
async function listarPosicaoEstoque(tenantId, cdDonoOpt) {
  const params = [tenantId];
  let donoClauseEnt = '';
  let donoClauseMov = '';
  let donoClauseInv = '';
  let donoClauseTransf = '';
  if (cdDonoOpt != null && String(cdDonoOpt).trim() !== '') {
    const n = parseInt(cdDonoOpt, 10);
    if (Number.isFinite(n)) {
      params.push(n);
      donoClauseEnt = ` AND e."CD_DONO" = $${params.length}::integer`;
      donoClauseMov = ` AND "CD_DONO" = $${params.length}::integer`;
      donoClauseInv = ` AND isl."CD_DONO" = $${params.length}::integer`;
      donoClauseTransf = ` AND t."CD_DONO_DESTINO" = $${params.length}::integer`;
    }
  }

  const sql = `
    WITH linhas AS (
      SELECT
        e."TENANT_ID",
        e."CD_DONO",
        CASE
          WHEN (elem->>'cdProduto') ~ '^[0-9]+$' THEN (elem->>'cdProduto')::integer
          ELSE NULL
        END AS cd_produto,
        NULLIF(TRIM(elem->>'lote'), '') AS lote,
        NULLIF(TRIM(elem->>'validade'), '') AS validade_raw,
        COALESCE(NULLIF(TRIM(elem->>'qtdConvertida'), ''), '0')::numeric AS qtd
      FROM "WMS_NFE_ENTRADA" e
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS elem
      WHERE e."TENANT_ID" = $1
        ${donoClauseEnt}
        AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) = 'ENCERRADA'
        AND e."CD_DONO" IS NOT NULL
        AND (elem->>'cdProduto') ~ '^[0-9]+$'
    ),
    ag AS (
      SELECT
        "TENANT_ID",
        "CD_DONO",
        cd_produto,
        lote,
        validade_raw,
        SUM(qtd) AS qtd_entrada
      FROM linhas
      WHERE cd_produto IS NOT NULL AND qtd > 0
      GROUP BY "TENANT_ID", "CD_DONO", cd_produto, lote, validade_raw
    ),
    inv_ag AS (
      SELECT
        isl."TENANT_ID",
        isl."CD_DONO",
        isl."CD_PRODUTO" AS cd_produto,
        NULLIF(TRIM(isl."LOTE"), '') AS lote,
        CASE
          WHEN isl."VALIDADE" IS NOT NULL THEN to_char(isl."VALIDADE", 'YYYY-MM-DD')
          ELSE NULL
        END AS validade_raw,
        SUM(isl."QTD") AS qtd_entrada
      FROM "WMS_INVENTARIO_SALDO_LOTE" isl
      WHERE isl."TENANT_ID" = $1
        ${donoClauseInv}
      GROUP BY isl."TENANT_ID", isl."CD_DONO", isl."CD_PRODUTO", lote, isl."VALIDADE"
      HAVING SUM(isl."QTD") > 1e-9
    ),
    transf_ag AS (
      SELECT
        t."TENANT_ID",
        t."CD_DONO_DESTINO" AS "CD_DONO",
        t."CD_PRODUTO_DESTINO" AS cd_produto,
        NULLIF(TRIM(t."LOTE"), '') AS lote,
        CASE
          WHEN t."VALIDADE" IS NOT NULL THEN to_char(t."VALIDADE", 'YYYY-MM-DD')
          ELSE NULL
        END AS validade_raw,
        SUM(t."QTD") AS qtd_entrada
      FROM "WMS_TRANSFERENCIA_DONO" t
      WHERE t."TENANT_ID" = $1
        ${donoClauseTransf}
        AND UPPER(TRIM(COALESCE(t."ST_TRANSFERENCIA", ''))) = 'EFETIVADA'
        AND t."CD_DONO_DESTINO" IS NOT NULL
        AND t."CD_PRODUTO_DESTINO" IS NOT NULL
        AND t."QTD" > 0
      GROUP BY t."TENANT_ID", t."CD_DONO_DESTINO", t."CD_PRODUTO_DESTINO", lote, validade_raw
      HAVING SUM(t."QTD") > 1e-9
    ),
    ent_sku AS (
      SELECT "TENANT_ID", "CD_DONO", cd_produto, SUM(qtd_entrada) AS qtd_entrada_sku
      FROM ag
      GROUP BY "TENANT_ID", "CD_DONO", cd_produto
    ),
    mov AS (
      SELECT "TENANT_ID", "CD_DONO", "CD_PRODUTO" AS cd_produto, SUM("QTD")::numeric AS qtd_mov
      FROM "WMS_MOVIMENTO_ESTOQUE"
      WHERE "TENANT_ID" = $1
        AND "CD_DONO" IS NOT NULL
        ${donoClauseMov}
      GROUP BY "TENANT_ID", "CD_DONO", "CD_PRODUTO"
    ),
    res AS (
      SELECT "TENANT_ID", "CD_DONO", "CD_PRODUTO" AS cd_produto, SUM("QTD_RESERVADA")::numeric AS qtd_res
      FROM "WMS_RESERVA_ESTOQUE_OPL"
      WHERE "TENANT_ID" = $1
        AND "CD_DONO" IS NOT NULL
        ${donoClauseMov}
      GROUP BY "TENANT_ID", "CD_DONO", "CD_PRODUTO"
    ),
    orphan_sku AS (
      SELECT DISTINCT u."CD_DONO", u.cd_produto
        FROM (
          SELECT "CD_DONO", cd_produto FROM mov WHERE cd_produto IS NOT NULL
          UNION
          SELECT "CD_DONO", cd_produto FROM res WHERE cd_produto IS NOT NULL
        ) u
       WHERE NOT EXISTS (
         SELECT 1 FROM ag a
          WHERE a."CD_DONO" = u."CD_DONO" AND a.cd_produto = u.cd_produto
       )
       AND NOT EXISTS (
         SELECT 1 FROM inv_ag ia
          WHERE ia."CD_DONO" = u."CD_DONO" AND ia.cd_produto = u.cd_produto
       )
       AND NOT EXISTS (
         SELECT 1 FROM transf_ag ta
          WHERE ta."CD_DONO" = u."CD_DONO" AND ta.cd_produto = u.cd_produto
       )
    ),
    det_ent AS (
      SELECT
        ag."CD_DONO",
        d."NOME" AS "NM_DONO",
        d."MASCARA_CODIGO_PRODUTO",
        ag.cd_produto AS "CD_PRODUTO",
        p."CODIGO" AS "CODIGO_PRODUTO_INTERNO",
        p."NOME" AS "NM_PRODUTO",
        ag.lote AS "LOTE",
        ag.validade_raw AS "VALIDADE",
        p."TIPO_ARMAZENAGEM" AS "TIPO_ARMAZENAGEM",
        ag.qtd_entrada AS "QTD_ENTRADA",
        COALESCE(es.qtd_entrada_sku, 0) AS "QTD_ENTRADA_SKU",
        COALESCE(m.qtd_mov, 0) AS "QTD_MOVIMENTO_SKU",
        COALESCE(r.qtd_res, 0) AS "QTD_RESERVA_SKU",
        (COALESCE(es.qtd_entrada_sku, 0) + COALESCE(m.qtd_mov, 0)) AS "QTD_SALDO_SKU",
        false AS "SEM_ENTRADA_ENCERRADA",
        false AS "ORIGEM_INVENTARIO",
        false AS "ORIGEM_TRANSFERENCIA"
      FROM ag
      JOIN "WMS_DONO_ESTOQUE" d
        ON d."CD_DONO" = ag."CD_DONO" AND d."TENANT_ID" = ag."TENANT_ID"
      LEFT JOIN "WMS_PRODUTO_DONO" p
        ON p."CD_PRODUTO" = ag.cd_produto
       AND p."TENANT_ID" = ag."TENANT_ID"
       AND p."CD_DONO" = ag."CD_DONO"
      LEFT JOIN ent_sku es
        ON es."TENANT_ID" = ag."TENANT_ID"
       AND es."CD_DONO" = ag."CD_DONO"
       AND es.cd_produto = ag.cd_produto
      LEFT JOIN mov m
        ON m."TENANT_ID" = ag."TENANT_ID"
       AND m."CD_DONO" = ag."CD_DONO"
       AND m.cd_produto = ag.cd_produto
      LEFT JOIN res r
        ON r."TENANT_ID" = ag."TENANT_ID"
       AND r."CD_DONO" = ag."CD_DONO"
       AND r.cd_produto = ag.cd_produto
    ),
    det_inv AS (
      SELECT
        ag."CD_DONO",
        d."NOME" AS "NM_DONO",
        d."MASCARA_CODIGO_PRODUTO",
        ag.cd_produto AS "CD_PRODUTO",
        p."CODIGO" AS "CODIGO_PRODUTO_INTERNO",
        p."NOME" AS "NM_PRODUTO",
        ag.lote AS "LOTE",
        ag.validade_raw AS "VALIDADE",
        p."TIPO_ARMAZENAGEM" AS "TIPO_ARMAZENAGEM",
        ag.qtd_entrada AS "QTD_ENTRADA",
        COALESCE(es.qtd_entrada_sku, 0) AS "QTD_ENTRADA_SKU",
        COALESCE(m.qtd_mov, 0) AS "QTD_MOVIMENTO_SKU",
        COALESCE(r.qtd_res, 0) AS "QTD_RESERVA_SKU",
        (COALESCE(es.qtd_entrada_sku, 0) + COALESCE(m.qtd_mov, 0)) AS "QTD_SALDO_SKU",
        false AS "SEM_ENTRADA_ENCERRADA",
        true AS "ORIGEM_INVENTARIO",
        false AS "ORIGEM_TRANSFERENCIA"
      FROM inv_ag ag
      JOIN "WMS_DONO_ESTOQUE" d
        ON d."CD_DONO" = ag."CD_DONO" AND d."TENANT_ID" = ag."TENANT_ID"
      LEFT JOIN "WMS_PRODUTO_DONO" p
        ON p."CD_PRODUTO" = ag.cd_produto
       AND p."TENANT_ID" = ag."TENANT_ID"
       AND p."CD_DONO" = ag."CD_DONO"
      LEFT JOIN ent_sku es
        ON es."TENANT_ID" = ag."TENANT_ID"
       AND es."CD_DONO" = ag."CD_DONO"
       AND es.cd_produto = ag.cd_produto
      LEFT JOIN mov m
        ON m."TENANT_ID" = ag."TENANT_ID"
       AND m."CD_DONO" = ag."CD_DONO"
       AND m.cd_produto = ag.cd_produto
      LEFT JOIN res r
        ON r."TENANT_ID" = ag."TENANT_ID"
       AND r."CD_DONO" = ag."CD_DONO"
       AND r.cd_produto = ag.cd_produto
    ),
    det_transf AS (
      SELECT
        ag."CD_DONO",
        d."NOME" AS "NM_DONO",
        d."MASCARA_CODIGO_PRODUTO",
        ag.cd_produto AS "CD_PRODUTO",
        p."CODIGO" AS "CODIGO_PRODUTO_INTERNO",
        p."NOME" AS "NM_PRODUTO",
        ag.lote AS "LOTE",
        ag.validade_raw AS "VALIDADE",
        p."TIPO_ARMAZENAGEM" AS "TIPO_ARMAZENAGEM",
        ag.qtd_entrada AS "QTD_ENTRADA",
        COALESCE(es.qtd_entrada_sku, 0) AS "QTD_ENTRADA_SKU",
        COALESCE(m.qtd_mov, 0) AS "QTD_MOVIMENTO_SKU",
        COALESCE(r.qtd_res, 0) AS "QTD_RESERVA_SKU",
        (COALESCE(es.qtd_entrada_sku, 0) + COALESCE(m.qtd_mov, 0)) AS "QTD_SALDO_SKU",
        false AS "SEM_ENTRADA_ENCERRADA",
        false AS "ORIGEM_INVENTARIO",
        true AS "ORIGEM_TRANSFERENCIA"
      FROM transf_ag ag
      JOIN "WMS_DONO_ESTOQUE" d
        ON d."CD_DONO" = ag."CD_DONO" AND d."TENANT_ID" = ag."TENANT_ID"
      LEFT JOIN "WMS_PRODUTO_DONO" p
        ON p."CD_PRODUTO" = ag.cd_produto
       AND p."TENANT_ID" = ag."TENANT_ID"
       AND p."CD_DONO" = ag."CD_DONO"
      LEFT JOIN ent_sku es
        ON es."TENANT_ID" = ag."TENANT_ID"
       AND es."CD_DONO" = ag."CD_DONO"
       AND es.cd_produto = ag.cd_produto
      LEFT JOIN mov m
        ON m."TENANT_ID" = ag."TENANT_ID"
       AND m."CD_DONO" = ag."CD_DONO"
       AND m.cd_produto = ag.cd_produto
      LEFT JOIN res r
        ON r."TENANT_ID" = ag."TENANT_ID"
       AND r."CD_DONO" = ag."CD_DONO"
       AND r.cd_produto = ag.cd_produto
    ),
    det_mov AS (
      SELECT
        os."CD_DONO",
        d."NOME" AS "NM_DONO",
        d."MASCARA_CODIGO_PRODUTO",
        os.cd_produto AS "CD_PRODUTO",
        p."CODIGO" AS "CODIGO_PRODUTO_INTERNO",
        p."NOME" AS "NM_PRODUTO",
        ''::text AS "LOTE",
        ''::text AS "VALIDADE",
        p."TIPO_ARMAZENAGEM" AS "TIPO_ARMAZENAGEM",
        0::numeric AS "QTD_ENTRADA",
        0::numeric AS "QTD_ENTRADA_SKU",
        COALESCE(m.qtd_mov, 0) AS "QTD_MOVIMENTO_SKU",
        COALESCE(r.qtd_res, 0) AS "QTD_RESERVA_SKU",
        COALESCE(m.qtd_mov, 0) AS "QTD_SALDO_SKU",
        true AS "SEM_ENTRADA_ENCERRADA",
        false AS "ORIGEM_INVENTARIO",
        false AS "ORIGEM_TRANSFERENCIA"
      FROM orphan_sku os
      JOIN "WMS_DONO_ESTOQUE" d
        ON d."CD_DONO" = os."CD_DONO" AND d."TENANT_ID" = $1
      LEFT JOIN "WMS_PRODUTO_DONO" p
        ON p."CD_PRODUTO" = os.cd_produto
       AND p."TENANT_ID" = $1
       AND p."CD_DONO" = os."CD_DONO"
      LEFT JOIN mov m
        ON m."TENANT_ID" = $1
       AND m."CD_DONO" = os."CD_DONO"
       AND m.cd_produto = os.cd_produto
      LEFT JOIN res r
        ON r."TENANT_ID" = $1
       AND r."CD_DONO" = os."CD_DONO"
       AND r.cd_produto = os.cd_produto
      WHERE ABS(COALESCE(m.qtd_mov, 0)) > 1e-9 OR COALESCE(r.qtd_res, 0) > 1e-9
    )
    SELECT * FROM det_ent
    UNION ALL
    SELECT * FROM det_inv
    UNION ALL
    SELECT * FROM det_transf
    UNION ALL
    SELECT * FROM det_mov
    ORDER BY "CD_DONO", "CODIGO_PRODUTO_INTERNO" NULLS LAST, "LOTE" NULLS LAST, "VALIDADE" NULLS LAST
    LIMIT 10000
  `;

  try {
    const r = await pool.query(sql, params);
    const avisos = [...AVISOS_PADRAO];
    const linhas = (r.rows || []).map((row) => mapLinhaPosicao(row));
    if (!linhas.length) {
      const extras = await avisosQuandoPosicaoVazia(tenantId, cdDonoOpt);
      extras.forEach((a) => avisos.push(a));
    }
    const filtroDonoLabel = await rotuloDonoRelatorio(tenantId, cdDonoOpt, linhas);
    return { linhas, avisos, filtroDonoLabel };
  } catch (e) {
    if (schemaMissing(e)) {
      const err = new Error(
        'Estrutura WMS incompleta para posição de estoque. Execute scripts de NF entrada, produto dono e movimento de estoque.'
      );
      err.code = 'SCHEMA';
      throw err;
    }
    throw e;
  }
}

function linhasParaCsv(rows) {
  const cols = [
    'CD_DONO',
    'NM_DONO',
    'CD_PRODUTO',
    'CODIGO_PRODUTO',
    'NM_PRODUTO',
    'TIPO_ARMAZENAGEM',
    'LOTE',
    'VALIDADE',
    'QTD_ENTRADA',
    'QTD_SALDO_EST_FEFO',
    'QTD_ENTRADA_SKU',
    'QTD_SAIDA_SKU',
    'QTD_RESERVA_SKU',
    'QTD_SALDO_SKU',
    'QTD_DISPONIVEL_SKU',
  ];
  const qtyCols = new Set([
    'QTD_ENTRADA',
    'QTD_SALDO_EST_FEFO',
    'QTD_ENTRADA_SKU',
    'QTD_SAIDA_SKU',
    'QTD_RESERVA_SKU',
    'QTD_SALDO_SKU',
    'QTD_DISPONIVEL_SKU',
  ]);
  const esc = (v, col) => {
    if (v == null) return '';
    if (qtyCols.has(col)) {
      const n = Number(v);
      if (!Number.isFinite(n)) return '';
      return String(Math.round(n));
    }
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = cols.join(';');
  const body = (rows || []).map((row) => cols.map((c) => esc(row[c], c)).join(';')).join('\n');
  return `${head}\n${body}`;
}

/** Remove linhas de SKU com saldo ledger ≈ 0 (posição operacional). */
function filtrarLinhasPosicaoOcultarZerados(linhas) {
  const list = linhas || [];
  const saldoPorSku = new Map();
  for (const r of list) {
    const k = `${r.CD_DONO}|${r.CD_PRODUTO}`;
    if (!saldoPorSku.has(k)) saldoPorSku.set(k, Number(r.QTD_SALDO_SKU) || 0);
  }
  const ocultos = [...saldoPorSku.values()].filter((s) => Math.abs(s) < 1e-9).length;
  const filtradas = list.filter((r) => {
    const k = `${r.CD_DONO}|${r.CD_PRODUTO}`;
    return Math.abs(saldoPorSku.get(k) || 0) >= 1e-9;
  });
  return {
    linhas: filtradas,
    skusOcultosZerados: ocultos,
    skusAntes: saldoPorSku.size,
    skusDepois: saldoPorSku.size - ocultos,
  };
}

/** Enriquece linhas com grupo/categoria WMS para separadores no relatório de saldo. */
async function enriquecerLinhasPosicaoCadastro(tenantId, linhas) {
  const cds = [
    ...new Set(
      (linhas || [])
        .map((r) => parseInt(r.CD_PRODUTO, 10))
        .filter((n) => Number.isFinite(n))
    ),
  ];
  if (!cds.length) return linhas || [];
  const { classificarDetalheConservacao } = require('./wms-relatorio-separadores-cadastro.service');
  const map = new Map();
  try {
    const r = await pool.query(
      `SELECT pr."CD_PRODUTO", pr."CODIGO", pr."TIPO_ARMAZENAGEM", pr."NCM",
              pr."CD_CATEGORIA", cat."NOME" AS "NM_CATEGORIA",
              cat."CD_GRUPO", g."NOME" AS "NM_GRUPO"
         FROM "WMS_PRODUTO_DONO" pr
    LEFT JOIN "WMS_CATEGORIA_PRODUTO" cat
           ON cat."CD_CATEGORIA" = pr."CD_CATEGORIA" AND cat."TENANT_ID" = pr."TENANT_ID"
    LEFT JOIN "WMS_GRUPO_PRODUTO" g
           ON g."CD_GRUPO" = cat."CD_GRUPO" AND g."TENANT_ID" = cat."TENANT_ID"
        WHERE pr."TENANT_ID" = $1
          AND pr."CD_PRODUTO" = ANY($2::integer[])`,
      [tenantId, cds]
    );
    for (const row of r.rows || []) {
      map.set(Number(row.CD_PRODUTO), {
        CD_PRODUTO: Number(row.CD_PRODUTO),
        CODIGO: row.CODIGO,
        TIPO_ARMAZENAGEM: row.TIPO_ARMAZENAGEM || '',
        NCM: row.NCM,
        CD_CATEGORIA: row.CD_CATEGORIA != null ? Number(row.CD_CATEGORIA) : null,
        NM_CATEGORIA: row.NM_CATEGORIA,
        CD_GRUPO: row.CD_GRUPO != null ? Number(row.CD_GRUPO) : null,
        NM_GRUPO: row.NM_GRUPO,
      });
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  return (linhas || []).map((r) => {
    const cd = parseInt(r.CD_PRODUTO, 10);
    const cad = map.get(cd) || { TIPO_ARMAZENAGEM: r.TIPO_ARMAZENAGEM || '' };
    const det = classificarDetalheConservacao(r.NM_PRODUTO, cad);
    return {
      ...r,
      _cadWms: cad,
      _bucket: det.bucket,
      _frioTipo: det.frioTipo,
    };
  });
}

module.exports = {
  listarPosicaoEstoque,
  linhasParaCsv,
  montarRotuloFiltroDono,
  rotuloDonoRelatorio,
  AVISOS_PADRAO,
  applyProductMask,
  formatValidadeBr,
  enriquecerLinhasPosicaoCadastro,
  filtrarLinhasPosicaoOcultarZerados,
};
