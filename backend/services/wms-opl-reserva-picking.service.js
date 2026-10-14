'use strict';

const {
  saldoPorCdProdutoRecebimentoEncerradoMaisMovimentos,
  agregarQtColetadaPorCdProdutoOpl,
} = require('./wms-opl-cobertura-estoque.service');
const { resolverEspelhosOplParaCarga } = require('./wms-carga-validacao.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

/**
 * Lista reservas gravadas para um espelho OPL.
 * @param {import('pg').Pool|import('pg').PoolClient} db
 */
async function listarReservasPorOplArquivo(db, tenantId, cdOplArquivo) {
  const r = await db.query(
    `SELECT "CD_PRODUTO", "QTD_RESERVADA", "DH_ATUALIZACAO", "SG_USER"
       FROM "WMS_RESERVA_ESTOQUE_OPL"
      WHERE "TENANT_ID" = $1 AND "CD_OPL_ARQUIVO" = $2::integer
      ORDER BY "CD_PRODUTO"`,
    [tenantId, cdOplArquivo]
  );
  return r.rows || [];
}

/**
 * Remove todas as reservas de um espelho OPL (reabrir picking para correção).
 * Não altera QT_COLETADA — só libera o lock de edição.
 *
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @returns {Promise<{ removidos: number; skipped?: boolean }>}
 */
async function removerReservasOplArquivo(db, tenantId, cdOplArquivo) {
  try {
    const del = await db.query(
      `DELETE FROM "WMS_RESERVA_ESTOQUE_OPL" WHERE "TENANT_ID" = $1 AND "CD_OPL_ARQUIVO" = $2::integer`,
      [tenantId, cdOplArquivo]
    );
    return { removidos: del.rowCount || 0 };
  } catch (e) {
    if (schemaMissing(e)) {
      return { removidos: 0, skipped: true };
    }
    throw e;
  }
}

/**
 * Ao concluir picking (todos os itens com QT_COLETADA): grava/atualiza reservas por CD_PRODUTO.
 * Saldo disponível = soma NF-e encerradas (cdProduto); já desconta reservas de **outros** espelhos.
 * Itens sem de-para não entram na reserva (MVP).
 *
 * @param {import('pg').PoolClient} client
 * @param {{ ignorarSaldoInsuficiente?: boolean }} [opts] — liberação supervisor: não aborta; pula SKU sem saldo
 * @returns {Promise<{ ok: boolean; registros?: number; skipped?: boolean; reason?: string; aviso?: string }>}
 */
async function aplicarReservasAoConcluirPickingOpl(client, tenantId, cdOplArquivo, cdDono, sgUser, opts) {
  const ignorarSaldo = !!(opts && opts.ignorarSaldoInsuficiente);
  try {
    const { byCd, itensSemMapeamento, qtdTotalColetadaSemMapa } = await agregarQtColetadaPorCdProdutoOpl(
      client,
      tenantId,
      cdDono,
      cdOplArquivo
    );
    if (!byCd.size) {
      let aviso = null;
      if (itensSemMapeamento > 0 && qtdTotalColetadaSemMapa > 0) {
        aviso =
          'Picking concluído, mas nenhuma quantidade foi reservada: faltam de-para / produto dono para os códigos OL coletados.';
      }
      return { ok: true, registros: 0, skipped: false, aviso };
    }

    const saldo = await saldoPorCdProdutoRecebimentoEncerradoMaisMovimentos(tenantId, cdDono, client);
    const rO = await client.query(
      `SELECT "CD_PRODUTO", SUM("QTD_RESERVADA")::numeric AS q
         FROM "WMS_RESERVA_ESTOQUE_OPL"
        WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer AND "CD_OPL_ARQUIVO" <> $3::integer
        GROUP BY "CD_PRODUTO"`,
      [tenantId, cdDono, cdOplArquivo]
    );
    const outros = new Map();
    for (const row of rO.rows || []) {
      const id = parseInt(row.CD_PRODUTO ?? row.cd_produto, 10);
      if (!Number.isFinite(id)) continue;
      const q = Number(row.q);
      outros.set(id, Number.isFinite(q) ? q : 0);
    }

    const toReserve = new Map();
    const semSaldo = [];
    for (const [cdProd, need] of byCd) {
      const s = saldo.get(cdProd) || 0;
      const o = outros.get(cdProd) || 0;
      if (need + o > s + 1e-6) {
        if (ignorarSaldo) {
          semSaldo.push(cdProd);
          continue;
        }
        const err = new Error(
          `Reserva: saldo encerrado insuficiente para o produto interno ${cdProd} (picking ${need} + outros espelhos ${o} > saldo estimado ${s}). Ajuste picking ou libere outra reserva.`
        );
        err.code = 'RESERVA_CONFLITO';
        throw err;
      }
      toReserve.set(cdProd, need);
    }

    await client.query(
      `DELETE FROM "WMS_RESERVA_ESTOQUE_OPL" WHERE "TENANT_ID" = $1 AND "CD_OPL_ARQUIVO" = $2::integer`,
      [tenantId, cdOplArquivo]
    );

    let n = 0;
    const sg = sgUser != null ? String(sgUser).slice(0, 64) : null;
    for (const [cdProd, qtd] of toReserve) {
      await client.query(
        `INSERT INTO "WMS_RESERVA_ESTOQUE_OPL"
          ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "CD_OPL_ARQUIVO", "QTD_RESERVADA", "SG_USER")
         VALUES ($1, $2::integer, $3::integer, $4::integer, $5::numeric, $6)`,
        [tenantId, cdDono, cdProd, cdOplArquivo, qtd, sg]
      );
      n += 1;
    }

    let aviso = null;
    if (itensSemMapeamento > 0 && qtdTotalColetadaSemMapa > 0) {
      aviso = `Parte do picking (${qtdTotalColetadaSemMapa} un. em ${itensSemMapeamento} código(s) OL) não foi reservada por falta de de-para.`;
    }
    if (semSaldo.length) {
      const extra =
        `Liberação supervisor: reserva omitida para produto(s) interno(s) ${semSaldo.join(', ')} (saldo encerrado insuficiente).`;
      aviso = aviso ? `${aviso} ${extra}` : extra;
    }
    return { ok: true, registros: n, aviso };
  } catch (e) {
    if (schemaMissing(e)) {
      return {
        ok: true,
        skipped: true,
        reason: 'Tabela WMS_RESERVA_ESTOQUE_OPL ou dependência ausente. Execute adicionar_wms_reserva_opl_picking_postgres.sql.',
      };
    }
    throw e;
  }
}

/**
 * Outras cargas que ainda usam o mesmo espelho OPL (pedidos na NF) e não foram expedidas.
 * Evita apagar reserva do espelho inteiro quando só uma carga confirma saída (#5 e #6 no mesmo OPL).
 */
async function listarCargasNaoExpedidasMesmoEspelhoOpl(client, tenantId, cdOplArquivo, excluirCdCarga) {
  const r = await client.query(
    `WITH pedidos_espelho AS (
       SELECT DISTINCT LPAD(regexp_replace(trim(p."NUM_PEDIDO"), '[^0-9]', '', 'g'), 10, '0') AS ped
         FROM "WMS_OPL_PEDIDO" p
        WHERE p."CD_OPL_ARQUIVO" = $1::integer
          AND trim(COALESCE(p."NUM_PEDIDO", '')) <> ''
     ),
     cargas_pedido AS (
       SELECT DISTINCT j."CD_CARGA" AS cd_carga
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA" AND n."TENANT_ID" = $2
        CROSS JOIN LATERAL jsonb_array_elements(
                CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END
              ) ln
         JOIN pedidos_espelho pe
           ON pe.ped = LPAD(regexp_replace(trim(COALESCE(ln->>'xPed', '')), '[^0-9]', '', 'g'), 10, '0')
        WHERE pe.ped <> ''
     )
     SELECT c."CD_CARGA"
       FROM cargas_pedido cp
       JOIN "WMS_CARGA_PROGRAMADA" c ON c."CD_CARGA" = cp.cd_carga AND c."TENANT_ID" = $2
       LEFT JOIN "WMS_EXPEDICAO_CARGA" e ON e."CD_CARGA" = c."CD_CARGA" AND e."TENANT_ID" = $2
      WHERE c."CD_CARGA" <> $3::integer
        AND COALESCE(UPPER(e."ST_EXPEDICAO"), '') <> 'EXPEDIDA'
        AND COALESCE(UPPER(c."ST_CARGA"), '') <> 'EXPEDIDA'
      ORDER BY c."CD_CARGA"`,
    [cdOplArquivo, tenantId, excluirCdCarga]
  );
  return (r.rows || []).map((row) => parseInt(row.CD_CARGA ?? row.cd_carga, 10)).filter(Number.isFinite);
}

/**
 * Ao confirmar saída da carga: remove reservas do espelho OPL só quando não há outra carga
 * pendente no mesmo arquivo OPL (várias cargas programadas no mesmo espelho de separação).
 *
 * @param {import('pg').PoolClient} client
 * @returns {Promise<{ liberados: number; cdOplArquivo?: number|null; skipped?: boolean; mantidasParaCargas?: number[] }>}
 */
async function liberarReservasOplPorCargaExpedida(client, tenantId, cdCarga) {
  try {
    const espelhos = await resolverEspelhosOplParaCarga(tenantId, cdCarga, client);
    if (!espelhos.length) {
      return { liberados: 0, cdOplArquivo: null, cdOplArquivos: [] };
    }
    let total = 0;
    const cdsOpl = [];
    const mantidasParaCargas = [];
    for (const esp of espelhos) {
      const cdOpl = parseInt(String(esp.CD_OPL_ARQUIVO), 10);
      if (!Number.isFinite(cdOpl)) continue;
      cdsOpl.push(cdOpl);
      const pendentes = await listarCargasNaoExpedidasMesmoEspelhoOpl(
        client,
        tenantId,
        cdOpl,
        cdCarga
      );
      if (pendentes.length) {
        mantidasParaCargas.push(...pendentes);
        continue;
      }
      const del = await client.query(
        `DELETE FROM "WMS_RESERVA_ESTOQUE_OPL" WHERE "TENANT_ID" = $1 AND "CD_OPL_ARQUIVO" = $2::integer`,
        [tenantId, cdOpl]
      );
      total += del.rowCount || 0;
    }
    return {
      liberados: total,
      cdOplArquivo: cdsOpl[0] != null ? cdsOpl[0] : null,
      cdOplArquivos: cdsOpl,
      mantidasParaCargas: mantidasParaCargas.length ? [...new Set(mantidasParaCargas)] : undefined,
    };
  } catch (e) {
    if (schemaMissing(e)) {
      return { liberados: 0, skipped: true };
    }
    throw e;
  }
}

/**
 * Reaplica reservas OPL de todos os espelhos de uma carga reaberta (expedida → em expedição).
 * Limpa reservas só desta carga, valida saldo agregando todos os espelhos do mesmo dono
 * (evita falso conflito «picking + outros espelhos» entre OPL #15, #19, #29… da mesma carga).
 *
 * @param {import('pg').PoolClient} client
 * @param {{ ignorarSaldoInsuficiente?: boolean }} [opts]
 */
async function reaplicarReservasOplCargaReaberta(client, tenantId, cdCarga, sgUser, opts) {
  const ignorarSaldo = !!(opts && opts.ignorarSaldoInsuficiente);
  try {
    const espelhos = await resolverEspelhosOplParaCarga(tenantId, cdCarga, client);
    if (!espelhos.length) {
      return { ok: true, registros: 0, espelhos: 0, avisos: [] };
    }

    const planos = [];
    const cdsOpl = [];
    for (const esp of espelhos) {
      const cdOpl = parseInt(String(esp.CD_OPL_ARQUIVO), 10);
      const cdDono = esp.CD_DONO != null ? parseInt(String(esp.CD_DONO), 10) : NaN;
      if (!Number.isFinite(cdOpl) || !Number.isFinite(cdDono)) continue;
      cdsOpl.push(cdOpl);
      const agg = await agregarQtColetadaPorCdProdutoOpl(client, tenantId, cdDono, cdOpl);
      planos.push({
        cdOpl,
        cdDono,
        byCd: agg.byCd,
        itensSemMapeamento: agg.itensSemMapeamento,
        qtdTotalColetadaSemMapa: agg.qtdTotalColetadaSemMapa,
      });
    }
    if (!planos.length) {
      return { ok: true, registros: 0, espelhos: 0, avisos: [] };
    }

    for (const cdOpl of cdsOpl) {
      await client.query(
        `DELETE FROM "WMS_RESERVA_ESTOQUE_OPL" WHERE "TENANT_ID" = $1 AND "CD_OPL_ARQUIVO" = $2::integer`,
        [tenantId, cdOpl]
      );
    }

    const avisos = [];
    let totalReg = 0;
    const sg = sgUser != null ? String(sgUser).slice(0, 64) : null;
    const donos = [...new Set(planos.map((p) => p.cdDono))];

    for (const cdDono of donos) {
      const saldo = await saldoPorCdProdutoRecebimentoEncerradoMaisMovimentos(tenantId, cdDono, client);
      const rO = await client.query(
        `SELECT "CD_PRODUTO", SUM("QTD_RESERVADA")::numeric AS q
           FROM "WMS_RESERVA_ESTOQUE_OPL"
          WHERE "TENANT_ID" = $1
            AND "CD_DONO" = $2::integer
            AND NOT ("CD_OPL_ARQUIVO" = ANY($3::int[]))
          GROUP BY "CD_PRODUTO"`,
        [tenantId, cdDono, cdsOpl]
      );
      const outros = new Map();
      for (const row of rO.rows || []) {
        const id = parseInt(row.CD_PRODUTO ?? row.cd_produto, 10);
        if (!Number.isFinite(id)) continue;
        const q = Number(row.q);
        outros.set(id, Number.isFinite(q) ? q : 0);
      }

      const needAgg = new Map();
      for (const p of planos.filter((x) => x.cdDono === cdDono)) {
        for (const [cdProd, need] of p.byCd) {
          needAgg.set(cdProd, Number(((needAgg.get(cdProd) || 0) + need).toFixed(6)));
        }
      }

      const semSaldo = new Set();
      for (const [cdProd, totalNeed] of needAgg) {
        const s = saldo.get(cdProd) || 0;
        const o = outros.get(cdProd) || 0;
        if (totalNeed + o > s + 1e-6) {
          if (ignorarSaldo) {
            semSaldo.add(cdProd);
          } else {
            const err = new Error(
              `Reserva: saldo encerrado insuficiente para o produto interno ${cdProd} (picking total ${totalNeed} + reservas de outras cargas ${o} > saldo estimado ${s}). Ajuste picking ou libere outra reserva.`
            );
            err.code = 'RESERVA_CONFLITO';
            throw err;
          }
        }
      }

      for (const p of planos.filter((x) => x.cdDono === cdDono)) {
        if (p.itensSemMapeamento > 0 && p.qtdTotalColetadaSemMapa > 0) {
          avisos.push(
            `OPL #${p.cdOpl}: parte do picking (${p.qtdTotalColetadaSemMapa} un.) sem de-para — reserva parcial.`
          );
        }
        for (const [cdProd, need] of p.byCd) {
          if (ignorarSaldo && semSaldo.has(cdProd)) continue;
          await client.query(
            `INSERT INTO "WMS_RESERVA_ESTOQUE_OPL"
              ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "CD_OPL_ARQUIVO", "QTD_RESERVADA", "SG_USER")
             VALUES ($1, $2::integer, $3::integer, $4::integer, $5::numeric, $6)`,
            [tenantId, cdDono, cdProd, p.cdOpl, need, sg]
          );
          totalReg += 1;
        }
      }
      if (semSaldo.size) {
        avisos.push(
          `Reabertura: reserva omitida para produto(s) interno(s) ${[...semSaldo].join(', ')} (saldo insuficiente após estorno).`
        );
      }
    }

    return { ok: true, registros: totalReg, espelhos: planos.length, avisos };
  } catch (e) {
    if (schemaMissing(e)) {
      return {
        ok: true,
        registros: 0,
        skipped: true,
        avisos: ['Tabela de reserva OPL ausente — reabertura sem recriar reservas.'],
      };
    }
    throw e;
  }
}

module.exports = {
  aplicarReservasAoConcluirPickingOpl,
  reaplicarReservasOplCargaReaberta,
  listarReservasPorOplArquivo,
  removerReservasOplArquivo,
  listarCargasNaoExpedidasMesmoEspelhoOpl,
  liberarReservasOplPorCargaExpedida,
};
