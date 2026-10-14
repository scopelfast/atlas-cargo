'use strict';

const { applyProductMask } = require('./wms-relatorio-posicao-estoque.service');
const {
  listarShelfLifeSaldoPorValidade,
  listarShelfLifeCobranca,
  parseHorizonteDiasOverride,
  parseDataReferenciaIso,
} = require('./wms-relatorio-shelf-life-saldo.service');
const {
  listarRelatorioVencimentoPorRecebimentoEncerrado,
} = require('./wms-relatorio-vencimento.service');
const {
  parseApontadoModo,
  carregarChavesApontadasAtivas,
  filtrarLinhasPorApontado,
} = require('./wms-shelf-apontado.service');
const { filtrarLinhasPorProduto } = require('./wms-relatorio-filtro-produto.service');

function mapLinhasShelfLife(rows) {
  return (rows || []).map((row) => {
    const mask = String(row.MASCARA_CODIGO_PRODUTO || '').trim();
    const codInterno = String(row.CODIGO_INTERNO || row.CODIGO_PRODUTO || '').trim();
    const codigoExib =
      mask && codInterno ? applyProductMask(codInterno, mask) : codInterno || String(row.CODIGO_PRODUTO || '');
    return { ...row, CODIGO_PRODUTO: codigoExib };
  });
}

function parseShelfOpts(src) {
  const body = src && typeof src === 'object' ? src : {};
  const somenteRaw = body.somenteVencidos ?? body.somente_vencidos;
  return {
    modo: String(body.modo || 'saldo').trim().toLowerCase(),
    horizonteDias: body.horizonteDias ?? body.horizonte_dias ?? body.diasHorizonte,
    dataReferencia:
      body.dataReferencia ?? body.data_referencia ?? body.dataBase ?? body.data_base ?? body.aPartirDe,
    apontadoModo: parseApontadoModo(body.apontado ?? body.apontamento ?? body.apontadoModo),
    somenteVencidos:
      String(somenteRaw || '') === '1' || String(somenteRaw || '').toLowerCase() === 'true',
  };
}

/** Coleta linhas shelf-life para apontamento / baixa (mesma regra dos relatórios). */
async function coletarLinhasShelf(tenantId, filtros, opts = {}) {
  const tid = String(tenantId || '').trim();
  const f = filtros || {};
  const modo = String(opts.modo || 'saldo').trim().toLowerCase();
  const horizonteDias = parseHorizonteDiasOverride(opts.horizonteDias);
  const dataReferencia = parseDataReferenciaIso(opts.dataReferencia);
  const apontadoModo = parseApontadoModo(opts.apontadoModo);
  const somenteVencidos = opts.somenteVencidos === true;

  if (modo === 'cobranca' || modo === 'vencidos-cobranca') {
    const { rows } = await listarShelfLifeCobranca(tid, f.cdDono, {
      somenteVencidos,
      apontadoModo,
      dataReferencia,
    });
    return filtrarLinhasPorProduto(rows, f);
  }
  if (modo === 'entrada') {
    const { rows } = await listarRelatorioVencimentoPorRecebimentoEncerrado(tid, f.cdDono, {
      horizonteDias,
      dataReferencia,
    });
    let linhas = filtrarLinhasPorProduto(mapLinhasShelfLife(rows), f);
    const chaves = await carregarChavesApontadasAtivas(tid, f.cdDono);
    return filtrarLinhasPorApontado(linhas, chaves, apontadoModo);
  }
  const { rows } = await listarShelfLifeSaldoPorValidade(tid, f.cdDono, {
    horizonteDias,
    dataReferencia,
    apontadoModo,
  });
  return filtrarLinhasPorProduto(rows, f);
}

module.exports = {
  parseShelfOpts,
  coletarLinhasShelf,
  mapLinhasShelfLife,
};
