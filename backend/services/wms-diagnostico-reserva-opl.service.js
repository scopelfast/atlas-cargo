'use strict';

/**
 * WMS — Diagnóstico e saneamento de reservas OPL órfãs.
 *
 * Uma reserva "órfã" é aquela em `WMS_RESERVA_ESTOQUE_OPL` cujo espelho OPL
 * teve **todas** as cargas vinculadas já expedidas (ou não tem mais carga
 * pendente). A função `liberarReservasOplPorCargaExpedida` normalmente faz
 * essa limpeza, mas em alguns cenários (NF-saída importada antes do
 * espelho, pedido reaproveitado em outro arquivo OPL, etc.) o link
 * espelho↔carga não fecha e a reserva fica eterna, descontando indevidamente
 * da trava de simulação OPL (caso "tenho 2 em estoque mas trava diz falta 1").
 *
 * Esta camada NÃO altera produção sozinha — apenas:
 *   1. lista as reservas para um SKU + dono (`listarReservasParaSku`),
 *   2. lista as reservas órfãs do tenant inteiro (`listarReservasOrfas`),
 *   3. devolve uma prévia de limpeza (`previewLimparOrfas`),
 *   4. limpa quando o operador confirma (`limparReservasOrfas`).
 *
 * Reaproveita o critério de "carga pendente" de
 * `wms-opl-reserva-picking.service.js` para que a auditoria e o serviço
 * runtime falem a mesma língua.
 */

const { pool } = require('../config/db');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

/** Monta mensagem de erro detalhada para o catch de schemaMissing.
 *  Antes a mensagem era hard-coded "Tabela WMS_RESERVA_ESTOQUE_OPL ausente",
 *  o que mascarava o caso em que o problema real era uma COLUNA inexistente em
 *  outra tabela (ex.: query referenciando uma coluna renomeada). */
function descreverErroSchema(err) {
  if (!err) return 'Estrutura WMS desatualizada para limpeza de reservas órfãs.';
  if (err.code === '42P01') {
    return `Tabela WMS ausente: ${err.message || err.detail || 'verifique scripts de migração'}.`;
  }
  if (err.code === '42703') {
    return `Coluna WMS ausente: ${err.message || err.detail || 'verifique scripts de migração'}.`;
  }
  return `Estrutura WMS desatualizada: ${err.message || ''}`;
}

/** SQL: para cada espelho OPL passado, retorna quantas cargas vinculadas
 *  existem e quantas estão expedidas. Usa o MESMO matching de pedido↔carga
 *  do `listarCargasNaoExpedidasMesmoEspelhoOpl` (LPAD 10 + regex de dígitos). */
async function carregarEstadoCargasPorOpl(tenantId, cdOplArquivos, executor) {
  const q = executor || pool;
  if (!Array.isArray(cdOplArquivos) || !cdOplArquivos.length) return new Map();
  const r = await q.query(
    `WITH pedidos_espelho AS (
       SELECT DISTINCT p."CD_OPL_ARQUIVO",
              LPAD(regexp_replace(trim(p."NUM_PEDIDO"), '[^0-9]', '', 'g'), 10, '0') AS ped
         FROM "WMS_OPL_PEDIDO" p
        WHERE p."CD_OPL_ARQUIVO" = ANY($1::integer[])
          AND trim(COALESCE(p."NUM_PEDIDO", '')) <> ''
     ),
     cargas_pedido AS (
       SELECT DISTINCT pe."CD_OPL_ARQUIVO", j."CD_CARGA"
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA" AND n."TENANT_ID" = $2
         CROSS JOIN LATERAL jsonb_array_elements(
                 CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END
               ) ln
         JOIN pedidos_espelho pe
           ON pe.ped = LPAD(regexp_replace(trim(COALESCE(ln->>'xPed', '')), '[^0-9]', '', 'g'), 10, '0')
        WHERE pe.ped <> ''
     )
     SELECT cp."CD_OPL_ARQUIVO",
            cp."CD_CARGA",
            c."ST_CARGA",
            e."ST_EXPEDICAO",
            COALESCE(e."DH_SAIDA", e."DH_INICIO") AS "DH_EXPEDICAO"
       FROM cargas_pedido cp
       JOIN "WMS_CARGA_PROGRAMADA" c ON c."CD_CARGA" = cp."CD_CARGA" AND c."TENANT_ID" = $2
       LEFT JOIN "WMS_EXPEDICAO_CARGA" e ON e."CD_CARGA" = c."CD_CARGA" AND e."TENANT_ID" = $2
      ORDER BY cp."CD_OPL_ARQUIVO", cp."CD_CARGA"`,
    [cdOplArquivos, tenantId]
  );
  const m = new Map();
  for (const row of r.rows || []) {
    const cdOpl = parseInt(row.CD_OPL_ARQUIVO, 10);
    if (!Number.isFinite(cdOpl)) continue;
    if (!m.has(cdOpl)) m.set(cdOpl, []);
    const expedida =
      String(row.ST_EXPEDICAO || '').toUpperCase().trim() === 'EXPEDIDA' ||
      String(row.ST_CARGA || '').toUpperCase().trim() === 'EXPEDIDA';
    m.get(cdOpl).push({
      CD_CARGA: row.CD_CARGA,
      ST_CARGA: row.ST_CARGA,
      ST_EXPEDICAO: row.ST_EXPEDICAO,
      DH_EXPEDICAO: row.DH_EXPEDICAO,
      expedida,
    });
  }
  return m;
}

