'use strict';

/**
 * WMS — Auditoria de saúde do estoque.
 *
 * Varre o tenant inteiro em 5 verificações independentes para listar
 * TODOS os pontos onde o estoque tem risco de divergência:
 *
 *   A) SKUs com saldo positivo só do ledger (sem NF encerrada somando).
 *      "(só mov.)" do relatório de Posição em larga escala.
 *
 *   B) SKUs com saldo SKU negativo (saiu mais do que entrou).
 *
 *   C) NF-e abertas há mais de N dias (não encerradas).
 *      O saldo dessas NFs NÃO entra na Posição até encerrar.
 *
 *   D) NF-e ENCERRADAS com itens da conferência inválidos
 *      (`cdProduto` null / não-numérico OU `qtdConvertida` <= 0).
 *      Saldo aparente menor do que o físico.
 *
 *   E) Cadastros DUPLICADOS no mesmo dono (mesma chave de código OL, vários CD_PRODUTO).
 *      Ex.: 6031021420 e 6.03.10.214.20 — NÃO alerta só por nome igual com códigos diferentes.
 *
 * Cada bloco retorna até 500 linhas (LIMIT defensivo). Em todos os casos,
 * a chave `(cdDono, codigo)` permite o front passar o problema direto para
 * o endpoint de diagnóstico via botão de lupa.
 */

