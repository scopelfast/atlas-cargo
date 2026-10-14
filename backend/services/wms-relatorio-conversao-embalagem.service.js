'use strict';

const { pool } = require('../config/db');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

const AVISO_FONTE =
  'Lista vínculos ativos em que a quantidade operacional/NF é convertida para unidade de estoque (fator ≠ 1 ou código referência ≠ código estoque). Usado na validação NF × separação.';

function formatFator(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 6 });
}

function montarExemploConversao(row) {
  const f = Number(row.FATOR_CONVERSAO);
  if (!Number.isFinite(f) || f <= 0) return '';
  const ref = String(row.CODIGO_REFERENCIA || '').trim();
  const est = String(row.CODIGO_ESTOQUE || '').trim();
  const unRef = String(row.UNIDADE_REFERENCIA || row.UNIDADE || '').trim();
  const unEst = String(row.UNIDADE_ESTOQUE || '').trim();
  const uRef = unRef ? ` ${unRef}` : '';
  const uEst = unEst ? ` ${unEst}` : '';
  if (f === 1 && ref && est && ref !== est) {
    return `1${uRef} (${ref}) → 1${uEst} (${est})`;
  }
  return `1${uRef} (${ref || 'ref.'}) = ${formatFator(f)}${uEst} (${est || 'estoque'})`;
}

function enriquecerLinha(row) {
  const codEstoque = String(row.CODIGO_ESTOQUE || '').trim();
  const codRef = String(row.CODIGO_REFERENCIA || '').trim();
  return {
    ...row,
    CODIGO_PRODUTO: codEstoque,
    CODIGO_PRODUTO_INTERNO: codRef,
    EXEMPLO_CONVERSAO: montarExemploConversao(row),
    FATOR_CONVERSAO_FMT: formatFator(row.FATOR_CONVERSAO),
  };
}

function parseDonoParam(cdDonoOpt, params) {
  if (cdDonoOpt == null || String(cdDonoOpt).trim() === '') return '';
  const n = parseInt(cdDonoOpt, 10);
  if (!Number.isFinite(n)) return '';
  params.push(n);
  return ` AND x."CD_DONO" = $${params.length}::integer`;
}

async function listarOperacionalConversao(tenantId, cdDonoOpt) {
  const params = [tenantId];
  const donoClause = parseDonoParam(cdDonoOpt, params).replace(/x\./g, 'o.');
  const sql = `
    SELECT
      o."CD_DONO",
      d."NOME" AS "NM_DONO",
      p."CD_PRODUTO",
      p."CODIGO" AS "CODIGO_ESTOQUE",
      p."NOME" AS "NM_PRODUTO",
      p."UNIDADE" AS "UNIDADE_ESTOQUE",
      p."TIPO_ARMAZENAGEM",
      'CATÁLOGO OL' AS "ORIGEM",
      o."CODIGO_OPERACIONAL" AS "CODIGO_REFERENCIA",
      o."UNIDADE" AS "UNIDADE_REFERENCIA",
      o."FATOR_CONVERSAO",
      o."INDICE_ARRED",
      NULL::text AS "OBSERVACAO"
    FROM "WMS_PRODUTO_OPERACIONAL" o
    INNER JOIN "WMS_PRODUTO_DONO" p
      ON p."CD_PRODUTO" = o."CD_PRODUTO"
     AND p."TENANT_ID" = o."TENANT_ID"
     AND p."CD_DONO" = o."CD_DONO"
    INNER JOIN "WMS_DONO_ESTOQUE" d
      ON d."CD_DONO" = o."CD_DONO"
     AND d."TENANT_ID" = o."TENANT_ID"
    WHERE o."TENANT_ID" = $1
      ${donoClause}
      AND COALESCE(o."FGACTIVE", 'S') = 'S'
      AND COALESCE(p."FGACTIVE", 'S') = 'S'
      AND (
        o."FATOR_CONVERSAO" IS DISTINCT FROM 1
        OR LOWER(TRIM(o."CODIGO_OPERACIONAL")) IS DISTINCT FROM LOWER(TRIM(p."CODIGO"))
      )
    ORDER BY o."CD_DONO", p."CODIGO", o."CODIGO_OPERACIONAL"
    LIMIT 5000
  `;
  const r = await pool.query(sql, params);
  return r.rows || [];
}

