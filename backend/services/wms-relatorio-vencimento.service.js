'use strict';

const { pool } = require('../config/db');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

const AVISO_FONTE =
  'Relatório derivado apenas de NF-e de entrada encerradas e linhas com validade (AAAA-MM-DD) e quantidade conferida > 0; não desconta saídas nem inventário.';

/**
 * Linhas de recebimento encerrado com validade dentro do horizonte
 * (override da consulta ou NU_DIAS_REL_VENCIMENTO de cada dono).
 * @param {string} tenantId
 * @param {number|string|null} cdDonoOpt
 * @param {{ horizonteDias?: number|null, dataReferencia?: string|null }} opts
 */
async function listarRelatorioVencimentoPorRecebimentoEncerrado(tenantId, cdDonoOpt, opts = {}) {
  const params = [tenantId];
  let donoClause = '';
  if (cdDonoOpt != null && String(cdDonoOpt).trim() !== '') {
    const n = parseInt(cdDonoOpt, 10);
    if (Number.isFinite(n)) {
      params.push(n);
      donoClause = ` AND e."CD_DONO" = $${params.length}::integer`;
    }
  }
  let horizonteOverride = null;
  if (opts.horizonteDias != null && String(opts.horizonteDias).trim() !== '') {
    const h = parseInt(String(opts.horizonteDias).trim(), 10);
    if (Number.isFinite(h) && h >= 1 && h <= 1095) horizonteOverride = h;
  }
  let horizonteSql = `d."NU_DIAS_REL_VENCIMENTO"`;
  if (horizonteOverride != null) {
    params.push(horizonteOverride);
    horizonteSql = `$${params.length}::integer`;
  }

  let dataRefIso = null;
  if (opts.dataReferencia != null && String(opts.dataReferencia).trim() !== '') {
    const s = String(opts.dataReferencia).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(`${s}T12:00:00`);
      if (!Number.isNaN(d.getTime())) dataRefIso = s;
    } else {
      const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (m) {
        const iso = `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
        const d = new Date(`${iso}T12:00:00`);
        if (!Number.isNaN(d.getTime())) dataRefIso = iso;
      }
    }
  }
  let dataBaseSql = 'CURRENT_DATE';
  if (dataRefIso) {
    params.push(dataRefIso);
    dataBaseSql = `$${params.length}::date`;
  }

  const sql = `
    WITH exp AS (
      SELECT
        e."TENANT_ID",
        e."CD_NFE",
        e."CD_DONO",
        e."CHAVE_NFE",
        e."NUMERO_NF",
        elem
      FROM "WMS_NFE_ENTRADA" e
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS elem
      WHERE e."TENANT_ID" = $1
        ${donoClause}
        AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) = 'ENCERRADA'
        AND e."CD_DONO" IS NOT NULL
    ),
    filtrada AS (
      SELECT
        exp."TENANT_ID",
        exp."CD_NFE",
        exp."CD_DONO",
        exp."CHAVE_NFE",
        exp."NUMERO_NF",
        NULLIF(TRIM(exp.elem->>'validade'), '') AS vtxt,
        NULLIF(TRIM(exp.elem->>'codigoProduto'), '') AS codigo_prod,
        NULLIF(TRIM(exp.elem->>'lote'), '') AS lote,
        CASE
          WHEN (exp.elem->>'cdProduto') ~ '^[0-9]+$' THEN (exp.elem->>'cdProduto')::integer
          ELSE NULL
        END AS cd_produto_json,
        COALESCE(NULLIF(TRIM(exp.elem->>'qtdConvertida'), ''), '0')::numeric AS qtd_conv
      FROM exp
    )
    SELECT
      f."TENANT_ID",
      f."CD_NFE",
      f."CD_DONO",
      d."NOME" AS "NM_DONO",
      ${horizonteSql} AS "NU_DIAS_REL_VENCIMENTO_DONO",
      d."MASCARA_CODIGO_PRODUTO",
      f."CHAVE_NFE",
      f."NUMERO_NF",
      f.vtxt AS "DT_VALIDADE",
      f.lote AS "LOTE",
      f.codigo_prod AS "CODIGO_PRODUTO",
      f.cd_produto_json AS "CD_PRODUTO",
      p."CODIGO" AS "CODIGO_INTERNO",
      p."NOME" AS "NM_PRODUTO",
      p."TIPO_ARMAZENAGEM" AS "TIPO_ARMAZENAGEM",
      f.qtd_conv AS "QTD_RECEBIDA_UM_CANON",
      (f.vtxt::date - ${dataBaseSql}) AS "DIAS_ATE_VENCIMENTO"
    FROM filtrada f
    JOIN "WMS_DONO_ESTOQUE" d
      ON d."CD_DONO" = f."CD_DONO" AND d."TENANT_ID" = f."TENANT_ID"
    LEFT JOIN "WMS_PRODUTO_DONO" p
      ON p."CD_PRODUTO" = f.cd_produto_json
     AND p."TENANT_ID" = f."TENANT_ID"
     AND p."CD_DONO" = f."CD_DONO"
    WHERE f.vtxt ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      AND f.qtd_conv > 0
      AND f.vtxt::date <= (${dataBaseSql} + (${horizonteSql}))
      ${dataRefIso ? `AND f.vtxt::date >= (${dataBaseSql})` : ''}
    ORDER BY f.vtxt::date ASC, f."CD_DONO", f.codigo_prod NULLS LAST, f."CD_NFE"
    LIMIT 5000
  `;
  try {
    const r = await pool.query(sql, params);
    const avisos = [AVISO_FONTE];
    const br = dataRefIso
      ? (() => {
          const m = dataRefIso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          return m ? `${m[3]}/${m[2]}/${m[1]}` : dataRefIso;
        })()
      : 'hoje';
    if (horizonteOverride != null && dataRefIso) {
      avisos.unshift(
        `Janela à frente: a partir de ${br} + ${horizonteOverride} dia(s) — só validades neste período (não inclui o que já venceu antes de ${br}).`
      );
    } else if (horizonteOverride != null) {
      avisos.unshift(
        `Horizonte escolhido na consulta: ${horizonteOverride} dia(s) a partir de ${br} — o que já venceu e o que vence nesse período.`
      );
    } else if (dataRefIso) {
      avisos.unshift(
        `Janela à frente a partir de ${br} (horizonte = política do dono) — não inclui o que já venceu antes dessa data.`
      );
    }
    return { rows: r.rows || [], avisos };
  } catch (e) {
    if (schemaMissing(e)) {
      const err = new Error(
        'Estrutura WMS incompleta para o relatório. Execute scripts de NF entrada, dono (política de validade) e tabelas de produto.'
      );
      err.code = 'SCHEMA';
      throw err;
    }
    throw e;
  }
}

function linhasParaCsv(rows) {
  const cols = [
    'CD_NFE',
    'CD_DONO',
    'NM_DONO',
    'NU_DIAS_REL_VENCIMENTO_DONO',
    'CHAVE_NFE',
    'NUMERO_NF',
    'DT_VALIDADE',
    'LOTE',
    'CODIGO_PRODUTO',
    'CD_PRODUTO',
    'NM_PRODUTO',
    'TIPO_ARMAZENAGEM',
    'QTD_RECEBIDA_UM_CANON',
    'DIAS_ATE_VENCIMENTO',
  ];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = cols.join(';');
  const body = (rows || [])
    .map((row) => cols.map((c) => esc(row[c] ?? row[c.toLowerCase()])).join(';'))
    .join('\n');
  return `${head}\n${body}`;
}

module.exports = {
  listarRelatorioVencimentoPorRecebimentoEncerrado,
  linhasParaCsv,
  AVISO_FONTE,
};