const { pool } = require('../config/db');
const reservaOplDiag = require('./wms-diagnostico-reserva-opl.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

/** A) SKUs com saldo positivo "(só mov.)" — sem entrada de NF encerrada. */
async function listarSkusSoMovimento(tenantId, cdDonoFiltro) {
  const params = [tenantId];
  let donoClause = '';
  if (cdDonoFiltro != null) {
    params.push(parseInt(cdDonoFiltro, 10));
    donoClause = ` AND m."CD_DONO" = $${params.length}::integer`;
  }
  const sql = `
    WITH ent AS (
      SELECT e."CD_DONO",
             (elem->>'cdProduto')::integer AS cd_produto,
             SUM(COALESCE(NULLIF(TRIM(elem->>'qtdConvertida'), ''), '0')::numeric) AS qtd
        FROM "WMS_NFE_ENTRADA" e
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS elem
       WHERE e."TENANT_ID" = $1
         AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) = 'ENCERRADA'
         AND e."CD_DONO" IS NOT NULL
         AND (elem->>'cdProduto') ~ '^[0-9]+$'
       GROUP BY e."CD_DONO", (elem->>'cdProduto')::integer
    ),
    mov AS (
      SELECT m."CD_DONO", m."CD_PRODUTO" AS cd_produto, SUM(m."QTD")::numeric AS qtd
        FROM "WMS_MOVIMENTO_ESTOQUE" m
       WHERE m."TENANT_ID" = $1
         AND m."CD_DONO" IS NOT NULL ${donoClause}
       GROUP BY m."CD_DONO", m."CD_PRODUTO"
    )
    SELECT
      m."CD_DONO",
      o."NOME"   AS "NM_DONO",
      m.cd_produto AS "CD_PRODUTO",
      p."CODIGO" AS "CODIGO_PRODUTO",
      p."NOME"   AS "NM_PRODUTO",
      p."TIPO_ARMAZENAGEM",
      COALESCE(ent.qtd, 0) AS "QTD_ENTRADA_NF_ENCERRADA",
      m.qtd                AS "QTD_MOVIMENTOS",
      COALESCE(ent.qtd, 0) + m.qtd AS "QTD_SALDO_SKU"
      FROM mov m
      LEFT JOIN ent ON ent."CD_DONO" = m."CD_DONO" AND ent.cd_produto = m.cd_produto
      LEFT JOIN "WMS_PRODUTO_DONO" p ON p."CD_PRODUTO" = m.cd_produto AND p."TENANT_ID" = $1
      LEFT JOIN "WMS_DONO_ESTOQUE" o ON o."CD_DONO" = m."CD_DONO" AND o."TENANT_ID" = $1
     WHERE m.qtd > 0
       AND COALESCE(ent.qtd, 0) = 0
     ORDER BY m.qtd DESC, m."CD_DONO"
     LIMIT 500
  `;
  const r = await pool.query(sql, params);
  return r.rows;
}

/** B) Saldo SKU negativo: ledger ficou abaixo das entradas (ou sem entradas). */
async function listarSkusSaldoNegativo(tenantId, cdDonoFiltro) {
  const params = [tenantId];
  let donoClause = '';
  if (cdDonoFiltro != null) {
    params.push(parseInt(cdDonoFiltro, 10));
    donoClause = ` AND m."CD_DONO" = $${params.length}::integer`;
  }
  const sql = `
    WITH ent AS (
      SELECT e."CD_DONO",
             (elem->>'cdProduto')::integer AS cd_produto,
             SUM(COALESCE(NULLIF(TRIM(elem->>'qtdConvertida'), ''), '0')::numeric) AS qtd
        FROM "WMS_NFE_ENTRADA" e
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS elem
       WHERE e."TENANT_ID" = $1
         AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) = 'ENCERRADA'
         AND e."CD_DONO" IS NOT NULL
         AND (elem->>'cdProduto') ~ '^[0-9]+$'
       GROUP BY e."CD_DONO", (elem->>'cdProduto')::integer
    ),
    mov AS (
      SELECT m."CD_DONO", m."CD_PRODUTO" AS cd_produto, SUM(m."QTD")::numeric AS qtd
        FROM "WMS_MOVIMENTO_ESTOQUE" m
       WHERE m."TENANT_ID" = $1
         AND m."CD_DONO" IS NOT NULL ${donoClause}
       GROUP BY m."CD_DONO", m."CD_PRODUTO"
    ),
    saldo AS (
      SELECT u."CD_DONO", u.cd_produto,
             COALESCE(ent.qtd, 0) AS qtd_ent,
             COALESCE(mov.qtd, 0) AS qtd_mov,
             COALESCE(ent.qtd, 0) + COALESCE(mov.qtd, 0) AS qtd_saldo
        FROM (
              SELECT "CD_DONO", cd_produto FROM ent
              UNION
              SELECT "CD_DONO", cd_produto FROM mov
             ) u
        LEFT JOIN ent ON ent."CD_DONO" = u."CD_DONO" AND ent.cd_produto = u.cd_produto
        LEFT JOIN mov ON mov."CD_DONO" = u."CD_DONO" AND mov.cd_produto = u.cd_produto
    )
    SELECT s."CD_DONO",
           o."NOME"   AS "NM_DONO",
           s.cd_produto AS "CD_PRODUTO",
           p."CODIGO" AS "CODIGO_PRODUTO",
           p."NOME"   AS "NM_PRODUTO",
           s.qtd_ent  AS "QTD_ENTRADA_NF_ENCERRADA",
           s.qtd_mov  AS "QTD_MOVIMENTOS",
           s.qtd_saldo AS "QTD_SALDO_SKU"
      FROM saldo s
      LEFT JOIN "WMS_PRODUTO_DONO" p ON p."CD_PRODUTO" = s.cd_produto AND p."TENANT_ID" = $1
      LEFT JOIN "WMS_DONO_ESTOQUE" o ON o."CD_DONO" = s."CD_DONO" AND o."TENANT_ID" = $1
     WHERE s.qtd_saldo < 0
     ORDER BY s.qtd_saldo ASC, s."CD_DONO"
     LIMIT 500
  `;
  const r = await pool.query(sql, params);
  return r.rows;
}

/** C) NF-e abertas há mais de `diasMin` dias (não encerradas). */
async function listarNfsAbertas(tenantId, cdDonoFiltro, diasMin) {
  const dias = Number.isFinite(diasMin) && diasMin > 0 ? diasMin : 7;
  const params = [tenantId, dias];
  let donoClause = '';
  if (cdDonoFiltro != null) {
    params.push(parseInt(cdDonoFiltro, 10));
    donoClause = ` AND e."CD_DONO" = $${params.length}::integer`;
  }
  const sql = `
    SELECT e."CD_NFE" AS "CD_NFE_ENTRADA",
           e."CD_DONO",
           o."NOME" AS "NM_DONO",
           e."ST_RECEBIMENTO",
           e."NUMERO_NF" AS "NU_NF",
           e."SERIE" AS "NU_SERIE",
           COALESCE(e."DH_CONFERENCIA", e."DH_IMPORTACAO", e."DH_EMISSAO") AS "DH_RECEBIMENTO",
           jsonb_array_length(COALESCE(e."LINHAS_JSON", '[]'::jsonb))      AS "QTD_LINHAS_JSON",
           jsonb_array_length(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS "QTD_LINHAS_CONF",
           EXTRACT(DAY FROM (CURRENT_TIMESTAMP - COALESCE(e."DH_CONFERENCIA", e."DH_IMPORTACAO", e."DH_EMISSAO")))::integer AS "DIAS_ABERTA"
      FROM "WMS_NFE_ENTRADA" e
      LEFT JOIN "WMS_DONO_ESTOQUE" o ON o."CD_DONO" = e."CD_DONO" AND o."TENANT_ID" = e."TENANT_ID"
     WHERE e."TENANT_ID" = $1
       AND e."CD_DONO" IS NOT NULL
       AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) <> 'ENCERRADA'
       AND COALESCE(e."DH_CONFERENCIA", e."DH_IMPORTACAO", e."DH_EMISSAO") < (CURRENT_TIMESTAMP - ($2 || ' days')::interval)
       ${donoClause}
     ORDER BY COALESCE(e."DH_CONFERENCIA", e."DH_IMPORTACAO", e."DH_EMISSAO") ASC NULLS FIRST
     LIMIT 500
  `;
  const r = await pool.query(sql, params);
  return r.rows;
}

/** D) NF-e ENCERRADAS com itens da conferência inválidos. */
async function listarConferenciasInvalidas(tenantId, cdDonoFiltro) {
  const params = [tenantId];
  let donoClause = '';
  if (cdDonoFiltro != null) {
    params.push(parseInt(cdDonoFiltro, 10));
    donoClause = ` AND e."CD_DONO" = $${params.length}::integer`;
  }
  const sql = `
    WITH src AS (
      SELECT e."CD_NFE" AS "CD_NFE_ENTRADA", e."CD_DONO",
             e."NUMERO_NF" AS "NU_NF", e."SERIE" AS "NU_SERIE",
             COALESCE(e."DH_ENCERRAMENTO", e."DH_CONFERENCIA", e."DH_IMPORTACAO") AS "DH_RECEBIMENTO", elem
        FROM "WMS_NFE_ENTRADA" e
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS elem
       WHERE e."TENANT_ID" = $1
         AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) = 'ENCERRADA'
         AND e."CD_DONO" IS NOT NULL
         ${donoClause}
    )
    SELECT s."CD_NFE_ENTRADA",
           s."CD_DONO",
           o."NOME" AS "NM_DONO",
           s."NU_NF",
           s."NU_SERIE",
           s."DH_RECEBIMENTO",
           s.elem->>'nItem'         AS "nItem",
           s.elem->>'codigoProduto' AS "codigoProduto",
           s.elem->>'cdProduto'     AS "cdProdutoRaw",
           s.elem->>'lote'          AS "lote",
           s.elem->>'qtdRecebida'   AS "qtdRecebida",
           s.elem->>'fatorConversao' AS "fatorConversao",
           s.elem->>'qtdConvertida' AS "qtdConvertida",
           CASE
             WHEN NOT ((s.elem->>'cdProduto') ~ '^[0-9]+$')
               THEN 'SEM_CD_PRODUTO'
             WHEN COALESCE((s.elem->>'qtdConvertida')::numeric, 0) <= 0
               THEN 'QTD_ZERO'
             ELSE 'OK'
           END AS "diagnostico"
      FROM src s
      LEFT JOIN "WMS_DONO_ESTOQUE" o ON o."CD_DONO" = s."CD_DONO" AND o."TENANT_ID" = $1
     WHERE NOT ((s.elem->>'cdProduto') ~ '^[0-9]+$')
        OR COALESCE((s.elem->>'qtdConvertida')::numeric, 0) <= 0
     ORDER BY s."DH_RECEBIMENTO" DESC NULLS LAST, s."CD_NFE_ENTRADA"
     LIMIT 500
  `;
  const r = await pool.query(sql, params);
  return r.rows;
}

/** Chave normalizada do código (dígitos/letras OL) — alinhado a wms_codigo_produto_chave. */
const SQL_CHAVE_CODIGO_P = `lower(regexp_replace(trim(coalesce(p."CODIGO", '')), '[^0-9A-Za-z]', '', 'g'))`;

/** E) Cadastros duplicados no mesmo dono — mesma chave de código, CD_PRODUTO diferentes. */
async function listarCadastrosDuplicados(tenantId, cdDonoFiltro) {
  const params = [tenantId];
  let donoClause = '';
  if (cdDonoFiltro != null) {
    params.push(parseInt(cdDonoFiltro, 10));
    donoClause = ` AND p."CD_DONO" = $${params.length}::integer`;
  }
  const sql = `
    WITH prod AS (
      SELECT p."CD_DONO",
             p."CD_PRODUTO",
             p."CODIGO",
             p."NOME",
             p."UNIDADE",
             ${SQL_CHAVE_CODIGO_P} AS chave
        FROM "WMS_PRODUTO_DONO" p
       WHERE p."TENANT_ID" = $1
         AND COALESCE(p."FGACTIVE", 'S') = 'S'
         AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
         ${donoClause}
    ),
    agrupados AS (
      SELECT "CD_DONO", chave, COUNT(*) AS qtd
        FROM prod
       WHERE chave <> ''
       GROUP BY "CD_DONO", chave
      HAVING COUNT(*) > 1
    )
    SELECT p."CD_DONO",
           o."NOME"   AS "NM_DONO",
           p."CD_PRODUTO",
           p."CODIGO" AS "CODIGO_PRODUTO",
           p."NOME"   AS "NM_PRODUTO",
           p."UNIDADE",
           p.chave    AS "CHAVE_CODIGO",
           a.qtd      AS "QTD_DUPLICATAS"
      FROM agrupados a
      INNER JOIN prod p ON p."CD_DONO" = a."CD_DONO" AND p.chave = a.chave
      LEFT JOIN "WMS_DONO_ESTOQUE" o ON o."CD_DONO" = p."CD_DONO" AND o."TENANT_ID" = $1
     ORDER BY p."CD_DONO", p.chave, p."CD_PRODUTO"
     LIMIT 500
  `;
  const r = await pool.query(sql, params);
  return r.rows;
}

/** Agregação completa. `cdDonoFiltro` opcional restringe tudo a um dono. */
async function auditarSaudeEstoque(tenantId, cdDonoFiltro, diasNfAberta) {
  const cd = cdDonoFiltro != null && cdDonoFiltro !== '' ? parseInt(cdDonoFiltro, 10) : null;
  try {
    const [soMov, neg, abertas, confInv, dup, orfasResult] = await Promise.all([
      listarSkusSoMovimento(tenantId, cd),
      listarSkusSaldoNegativo(tenantId, cd),
      listarNfsAbertas(tenantId, cd, diasNfAberta),
      listarConferenciasInvalidas(tenantId, cd),
      listarCadastrosDuplicados(tenantId, cd),
      reservaOplDiag.previewLimparOrfas(tenantId, cd).catch(() => ({ ok: { espelhos: [], total: 0 } })),
    ]);
    const reservasOrfas = (orfasResult && orfasResult.ok && orfasResult.ok.espelhos) || [];
    const reservasOrfasTotalLinhas = (orfasResult && orfasResult.ok && orfasResult.ok.total) || 0;
    return {
      ok: {
        geradoEm: new Date().toISOString(),
        cdDonoFiltro: cd,
        diasNfAbertaCorte: Number.isFinite(diasNfAberta) && diasNfAberta > 0 ? diasNfAberta : 7,
        resumo: {
          skusSoMovimento: soMov.length,
          skusSaldoNegativo: neg.length,
          nfsAbertasAntigas: abertas.length,
          itensConferenciaInvalidos: confInv.length,
          cadastrosDuplicados: dup.length,
          reservasOrfasEspelhos: reservasOrfas.length,
          reservasOrfasLinhas: reservasOrfasTotalLinhas,
        },
        skusSoMovimento: soMov,
        skusSaldoNegativo: neg,
        nfsAbertasAntigas: abertas,
        itensConferenciaInvalidos: confInv,
        cadastrosDuplicados: dup,
        reservasOrfas,
      },
    };
  } catch (e) {
    if (schemaMissing(e)) {
      return { err: 'Estrutura WMS desatualizada para auditoria.', status: 503 };
    }
    throw e;
  }
}

module.exports = {
  auditarSaudeEstoque,
  listarSkusSoMovimento,
  listarSkusSaldoNegativo,
  listarNfsAbertas,
  listarConferenciasInvalidas,
  listarCadastrosDuplicados,
};
