'use strict';

/**
 * Valorização de estoque WMS (R$) — base para dashboard e cobrança % sobre valor.
 * Saldo: NF entrada encerrada + WMS_MOVIMENTO_ESTOQUE (mesma base da Movimentação).
 * Preço unitário: última NF encerrada.
 *   - conferência converteu UM (qtdConvertida ≥ qCom): vProd ÷ qtdConvertida
 *   - conferência parcial (qtdConvertida < qCom): vProd ÷ qCom
 *   - senão VALOR_REFERENCIA do cadastro.
 */

const { pool } = require('../config/db');
const { applyProductMask } = require('./wms-relatorio-posicao-estoque.service');
const { exprDhEntradaEstoque } = require('./wms-relatorio-movimentacao.service');

const METODO_VALOR = 'VPROD_QTD_CONVERTIDA';
/** Primeiro dia com movimentação WMS (backfill retroativo). */
const WMS_VALOR_DT_INICIO = '2026-05-18';
const AVISOS_PADRAO = [
  'Valor do estoque = saldo (ledger) × preço unitário na mesma UM do saldo. Não usa peso (PESO_KG) nem valor de NF de saída.',
  'Preço NF: conversão de UM (qtdConvertida ≥ qCom ou UM XML ≠ cadastro) usa vProd ÷ qtdConvertida. Conferência parcial na mesma UM (qtdConvertida < qCom) usa vProd ÷ qCom. Senão VALOR_REFERENCIA.',
  'SKUs com saldo positivo e sem preço entram em «sem preço» — não entram no valor total.',
  'Cobrança estimada = valor × (PCT_COBRANCA_ESTOQUE do dono ÷ 100). Configure o % em Cadastros → Dono do estoque.',
  'Antes de gerar snapshots: use «Auditar UM» para comparar com a fórmula antiga (vUnCom).',
  'Pico do período = maior snapshot diário gravado. Valor «hoje» é calculado em tempo real. Depois de corrigir preço, regenere os snapshots do mês.',
];

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function toNumber(v) {
  if (v == null || v === '') return NaN;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

function round2(n) {
  return Number((Number(n) || 0).toFixed(2));
}

function round4(n) {
  return Number((Number(n) || 0).toFixed(4));
}

function normCodigoKey(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-z]/g, '');
}

function sqlNumJsonField(jsonExpr, key) {
  return `NULLIF(REPLACE(TRIM(COALESCE(${jsonExpr}->>'${key}', '')), ',', '.'), '')::numeric`;
}

/** vUnCom ou vProd/qCom de uma linha LINHAS_JSON da NF-e (fórmula legada — UM comercial XML). */
function sqlUnitPriceNfe(itemAlias) {
  return `COALESCE(
    ${sqlNumJsonField(itemAlias, 'vUnCom')},
    ${sqlNumJsonField(itemAlias, 'vunCom')},
    CASE
      WHEN COALESCE(${sqlNumJsonField(itemAlias, 'qCom')}, ${sqlNumJsonField(itemAlias, 'qTrib')}, ${sqlNumJsonField(itemAlias, 'qtrib')}, 0) > 0
      THEN ${sqlNumJsonField(itemAlias, 'vProd')}
           / NULLIF(COALESCE(${sqlNumJsonField(itemAlias, 'qCom')}, ${sqlNumJsonField(itemAlias, 'qTrib')}, ${sqlNumJsonField(itemAlias, 'qtrib')}), 0)
    END
  )`;
}

function sqlQComXml(lnElemExpr) {
  return `COALESCE(
    ${sqlNumJsonField(lnElemExpr, 'qCom')},
    ${sqlNumJsonField(lnElemExpr, 'qTrib')},
    ${sqlNumJsonField(lnElemExpr, 'qtrib')}
  )`;
}

function sqlNormUm(expr) {
  return `CASE
    WHEN UPPER(TRIM(COALESCE(${expr}, ''))) IN ('PCT', 'PC', 'PACOTE', 'PKT', 'PKG') THEN 'PC'
    WHEN UPPER(TRIM(COALESCE(${expr}, ''))) IN ('UN', 'UND', 'UNID', 'UNIDADE') THEN 'UN'
    WHEN UPPER(TRIM(COALESCE(${expr}, ''))) IN ('CX', 'CAIXA') THEN 'CX'
    WHEN UPPER(TRIM(COALESCE(${expr}, ''))) IN ('FD', 'FARDO') THEN 'FD'
    WHEN UPPER(TRIM(COALESCE(${expr}, ''))) IN ('KG', 'KGM', 'KILO') THEN 'KG'
    ELSE UPPER(TRIM(COALESCE(${expr}, '')))
  END`;
}

function sqlXmlUmIgualCadastro(lnElemExpr, unidadeCadExpr) {
  const uCom = sqlNormUm(`${lnElemExpr}->>'uCom'`);
  const uTrib = sqlNormUm(`${lnElemExpr}->>'uTrib'`);
  const uCad = sqlNormUm(unidadeCadExpr);
  return `(${uCad} <> '' AND (${uCom} = ${uCad} OR (${uTrib} <> '' AND ${uTrib} = ${uCad})))`;
}

/**
 * Preço na UM do ledger.
 * vProd é sempre o valor da linha XML inteira (qCom).
 * - Mesma UM no XML e no cadastro e qtdConvertida < qCom: conferência parcial → vProd ÷ qCom.
 * - Conversão de UM (FD→PC, CX→KG, etc.): vProd ÷ qtdConvertida.
 * - fallback: vUnCom.
 */
function sqlPrecoUnitLedgerUm(confElemExpr, lnElemExpr, unidadeCadExpr) {
  const vProd = sqlNumJsonField(lnElemExpr, 'vProd');
  const qtdConv = sqlNumJsonField(confElemExpr, 'qtdConvertida');
  const qCom = sqlQComXml(lnElemExpr);
  const mesmaUm = unidadeCadExpr
    ? sqlXmlUmIgualCadastro(lnElemExpr, unidadeCadExpr)
    : 'FALSE';
  return `COALESCE(
    CASE
      WHEN ${qtdConv} IS NOT NULL AND ${qtdConv} > 0
       AND ${vProd} IS NOT NULL AND ${vProd} > 0
       AND ${qCom} IS NOT NULL AND ${qCom} > 0
       AND ${qtdConv} < ${qCom}
       AND ${mesmaUm}
      THEN ${vProd} / ${qCom}
      WHEN ${qtdConv} IS NOT NULL AND ${qtdConv} > 0
       AND ${vProd} IS NOT NULL AND ${vProd} > 0
      THEN ${vProd} / ${qtdConv}
    END,
    ${sqlUnitPriceNfe(lnElemExpr)}
  )`;
}

function sqlPrecoUnitExpr(confElemExpr, lnElemExpr, metodoPreco, unidadeCadExpr) {
  if (metodoPreco === 'VUNCOM') return sqlUnitPriceNfe(lnElemExpr);
  return sqlPrecoUnitLedgerUm(confElemExpr, lnElemExpr, unidadeCadExpr);
}

