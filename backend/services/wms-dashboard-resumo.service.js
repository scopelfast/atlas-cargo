'use strict';

/**
 * Resumo do dashboard "Estoque / WMS — visão geral".
 * Faz queries leves e agregadas para os cards do painel inicial. Cada bloco é
 * isolado em try/catch para que, se uma tabela ainda não existir (banco em
 * homologação parcial), o card devolve null em vez de derrubar o painel todo.
 *
 * Endpoint: GET /api/wms/dashboard/resumo
 */

const { pool } = require('../config/db');
const { listarShelfLifeSaldoPorValidade } = require('./wms-relatorio-shelf-life-saldo.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

/** Conta NF-e do tenant por status (em operação vs encerradas). */
async function contarNfeRecebimento(tenantId) {
  try {
    const r = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE("ST_RECEBIMENTO",''))) <> 'ENCERRADA')::int AS nf_abertas,
         COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE("ST_RECEBIMENTO",''))) = 'ENCERRADA')::int  AS nf_encerradas
       FROM "WMS_NFE_ENTRADA"
       WHERE "TENANT_ID" = $1`,
      [tenantId]
    );
    return {
      nfAbertas: Number(r.rows[0]?.nf_abertas) || 0,
      nfEncerradas: Number(r.rows[0]?.nf_encerradas) || 0,
    };
  } catch (e) {
    if (schemaMissing(e)) return { nfAbertas: null, nfEncerradas: null };
    throw e;
  }
}

/** Conta arquivos OPL (espelhos de separação) do tenant. */
async function contarOplEspelhos(tenantId) {
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS qtd FROM "WMS_OPL_ARQUIVO" WHERE "TENANT_ID" = $1`,
      [tenantId]
    );
    return Number(r.rows[0]?.qtd) || 0;
  } catch (e) {
    if (schemaMissing(e)) return null;
    throw e;
  }
}

/** Espelhos OPL importados ainda sem nenhuma quantidade coletada (picking pendente). */
async function contarOplPickingPendente(tenantId) {
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS qtd
         FROM "WMS_OPL_ARQUIVO" a
        WHERE a."TENANT_ID" = $1
          AND COALESCE(a."Q_ITENS", 0) > 0
          AND NOT EXISTS (
            SELECT 1 FROM "WMS_OPL_PEDIDO" p
              JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
             WHERE p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
               AND i."QT_COLETADA" IS NOT NULL
          )`,
      [tenantId]
    );
    return Number(r.rows[0]?.qtd) || 0;
  } catch (e) {
    if (schemaMissing(e)) return null;
    throw e;
  }
}

const SQL_EXPR_XPED_NF = `LPAD(regexp_replace(trim(COALESCE(ln->>'xPed', ln->>'xped', '')), '[^0-9]', '', 'g'), 10, '0')`;

/** Espelhos sem picking fora das cargas em montagem (contexto informativo no painel). */
async function contarOplPickingPendenteHistorico(tenantId) {
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS qtd
         FROM "WMS_OPL_ARQUIVO" a
        WHERE a."TENANT_ID" = $1
          AND COALESCE(a."Q_ITENS", 0) > 0
          AND NOT EXISTS (
            SELECT 1 FROM "WMS_OPL_PEDIDO" p
              JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
             WHERE p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
               AND i."QT_COLETADA" IS NOT NULL
          )
          AND NOT EXISTS (
            SELECT 1
              FROM "WMS_CARGA_PROGRAMADA" c
              JOIN "WMS_CARGA_PROGRAMADA_NFE" j ON j."CD_CARGA" = c."CD_CARGA"
              JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
              JOIN LATERAL jsonb_array_elements(COALESCE(n."LINHAS_JSON", '[]'::jsonb)) ln ON true
              JOIN "WMS_OPL_PEDIDO" p2 ON p2."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
                AND LPAD(regexp_replace(trim(COALESCE(p2."NUM_PEDIDO", '')), '[^0-9]', '', 'g'), 10, '0') = ${SQL_EXPR_XPED_NF}
             WHERE c."TENANT_ID" = a."TENANT_ID"
               AND UPPER(TRIM(COALESCE(c."ST_CARGA", ''))) IN ('RASCUNHO', 'CONFIRMADA')
               AND trim(COALESCE(ln->>'xPed', ln->>'xped', '')) <> ''
          )`,
      [tenantId]
    );
    return Number(r.rows[0]?.qtd) || 0;
  } catch (e) {
    if (schemaMissing(e)) return null;
    throw e;
  }
}