async function listarDeparaConversao(tenantId, cdDonoOpt) {
  const params = [tenantId];
  const donoClause = parseDonoParam(cdDonoOpt, params).replace(/x\./g, 'dp.');
  const sql = `
    SELECT
      dp."CD_DONO",
      d."NOME" AS "NM_DONO",
      p."CD_PRODUTO",
      COALESCE(p."CODIGO", dp."CODIGO_INTERNO") AS "CODIGO_ESTOQUE",
      p."NOME" AS "NM_PRODUTO",
      p."UNIDADE" AS "UNIDADE_ESTOQUE",
      p."TIPO_ARMAZENAGEM",
      'DE-PARA NF' AS "ORIGEM",
      dp."CODIGO_EXTERNO" AS "CODIGO_REFERENCIA",
      NULL::varchar AS "UNIDADE_REFERENCIA",
      dp."FATOR_CONVERSAO",
      NULL::numeric AS "INDICE_ARRED",
      dp."OBSERVACAO"
    FROM "WMS_DEPARA_PRODUTO" dp
    INNER JOIN "WMS_DONO_ESTOQUE" d
      ON d."CD_DONO" = dp."CD_DONO"
     AND d."TENANT_ID" = dp."TENANT_ID"
    LEFT JOIN LATERAL (
      SELECT pr."CD_PRODUTO", pr."CODIGO", pr."NOME", pr."UNIDADE", pr."TIPO_ARMAZENAGEM"
        FROM "WMS_PRODUTO_DONO" pr
       WHERE pr."TENANT_ID" = dp."TENANT_ID"
         AND pr."CD_DONO" = dp."CD_DONO"
         AND COALESCE(pr."FGACTIVE", 'S') = 'S'
         AND LOWER(TRIM(pr."CODIGO")) = LOWER(TRIM(dp."CODIGO_INTERNO"))
       LIMIT 1
    ) p ON true
    WHERE dp."TENANT_ID" = $1
      ${donoClause}
      AND COALESCE(dp."FGACTIVE", 'S') = 'S'
      AND (
        dp."FATOR_CONVERSAO" IS DISTINCT FROM 1
        OR LOWER(TRIM(dp."CODIGO_EXTERNO")) IS DISTINCT FROM LOWER(TRIM(dp."CODIGO_INTERNO"))
      )
    ORDER BY dp."CD_DONO", dp."CODIGO_INTERNO", dp."CODIGO_EXTERNO"
    LIMIT 5000
  `;
  const r = await pool.query(sql, params);
  return r.rows || [];
}

/**
 * SKUs com conversão de embalagem (catálogo OL + de-para NF).
 */
async function listarConversaoEmbalagem(tenantId, cdDonoOpt, opts = {}) {
  const origem = String(opts.origem || 'todos').trim().toLowerCase();
  const avisos = [AVISO_FONTE];

  try {
    const tasks = [];
    if (origem === 'todos' || origem === 'operacional') {
      tasks.push(listarOperacionalConversao(tenantId, cdDonoOpt));
    }
    if (origem === 'todos' || origem === 'depara') {
      tasks.push(listarDeparaConversao(tenantId, cdDonoOpt));
    }
    const partes = await Promise.all(tasks);
    const merged = partes
      .flat()
      .sort((a, b) => {
        const da = parseInt(a.CD_DONO, 10) || 0;
        const db = parseInt(b.CD_DONO, 10) || 0;
        if (da !== db) return da - db;
        const ca = String(a.CODIGO_ESTOQUE || '');
        const cb = String(b.CODIGO_ESTOQUE || '');
        if (ca !== cb) return ca.localeCompare(cb, 'pt-BR');
        return String(a.CODIGO_REFERENCIA || '').localeCompare(String(b.CODIGO_REFERENCIA || ''), 'pt-BR');
      })
      .slice(0, 8000)
      .map(enriquecerLinha);

    if (merged.length >= 8000) {
      avisos.push('Resultado limitado a 8.000 linhas. Refine o filtro por dono ou produto.');
    }
    return { linhas: merged, avisos };
  } catch (e) {
    if (schemaMissing(e)) {
      const err = new Error(
        'Estrutura WMS incompleta. Execute scripts de produto operacional (OL) e de-para NF.'
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
    'ORIGEM',
    'CODIGO_ESTOQUE',
    'CODIGO_REFERENCIA',
    'NM_PRODUTO',
    'FATOR_CONVERSAO',
    'UNIDADE_REFERENCIA',
    'UNIDADE_ESTOQUE',
    'INDICE_ARRED',
    'EXEMPLO_CONVERSAO',
    'TIPO_ARMAZENAGEM',
    'OBSERVACAO',
  ];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = cols.join(';');
  const body = (rows || [])
    .map((row) => cols.map((c) => esc(row[c])).join(';'))
    .join('\n');
  return `${head}\n${body}`;
}

module.exports = {
  listarConversaoEmbalagem,
  linhasParaCsv,
  AVISO_FONTE,
};