/** Classifica um espelho OPL em ATIVA, ORFA ou SEM_CARGAS. */
function classificarEspelho(cargas) {
  const arr = Array.isArray(cargas) ? cargas : [];
  if (!arr.length) return 'SEM_CARGAS';
  const todasExpedidas = arr.every((c) => c.expedida);
  return todasExpedidas ? 'ORFA' : 'ATIVA';
}

/** Lista todas as reservas que pesam num SKU específico (mostra na lupa). */
async function listarReservasParaSku(tenantId, cdDono, cdProduto) {
  try {
    const r = await pool.query(
      `SELECT r."CD_RESERVA", r."CD_OPL_ARQUIVO", r."QTD_RESERVADA", r."DH_ATUALIZACAO", r."SG_USER",
              a."NM_ARQUIVO", a."DH_IMPORT", a."ST_IMPORT"
         FROM "WMS_RESERVA_ESTOQUE_OPL" r
         LEFT JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO" = r."CD_OPL_ARQUIVO" AND a."TENANT_ID" = r."TENANT_ID"
        WHERE r."TENANT_ID" = $1
          AND r."CD_DONO" = $2::integer
          AND r."CD_PRODUTO" = $3::integer
        ORDER BY r."CD_OPL_ARQUIVO"`,
      [tenantId, cdDono, cdProduto]
    );
    const reservas = r.rows || [];
    const ids = reservas.map((x) => parseInt(x.CD_OPL_ARQUIVO, 10)).filter(Number.isFinite);
    const cargasMap = ids.length ? await carregarEstadoCargasPorOpl(tenantId, ids) : new Map();
    const detalhadas = reservas.map((res) => {
      const id = parseInt(res.CD_OPL_ARQUIVO, 10);
      const cargas = cargasMap.get(id) || [];
      return Object.assign({}, res, {
        cargasVinculadas: cargas,
        qtdCargas: cargas.length,
        qtdCargasExpedidas: cargas.filter((c) => c.expedida).length,
        classificacao: classificarEspelho(cargas),
      });
    });
    const totalAtivas = detalhadas
      .filter((d) => d.classificacao !== 'ORFA')
      .reduce((acc, d) => acc + (Number(d.QTD_RESERVADA) || 0), 0);
    const totalOrfas = detalhadas
      .filter((d) => d.classificacao === 'ORFA')
      .reduce((acc, d) => acc + (Number(d.QTD_RESERVADA) || 0), 0);
    return {
      ok: {
        cdDono,
        cdProduto,
        reservas: detalhadas,
        totais: { totalAtivas, totalOrfas, total: totalAtivas + totalOrfas },
      },
    };
  } catch (e) {
    if (schemaMissing(e)) return { err: descreverErroSchema(e), status: 503 };
    throw e;
  }
}

/** Lista TODAS as reservas órfãs do tenant (ou de um dono). */
async function listarReservasOrfas(tenantId, cdDonoFiltro) {
  try {
    const params = [tenantId];
    let where = '';
    if (cdDonoFiltro != null) {
      params.push(parseInt(cdDonoFiltro, 10));
      where = ` AND r."CD_DONO" = $${params.length}::integer`;
    }
    const r = await pool.query(
      `SELECT r."CD_RESERVA", r."CD_DONO", r."CD_PRODUTO", r."CD_OPL_ARQUIVO",
              r."QTD_RESERVADA", r."DH_ATUALIZACAO", r."SG_USER",
              o."NOME" AS "NM_DONO",
              a."NM_ARQUIVO", a."DH_IMPORT", a."ST_IMPORT",
              p."CODIGO" AS "CODIGO_PRODUTO", p."NOME" AS "NM_PRODUTO"
         FROM "WMS_RESERVA_ESTOQUE_OPL" r
         LEFT JOIN "WMS_DONO_ESTOQUE" o ON o."CD_DONO" = r."CD_DONO" AND o."TENANT_ID" = r."TENANT_ID"
         LEFT JOIN "WMS_OPL_ARQUIVO"  a ON a."CD_OPL_ARQUIVO" = r."CD_OPL_ARQUIVO" AND a."TENANT_ID" = r."TENANT_ID"
         LEFT JOIN "WMS_PRODUTO_DONO" p ON p."CD_PRODUTO" = r."CD_PRODUTO" AND p."TENANT_ID" = r."TENANT_ID"
        WHERE r."TENANT_ID" = $1 ${where}
        ORDER BY r."CD_DONO", r."CD_OPL_ARQUIVO", r."CD_PRODUTO"`,
      params
    );
    const linhas = r.rows || [];
    /** Agrupa por espelho OPL — só precisamos avaliar estado uma vez por espelho. */
    const espelhos = new Set();
    linhas.forEach((l) => {
      const id = parseInt(l.CD_OPL_ARQUIVO, 10);
      if (Number.isFinite(id)) espelhos.add(id);
    });
    const cargasMap = espelhos.size ? await carregarEstadoCargasPorOpl(tenantId, Array.from(espelhos)) : new Map();
    const orfas = [];
    for (const l of linhas) {
      const id = parseInt(l.CD_OPL_ARQUIVO, 10);
      const cargas = cargasMap.get(id) || [];
      if (classificarEspelho(cargas) !== 'ORFA') continue;
      orfas.push(
        Object.assign({}, l, {
          cargasVinculadas: cargas,
          qtdCargas: cargas.length,
          qtdCargasExpedidas: cargas.filter((c) => c.expedida).length,
        })
      );
    }
    return { ok: { orfas, total: orfas.length } };
  } catch (e) {
    if (schemaMissing(e)) return { err: descreverErroSchema(e), status: 503 };
    throw e;
  }
}