/**
 * Espelhos sem picking que atendem pedidos (xPed) de cargas em montagem (RASCUNHO/CONFIRMADA).
 * KPI acionável — não conta histórico de lotes antigos sem carga aberta.
 */
async function contarOplPickingPendenteMontagem(tenantId) {
  try {
    const r = await pool.query(
      `SELECT COUNT(DISTINCT a."CD_OPL_ARQUIVO")::int AS qtd
         FROM "WMS_OPL_ARQUIVO" a
        WHERE a."TENANT_ID" = $1
          AND COALESCE(a."Q_ITENS", 0) > 0
          AND NOT EXISTS (
            SELECT 1 FROM "WMS_OPL_PEDIDO" p
              JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
             WHERE p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
               AND i."QT_COLETADA" IS NOT NULL
          )
          AND EXISTS (
            SELECT 1
              FROM "WMS_CARGA_PROGRAMADA" c
              JOIN "WMS_CARGA_PROGRAMADA_NFE" j ON j."CD_CARGA" = c."CD_CARGA"
              JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
              JOIN LATERAL jsonb_array_elements(COALESCE(n."LINHAS_JSON", '[]'::jsonb)) ln ON true
              JOIN "WMS_OPL_PEDIDO" p2 ON p2."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
                AND LPAD(regexp_replace(trim(COALESCE(p2."NUM_PEDIDO", '')), '[^0-9]', '', 'g'), 10, '0') = ${SQL_EXPR_XPED_NF}
             WHERE c."TENANT_ID" = a."TENANT_ID"
               AND UPPER(TRIM(COALESCE(c."ST_CARGA", ''))) IN ('RASCUNHO', 'CONFIRMADA')
               AND trim(COALESCE(ln->>'xPed', ln->>'xped', '')) <> ''
          )`,
      [tenantId]
    );
    return Number(r.rows[0]?.qtd) || 0;
  } catch (e) {
    if (schemaMissing(e)) return null;
    throw e;
  }
}

/**
 * Conta cargas programadas por estado relevante para o painel.
 * - cargasTotal: tudo
 * - separacaoPendentes: RASCUNHO ou CONFIRMADA (montagem de carga)
 * - cargasExpedidas: EXPEDIDA (ST_CARGA)
 *
 * Expedição pendente (saída) usa WMS_EXPEDICAO_CARGA — mesma fonte do módulo Expedição.
 */
async function contarCargasProgramadas(tenantId) {
  try {
    const r = await pool.query(
      `SELECT
         COUNT(*)::int                                                                                  AS total,
         COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE("ST_CARGA",''))) IN ('RASCUNHO','CONFIRMADA'))::int AS separacao_pendentes,
         COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE("ST_CARGA",''))) = 'EXPEDIDA')::int                 AS expedidas
       FROM "WMS_CARGA_PROGRAMADA"
       WHERE "TENANT_ID" = $1`,
      [tenantId]
    );
    return {
      cargasTotal: Number(r.rows[0]?.total) || 0,
      separacaoPendentes: Number(r.rows[0]?.separacao_pendentes) || 0,
      cargasExpedidas: Number(r.rows[0]?.expedidas) || 0,
    };
  } catch (e) {
    if (schemaMissing(e)) {
      return { cargasTotal: null, separacaoPendentes: null, cargasExpedidas: null };
    }
    throw e;
  }
}