/** Preço para nf_lin com conferência ligada pelo nItem (de-para / código legado). */
function sqlPrecoUnitNfLinComConf(lnItemExpr, confJsonExpr, nItemColExpr, metodoPreco, unidadeCadExpr) {
  if (metodoPreco === 'VUNCOM') return sqlUnitPriceNfe(lnItemExpr);
  const vProd = sqlNumJsonField(lnItemExpr, 'vProd');
  const qCom = sqlQComXml(lnItemExpr);
  const qtdConvSub = `(SELECT ${sqlNumJsonField('conf.elem', 'qtdConvertida')}
      FROM jsonb_array_elements(COALESCE(${confJsonExpr}, '[]'::jsonb)) conf(elem)
     WHERE TRIM(COALESCE(conf.elem->>'nItem', '')) <> ''
       AND TRIM(COALESCE(conf.elem->>'nItem', '')) = ${nItemColExpr}
     LIMIT 1)`;
  const mesmaUm = unidadeCadExpr
    ? sqlXmlUmIgualCadastro(lnItemExpr, unidadeCadExpr)
    : 'FALSE';
  return `COALESCE(
    CASE
      WHEN ${qtdConvSub} IS NOT NULL AND ${qtdConvSub} > 0
       AND ${vProd} IS NOT NULL AND ${vProd} > 0
       AND ${qCom} IS NOT NULL AND ${qCom} > 0
       AND ${qtdConvSub} < ${qCom}
       AND ${mesmaUm}
      THEN ${vProd} / ${qCom}
      WHEN ${qtdConvSub} IS NOT NULL AND ${qtdConvSub} > 0
       AND ${vProd} IS NOT NULL AND ${vProd} > 0
      THEN ${vProd} / ${qtdConvSub}
    END,
    ${sqlUnitPriceNfe(lnItemExpr)}
  )`;
}

function sqlNormCodigo(expr) {
  return `REGEXP_REPLACE(REPLACE(LOWER(TRIM(COALESCE(${expr}, ''))), '.', ''), '[^0-9a-z]', '', 'g')`;
}

/** Mesma regra de deparaLookupKeysFromCProd (código NF fornecedor). */
function sqlDeparaMatchCProd(cProdExpr, codigoExternoCol) {
  const c = `TRIM(COALESCE(${cProdExpr}, ''))`;
  const ext = `TRIM(COALESCE(${codigoExternoCol}, ''))`;
  return `(
    ${c} <> ''
    AND (
      LOWER(${c}) = LOWER(${ext})
      OR (
        ${c} ~ '^[0-9]+$'
        AND LOWER(${ext}) = LOWER(TRIM((${c}::numeric)::bigint::text))
      )
    )
  )`;
}

function parseDataIso(v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const y = parseInt(m[3], 10);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }
  return null;
}

/** DATE do PostgreSQL (node-pg devolve Date) → YYYY-MM-DD para comparação e gráficos. */
function isoDateFromDb(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parsed = parseDataIso(s);
  return parsed || '';
}

function hojeIsoTz() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function inicioMes(iso) {
  const p = String(iso || hojeIsoTz()).slice(0, 7);
  return `${p}-01`;
}

