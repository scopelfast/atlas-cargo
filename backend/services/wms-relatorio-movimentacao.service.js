'use strict';

const { pool } = require('../config/db');
const { applyProductMask } = require('./wms-relatorio-posicao-estoque.service');
const {
  enriquecerLinhasMovimentacao,
  somarPorChave,
  diaAnteriorIso,
  normalizarOrdemMovimentacao,
  montarRotuloFiltroOrdem,
  ordenarLinhasMovimentacaoRelatorio,
  recalcularSaldoNaOrdemExibida,
} = require('./wms-relatorio-movimentacao-enriquecimento.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

/** Cache de colunas opcionais em WMS_NFE_ENTRADA (reiniciar o app após migration). */
let __cacheColsNfeEntrada = null;
async function colsNfeEntradaMov() {
  if (__cacheColsNfeEntrada != null) return __cacheColsNfeEntrada;
  try {
    const r = await pool.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'WMS_NFE_ENTRADA'
          AND column_name IN ('DT_RECEBIMENTO', 'DH_PRIMEIRO_ENCERRAMENTO')`
    );
    const set = new Set((r.rows || []).map((row) => String(row.column_name || '')));
    __cacheColsNfeEntrada = {
      dtReceb: set.has('DT_RECEBIMENTO'),
      dhPrimEnc: set.has('DH_PRIMEIRO_ENCERRAMENTO'),
    };
  } catch (_) {
    __cacheColsNfeEntrada = { dtReceb: false, dhPrimEnc: false };
  }
  return __cacheColsNfeEntrada;
}

/** Expressão SQL da data oficial de entrada no estoque (NF encerrada). */
async function exprDhEntradaEstoque(alias = 'e') {
  const cols = await colsNfeEntradaMov();
  const a = alias ? `${alias}.` : '';
  const parts = [];
  if (cols.dtReceb) parts.push(`${a}"DT_RECEBIMENTO"::timestamptz`);
  if (cols.dhPrimEnc) parts.push(`${a}"DH_PRIMEIRO_ENCERRAMENTO"`);
  parts.push(`${a}"DH_ENCERRAMENTO"`, `${a}"DH_CONFERENCIA"`, `${a}"DH_IMPORTACAO"`);
  return `COALESCE(${parts.join(', ')})`;
}

const AVISOS_PADRAO = [
  'Movimentações de entrada derivadas de NF-e encerradas (linhas da conferência com cdProduto e qtdConvertida > 0).',
  'Movimentações de saída/ajuste vêm de WMS_MOVIMENTO_ESTOQUE (ex.: EXPEDICAO_SAIDA na confirmação da expedição).',
  'Saídas de expedição são detalhadas por NF-e da carga (quantidade de cada nota em LINHAS_JSON); coluna Operação WMS mantém a carga.',
  'Cada confirmação de saída após reabertura gera novo movimento no ledger (chave sequencial N1, N2…).',
  'Coluna Saldo em estoque: acumulado cronológico por produto; com data inicial no filtro, a primeira linha é posição inicial.',
  'Filtro de período aplica-se à data/hora do movimento (encerramento da NF ou DH_REGISTRO do ledger).',
  'Ordenação «Número da NF» agrupa por produto e lista as notas em ordem crescente; o saldo segue a sequência exibida.',
  'Coluna Seq. item: número da linha na NF-e (conferência). Útil quando dois itens distintos do XML mapeiam ao mesmo produto dono.',
];

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

function formatDataBrIso(iso) {
  const [y, m, d] = String(iso).split('-');
  return `${d}/${m}/${y}`;
}

/** Rótulo legível do período (dtDe/dtAte) para cabeçalho dos relatórios. */
function montarRotuloFiltroPeriodo(filtros) {
  const dtDe = parseDataIso(filtros?.dtDe);
  const dtAte = parseDataIso(filtros?.dtAte);
  if (!dtDe && !dtAte) return '';
  if (dtDe && dtAte) {
    if (dtDe === dtAte) return formatDataBrIso(dtDe);
    return `${formatDataBrIso(dtDe)} a ${formatDataBrIso(dtAte)}`;
  }
  if (dtDe) return `a partir de ${formatDataBrIso(dtDe)}`;
  return `até ${formatDataBrIso(dtAte)}`;
}

/** Normaliza o filtro de sentido do movimento. Aceita 'entrada' | 'saida' | qualquer
 *  outra coisa (= todos). Mantemos a comparação por SINAL DA QUANTIDADE (positiva =
 *  entrada, negativa = saída) ao invés de listar tipos específicos, para que
 *  ajustes manuais positivos no ledger também caiam em "entradas" naturalmente. */
function normalizarSentido(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'entrada' || s === 'entradas' || s === 'in') return 'entrada';
  if (s === 'saida' || s === 'saída' || s === 'saidas' || s === 'out') return 'saida';
  return '';
}

/** Rótulo legível do sentido para cabeçalho dos relatórios. */
function montarRotuloFiltroSentido(filtros) {
  const s = normalizarSentido(filtros?.sentido);
  if (s === 'entrada') return 'Entradas';
  if (s === 'saida') return 'Saídas';
  return '';
}

/** Limite de segurança do SELECT. Com ORDER BY data ASC, linhas além deste teto
 *  (mais recentes) sumiam da tela se o filtro de produto fosse só no JS depois. */
const LIMITE_LINHAS_MOVIMENTACAO = 15000;

/**
 * Cláusulas SQL sobre alias `p` (WMS_PRODUTO_DONO) para filtrar ANTES do LIMIT.
 * Empurra código/descrição/conservação para o banco — evita cortar saídas recentes
 * quando o dono tem >15k movimentos e o usuário filtra um SKU.
 * @param {object} filtros
 * @param {any[]} params
 * @returns {string[]}
 */
function montarClausulasProdutoSql(filtros, params) {
  const parts = [];
  const cod = String(filtros?.codigoProduto || '').trim();
  const desc = String(filtros?.descricaoProduto || '').trim();
  const cons = Array.isArray(filtros?.conservacao)
    ? filtros.conservacao.filter(Boolean)
    : [];

  if (cod) {
    const codN = cod.toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (codN) {
      params.push(codN);
      parts.push(
        `regexp_replace(UPPER(COALESCE(p."CODIGO", '')), '[^0-9A-Z]', '', 'g') LIKE '%' || $${params.length} || '%'`
      );
    }
  }
  if (desc) {
    params.push(desc.toLowerCase());
    parts.push(`LOWER(COALESCE(p."NOME", '')) LIKE '%' || $${params.length} || '%'`);
  }
  if (cons.length) {
    const ors = [];
    for (const c of cons) {
      const u = String(c).toUpperCase();
      if (u === 'SECO') {
        ors.push(
          `UPPER(TRIM(COALESCE(p."TIPO_ARMAZENAGEM", ''))) IN ('SECO', 'SECO_AMB', 'AMBIENTE')`
        );
      } else if (u === 'REFRIGERADO') {
        ors.push(
          `UPPER(TRIM(COALESCE(p."TIPO_ARMAZENAGEM", ''))) IN ('REFRIGERADO', 'RESFRIADO')`
        );
      } else if (u === 'CONGELADO') {
        ors.push(`UPPER(TRIM(COALESCE(p."TIPO_ARMAZENAGEM", ''))) = 'CONGELADO'`);
      } else if (u === 'OUTRO') {
        ors.push(
          `(p."TIPO_ARMAZENAGEM" IS NULL OR TRIM(COALESCE(p."TIPO_ARMAZENAGEM", '')) = '' OR UPPER(TRIM(p."TIPO_ARMAZENAGEM")) NOT IN ('SECO', 'SECO_AMB', 'AMBIENTE', 'REFRIGERADO', 'RESFRIADO', 'CONGELADO'))`
        );
      }
    }
    if (ors.length) parts.push(`(${ors.join(' OR ')})`);
  }
  return parts;
}

function montarWhereUni(sentido, clausulasProduto) {
  const parts = [];
  if (sentido === 'entrada') parts.push('u.qtd > 0');
  else if (sentido === 'saida') parts.push('u.qtd < 0');
  for (const c of clausulasProduto || []) parts.push(c);
  if (!parts.length) return '';
  return `WHERE ${parts.join(' AND ')}`;
}

/**
 * @param {string} tenantId
 * @param {{ cdDono?: string|number, dtDe?: string, dtAte?: string, sentido?: string, codigoProduto?: string, descricaoProduto?: string, conservacao?: string[] }} filtros
 * @param {{ comSaldoAcumulado?: boolean }} [optsInternos] — demonstrativo usa `comSaldoAcumulado: false`
 */
async function listarMovimentacaoItens(tenantId, filtros, optsInternos) {
  filtros = filtros || {};
  optsInternos = optsInternos || {};
  const params = [tenantId];
  /** Data oficial da entrada: DT_RECEBIMENTO (doca) → DH_PRIMEIRO_ENCERRAMENTO → demais. */
  const dhEntradaExpr = await exprDhEntradaEstoque('e');
  let donoClauseEnt = '';
  let donoClauseMov = '';
  if (filtros.cdDono != null && String(filtros.cdDono).trim() !== '') {
    const n = parseInt(filtros.cdDono, 10);
    if (Number.isFinite(n)) {
      params.push(n);
      donoClauseEnt = ` AND e."CD_DONO" = $${params.length}::integer`;
      donoClauseMov = ` AND m."CD_DONO" = $${params.length}::integer`;
    }
  }
  const dtDe = parseDataIso(filtros.dtDe);
  const dtAte = parseDataIso(filtros.dtAte);
  let dtClauseEnt = '';
  let dtClauseMov = '';
  if (dtDe) {
    params.push(dtDe);
    dtClauseEnt += ` AND ${dhEntradaExpr}::date >= $${params.length}::date`;
    dtClauseMov += ` AND m."DH_REGISTRO"::date >= $${params.length}::date`;
  }
  if (dtAte) {
    params.push(dtAte);
    dtClauseEnt += ` AND ${dhEntradaExpr}::date <= $${params.length}::date`;
    dtClauseMov += ` AND m."DH_REGISTRO"::date <= $${params.length}::date`;
  }
  /** Filtro por sentido aplicado no final via CTE `uni` (sobre o sinal da qtd).
   *  Quando o usuário escolhe "Entradas", optimizamos descartando inteiramente o
   *  ledger de movimento (que predominantemente carrega saídas), o que torna a
   *  query mais barata. Mesmo assim, ENT também filtra qtd>0 por consistência. */
  const sentido = normalizarSentido(filtros.sentido);
  const incluirEnt = sentido !== 'saida';
  const incluirMov = sentido !== 'entrada';
  const clausulasProduto = montarClausulasProdutoSql(filtros, params);
  const filtroWhereUni = montarWhereUni(sentido, clausulasProduto);

  /** Monta dinamicamente as CTEs `ent` e/ou `mov` conforme o filtro de sentido.
   *  Se `sentido === 'entrada'`, descarta inteiramente o ledger (mais barato).
   *  Se `sentido === 'saida'`, descarta inteiramente as NF-e de entrada. */
  const cteEnt = incluirEnt
    ? `ent AS (
        SELECT
          e."TENANT_ID",
          ${dhEntradaExpr} AS dh_mov,
          'ENTRADA_RECEBIMENTO'::text AS tp_movimento,
          e."CD_NFE" AS ref_cd_nfe,
          e."NUMERO_NF" AS numero_nf,
          e."SERIE" AS serie,
          NULL::integer AS ref_cd_carga,
          e."CD_DONO",
          CASE
            WHEN (elem->>'cdProduto') ~ '^[0-9]+$' THEN (elem->>'cdProduto')::integer
            ELSE NULL
          END AS cd_produto,
          NULLIF(TRIM(elem->>'lote'), '') AS lote,
          NULLIF(TRIM(elem->>'validade'), '') AS validade,
          NULLIF(TRIM(elem->>'nItem'), '') AS n_item,
          COALESCE(NULLIF(TRIM(elem->>'qtdConvertida'), ''), '0')::numeric AS qtd,
          NULL::bigint AS cd_movimento,
          NULL::text AS idempotency_key
        FROM "WMS_NFE_ENTRADA" e
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS elem
        WHERE e."TENANT_ID" = $1
          ${donoClauseEnt}
          AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) = 'ENCERRADA'
          AND e."CD_DONO" IS NOT NULL
          AND (elem->>'cdProduto') ~ '^[0-9]+$'
          ${dtClauseEnt}
      )`
    : '';
  const cteMov = incluirMov
    ? `mov AS (
        SELECT
          m."TENANT_ID",
          m."DH_REGISTRO" AS dh_mov,
          m."TP_MOVIMENTO" AS tp_movimento,
          NULL::integer AS ref_cd_nfe,
          NULL::text AS numero_nf,
          NULL::text AS serie,
          m."REF_CD_CARGA" AS ref_cd_carga,
          m."CD_DONO",
          m."CD_PRODUTO" AS cd_produto,
          NULL::text AS lote,
          NULL::text AS validade,
          NULL::text AS n_item,
          m."QTD" AS qtd,
          m."CD_MOVIMENTO" AS cd_movimento,
          m."IDEMPOTENCY_KEY" AS idempotency_key
        FROM "WMS_MOVIMENTO_ESTOQUE" m
        WHERE m."TENANT_ID" = $1
          ${donoClauseMov}
          ${dtClauseMov}
      )`
    : '';
  const partesCte = [cteEnt, cteMov].filter(Boolean);
  const partesUni = [];
  if (incluirEnt) partesUni.push('SELECT * FROM ent WHERE qtd IS NOT NULL AND qtd <> 0');
  if (incluirMov) partesUni.push('SELECT * FROM mov WHERE qtd IS NOT NULL AND qtd <> 0');

  const sql = `
    WITH ${partesCte.join(',\n    ')},
    uni AS (
      ${partesUni.join('\n      UNION ALL\n      ')}
    )
    SELECT
      u.dh_mov AS "DH_MOVIMENTO",
      u.tp_movimento AS "TP_MOVIMENTO",
      u.ref_cd_nfe AS "REF_CD_NFE",
      u.numero_nf AS "NUMERO_NF",
      u.serie AS "SERIE",
      u.ref_cd_carga AS "REF_CD_CARGA",
      u.cd_movimento AS "CD_MOVIMENTO",
      u.idempotency_key AS "IDEMPOTENCY_KEY",
      u."CD_DONO",
      d."NOME" AS "NM_DONO",
      d."MASCARA_CODIGO_PRODUTO",
      u.cd_produto AS "CD_PRODUTO",
      p."CODIGO" AS "CODIGO_PRODUTO_INTERNO",
      p."NOME" AS "NM_PRODUTO",
      u.lote AS "LOTE",
      u.validade AS "VALIDADE",
      u.n_item AS "N_ITEM",
      p."TIPO_ARMAZENAGEM" AS "TIPO_ARMAZENAGEM",
      u.qtd AS "QTD"
    FROM uni u
    JOIN "WMS_DONO_ESTOQUE" d
      ON d."CD_DONO" = u."CD_DONO" AND d."TENANT_ID" = u."TENANT_ID"
    LEFT JOIN "WMS_PRODUTO_DONO" p
      ON p."CD_PRODUTO" = u.cd_produto
     AND p."TENANT_ID" = u."TENANT_ID"
     AND p."CD_DONO" = u."CD_DONO"
    ${filtroWhereUni}
    ORDER BY u.dh_mov ASC, u."CD_DONO", u.cd_produto NULLS LAST, u.cd_movimento NULLS LAST
    LIMIT ${LIMITE_LINHAS_MOVIMENTACAO}
  `;

  try {
    const r = await pool.query(sql, params);
    const linhasBrutas = mapearLinhasMovimentacaoBrutas(r.rows || []);
    const avisos = [...AVISOS_PADRAO];
    if ((r.rows || []).length >= LIMITE_LINHAS_MOVIMENTACAO) {
      avisos.unshift(
        `ATENÇÃO: o relatório atingiu o limite de ${LIMITE_LINHAS_MOVIMENTACAO.toLocaleString('pt-BR')} linhas (ordem cronológica — as mais antigas). Movimentos mais recentes podem estar ausentes. Filtre por código/descrição do produto e/ou período para ver o histórico completo.`
      );
    }

    let saldoInicialPorChave = null;
    if (dtDe) {
      const paramsAntes = [tenantId];
      let donoClauseEntA = '';
      let donoClauseMovA = '';
      if (filtros.cdDono != null && String(filtros.cdDono).trim() !== '') {
        const n = parseInt(filtros.cdDono, 10);
        if (Number.isFinite(n)) {
          paramsAntes.push(n);
          donoClauseEntA = ` AND e."CD_DONO" = $${paramsAntes.length}::integer`;
          donoClauseMovA = ` AND m."CD_DONO" = $${paramsAntes.length}::integer`;
        }
      }
      const dtAteAntes = diaAnteriorIso(dtDe);
      paramsAntes.push(dtAteAntes);
      const pAte = paramsAntes.length;
      const dtClauseEntA = ` AND ${dhEntradaExpr}::date <= $${pAte}::date`;
      const dtClauseMovA = ` AND m."DH_REGISTRO"::date <= $${pAte}::date`;
      const clausulasProdutoA = montarClausulasProdutoSql(filtros, paramsAntes);
      const filtroWhereUniA = montarWhereUni(sentido, clausulasProdutoA);

      const cteEntA = incluirEnt
        ? `ent AS (
        SELECT
          e."TENANT_ID",
          ${dhEntradaExpr} AS dh_mov,
          'ENTRADA_RECEBIMENTO'::text AS tp_movimento,
          e."CD_NFE" AS ref_cd_nfe,
          e."NUMERO_NF" AS numero_nf,
          e."SERIE" AS serie,
          NULL::integer AS ref_cd_carga,
          e."CD_DONO",
          CASE
            WHEN (elem->>'cdProduto') ~ '^[0-9]+$' THEN (elem->>'cdProduto')::integer
            ELSE NULL
          END AS cd_produto,
          NULLIF(TRIM(elem->>'lote'), '') AS lote,
          NULLIF(TRIM(elem->>'validade'), '') AS validade,
          NULLIF(TRIM(elem->>'nItem'), '') AS n_item,
          COALESCE(NULLIF(TRIM(elem->>'qtdConvertida'), ''), '0')::numeric AS qtd,
          NULL::bigint AS cd_movimento,
          NULL::text AS idempotency_key
        FROM "WMS_NFE_ENTRADA" e
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS elem
        WHERE e."TENANT_ID" = $1
          ${donoClauseEntA}
          AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) = 'ENCERRADA'
          AND e."CD_DONO" IS NOT NULL
          AND (elem->>'cdProduto') ~ '^[0-9]+$'
          ${dtClauseEntA}
      )`
        : '';
      const cteMovA = incluirMov
        ? `mov AS (
        SELECT
          m."TENANT_ID",
          m."DH_REGISTRO" AS dh_mov,
          m."TP_MOVIMENTO" AS tp_movimento,
          NULL::integer AS ref_cd_nfe,
          NULL::text AS numero_nf,
          NULL::text AS serie,
          m."REF_CD_CARGA" AS ref_cd_carga,
          m."CD_DONO",
          m."CD_PRODUTO" AS cd_produto,
          NULL::text AS lote,
          NULL::text AS validade,
          NULL::text AS n_item,
          m."QTD" AS qtd,
          m."CD_MOVIMENTO" AS cd_movimento,
          m."IDEMPOTENCY_KEY" AS idempotency_key
        FROM "WMS_MOVIMENTO_ESTOQUE" m
        WHERE m."TENANT_ID" = $1
          ${donoClauseMovA}
          ${dtClauseMovA}
      )`
        : '';
      const partesCteA = [cteEntA, cteMovA].filter(Boolean);
      const partesUniA = [];
      if (incluirEnt) partesUniA.push('SELECT * FROM ent WHERE qtd IS NOT NULL AND qtd <> 0');
      if (incluirMov) partesUniA.push('SELECT * FROM mov WHERE qtd IS NOT NULL AND qtd <> 0');
      if (partesUniA.length) {
        const sqlAntes = `
    WITH ${partesCteA.join(',\n    ')},
    uni AS (
      ${partesUniA.join('\n      UNION ALL\n      ')}
    )
    SELECT
      u.dh_mov AS "DH_MOVIMENTO",
      u.tp_movimento AS "TP_MOVIMENTO",
      u.ref_cd_nfe AS "REF_CD_NFE",
      u.numero_nf AS "NUMERO_NF",
      u.serie AS "SERIE",
      u.ref_cd_carga AS "REF_CD_CARGA",
      u.cd_movimento AS "CD_MOVIMENTO",
      u.idempotency_key AS "IDEMPOTENCY_KEY",
      u."CD_DONO",
      d."NOME" AS "NM_DONO",
      d."MASCARA_CODIGO_PRODUTO",
      u.cd_produto AS "CD_PRODUTO",
      p."CODIGO" AS "CODIGO_PRODUTO_INTERNO",
      p."NOME" AS "NM_PRODUTO",
      u.lote AS "LOTE",
      u.validade AS "VALIDADE",
      u.n_item AS "N_ITEM",
      p."TIPO_ARMAZENAGEM" AS "TIPO_ARMAZENAGEM",
      u.qtd AS "QTD"
    FROM uni u
    JOIN "WMS_DONO_ESTOQUE" d
      ON d."CD_DONO" = u."CD_DONO" AND d."TENANT_ID" = u."TENANT_ID"
    LEFT JOIN "WMS_PRODUTO_DONO" p
      ON p."CD_PRODUTO" = u.cd_produto
     AND p."TENANT_ID" = u."TENANT_ID"
     AND p."CD_DONO" = u."CD_DONO"
    ${filtroWhereUniA}
    ORDER BY u.dh_mov ASC
    LIMIT ${LIMITE_LINHAS_MOVIMENTACAO}
  `;
        const rAntes = await pool.query(sqlAntes, paramsAntes);
        const antesBrutas = mapearLinhasMovimentacaoBrutas(rAntes.rows || []);
        const antesEnr = await enriquecerLinhasMovimentacao(tenantId, antesBrutas, {
          dtDe: null,
          comSaldoAcumulado: false,
        });
        saldoInicialPorChave = somarPorChave(antesEnr);
      }
    }

    let linhas = await enriquecerLinhasMovimentacao(tenantId, linhasBrutas, {
      dtDe,
      saldoInicialPorChave,
      comSaldoAcumulado: optsInternos.comSaldoAcumulado !== false,
    });

    const ordem = normalizarOrdemMovimentacao(filtros.ordem);
    if (ordem !== 'data') {
      const semSaldo = linhas.filter((r) => !r.FG_SALDO_INICIAL);
      const ordenadas = ordenarLinhasMovimentacaoRelatorio(semSaldo, ordem);
      if (optsInternos.comSaldoAcumulado !== false) {
        linhas = recalcularSaldoNaOrdemExibida(ordenadas, saldoInicialPorChave, !!dtDe);
      } else {
        linhas = ordenadas;
      }
    }

    return { linhas, avisos };
  } catch (e) {
    if (schemaMissing(e)) {
      const err = new Error(
        'Estrutura WMS incompleta para movimentação. Execute scripts de NF entrada, produto dono e movimento de estoque.'
      );
      err.code = 'SCHEMA';
      throw err;
    }
    throw e;
  }
}

function mapearLinhasMovimentacaoBrutas(rows) {
  return (rows || []).map((row) => {
    const codInterno = String(row.CODIGO_PRODUTO_INTERNO || '').trim();
    const mask = String(row.MASCARA_CODIGO_PRODUTO || '').trim();
    const qtd = Number(row.QTD) || 0;
    return {
      DH_MOVIMENTO: row.DH_MOVIMENTO,
      TP_MOVIMENTO: row.TP_MOVIMENTO,
      REF_CD_NFE: row.REF_CD_NFE,
      NUMERO_NF: row.NUMERO_NF,
      SERIE: row.SERIE,
      REF_CD_CARGA: row.REF_CD_CARGA,
      CD_MOVIMENTO: row.CD_MOVIMENTO,
      IDEMPOTENCY_KEY: row.IDEMPOTENCY_KEY,
      CD_DONO: row.CD_DONO,
      NM_DONO: row.NM_DONO,
      CD_PRODUTO: row.CD_PRODUTO,
      CODIGO_PRODUTO: mask && codInterno ? applyProductMask(codInterno, mask) : codInterno,
      NM_PRODUTO: row.NM_PRODUTO || '',
      TIPO_ARMAZENAGEM: row.TIPO_ARMAZENAGEM || '',
      LOTE: row.LOTE || '',
      VALIDADE: row.VALIDADE || '',
      N_ITEM: row.N_ITEM != null ? String(row.N_ITEM).trim() : '',
      QTD: Number(qtd.toFixed(6)),
      SENTIDO: qtd >= 0 ? 'ENTRADA' : 'SAIDA',
    };
  });
}

function linhasParaCsv(rows) {
  const cols = [
    'DH_MOVIMENTO',
    'TIPO_LEGIVEL',
    'DOCUMENTO',
    'SENTIDO',
    'QTD',
    'QTD_SALDO',
    'CD_DONO',
    'NM_DONO',
    'CD_PRODUTO',
    'CODIGO_PRODUTO',
    'NM_PRODUTO',
    'TIPO_ARMAZENAGEM',
    'LOTE',
    'VALIDADE',
    'TP_MOVIMENTO',
    'REF_OPERACAO',
    'NUMERO_NF',
    'SERIE',
    'N_ITEM',
    'REF_CD_NFE',
    'REF_CD_CARGA',
    'REF_CD_INVENTARIO',
    'REF_CD_TRANSFERENCIA',
    'CD_MOVIMENTO',
  ];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const head = cols.join(';');
  const body = (rows || []).map((row) => cols.map((c) => esc(row[c])).join(';')).join('\n');
  return `${head}\n${body}`;
}

module.exports = {
  listarMovimentacaoItens,
  mapearLinhasMovimentacaoBrutas,
  linhasParaCsv,
  AVISOS_PADRAO,
  montarRotuloFiltroPeriodo,
  montarRotuloFiltroSentido,
  montarRotuloFiltroOrdem,
  normalizarSentido,
  parseDataIso,
  exprDhEntradaEstoque,
};