/** Cargas com expedição iniciada e saída ainda não confirmada (ST_EXPEDICAO = EM_EXPEDICAO). */
async function contarExpedicaoPendente(tenantId) {
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS qtd
         FROM "WMS_EXPEDICAO_CARGA" e
        WHERE e."TENANT_ID" = $1
          AND UPPER(TRIM(COALESCE(e."ST_EXPEDICAO", ''))) = 'EM_EXPEDICAO'`,
      [tenantId]
    );
    return Number(r.rows[0]?.qtd) || 0;
  } catch (e) {
    if (schemaMissing(e)) return null;
    throw e;
  }
}

/** IDs/nomes por trás de cada KPI acionável — para conferência no painel e no script de auditoria. */
async function listarDetalhesKpi(tenantId) {
  const empty = { montagemCargas: [], oplPicking: [], oplPickingMontagem: [], expedicaoSaida: [] };
  try {
    const [mont, opl, oplMont, exp] = await Promise.all([
      pool.query(
        `SELECT c."CD_CARGA" AS id, c."NM_DESCRICAO" AS desc
           FROM "WMS_CARGA_PROGRAMADA" c
          WHERE c."TENANT_ID" = $1
            AND UPPER(TRIM(COALESCE(c."ST_CARGA", ''))) IN ('RASCUNHO', 'CONFIRMADA')
          ORDER BY c."CD_CARGA" DESC
          LIMIT 20`,
        [tenantId]
      ),
      pool.query(
        `SELECT a."CD_OPL_ARQUIVO" AS id, a."NM_ARQUIVO" AS desc
           FROM "WMS_OPL_ARQUIVO" a
          WHERE a."TENANT_ID" = $1
            AND COALESCE(a."Q_ITENS", 0) > 0
            AND NOT EXISTS (
              SELECT 1 FROM "WMS_OPL_PEDIDO" p
                JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
               WHERE p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
                 AND i."QT_COLETADA" IS NOT NULL
            )
          ORDER BY a."CD_OPL_ARQUIVO" DESC
          LIMIT 20`,
        [tenantId]
      ),
      pool.query(
        `SELECT DISTINCT a."CD_OPL_ARQUIVO" AS id, a."NM_ARQUIVO" AS desc
           FROM "WMS_OPL_ARQUIVO" a
          WHERE a."TENANT_ID" = $1
            AND COALESCE(a."Q_ITENS", 0) > 0
            AND NOT EXISTS (
              SELECT 1 FROM "WMS_OPL_PEDIDO" p
                JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
               WHERE p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
                 AND i."QT_COLETADA" IS NOT NULL
            )
            AND EXISTS (
              SELECT 1
                FROM "WMS_CARGA_PROGRAMADA" c
                JOIN "WMS_CARGA_PROGRAMADA_NFE" j ON j."CD_CARGA" = c."CD_CARGA"
                JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
                JOIN LATERAL jsonb_array_elements(COALESCE(n."LINHAS_JSON", '[]'::jsonb)) ln ON true
                JOIN "WMS_OPL_PEDIDO" p2 ON p2."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
                  AND LPAD(regexp_replace(trim(COALESCE(p2."NUM_PEDIDO", '')), '[^0-9]', '', 'g'), 10, '0') = ${SQL_EXPR_XPED_NF}
               WHERE c."TENANT_ID" = a."TENANT_ID"
                 AND UPPER(TRIM(COALESCE(c."ST_CARGA", ''))) IN ('RASCUNHO', 'CONFIRMADA')
                 AND trim(COALESCE(ln->>'xPed', ln->>'xped', '')) <> ''
            )
          ORDER BY a."CD_OPL_ARQUIVO" DESC
          LIMIT 20`,
        [tenantId]
      ),
      pool.query(
        `SELECT c."CD_CARGA" AS id, c."NM_DESCRICAO" AS desc
           FROM "WMS_CARGA_PROGRAMADA" c
           INNER JOIN "WMS_EXPEDICAO_CARGA" e
             ON e."CD_CARGA" = c."CD_CARGA" AND e."TENANT_ID" = c."TENANT_ID"
          WHERE c."TENANT_ID" = $1
            AND UPPER(TRIM(COALESCE(e."ST_EXPEDICAO", ''))) = 'EM_EXPEDICAO'
          ORDER BY c."CD_CARGA" DESC
          LIMIT 20`,
        [tenantId]
      ),
    ]);
    return {
      montagemCargas: mont.rows || [],
      oplPicking: opl.rows || [],
      oplPickingMontagem: oplMont.rows || [],
      expedicaoSaida: exp.rows || [],
    };
  } catch (e) {
    if (schemaMissing(e)) return empty;
    throw e;
  }
}

/**
 * Conta linhas em shelf-life no horizonte do dono, com saldo estimado por lote (FEFO).
 * Mesma fonte do relatório Relatórios WMS → Datas críticas → Saldo por validade.
 */
async function contarShelfLife(tenantId) {
  try {
    const { rows } = await listarShelfLifeSaldoPorValidade(tenantId, null, { somenteComSaldo: true });
    let vencidos = 0;
    let criticos30 = 0;
    let curtoHorizonte = 0;
    let horizonteMax = 60;
    for (const ln of rows || []) {
      const dias = Number(ln.DIAS_ATE_VENCIMENTO);
      const horizonte = Number(ln.NU_DIAS_REL_VENCIMENTO_DONO);
      if (Number.isFinite(horizonte) && horizonte > horizonteMax) horizonteMax = horizonte;
      if (!Number.isFinite(dias)) continue;
      if (dias < 0) vencidos += 1;
      else if (dias <= 30) criticos30 += 1;
      else if (Number.isFinite(horizonte) && dias <= horizonte) curtoHorizonte += 1;
    }
    return {
      shelfLifeVencidos: vencidos,
      shelfLifeCriticos: criticos30,
      shelfLifeCurto: curtoHorizonte,
      shelfLifeTotal: vencidos + criticos30 + curtoHorizonte,
      shelfLifeHorizonteDias: horizonteMax,
    };
  } catch (e) {
    if (e && e.code === 'SCHEMA') {
      return {
        shelfLifeVencidos: null,
        shelfLifeCriticos: null,
        shelfLifeCurto: null,
        shelfLifeTotal: null,
        shelfLifeHorizonteDias: null,
      };
    }
    if (schemaMissing(e)) {
      return {
        shelfLifeVencidos: null,
        shelfLifeCriticos: null,
        shelfLifeCurto: null,
        shelfLifeTotal: null,
        shelfLifeHorizonteDias: null,
      };
    }
    throw e;
  }
}

/**
 * Conta SKUs com saldo NEGATIVO (entrada acumulada + movimentos do ledger < 0).
 * Query enxuta — sem reservas, sem lote/validade (só por SKU).
 *
 * Saldo negativo é um sinal de:
 *  - expedição registrada sem entrada equivalente,
 *  - inventário forçando ajuste incompatível,
 *  - bug no de-para de códigos OPL.
 *
 * Por isso é destacado em vermelho no painel.
 */
async function contarSaldoNegativo(tenantId) {
  try {
    const r = await pool.query(
      `WITH ent AS (
         SELECT e."CD_DONO",
                CASE WHEN (elem->>'cdProduto') ~ '^[0-9]+$'
                     THEN (elem->>'cdProduto')::integer END AS cd_produto,
                COALESCE(NULLIF(TRIM(elem->>'qtdConvertida'),''),'0')::numeric AS qtd
           FROM "WMS_NFE_ENTRADA" e
           CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON",'[]'::jsonb)) AS elem
          WHERE e."TENANT_ID" = $1
            AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO",''))) = 'ENCERRADA'
       ),
       mov AS (
         SELECT m."CD_DONO", m."CD_PRODUTO" AS cd_produto, SUM(m."QTD")::numeric AS qtd
           FROM "WMS_MOVIMENTO_ESTOQUE" m
          WHERE m."TENANT_ID" = $1
          GROUP BY m."CD_DONO", m."CD_PRODUTO"
       ),
       saldo AS (
         SELECT u."CD_DONO", u.cd_produto, SUM(u.qtd)::numeric AS qtd
           FROM (
             SELECT "CD_DONO", cd_produto, qtd FROM ent WHERE cd_produto IS NOT NULL
             UNION ALL
             SELECT "CD_DONO", cd_produto, qtd FROM mov WHERE cd_produto IS NOT NULL
           ) u
          GROUP BY u."CD_DONO", u.cd_produto
       )
       SELECT COUNT(*)::int AS qtd FROM saldo WHERE qtd < 0`,
      [tenantId]
    );
    return Number(r.rows[0]?.qtd) || 0;
  } catch (e) {
    if (schemaMissing(e)) return null;
    throw e;
  }
}

/** Conta inventários em andamento (EM_CONTAGEM ou CONFERIDO). */
async function contarInventariosAbertos(tenantId) {
  try {
    const r = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE("ST_INVENTARIO",''))) IN ('EM_CONTAGEM','CONFERIDO'))::int AS abertos,
         COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE("ST_INVENTARIO",''))) = 'ENCERRADO')::int                  AS encerrados
       FROM "WMS_INVENTARIO"
       WHERE "TENANT_ID" = $1`,
      [tenantId]
    );
    return {
      inventariosAbertos: Number(r.rows[0]?.abertos) || 0,
      inventariosEncerrados: Number(r.rows[0]?.encerrados) || 0,
    };
  } catch (e) {
    if (schemaMissing(e)) return { inventariosAbertos: null, inventariosEncerrados: null };
    throw e;
  }
}

