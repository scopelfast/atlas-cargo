'use strict';

const {
  carregarDemandaCodigoPorDonoNfCarga,
} = require('./wms-carga-validacao.service');
const { agregarQtdPorCdProdutoCodigosExternos } = require('./wms-opl-cobertura-estoque.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

async function proximaSeqMovimento(client, tenantId, cdCarga, cdDono, cdProd, tpMovimento) {
  const r = await client.query(
    `SELECT COUNT(*)::int AS c
       FROM "WMS_MOVIMENTO_ESTOQUE"
      WHERE "TENANT_ID" = $1
        AND "REF_CD_CARGA" = $2::integer
        AND "CD_DONO" = $3::integer
        AND "CD_PRODUTO" = $4::integer
        AND "TP_MOVIMENTO" = $5`,
    [tenantId, cdCarga, cdDono, cdProd, tpMovimento]
  );
  return (Number(r.rows[0] && r.rows[0].c) || 0) + 1;
}

async function netExpedicaoCargaProduto(client, tenantId, cdCarga, cdDono, cdProd) {
  const r = await client.query(
    `SELECT COALESCE(SUM("QTD"), 0)::numeric AS net
       FROM "WMS_MOVIMENTO_ESTOQUE"
      WHERE "TENANT_ID" = $1
        AND "REF_CD_CARGA" = $2::integer
        AND "CD_DONO" = $3::integer
        AND "CD_PRODUTO" = $4::integer
        AND "TP_MOVIMENTO" IN ('EXPEDICAO_SAIDA', 'EXPEDICAO_ESTORNO')`,
    [tenantId, cdCarga, cdDono, cdProd]
  );
  return Number(r.rows[0] && r.rows[0].net) || 0;
}

async function registrarSaidaPorDono(client, tenantId, cdCarga, cdDono, demandMap, sgUser, cdOplRef) {
  const demandRows = [...demandMap.entries()].map(([cod_ol, qtd]) => ({ cod_ol, qtd }));
  if (!demandRows.length) return 0;

  const { byCd } = await agregarQtdPorCdProdutoCodigosExternos(client, tenantId, cdDono, demandRows);
  const sg = sgUser != null ? String(sgUser).slice(0, 64) : null;
  let n = 0;
  for (const [cdProd, qtd] of byCd) {
    const seq = await proximaSeqMovimento(client, tenantId, cdCarga, cdDono, cdProd, 'EXPEDICAO_SAIDA');
    const key = `EXP_SAIDA|CA${cdCarga}|D${cdDono}|P${cdProd}|N${seq}`;
    const ins = await client.query(
      `INSERT INTO "WMS_MOVIMENTO_ESTOQUE"
        ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "QTD", "TP_MOVIMENTO", "REF_CD_CARGA", "REF_CD_OPL_ARQUIVO", "IDEMPOTENCY_KEY", "SG_USER")
       VALUES ($1, $2::integer, $3::integer, $4::numeric, 'EXPEDICAO_SAIDA', $5::integer, $6::integer, $7, $8)
       ON CONFLICT ("TENANT_ID", "IDEMPOTENCY_KEY") DO NOTHING`,
      [
        tenantId,
        cdDono,
        cdProd,
        -Math.abs(Number(qtd) || 0),
        cdCarga,
        cdOplRef,
        key.slice(0, 128),
        sg,
      ]
    );
    n += ins.rowCount || 0;
  }
  return n;
}

/**
 * Garante que o ledger reflita a demanda da carga expedida (corrige 2ª saída após reabertura).
 * expectedNet = −demanda; insere EXPEDICAO_SAIDA faltante com chave sequencial N.
 */
async function sincronizarMovimentosExpedicaoSaidaCarga(client, tenantId, cdCarga, sgUser, opts) {
  opts = opts || {};
  let inseridos = 0;
  const porDono = await carregarDemandaCodigoPorDonoNfCarga(tenantId, cdCarga, client);
  if (!porDono.size) return { ok: true, registros: 0 };

  const sg = sgUser != null ? String(sgUser).slice(0, 64) : null;
  let idx = 0;
  const cdOplLista = Array.isArray(opts.cdOplArquivos)
    ? opts.cdOplArquivos.map((v) => parseInt(String(v), 10)).filter(Number.isFinite)
    : [];

  for (const [cdDono, demandMap] of porDono) {
    const demandRows = [...demandMap.entries()].map(([cod_ol, qtd]) => ({ cod_ol, qtd }));
    const { byCd } = await agregarQtdPorCdProdutoCodigosExternos(client, tenantId, cdDono, demandRows);
    const cdOplRef =
      cdOplLista[idx] != null && Number.isFinite(cdOplLista[idx])
        ? cdOplLista[idx]
        : opts.cdOplArquivo != null && Number.isFinite(parseInt(String(opts.cdOplArquivo), 10))
          ? parseInt(String(opts.cdOplArquivo), 10)
          : null;

    for (const [cdProd, qtdDem] of byCd) {
      const qtd = Math.abs(Number(qtdDem) || 0);
      if (qtd < 1e-9) continue;
      const expectedNet = Number((-qtd).toFixed(6));
      let netAtual = Number((await netExpedicaoCargaProduto(client, tenantId, cdCarga, cdDono, cdProd)).toFixed(6));

      /** Excesso: saídas duplicadas no ledger (ex. confirmar + sync) acima da demanda NF. */
      if (netAtual < expectedNet - 1e-6) {
        const excessoNet = Number((netAtual - expectedNet).toFixed(6));
        const estornoQtd = Math.abs(excessoNet);
        const seqEst = await proximaSeqMovimento(client, tenantId, cdCarga, cdDono, cdProd, 'EXPEDICAO_ESTORNO');
        const keyEst = `EXP_AJUSTE_EXCESSO|CA${cdCarga}|D${cdDono}|P${cdProd}|N${seqEst}`;
        const insEst = await client.query(
          `INSERT INTO "WMS_MOVIMENTO_ESTOQUE"
            ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "QTD", "TP_MOVIMENTO", "REF_CD_CARGA", "REF_CD_OPL_ARQUIVO", "IDEMPOTENCY_KEY", "SG_USER")
           VALUES ($1, $2::integer, $3::integer, $4::numeric, 'EXPEDICAO_ESTORNO', $5::integer, $6::integer, $7, $8)
           ON CONFLICT ("TENANT_ID", "IDEMPOTENCY_KEY") DO NOTHING`,
          [
            tenantId,
            cdDono,
            cdProd,
            estornoQtd,
            cdCarga,
            cdOplRef,
            keyEst.slice(0, 128),
            sg,
          ]
        );
        inseridos += insEst.rowCount || 0;
        netAtual = Number((await netExpedicaoCargaProduto(client, tenantId, cdCarga, cdDono, cdProd)).toFixed(6));
      }

      const falta = Number((expectedNet - netAtual).toFixed(6));
      if (falta >= -1e-6) continue;

      const seq = await proximaSeqMovimento(client, tenantId, cdCarga, cdDono, cdProd, 'EXPEDICAO_SAIDA');
      const key = `EXP_SAIDA|CA${cdCarga}|D${cdDono}|P${cdProd}|N${seq}`;
      const ins = await client.query(
        `INSERT INTO "WMS_MOVIMENTO_ESTOQUE"
          ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "QTD", "TP_MOVIMENTO", "REF_CD_CARGA", "REF_CD_OPL_ARQUIVO", "IDEMPOTENCY_KEY", "SG_USER")
         VALUES ($1, $2::integer, $3::integer, $4::numeric, 'EXPEDICAO_SAIDA', $5::integer, $6::integer, $7, $8)
         ON CONFLICT ("TENANT_ID", "IDEMPOTENCY_KEY") DO NOTHING`,
        [
          tenantId,
          cdDono,
          cdProd,
          falta,
          cdCarga,
          cdOplRef,
          key.slice(0, 128),
          sg,
        ]
      );
      inseridos += ins.rowCount || 0;
    }
    idx += 1;
  }
  return { ok: true, registros: inseridos };
}

async function listarCargasExpedidas(client, tenantId) {
  const r = await client.query(
    `SELECT e."CD_CARGA"
       FROM "WMS_EXPEDICAO_CARGA" e
      WHERE e."TENANT_ID" = $1
        AND UPPER(TRIM(COALESCE(e."ST_EXPEDICAO", ''))) = 'EXPEDIDA'
      ORDER BY e."CD_CARGA"`,
    [tenantId]
  );
  return (r.rows || [])
    .map((row) => parseInt(String(row.CD_CARGA), 10))
    .filter(Number.isFinite);
}

/** Quantos produtos da carga expedida têm ledger de expedição abaixo da demanda (sem inserir). */
async function contarPendenciasSyncExpedicaoCarga(client, tenantId, cdCarga) {
  let pendentes = 0;
  const porDono = await carregarDemandaCodigoPorDonoNfCarga(tenantId, cdCarga, client);
  for (const [cdDono, demandMap] of porDono) {
    const demandRows = [...demandMap.entries()].map(([cod_ol, qtd]) => ({ cod_ol, qtd }));
    const { byCd } = await agregarQtdPorCdProdutoCodigosExternos(client, tenantId, cdDono, demandRows);
    for (const [cdProd, qtdDem] of byCd) {
      const qtd = Math.abs(Number(qtdDem) || 0);
      if (qtd < 1e-9) continue;
      const expectedNet = Number((-qtd).toFixed(6));
      const netAtual = Number(
        (await netExpedicaoCargaProduto(client, tenantId, cdCarga, cdDono, cdProd)).toFixed(6)
      );
      if (Math.abs(expectedNet - netAtual) > 1e-6) pendentes += 1;
    }
  }
  return pendentes;
}

/**
 * Repara ledger de todas as cargas expedidas do tenant (ou lista informada).
 * @param {{ dryRun?: boolean, cdCargas?: number[], incluirDetalhes?: boolean, maxDetalhes?: number }} opts
 */
async function sincronizarMovimentosExpedicaoSaidaTodasCargas(client, tenantId, sgUser, opts) {
  opts = opts || {};
  const dryRun = !!opts.dryRun;
  const incluirDetalhes = opts.incluirDetalhes !== false;
  const maxDetalhes = Number.isFinite(opts.maxDetalhes) ? opts.maxDetalhes : 500;
  const cargas = Array.isArray(opts.cdCargas) && opts.cdCargas.length
    ? opts.cdCargas.map((c) => parseInt(c, 10)).filter(Number.isFinite)
    : await listarCargasExpedidas(client, tenantId);

  const detalhes = [];
  let registros = 0;
  let cargasReparadas = 0;
  let cargasComPendencia = 0;

  for (const cdCarga of cargas) {
    const pend = await contarPendenciasSyncExpedicaoCarga(client, tenantId, cdCarga);
    if (pend <= 0) continue;
    cargasComPendencia += 1;
    if (dryRun) {
      if (incluirDetalhes && detalhes.length < maxDetalhes) {
        detalhes.push({ cdCarga, produtosPendentes: pend });
      }
      continue;
    }
    const sync = await sincronizarMovimentosExpedicaoSaidaCarga(client, tenantId, cdCarga, sgUser, {});
    if (sync.registros > 0) {
      cargasReparadas += 1;
      registros += sync.registros;
      if (incluirDetalhes && detalhes.length < maxDetalhes) {
        detalhes.push({ cdCarga, registrosInseridos: sync.registros, produtosPendentes: pend });
      }
    }
  }

  return {
    ok: true,
    dryRun,
    cargasAnalisadas: cargas.length,
    cargasComPendencia,
    cargasReparadas: dryRun ? 0 : cargasReparadas,
    registrosInseridos: dryRun ? 0 : registros,
    detalhes: incluirDetalhes ? detalhes : undefined,
  };
}

/**
 * Alinha ledger de expedição com a demanda das NF (idempotente: insere falta ou estorna excesso).
 */
async function registrarSaidaExpedicaoCarga(client, tenantId, cdCarga, sgUser, opts) {
  try {
    return await sincronizarMovimentosExpedicaoSaidaCarga(client, tenantId, cdCarga, sgUser, opts || {});
  } catch (e) {
    if (schemaMissing(e)) {
      return { ok: true, registros: 0, skipped: true };
    }
    throw e;
  }
}

/**
 * Estorna saldo líquido negativo de expedição na carga (saídas + estornos anteriores).
 */
async function estornarSaidaExpedicaoCarga(client, tenantId, cdCarga, sgUser) {
  try {
    const r = await client.query(
      `SELECT "CD_DONO", "CD_PRODUTO",
              SUM("QTD")::numeric AS net_exp,
              MIN("REF_CD_OPL_ARQUIVO") AS ref_opl
         FROM "WMS_MOVIMENTO_ESTOQUE"
        WHERE "TENANT_ID" = $1
          AND "REF_CD_CARGA" = $2::integer
          AND "TP_MOVIMENTO" IN ('EXPEDICAO_SAIDA', 'EXPEDICAO_ESTORNO')
        GROUP BY "CD_DONO", "CD_PRODUTO"
       HAVING SUM("QTD") < -1e-9`,
      [tenantId, cdCarga]
    );
    const sg = sgUser != null ? String(sgUser).slice(0, 64) : null;
    let n = 0;
    for (const row of r.rows || []) {
      const netExp = Number(row.net_exp);
      if (!Number.isFinite(netExp) || netExp >= -1e-9) continue;
      const cdDono = parseInt(String(row.CD_DONO), 10);
      const cdProd = parseInt(String(row.CD_PRODUTO), 10);
      if (!Number.isFinite(cdDono) || !Number.isFinite(cdProd)) continue;
      const estornoQtd = Math.abs(netExp);
      const cdOplRef =
        row.ref_opl != null && row.ref_opl !== '' ? parseInt(String(row.ref_opl), 10) : null;
      const seq = await proximaSeqMovimento(client, tenantId, cdCarga, cdDono, cdProd, 'EXPEDICAO_ESTORNO');
      const key = `EXP_ESTORNO|CA${cdCarga}|D${cdDono}|P${cdProd}|N${seq}`;
      const ins = await client.query(
        `INSERT INTO "WMS_MOVIMENTO_ESTOQUE"
          ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "QTD", "TP_MOVIMENTO", "REF_CD_CARGA", "REF_CD_OPL_ARQUIVO", "IDEMPOTENCY_KEY", "SG_USER")
         VALUES ($1, $2::integer, $3::integer, $4::numeric, 'EXPEDICAO_ESTORNO', $5::integer, $6::integer, $7, $8)
         ON CONFLICT ("TENANT_ID", "IDEMPOTENCY_KEY") DO NOTHING`,
        [
          tenantId,
          cdDono,
          cdProd,
          estornoQtd,
          cdCarga,
          Number.isFinite(cdOplRef) ? cdOplRef : null,
          key.slice(0, 128),
          sg,
        ]
      );
      n += ins.rowCount || 0;
    }
    return { ok: true, registros: n };
  } catch (e) {
    if (schemaMissing(e)) {
      return { ok: true, registros: 0, skipped: true };
    }
    throw e;
  }
}

module.exports = {
  registrarSaidaExpedicaoCarga,
  estornarSaidaExpedicaoCarga,
  sincronizarMovimentosExpedicaoSaidaCarga,
  sincronizarMovimentosExpedicaoSaidaTodasCargas,
  contarPendenciasSyncExpedicaoCarga,
  listarCargasExpedidas,
};