/** Prévia da limpeza: agrupa por espelho órfão e devolve `cdOplArquivos`,
 *  `qtdReservas`, `qtdLinhas` para confirmação antes do DELETE. */
async function previewLimparOrfas(tenantId, cdDonoFiltro) {
  const r = await listarReservasOrfas(tenantId, cdDonoFiltro);
  if (r.err) return r;
  const orfas = r.ok.orfas || [];
  const porOpl = new Map();
  for (const o of orfas) {
    const id = parseInt(o.CD_OPL_ARQUIVO, 10);
    if (!Number.isFinite(id)) continue;
    if (!porOpl.has(id)) {
      porOpl.set(id, {
        CD_OPL_ARQUIVO: id,
        CD_DONO: o.CD_DONO,
        NM_DONO: o.NM_DONO,
        NM_ARQUIVO: o.NM_ARQUIVO,
        DH_IMPORT: o.DH_IMPORT,
        ST_IMPORT: o.ST_IMPORT,
        qtdLinhas: 0,
        qtdTotal: 0,
        qtdCargasExpedidas: o.qtdCargasExpedidas,
        qtdCargas: o.qtdCargas,
      });
    }
    const acc = porOpl.get(id);
    acc.qtdLinhas += 1;
    acc.qtdTotal += Number(o.QTD_RESERVADA) || 0;
  }
  return { ok: { espelhos: Array.from(porOpl.values()), total: orfas.length } };
}

/** Limpa as reservas órfãs. Usa transação.
 *  Aceita filtro opcional por `cdProduto` para limpeza cirúrgica
 *  (caso o operador queira liberar só um SKU específico). */
async function limparReservasOrfas(tenantId, cdDonoFiltro, sgUser, cdProdutoFiltro) {
  const r = await listarReservasOrfas(tenantId, cdDonoFiltro);
  if (r.err) return r;
  let orfas = r.ok.orfas || [];
  /** Filtro adicional por SKU — usado quando o operador clica em "Limpar
   *  reservas órfãs deste SKU" direto na simulação OPL. */
  if (cdProdutoFiltro != null) {
    const cdProd = parseInt(cdProdutoFiltro, 10);
    if (Number.isFinite(cdProd)) {
      orfas = orfas.filter((o) => parseInt(o.CD_PRODUTO, 10) === cdProd);
    }
  }
  const ids = orfas
    .map((o) => parseInt(o.CD_RESERVA, 10))
    .filter(Number.isFinite);
  if (!ids.length) return { ok: { liberadas: 0, espelhos: 0 } };
  const espelhos = new Set(orfas.map((o) => parseInt(o.CD_OPL_ARQUIVO, 10)).filter(Number.isFinite));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const del = await client.query(
      `DELETE FROM "WMS_RESERVA_ESTOQUE_OPL"
        WHERE "TENANT_ID" = $1
          AND "CD_RESERVA" = ANY($2::bigint[])`,
      [tenantId, ids]
    );
    await client.query('COMMIT');
    return {
      ok: {
        liberadas: del.rowCount || 0,
        espelhos: espelhos.size,
        sgUser: sgUser || null,
      },
    };
  } catch (e) {
    await client.query('ROLLBACK');
    if (schemaMissing(e)) return { err: descreverErroSchema(e), status: 503 };
    throw e;
  } finally {
    client.release();
  }
}

module.exports = {
  listarReservasParaSku,
  listarReservasOrfas,
  previewLimparOrfas,
  limparReservasOrfas,
  carregarEstadoCargasPorOpl,
  classificarEspelho,
};