/**
 * Resumo consolidado. Roda os blocos em paralelo e devolve um objeto plano que
 * o frontend consome diretamente. Cada chave pode vir como `null` se a
 * estrutura da tabela ainda não existir naquela base (homologação parcial).
 */
async function obterResumoDashboard(tenantId) {
  const [nfe, opl, oplPick, oplPickMont, oplPickHist, cargas, expPend, shelf, saldoNeg, invs, detalhes] = await Promise.all([
    contarNfeRecebimento(tenantId),
    contarOplEspelhos(tenantId),
    contarOplPickingPendente(tenantId),
    contarOplPickingPendenteMontagem(tenantId),
    contarOplPickingPendenteHistorico(tenantId),
    contarCargasProgramadas(tenantId),
    contarExpedicaoPendente(tenantId),
    contarShelfLife(tenantId),
    contarSaldoNegativo(tenantId),
    contarInventariosAbertos(tenantId),
    listarDetalhesKpi(tenantId),
  ]);
  return {
    nfAbertas: nfe.nfAbertas,
    nfEncerradas: nfe.nfEncerradas,
    oplEspelhos: opl,
    oplPickingPendentes: oplPick,
    oplPickingPendentesMontagem: oplPickMont,
    oplPickingPendentesHistorico: oplPickHist,
    cargasTotal: cargas.cargasTotal,
    separacaoPendentes: cargas.separacaoPendentes,
    expedicaoPendentes: expPend,
    cargasExpedidas: cargas.cargasExpedidas,
    shelfLifeVencidos: shelf.shelfLifeVencidos,
    shelfLifeCriticos: shelf.shelfLifeCriticos,
    shelfLifeCurto: shelf.shelfLifeCurto,
    shelfLifeTotal: shelf.shelfLifeTotal,
    shelfLifeHorizonteDias: shelf.shelfLifeHorizonteDias,
    saldoNegativos: saldoNeg,
    inventariosAbertos: invs.inventariosAbertos,
    inventariosEncerrados: invs.inventariosEncerrados,
    detalhes,
    geradoEm: new Date().toISOString(),
  };
}

module.exports = {
  obterResumoDashboard,
  listarDetalhesKpi,
  contarExpedicaoPendente,
};