function fimMes(iso) {
  const s = String(iso || hojeIsoTz());
  const [y, m] = s.split('-').map((x) => parseInt(x, 10));
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

function cobrancaSobreValor(valorTotal, pct) {
  const p = toNumber(pct);
  if (!Number.isFinite(p) || p <= 0) return 0;
  return round2((Number(valorTotal) || 0) * (p / 100));
}

function listarDiasEntre(dtIni, dtFim) {
  const ini = parseDataIso(dtIni);
  const fim = parseDataIso(dtFim);
  if (!ini || !fim || ini > fim) return [];
  const out = [];
  const d = new Date(`${ini}T12:00:00`);
  const end = new Date(`${fim}T12:00:00`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

/**
 * Período de backfill: mês da referência, do WMS_VALOR_DT_INICIO (ou dia 1 do mês) até min(hoje, fim do mês).
 */
function resolverPeriodoBackfill(dataRef, dtInicioFixo) {
  const ref = parseDataIso(dataRef) || hojeIsoTz();
  const hoje = hojeIsoTz();
  const iniFixo = parseDataIso(dtInicioFixo) || WMS_VALOR_DT_INICIO;
  const iniMes = inicioMes(ref);
  const dtIni = iniFixo > iniMes ? iniFixo : iniMes;
  const fimMesRef = fimMes(ref);
  const dtFim = fimMesRef < hoje ? fimMesRef : hoje;
  if (dtIni > dtFim) return null;
  return { dtIni, dtFim, dias: listarDiasEntre(dtIni, dtFim) };
}

/** Saldo por CD_PRODUTO = entradas NF encerradas + movimentos ledger (opcional corte em dtAte). */
async function obterSaldoPorProdutoMap(tenantId, cdDonoOpt, client, dtAte) {
  const db = client || pool;
  const params = [tenantId];
  let donoClauseEnt = '';
  let donoClauseMov = '';
  if (cdDonoOpt != null && String(cdDonoOpt).trim() !== '') {
    const n = parseInt(cdDonoOpt, 10);
    if (Number.isFinite(n)) {
      params.push(n);
      donoClauseEnt = ` AND e."CD_DONO" = $${params.length}::integer`;
      donoClauseMov = ` AND m."CD_DONO" = $${params.length}::integer`;
    }
  }
  const dhEntradaExpr = await exprDhEntradaEstoque('e');
  let dtClauseEnt = '';
  let dtClauseMov = '';
  const dtCorte = parseDataIso(dtAte);
  if (dtCorte) {
    params.push(dtCorte);
    dtClauseEnt = ` AND ${dhEntradaExpr}::date <= $${params.length}::date`;
    dtClauseMov = ` AND m."DH_REGISTRO"::date <= $${params.length}::date`;
  }
  const sql = `
    WITH ent AS (
      SELECT e."CD_DONO",
             (elem->>'cdProduto')::integer AS cd_produto,
             SUM(COALESCE(NULLIF(TRIM(elem->>'qtdConvertida'), ''), '0')::numeric) AS qtd
        FROM "WMS_NFE_ENTRADA" e
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS elem
       WHERE e."TENANT_ID" = $1
         ${donoClauseEnt}
         AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) = 'ENCERRADA'
         AND (elem->>'cdProduto') ~ '^[0-9]+$'
         ${dtClauseEnt}
       GROUP BY e."CD_DONO", (elem->>'cdProduto')::integer
    ),
    mov AS (
      SELECT m."CD_DONO", m."CD_PRODUTO" AS cd_produto, SUM(m."QTD")::numeric AS qtd
        FROM "WMS_MOVIMENTO_ESTOQUE" m
       WHERE m."TENANT_ID" = $1
         ${donoClauseMov}
         ${dtClauseMov}
       GROUP BY m."CD_DONO", m."CD_PRODUTO"
    ),
    u AS (
      SELECT "CD_DONO", cd_produto, qtd FROM ent WHERE cd_produto IS NOT NULL
      UNION ALL
      SELECT "CD_DONO", cd_produto, qtd FROM mov WHERE cd_produto IS NOT NULL
    )
    SELECT "CD_DONO", cd_produto, SUM(qtd)::numeric AS saldo
      FROM u
     GROUP BY "CD_DONO", cd_produto`;
  const r = await db.query(sql, params);
  const map = new Map();
  for (const row of r.rows || []) {
    const cdDono = parseInt(row.CD_DONO, 10);
    const cd = parseInt(row.cd_produto, 10);
    if (!Number.isFinite(cdDono) || !Number.isFinite(cd)) continue;
    const k = `${cdDono}|${cd}`;
    map.set(k, Number(row.saldo) || 0);
  }
  return map;
}

/**
 * Último preço unitário por (CD_DONO, CD_PRODUTO) a partir de NF entrada encerrada.
 * 1) CONFERENCIA_JSON.cdProduto + LINHAS_JSON pelo mesmo nItem (regra do recebimento).
 * 2) cProd do XML via WMS_DEPARA_PRODUTO → código interno.
 * 3) cProd igual ao CODIGO do produto (legado).
 */
async function obterUltimoPrecoEntradaMap(tenantId, cdDonoOpt, client, dtAte, opts) {
  opts = opts || {};
  const metodoPreco = opts.metodoPreco === 'VUNCOM' ? 'VUNCOM' : 'LEDGER';
  const db = client || pool;
  const params = [tenantId];
  let donoClause = '';
  if (cdDonoOpt != null && String(cdDonoOpt).trim() !== '') {
    const n = parseInt(cdDonoOpt, 10);
    if (Number.isFinite(n)) {
      params.push(n);
      donoClause = ` AND e."CD_DONO" = $${params.length}::integer`;
    }
  }
  const dhEntradaExpr = await exprDhEntradaEstoque('e');
  let dtClauseDocs = '';
  const dtCorte = parseDataIso(dtAte);
  if (dtCorte) {
    params.push(dtCorte);
    dtClauseDocs = ` AND ${dhEntradaExpr}::date <= $${params.length}::date`;
  }
  const pxConf = sqlPrecoUnitExpr('conf.elem', 'ln.elem', metodoPreco, 'p."UNIDADE"');
  const pxConfCod = sqlPrecoUnitExpr('conf.elem', 'ln.elem', metodoPreco, 'p."UNIDADE"');
  const pxDepara = sqlPrecoUnitNfLinComConf(
    'nl.item',
    'nl."CONFERENCIA_JSON"',
    'nl.n_item',
    metodoPreco,
    'p."UNIDADE"'
  );
  const pxCodigo = sqlPrecoUnitNfLinComConf(
    'nl.item',
    'nl."CONFERENCIA_JSON"',
    'nl.n_item',
    metodoPreco,
    'p."UNIDADE"'
  );
  const normCodigoProd = sqlNormCodigo('p."CODIGO"');
  const normCodigoInterno = sqlNormCodigo('dep."CODIGO_INTERNO"');
  const normCProdItem = sqlNormCodigo(`nl.item->>'cProd'`);
  const normCodigoConf = sqlNormCodigo(`conf.elem->>'codigoProduto'`);
  const sql = `
    WITH docs AS (
      SELECT
        e."TENANT_ID",
        e."CD_DONO",
        e."CD_NFE" AS cd_nfe,
        ${dhEntradaExpr} AS dh_ref,
        e."DH_ENCERRAMENTO" AS dh_enc,
        e."CONFERENCIA_JSON",
        e."LINHAS_JSON"
      FROM "WMS_NFE_ENTRADA" e
      WHERE e."TENANT_ID" = $1
        ${donoClause}
        AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) = 'ENCERRADA'
        ${dtClauseDocs}
    ),
    priced_conf AS (
      SELECT
        d."CD_DONO",
        (conf.elem->>'cdProduto')::integer AS "CD_PRODUTO",
        d.dh_ref,
        d.dh_enc,
        d.cd_nfe,
        ${pxConf} AS v_unit
      FROM docs d
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d."CONFERENCIA_JSON", '[]'::jsonb)) AS conf(elem)
      INNER JOIN LATERAL jsonb_array_elements(COALESCE(d."LINHAS_JSON", '[]'::jsonb)) AS ln(elem)
        ON TRIM(COALESCE(conf.elem->>'nItem', '')) <> ''
       AND TRIM(COALESCE(conf.elem->>'nItem', '')) = TRIM(COALESCE(ln.elem->>'nItem', ''))
      LEFT JOIN "WMS_PRODUTO_DONO" p
        ON p."TENANT_ID" = d."TENANT_ID"
       AND p."CD_DONO" = d."CD_DONO"
       AND p."CD_PRODUTO" = (conf.elem->>'cdProduto')::integer
      WHERE (conf.elem->>'cdProduto') ~ '^[0-9]+$'
        AND (conf.elem->>'cdProduto')::integer > 0
    ),
    priced_conf_codigo AS (
      SELECT
        d."CD_DONO",
        p."CD_PRODUTO",
        d.dh_ref,
        d.dh_enc,
        d.cd_nfe,
        ${pxConfCod} AS v_unit
      FROM docs d
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d."CONFERENCIA_JSON", '[]'::jsonb)) AS conf(elem)
      INNER JOIN LATERAL jsonb_array_elements(COALESCE(d."LINHAS_JSON", '[]'::jsonb)) AS ln(elem)
        ON TRIM(COALESCE(conf.elem->>'nItem', '')) <> ''
       AND TRIM(COALESCE(conf.elem->>'nItem', '')) = TRIM(COALESCE(ln.elem->>'nItem', ''))
      INNER JOIN "WMS_PRODUTO_DONO" p
        ON p."TENANT_ID" = d."TENANT_ID"
       AND p."CD_DONO" = d."CD_DONO"
       AND ${normCodigoProd} = ${normCodigoConf}
       AND TRIM(COALESCE(conf.elem->>'codigoProduto', '')) <> ''
      WHERE NOT ((conf.elem->>'cdProduto') ~ '^[0-9]+$' AND (conf.elem->>'cdProduto')::integer > 0)
    ),
    nf_lin AS (
      SELECT
        d."TENANT_ID",
        d."CD_DONO",
        d.dh_ref,
        d.dh_enc,
        d.cd_nfe,
        d."CONFERENCIA_JSON",
        ln.elem AS item,
        TRIM(COALESCE(ln.elem->>'nItem', '')) AS n_item
      FROM docs d
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(d."LINHAS_JSON", '[]'::jsonb)) AS ln(elem)
      WHERE TRIM(COALESCE(ln.elem->>'cProd', '')) <> ''
    ),
    priced_depara AS (
      SELECT
        nl."CD_DONO",
        p."CD_PRODUTO",
        nl.dh_ref,
        nl.dh_enc,
        nl.cd_nfe,
        ${pxDepara} AS v_unit
      FROM nf_lin nl
      INNER JOIN "WMS_DEPARA_PRODUTO" dep
        ON dep."TENANT_ID" = nl."TENANT_ID"
       AND dep."CD_DONO" = nl."CD_DONO"
       AND COALESCE(TRIM(UPPER(dep."FGACTIVE")), 'S') = 'S'
       AND ${sqlDeparaMatchCProd('nl.item->>\'cProd\'', 'dep."CODIGO_EXTERNO"')}
      INNER JOIN "WMS_PRODUTO_DONO" p
        ON p."TENANT_ID" = nl."TENANT_ID"
       AND p."CD_DONO" = nl."CD_DONO"
       AND ${normCodigoProd} = ${normCodigoInterno}
    ),
    priced_codigo AS (
      SELECT
        nl."CD_DONO",
        p."CD_PRODUTO",
        nl.dh_ref,
        nl.dh_enc,
        nl.cd_nfe,
        ${pxCodigo} AS v_unit
      FROM nf_lin nl
      INNER JOIN "WMS_PRODUTO_DONO" p
        ON p."TENANT_ID" = nl."TENANT_ID"
       AND p."CD_DONO" = nl."CD_DONO"
       AND ${normCodigoProd} = ${normCProdItem}
    ),
    all_priced AS (
      SELECT "CD_DONO", "CD_PRODUTO", dh_ref, dh_enc, cd_nfe, v_unit FROM priced_conf
      UNION ALL
      SELECT "CD_DONO", "CD_PRODUTO", dh_ref, dh_enc, cd_nfe, v_unit FROM priced_conf_codigo
      UNION ALL
      SELECT "CD_DONO", "CD_PRODUTO", dh_ref, dh_enc, cd_nfe, v_unit FROM priced_depara
      UNION ALL
      SELECT "CD_DONO", "CD_PRODUTO", dh_ref, dh_enc, cd_nfe, v_unit FROM priced_codigo
    )
    SELECT DISTINCT ON ("CD_DONO", "CD_PRODUTO")
      "CD_DONO", "CD_PRODUTO", v_unit AS "V_UNIT", dh_ref AS "DH_REF"
    FROM all_priced
    WHERE v_unit IS NOT NULL AND v_unit > 0
    ORDER BY "CD_DONO", "CD_PRODUTO", dh_ref DESC, dh_enc DESC NULLS LAST, cd_nfe DESC`;
  const r = await db.query(sql, params);
  const map = new Map();
  for (const row of r.rows || []) {
    map.set(`${row.CD_DONO}|${row.CD_PRODUTO}`, {
      vUnit: Number(row.V_UNIT) || 0,
      fonte: 'NF_ENTRADA',
      dhRef: row.DH_REF,
    });
  }
  return map;
}

async function carregarMetaProdutos(tenantId, cdDonoOpt) {
  const params = [tenantId];
  let sql = `
    SELECT p."CD_PRODUTO", p."CD_DONO", p."CODIGO", p."NOME",
           p."VALOR_REFERENCIA", d."NOME" AS "NM_DONO", d."MASCARA_CODIGO_PRODUTO",
           d."PCT_COBRANCA_ESTOQUE"
      FROM "WMS_PRODUTO_DONO" p
      JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = p."CD_DONO" AND d."TENANT_ID" = p."TENANT_ID"
     WHERE p."TENANT_ID" = $1
       AND COALESCE(TRIM(UPPER(p."FGACTIVE")), 'S') = 'S'`;
  if (cdDonoOpt != null && String(cdDonoOpt).trim() !== '') {
    const n = parseInt(cdDonoOpt, 10);
    if (Number.isFinite(n)) {
      params.push(n);
      sql += ` AND p."CD_DONO" = $${params.length}::integer`;
    }
  }
  const r = await pool.query(sql, params);
  return r.rows || [];
}

/**
 * Posição valorizada em tempo real.
 * @returns {Promise<{ linhas: object[], resumo: object, avisos: string[] }>}
 */
async function calcularPosicaoValorizada(tenantId, cdDonoOpt, opts) {
  opts = opts || {};
  const dtAte = parseDataIso(opts.dtAte);
  const [saldoMap, precoMap, produtos] = await Promise.all([
    obterSaldoPorProdutoMap(tenantId, cdDonoOpt, null, dtAte),
    obterUltimoPrecoEntradaMap(tenantId, cdDonoOpt, null, dtAte),
    carregarMetaProdutos(tenantId, cdDonoOpt),
  ]);

  const porDono = new Map();
  const linhas = [];
  const chavesSaldo = new Set(saldoMap.keys());

  for (const p of produtos) {
    const cdDono = Number(p.CD_DONO);
    const cd = Number(p.CD_PRODUTO);
    const k = `${cdDono}|${cd}`;
    const saldo = saldoMap.has(k) ? Number(saldoMap.get(k)) || 0 : 0;
    if (Math.abs(saldo) < 1e-9) continue;

    let precoInfo = precoMap.get(k);
    let vUnit = precoInfo ? precoInfo.vUnit : NaN;
    let fontePreco = precoInfo ? 'NF_ENTRADA' : '';
    if (!Number.isFinite(vUnit) || vUnit <= 0) {
      const vr = toNumber(p.VALOR_REFERENCIA);
      if (Number.isFinite(vr) && vr > 0) {
        vUnit = vr;
        fontePreco = 'VALOR_REFERENCIA';
      }
    }

    const saldoPos = saldo > 0 ? saldo : 0;
    const temPreco = Number.isFinite(vUnit) && vUnit > 0;
    const valorLinha = temPreco && saldoPos > 0 ? round2(saldoPos * vUnit) : 0;
    const mask = String(p.MASCARA_CODIGO_PRODUTO || '').trim();
    const cod = String(p.CODIGO || '').trim();
    const codExib = mask && cod ? applyProductMask(cod, mask) : cod;

    const row = {
      CD_DONO: cdDono,
      NM_DONO: p.NM_DONO || '',
      CD_PRODUTO: cd,
      CODIGO_PRODUTO: codExib,
      NM_PRODUTO: p.NOME || '',
      QTD_SALDO: round4(saldo),
      VLR_UNITARIO: temPreco ? round4(vUnit) : null,
      FONTE_PRECO: temPreco ? fontePreco : 'SEM_PRECO',
      VALOR_ESTOQUE: valorLinha,
      SALDO_NEGATIVO: saldo < 0,
    };
    linhas.push(row);

    if (!porDono.has(cdDono)) {
      porDono.set(cdDono, {
        CD_DONO: cdDono,
        NM_DONO: p.NM_DONO || '',
        PCT_COBRANCA_ESTOQUE: toNumber(p.PCT_COBRANCA_ESTOQUE),
        valorTotal: 0,
        qtdSkus: 0,
        qtdSkusSemPreco: 0,
        qtdUnidadesSemPreco: 0,
        qtdSaldoNegativo: 0,
      });
    }
    const agg = porDono.get(cdDono);
    agg.qtdSkus += 1;
    if (saldo < 0) agg.qtdSaldoNegativo += 1;
    if (temPreco && saldoPos > 0) {
      agg.valorTotal = round2(agg.valorTotal + valorLinha);
    } else if (saldoPos > 0) {
      agg.qtdSkusSemPreco += 1;
      agg.qtdUnidadesSemPreco = round4(agg.qtdUnidadesSemPreco + saldoPos);
    }
  }

  /** SKUs só no ledger sem cadastro ativo */
  for (const k of chavesSaldo) {
    const [cdDonoStr, cdStr] = k.split('|');
    const cdDono = parseInt(cdDonoStr, 10);
    const cd = parseInt(cdStr, 10);
    if (produtos.some((p) => Number(p.CD_DONO) === cdDono && Number(p.CD_PRODUTO) === cd)) continue;
    const saldo = Number(saldoMap.get(k)) || 0;
    if (Math.abs(saldo) < 1e-9) continue;
    linhas.push({
      CD_DONO: cdDono,
      NM_DONO: '',
      CD_PRODUTO: cd,
      CODIGO_PRODUTO: `#${cd}`,
      NM_PRODUTO: '(produto não cadastrado)',
      QTD_SALDO: round4(saldo),
      VLR_UNITARIO: null,
      FONTE_PRECO: 'SEM_CADASTRO',
      VALOR_ESTOQUE: 0,
      SALDO_NEGATIVO: saldo < 0,
    });
  }

  linhas.sort((a, b) => {
    const d = Number(a.CD_DONO) - Number(b.CD_DONO);
    if (d !== 0) return d;
    return String(a.CODIGO_PRODUTO).localeCompare(String(b.CODIGO_PRODUTO));
  });

  let valorTotal = 0;
  let qtdSkus = 0;
  let qtdSkusSemPreco = 0;
  let qtdUnidadesSemPreco = 0;
  const porDonoArr = [];
  for (const agg of porDono.values()) {
    agg.valorTotal = round2(agg.valorTotal);
    agg.valorCobrancaEstimado = cobrancaSobreValor(agg.valorTotal, agg.PCT_COBRANCA_ESTOQUE);
    valorTotal = round2(valorTotal + agg.valorTotal);
    qtdSkus += agg.qtdSkus;
    qtdSkusSemPreco += agg.qtdSkusSemPreco;
    qtdUnidadesSemPreco = round4(qtdUnidadesSemPreco + agg.qtdUnidadesSemPreco);
    porDonoArr.push(agg);
  }
  porDonoArr.sort((a, b) => Number(a.CD_DONO) - Number(b.CD_DONO));

  const avisos = [...AVISOS_PADRAO];
  if (valorTotal > 0) {
    const suspeitos = linhas
      .filter((l) => Number(l.VALOR_ESTOQUE) > valorTotal * 0.08)
      .sort((a, b) => Number(b.VALOR_ESTOQUE) - Number(a.VALOR_ESTOQUE))
      .slice(0, 5);
    for (const s of suspeitos) {
      const pct = round2((Number(s.VALOR_ESTOQUE) / valorTotal) * 100);
      avisos.push(
        `SKU ${s.CODIGO_PRODUTO} (${s.NM_DONO}) concentra ${pct}% do valor (${s.QTD_SALDO} × R$ ${s.VLR_UNITARIO}). Confira UM da conferência vs qCom da NF.`
      );
    }
  }

  return {
    linhas,
    resumo: {
      valorTotal,
      qtdSkus,
      qtdSkusSemPreco,
      qtdUnidadesSemPreco,
      metodoValor: METODO_VALOR,
      geradoEm: new Date().toISOString(),
    },
    porDono: porDonoArr,
    avisos,
  };
}

async function gravarSnapshotDiario(tenantId, cdDono, dtReferencia, client, opts) {
  const db = client || pool;
  opts = opts || {};
  const asOf = parseDataIso(opts.asOfDate) || parseDataIso(dtReferencia) || hojeIsoTz();
  const calc = await calcularPosicaoValorizada(tenantId, cdDono, { dtAte: asOf });
  const agg =
    calc.porDono.find((d) => Number(d.CD_DONO) === Number(cdDono)) ||
    calc.porDono[0] || {
      valorTotal: calc.resumo.valorTotal,
      qtdSkus: calc.resumo.qtdSkus,
      qtdSkusSemPreco: calc.resumo.qtdSkusSemPreco,
      qtdUnidadesSemPreco: calc.resumo.qtdUnidadesSemPreco,
      PCT_COBRANCA_ESTOQUE: null,
    };

  const pct = agg.PCT_COBRANCA_ESTOQUE;
  const valorTotal = round2(agg.valorTotal != null ? agg.valorTotal : calc.resumo.valorTotal);
  const valorCob = cobrancaSobreValor(valorTotal, pct);

  await db.query(
    `INSERT INTO "WMS_ESTOQUE_SNAPSHOT_DIARIO"
      ("TENANT_ID", "CD_DONO", "DT_REFERENCIA", "VALOR_TOTAL", "QTD_SKUS", "QTD_SKUS_SEM_PRECO",
       "QTD_UNIDADES_SEM_PRECO", "METODO_VALOR", "PCT_COBRANCA", "VALOR_COBRANCA_ESTIMADO")
     VALUES ($1, $2::integer, $3::date, $4::numeric, $5::integer, $6::integer, $7::numeric, $8, $9::numeric, $10::numeric)
     ON CONFLICT ("TENANT_ID", "CD_DONO", "DT_REFERENCIA")
     DO UPDATE SET
       "VALOR_TOTAL" = EXCLUDED."VALOR_TOTAL",
       "QTD_SKUS" = EXCLUDED."QTD_SKUS",
       "QTD_SKUS_SEM_PRECO" = EXCLUDED."QTD_SKUS_SEM_PRECO",
       "QTD_UNIDADES_SEM_PRECO" = EXCLUDED."QTD_UNIDADES_SEM_PRECO",
       "METODO_VALOR" = EXCLUDED."METODO_VALOR",
       "PCT_COBRANCA" = EXCLUDED."PCT_COBRANCA",
       "VALOR_COBRANCA_ESTIMADO" = EXCLUDED."VALOR_COBRANCA_ESTIMADO",
       "DH_GERACAO" = CURRENT_TIMESTAMP`,
    [
      tenantId,
      cdDono,
      dtReferencia,
      valorTotal,
      agg.qtdSkus || 0,
      agg.qtdSkusSemPreco || 0,
      agg.qtdUnidadesSemPreco || 0,
      METODO_VALOR,
      Number.isFinite(pct) ? pct : null,
      valorCob,
    ]
  );
  return { cdDono, dtReferencia, valorTotal, valorCobrancaEstimado: valorCob };
}

async function listarDonosAtivos(tenantId, cdDonoOpt) {
  const params = [tenantId];
  let sql = `
    SELECT d."CD_DONO", d."NOME" AS "NM_DONO", d."PCT_COBRANCA_ESTOQUE"
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
  const r = await pool.query(sql, params);
  return r.rows || [];
}

async function executarSnapshotsTenant(tenantId, dtReferencia, opts) {
  const donos = await listarDonosAtivos(tenantId, null);
  const gravados = [];
  for (const d of donos) {
    try {
      const g = await gravarSnapshotDiario(tenantId, d.CD_DONO, dtReferencia, null, opts);
      gravados.push(g);
    } catch (e) {
      if (!schemaMissing(e)) throw e;
    }
  }
  return gravados;
}

/**
 * Grava snapshot diário para cada dia do período (saldo/preço «as-of» cada data).
 */
async function executarBackfillSnapshots(tenantId, dtIni, dtFim, cdDonoOpt) {
  const dias = listarDiasEntre(dtIni, dtFim);
  if (!dias.length) {
    return { dtIni, dtFim, diasProcessados: 0, snapshotsGravados: 0, gravados: [] };
  }
  let donos;
  if (cdDonoOpt != null && String(cdDonoOpt).trim() !== '') {
    const n = parseInt(cdDonoOpt, 10);
    if (!Number.isFinite(n)) throw new Error('CD_DONO inválido.');
    donos = [{ CD_DONO: n }];
  } else {
    donos = await listarDonosAtivos(tenantId, null);
  }
  const client = await pool.connect();
  const gravados = [];
  try {
    await client.query('BEGIN');
    for (const dt of dias) {
      for (const d of donos) {
        const g = await gravarSnapshotDiario(tenantId, d.CD_DONO, dt, client, { asOfDate: dt });
        gravados.push(g);
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return {
    dtIni,
    dtFim,
    diasProcessados: dias.length,
    snapshotsGravados: gravados.length,
    gravados,
  };
}

async function carregarSerieSnapshots(tenantId, cdDonoOpt, dtIni, dtFim) {
  const params = [tenantId, dtIni, dtFim];
  let donoClause = '';
  if (cdDonoOpt != null && String(cdDonoOpt).trim() !== '') {
    const n = parseInt(cdDonoOpt, 10);
    if (Number.isFinite(n)) {
      params.push(n);
      donoClause = ` AND s."CD_DONO" = $${params.length}::integer`;
    }
  }
  try {
    const r = await pool.query(
      `SELECT s."DT_REFERENCIA"::text AS "DT_REFERENCIA", s."CD_DONO", d."NOME" AS "NM_DONO",
              s."VALOR_TOTAL", s."VALOR_COBRANCA_ESTIMADO", s."PCT_COBRANCA",
              s."QTD_SKUS_SEM_PRECO"
         FROM "WMS_ESTOQUE_SNAPSHOT_DIARIO" s
         JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = s."CD_DONO" AND d."TENANT_ID" = s."TENANT_ID"
        WHERE s."TENANT_ID" = $1
          AND s."DT_REFERENCIA" >= $2::date
          AND s."DT_REFERENCIA" <= $3::date
          ${donoClause}
        ORDER BY s."DT_REFERENCIA", s."CD_DONO"`,
      params
    );
    return r.rows || [];
  } catch (e) {
    if (schemaMissing(e)) return [];
    throw e;
  }
}

function agregarPicos(serie, dtRef) {
  const hoje = dtRef || hojeIsoTz();
  const iniMes = inicioMes(hoje);
  const fim = fimMes(hoje);
  const diaMes = parseInt(hoje.slice(8, 10), 10);

  const noMes = serie.filter((r) => {
    const dt = isoDateFromDb(r.DT_REFERENCIA);
    return dt >= iniMes && dt <= fim;
  });

  const porDia = new Map();
  for (const row of noMes) {
    const dt = isoDateFromDb(row.DT_REFERENCIA);
    const v = Number(row.VALOR_TOTAL) || 0;
    porDia.set(dt, (porDia.get(dt) || 0) + v);
  }
  const dias = [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  let picoDiario = { dt: null, valor: 0 };
  for (const [dt, valor] of dias) {
    if (valor > picoDiario.valor) picoDiario = { dt, valor: round2(valor) };
  }

  const iniSemana = (() => {
    const d = new Date(hoje + 'T12:00:00');
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    return d.toISOString().slice(0, 10);
  })();

  let picoSemanal = { dtIni: iniSemana, dtFim: hoje, valor: 0 };
  for (const [dt, valor] of dias) {
    if (dt >= iniSemana && dt <= hoje && valor > picoSemanal.valor) {
      picoSemanal = { dtIni: iniSemana, dtFim: hoje, valor: round2(valor), dtPico: dt };
    }
  }

  const quinzena = diaMes <= 15 ? 1 : 2;
  const qIni = quinzena === 1 ? iniMes : `${hoje.slice(0, 7)}-16`;
  const qFim = quinzena === 1 ? `${hoje.slice(0, 7)}-15` : fim;
  let picoQuinzenal = { quinzena, dtIni: qIni, dtFim: qFim, valor: 0 };
  for (const [dt, valor] of dias) {
    if (dt >= qIni && dt <= qFim && valor > picoQuinzenal.valor) {
      picoQuinzenal = { quinzena, dtIni: qIni, dtFim: qFim, valor: round2(valor), dtPico: dt };
    }
  }

  let picoMensal = { dtIni: iniMes, dtFim: fim, valor: 0 };
  for (const [dt, valor] of dias) {
    if (valor > picoMensal.valor) {
      picoMensal = { dtIni: iniMes, dtFim: fim, valor: round2(valor), dtPico: dt };
    }
  }

  const serieDiaria = dias.map(([dt, valor]) => ({
    dt,
    valor: round2(valor),
  }));

  return {
    picoDiario,
    picoSemanal,
    picoQuinzenal,
    picoMensal,
    serieDiaria,
    diasComSnapshot: dias.length,
  };
}

/**
 * Dashboard consolidado: valor hoje + histórico de snapshots + picos.
 */
async function obterDashboardValorEstoque(tenantId, opts) {
  opts = opts || {};
  const cdDonoOpt = opts.cdDono;
  const dtRef = parseDataIso(opts.dataRef) || hojeIsoTz();
  const dtIniHist = parseDataIso(opts.dataIni) || inicioMes(dtRef);
  const dtFimHist = parseDataIso(opts.dataFim) || dtRef;

  const [atual, serie, donos] = await Promise.all([
    calcularPosicaoValorizada(tenantId, cdDonoOpt),
    carregarSerieSnapshots(tenantId, cdDonoOpt, dtIniHist, dtFimHist),
    listarDonosAtivos(tenantId, cdDonoOpt),
  ]);

  const picos = agregarPicos(serie, dtRef);

  const valorHoje = cdDonoOpt
    ? round2((atual.porDono[0] && atual.porDono[0].valorTotal) || atual.resumo.valorTotal)
    : round2(atual.resumo.valorTotal);

  let pctCobranca = null;
  let cobrancaHoje = 0;
  if (cdDonoOpt && atual.porDono[0]) {
    pctCobranca = atual.porDono[0].PCT_COBRANCA_ESTOQUE;
    cobrancaHoje = atual.porDono[0].valorCobrancaEstimado || 0;
  } else {
    cobrancaHoje = round2(
      atual.porDono.reduce((s, d) => s + (Number(d.valorCobrancaEstimado) || 0), 0)
    );
  }

  const picoMensalPorDono = [];
  let cobrancaPicoMensal = 0;
  const iniMes = inicioMes(dtRef);
  const fim = fimMes(dtRef);
  for (const d of donos) {
    const cd = Number(d.CD_DONO);
    const rowsDono = serie.filter((r) => {
      const dt = isoDateFromDb(r.DT_REFERENCIA);
      return Number(r.CD_DONO) === cd && dt >= iniMes && dt <= fim;
    });
    let maxV = 0;
    let dtPico = null;
    for (const row of rowsDono) {
      const v = Number(row.VALOR_TOTAL) || 0;
      if (v > maxV) {
        maxV = v;
        dtPico = isoDateFromDb(row.DT_REFERENCIA);
      }
    }
    const pct = toNumber(d.PCT_COBRANCA_ESTOQUE);
    const cob = cobrancaSobreValor(maxV, pct);
    cobrancaPicoMensal = round2(cobrancaPicoMensal + cob);
    picoMensalPorDono.push({
      CD_DONO: cd,
      NM_DONO: d.NM_DONO,
      PCT_COBRANCA_ESTOQUE: pct,
      picoValor: round2(maxV),
      dtPico,
      cobrancaEstimada: cob,
    });
  }

  const avisos = [...(atual.avisos || AVISOS_PADRAO)];
  if (!serie.length) {
    avisos.push(
      'Ainda não há snapshots diários gravados neste mês. Use «Gerar snapshots do mês» (backfill desde 18/05) ou «Gerar snapshot hoje».'
    );
  }
  if (atual.resumo.qtdSkusSemPreco > 0) {
    avisos.push(
      `${atual.resumo.qtdSkusSemPreco} SKU(s) com saldo positivo sem preço — valor total pode estar subestimado.`
    );
    avisos.push(
      'Sem NF de entrada: informe Valor referência (R$) em Cadastros WMS → Produto, ou exporte a lista «sem preço» para tratar em lote.'
    );
  }

  return {
    dataRef: dtRef,
    periodoHistorico: { dtIni: dtIniHist, dtFim: dtFimHist },
    valorHoje,
    pctCobranca,
    cobrancaHojeEstimada: cobrancaHoje,
    cobrancaPicoMensalEstimada: cobrancaPicoMensal,
    picoMensalPorDono,
    resumoHoje: atual.resumo,
    porDonoHoje: atual.porDono,
    picos,
    serieSnapshots: serie.map((r) => ({
      dt: isoDateFromDb(r.DT_REFERENCIA),
      cdDono: r.CD_DONO,
      nmDono: r.NM_DONO,
      valor: round2(r.VALOR_TOTAL),
      valorCobranca: round2(r.VALOR_COBRANCA_ESTIMADO),
      pctCobranca: r.PCT_COBRANCA != null ? Number(r.PCT_COBRANCA) : null,
      qtdSkusSemPreco: Number(r.QTD_SKUS_SEM_PRECO) || 0,
    })),
    avisos,
    geradoEm: new Date().toISOString(),
  };
}

function normValorImport(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return Number(n.toFixed(4));
}

function parseCsvLineSemicolon(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ';') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** CSV exportado pelo módulo (separador ;, BOM opcional). */
function parseCsvValorReferencia(text) {
  const raw = String(text || '').replace(/^\uFEFF/, '');
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const header = parseCsvLineSemicolon(lines[0]).map((h) => String(h).trim().toUpperCase());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLineSemicolon(lines[i]);
    const obj = {};
    header.forEach((h, j) => {
      obj[h] = cols[j] != null ? String(cols[j]).trim() : '';
    });
    rows.push(obj);
  }
  return rows;
}

function linhasPlanilhaParaImportValorReferencia(rows) {
  const out = [];
  for (const r of rows || []) {
    const norm = {};
    for (const [k, v] of Object.entries(r)) {
      norm[String(k).trim().toUpperCase()] = v;
    }
    const cdDono = parseInt(norm.CD_DONO, 10);
    const cdProduto = parseInt(norm.CD_PRODUTO, 10);
    const codigo = String(norm.CODIGO_PRODUTO || norm.CODIGO || '').trim();
    const valor = normValorImport(
      norm.VALOR_REFERENCIA ?? norm.VLR_UNITARIO ?? norm.VALOR ?? norm.PRECO ?? norm.PRECO_UNITARIO
    );
    if (!Number.isFinite(cdDono) || valor == null) continue;
    if (!Number.isFinite(cdProduto) && !codigo) continue;
    out.push({
      cdDono,
      cdProduto: Number.isFinite(cdProduto) ? cdProduto : null,
      codigo,
      valor,
    });
  }
  return out;
}

function carregarLinhasArquivoValorReferencia(arquivoPath) {
  const path = require('path');
  const fs = require('fs');
  const ext = path.extname(arquivoPath).toLowerCase();
  if (ext === '.csv' || ext === '.txt') {
    return parseCsvValorReferencia(fs.readFileSync(arquivoPath, 'utf8'));
  }
  if (ext === '.xlsx' || ext === '.xls') {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(path.resolve(arquivoPath));
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  }
  throw new Error('Formato não suportado. Use .csv ou .xlsx');
}

/**
 * Atualiza VALOR_REFERENCIA em WMS_PRODUTO_DONO (match CD_DONO + CD_PRODUTO ou código).
 */
async function aplicarImportValorReferencia(tenantId, linhasImport, { dryRun = false } = {}) {
  const linhas = linhasImport || [];
  const client = await pool.connect();
  let atualizados = 0;
  let semProduto = 0;
  const amostra = [];

  try {
    await client.query('BEGIN');
    for (const ln of linhas) {
      let res;
      if (ln.cdProduto != null) {
        res = await client.query(
          `UPDATE "WMS_PRODUTO_DONO" p
              SET "VALOR_REFERENCIA" = $4::numeric,
                  "DH_MAINTENANCE" = CURRENT_TIMESTAMP
            WHERE p."TENANT_ID" = $1
              AND p."CD_DONO" = $2::integer
              AND p."CD_PRODUTO" = $3::integer
              AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
            RETURNING p."CD_PRODUTO", p."CODIGO", p."VALOR_REFERENCIA"`,
          [tenantId, ln.cdDono, ln.cdProduto, ln.valor]
        );
      } else {
        const d = String(ln.codigo).replace(/\D/g, '');
        if (!d) {
          semProduto++;
          continue;
        }
        res = await client.query(
          `UPDATE "WMS_PRODUTO_DONO" p
              SET "VALOR_REFERENCIA" = $4::numeric,
                  "DH_MAINTENANCE" = CURRENT_TIMESTAMP
            WHERE p."TENANT_ID" = $1
              AND p."CD_DONO" = $2::integer
              AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
              AND regexp_replace(trim(p."CODIGO"), '[^0-9]', '', 'g') = $3
            RETURNING p."CD_PRODUTO", p."CODIGO", p."VALOR_REFERENCIA"`,
          [tenantId, ln.cdDono, d, ln.valor]
        );
      }
      if (res.rowCount) {
        atualizados += res.rowCount;
        if (amostra.length < 8) {
          amostra.push({
            cdDono: ln.cdDono,
            cdProduto: res.rows[0].CD_PRODUTO,
            codigo: res.rows[0].CODIGO,
            valor: Number(res.rows[0].VALOR_REFERENCIA),
          });
        }
      } else {
        semProduto++;
      }
    }
    if (dryRun) await client.query('ROLLBACK');
    else await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return {
    linhasComValor: linhas.length,
    atualizados,
    semProduto,
    amostra,
    dryRun: !!dryRun,
  };
}

function resolverPrecoSku(precoMap, produto) {
  const k = `${produto.CD_DONO}|${produto.CD_PRODUTO}`;
  const info = precoMap.get(k);
  let vUnit = info ? info.vUnit : NaN;
  if (!Number.isFinite(vUnit) || vUnit <= 0) {
    const vr = toNumber(produto.VALOR_REFERENCIA);
    if (Number.isFinite(vr) && vr > 0) vUnit = vr;
  }
  return vUnit;
}

/**
 * Compara valor total com fórmula antiga (vUnCom) vs nova (vProd/qtdConvertida).
 * topInfladores = SKUs que mais caíram (estavam superestimados).
 */
async function auditarAjustePrecoUm(tenantId, cdDonoOpt) {
  const [saldoMap, precoNovo, precoAntigo, produtos] = await Promise.all([
    obterSaldoPorProdutoMap(tenantId, cdDonoOpt, null, null),
    obterUltimoPrecoEntradaMap(tenantId, cdDonoOpt, null, null, { metodoPreco: 'LEDGER' }),
    obterUltimoPrecoEntradaMap(tenantId, cdDonoOpt, null, null, { metodoPreco: 'VUNCOM' }),
    carregarMetaProdutos(tenantId, cdDonoOpt),
  ]);

  let totalAntigo = 0;
  let totalNovo = 0;
  const comparacoes = [];

  for (const p of produtos) {
    const cdDono = Number(p.CD_DONO);
    const cd = Number(p.CD_PRODUTO);
    const k = `${cdDono}|${cd}`;
    const saldo = saldoMap.has(k) ? Number(saldoMap.get(k)) || 0 : 0;
    if (saldo <= 1e-9) continue;

    const vAntigo = resolverPrecoSku(precoAntigo, p);
    const vNovo = resolverPrecoSku(precoNovo, p);
    const temAntigo = Number.isFinite(vAntigo) && vAntigo > 0;
    const temNovo = Number.isFinite(vNovo) && vNovo > 0;
    const valorAntigo = temAntigo ? round2(saldo * vAntigo) : 0;
    const valorNovo = temNovo ? round2(saldo * vNovo) : 0;
    totalAntigo = round2(totalAntigo + valorAntigo);
    totalNovo = round2(totalNovo + valorNovo);

    if (Math.abs(valorAntigo - valorNovo) < 0.01) continue;

    const mask = String(p.MASCARA_CODIGO_PRODUTO || '').trim();
    const cod = String(p.CODIGO || '').trim();
    const codExib = mask && cod ? applyProductMask(cod, mask) : cod;
    const delta = round2(valorNovo - valorAntigo);
    const pct = valorAntigo > 0 ? round2((delta / valorAntigo) * 100) : valorNovo > 0 ? 100 : 0;

    comparacoes.push({
      CD_DONO: cdDono,
      NM_DONO: p.NM_DONO || '',
      CD_PRODUTO: cd,
      CODIGO_PRODUTO: codExib,
      NM_PRODUTO: p.NOME || '',
      QTD_SALDO: round4(saldo),
      VLR_UNIT_ANTIGO: temAntigo ? round4(vAntigo) : null,
      VLR_UNIT_NOVO: temNovo ? round4(vNovo) : null,
      VALOR_ANTIGO: valorAntigo,
      VALOR_NOVO: valorNovo,
      DELTA_VALOR: delta,
      PCT_VARIACAO: pct,
    });
  }

  comparacoes.sort((a, b) => b.VALOR_ANTIGO - b.VALOR_NOVO - (a.VALOR_ANTIGO - a.VALOR_NOVO));

  const topInfladores = comparacoes.filter((r) => r.VALOR_ANTIGO > r.VALOR_NOVO).slice(0, 40);
  const topSubestimados = comparacoes
    .filter((r) => r.VALOR_NOVO > r.VALOR_ANTIGO)
    .sort((a, b) => b.DELTA_VALOR - a.DELTA_VALOR)
    .slice(0, 40);

  const deltaTotal = round2(totalNovo - totalAntigo);
  const pctTotal = totalAntigo > 0 ? round2((deltaTotal / totalAntigo) * 100) : 0;

  return {
    metodoNovo: METODO_VALOR,
    metodoAntigo: 'VUNCOM_XML',
    resumo: {
      valorTotalAntigo: totalAntigo,
      valorTotalNovo: totalNovo,
      deltaValor: deltaTotal,
      pctVariacao: pctTotal,
      qtdSkusComparados: comparacoes.length,
    },
    topInfladores,
    topSubestimados,
    geradoEm: new Date().toISOString(),
  };
}

function linhasAuditoriaUmParaCsv(linhas) {
  const cols = [
    'CD_DONO',
    'NM_DONO',
    'CODIGO_PRODUTO',
    'NM_PRODUTO',
    'QTD_SALDO',
    'VLR_UNIT_ANTIGO',
    'VLR_UNIT_NOVO',
    'VALOR_ANTIGO',
    'VALOR_NOVO',
    'DELTA_VALOR',
    'PCT_VARIACAO',
  ];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = cols.join(';');
  const body = (linhas || []).map((row) => cols.map((c) => esc(row[c])).join(';')).join('\n');
  return `\ufeff${head}\n${body}`;
}

function linhasPosicaoParaCsv(linhas) {
  const cols = [
    'CD_DONO',
    'NM_DONO',
    'CD_PRODUTO',
    'CODIGO_PRODUTO',
    'NM_PRODUTO',
    'QTD_SALDO',
    'VLR_UNITARIO',
    'FONTE_PRECO',
    'VALOR_ESTOQUE',
  ];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = cols.join(';');
  const body = (linhas || []).map((row) => cols.map((c) => esc(row[c])).join(';')).join('\n');
  return `\ufeff${head}\n${body}`;
}

module.exports = {
  AVISOS_PADRAO,
  METODO_VALOR,
  WMS_VALOR_DT_INICIO,
  calcularPosicaoValorizada,
  obterDashboardValorEstoque,
  executarSnapshotsTenant,
  executarBackfillSnapshots,
  gravarSnapshotDiario,
  resolverPeriodoBackfill,
  listarDiasEntre,
  linhasPosicaoParaCsv,
  parseCsvValorReferencia,
  linhasPlanilhaParaImportValorReferencia,
  carregarLinhasArquivoValorReferencia,
  aplicarImportValorReferencia,
  obterUltimoPrecoEntradaMap,
  auditarAjustePrecoUm,
  linhasAuditoriaUmParaCsv,
  hojeIsoTz,
  isoDateFromDb,
  carregarSerieSnapshots,
  cobrancaSobreValor,
};
