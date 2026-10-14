'use strict';

const { pool } = require('../config/db');
const { applyProductMask } = require('./wms-relatorio-posicao-estoque.service');
const {
  parseDataIso,
  montarRotuloFiltroPeriodo,
} = require('./wms-relatorio-movimentacao.service');
const { extrairDataEntregaPedidoOpl } = require('./wms-opl-relatorio-romaneio.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

const AVISOS_PADRAO = [
  'Linhas do espelho OPL (Separação): pedido, destino, quantidade pedida e quantidade coletada no picking.',
  'Período filtra pela data de importação do arquivo OPL (DH_IMPORT), não pela data do picking (não há carimbo por linha).',
  'Data de entrega: programação do pedido no arquivo OPL (campo de entrega do tipo 2), não é a data de importação nem do picking.',
  'Itens com picking concluído geram reserva de estoque ao encerrar o espelho; a baixa formal ocorre na expedição (relatório Movimentação).',
];

function normalizarSituacaoPicking(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s === 'pendente' || s === 'pend') return 'pendente';
  if (s === 'coletado' || s === 'ok' || s === 'concluido' || s === 'concluída') return 'coletado';
  if (s === 'divergente' || s === 'div') return 'divergente';
  if (s === 'com_coleta' || s === 'com-coleta' || s === 'pick') return 'com_coleta';
  return '';
}

function montarRotuloFiltroSituacao(filtros) {
  const s = normalizarSituacaoPicking(filtros?.situacaoPicking);
  if (s === 'pendente') return 'Somente pendentes (sem qtd coletada)';
  if (s === 'coletado') return 'Somente coletados (qtd = pedida)';
  if (s === 'divergente') return 'Somente divergentes (qtd coletada ≠ pedida)';
  if (s === 'com_coleta') return 'Com quantidade coletada informada';
  return '';
}

function montarRotuloFiltroEspelho(filtros) {
  const parts = [];
  const esp = String(filtros?.espelho ?? '').trim();
  if (esp) parts.push(`Espelho contém: ${esp}`);
  const cd = parseInt(filtros?.cdOplArquivo, 10);
  if (Number.isFinite(cd)) parts.push(`Nº espelho: #${cd}`);
  return parts.join(' · ');
}

function montarRotuloFiltroPedidoDestino(filtros) {
  const parts = [];
  const ped = String(filtros?.numPedido ?? '').trim();
  if (ped) parts.push(`Pedido OPL: ${ped}`);
  const dest = String(filtros?.destino ?? '').trim();
  if (dest) parts.push(`Destino contém: ${dest}`);
  return parts.join(' · ');
}

function montarRotuloTipoPeriodo(filtros) {
  const t = String(filtros?.tipoPeriodo || 'importacao').toLowerCase();
  if (t === 'entrega') return 'Data de entrega do pedido OPL';
  return 'Data de importação do espelho';
}

function parseDataBrParaIso(s) {
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function filtrarLinhasPorDataEntrega(linhas, dtDe, dtAte) {
  if (!dtDe && !dtAte) return linhas || [];
  return (linhas || []).filter((row) => {
    const iso = parseDataBrParaIso(row.DATA_ENTREGA);
    if (!iso) return false;
    if (dtDe && iso < dtDe) return false;
    if (dtAte && iso > dtAte) return false;
    return true;
  });
}

function situacaoLinha(qtPed, qtCol) {
  const ped = Number(qtPed);
  const colRaw = qtCol;
  if (colRaw == null || colRaw === '') return 'PENDENTE';
  const col = Number(colRaw);
  if (!Number.isFinite(col)) return 'PENDENTE';
  if (!Number.isFinite(ped)) return 'COLETADO';
  if (Math.abs(col - ped) < 0.000001) return 'COLETADO';
  return 'DIVERGENTE';
}

/**
 * @param {string} tenantId
 * @param {{ cdDono?: string|number, dtDe?: string, dtAte?: string, situacaoPicking?: string, espelho?: string, cdOplArquivo?: string|number, numPedido?: string, destino?: string, tipoPeriodo?: string }} filtros
 */
async function listarSeparacaoOplItens(tenantId, filtros) {
  filtros = filtros || {};
  const params = [tenantId];
  let donoClause = '';
  if (filtros.cdDono != null && String(filtros.cdDono).trim() !== '') {
    const n = parseInt(filtros.cdDono, 10);
    if (Number.isFinite(n)) {
      params.push(n);
      donoClause = ` AND a."CD_DONO" = $${params.length}::integer`;
    }
  }
  const dtDe = parseDataIso(filtros.dtDe);
  const dtAte = parseDataIso(filtros.dtAte);
  const tipoPeriodo = String(filtros.tipoPeriodo || 'importacao').toLowerCase();
  let dtClause = '';
  if (tipoPeriodo !== 'entrega') {
    if (dtDe) {
      params.push(dtDe);
      dtClause += ` AND a."DH_IMPORT" >= $${params.length}::date`;
    }
    if (dtAte) {
      params.push(dtAte);
      dtClause += ` AND a."DH_IMPORT" < ($${params.length}::date + interval '1 day')`;
    }
  }

  let espelhoClause = '';
  const espF = String(filtros.espelho ?? '').trim();
  if (espF) {
    params.push(`%${espF}%`);
    espelhoClause += ` AND upper(a."NM_ARQUIVO") LIKE upper($${params.length})`;
  }
  const cdOpl = parseInt(filtros.cdOplArquivo, 10);
  if (Number.isFinite(cdOpl)) {
    params.push(cdOpl);
    espelhoClause += ` AND a."CD_OPL_ARQUIVO" = $${params.length}::integer`;
  }
  const pedF = String(filtros.numPedido ?? '').trim();
  if (pedF) {
    params.push(`%${pedF}%`);
    espelhoClause += ` AND p."NUM_PEDIDO" LIKE $${params.length}`;
  }
  const destF = String(filtros.destino ?? '').trim();
  if (destF) {
    params.push(`%${destF.toUpperCase()}%`);
    const pDest = params.length;
    espelhoClause += ` AND (
      upper(coalesce(p."COD_DESTINATARIO", '')) LIKE $${pDest}
      OR upper(coalesce(p."RAZ_SOC_DEST", '')) LIKE $${pDest}
      OR upper(coalesce(p."CIDADE_ENTREGA", '')) LIKE $${pDest}
    )`;
  }

  const sit = normalizarSituacaoPicking(filtros.situacaoPicking);
  let sitClause = '';
  if (sit === 'pendente') sitClause = ` AND i."QT_COLETADA" IS NULL`;
  else if (sit === 'com_coleta') sitClause = ` AND i."QT_COLETADA" IS NOT NULL`;
  else if (sit === 'coletado') {
    sitClause = ` AND i."QT_COLETADA" IS NOT NULL AND i."QT_COLETADA" = i."QT_PEDIDA"`;
  } else if (sit === 'divergente') {
    sitClause = ` AND i."QT_COLETADA" IS NOT NULL AND i."QT_COLETADA" IS DISTINCT FROM i."QT_PEDIDA"`;
  }

  let prodClause = '';
  const codF = String(filtros.codigoProduto ?? '').trim();
  if (codF) {
    const codN = codF.toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (codN) {
      params.push(`%${codN}%`);
      const pCod = params.length;
      prodClause += ` AND (
        regexp_replace(upper(trim(i."COD_PRODUTO_OL")), '[^0-9A-Z]', '', 'g') LIKE $${pCod}
        OR regexp_replace(upper(trim(coalesce(pd."CODIGO", ''))), '[^0-9A-Z]', '', 'g') LIKE $${pCod}
      )`;
    }
  }
  const descF = String(filtros.descricaoProduto ?? '').trim();
  if (descF) {
    params.push(`%${descF.toUpperCase()}%`);
    prodClause += ` AND (upper(coalesce(i."DESCRICAO", '')) LIKE $${params.length} OR upper(coalesce(pd."NOME", '')) LIKE $${params.length})`;
  }

  const sql = `
    SELECT
      a."DH_IMPORT" AS "DH_REF",
      a."CD_OPL_ARQUIVO",
      a."NM_ARQUIVO",
      a."CD_DONO",
      d."NOME" AS "NM_DONO",
      d."MASCARA_CODIGO_PRODUTO",
      p."NUM_PEDIDO",
      p."COD_DESTINATARIO",
      p."RAZ_SOC_DEST",
      p."CIDADE_ENTREGA",
      p."UF_ENTREGA",
      p."LINHA2_RAW",
      p."DADOS_JSON",
      p."DATA_PEDIDO",
      i."COD_PRODUTO_OL",
      i."DESCRICAO" AS "DS_OPL",
      i."QT_PEDIDA",
      i."QT_COLETADA",
      pd."CODIGO" AS "CODIGO_PRODUTO_INTERNO",
      pd."NOME" AS "NM_CADASTRO",
      pd."TIPO_ARMAZENAGEM"
    FROM "WMS_OPL_ITEM" i
    JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_PEDIDO" = i."CD_OPL_PEDIDO"
    JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO" = p."CD_OPL_ARQUIVO" AND a."TENANT_ID" = $1
    LEFT JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = a."CD_DONO" AND d."TENANT_ID" = a."TENANT_ID"
    LEFT JOIN "WMS_PRODUTO_DONO" pd
      ON pd."TENANT_ID" = a."TENANT_ID"
     AND pd."CD_DONO" = a."CD_DONO"
     AND pd."FGACTIVE" = 'S'
     AND regexp_replace(upper(trim(pd."CODIGO")), '[^0-9A-Z]', '', 'g')
         = regexp_replace(upper(trim(i."COD_PRODUTO_OL")), '[^0-9A-Z]', '', 'g')
    WHERE 1=1
      ${donoClause}
      ${dtClause}
      ${espelhoClause}
      ${sitClause}
      ${prodClause}
    ORDER BY a."DH_IMPORT" DESC, a."CD_OPL_ARQUIVO" DESC, p."NUM_PEDIDO", i."SEQ_ITEM"
    LIMIT 15000
  `;

  try {
    const r = await pool.query(sql, params);
    const linhas = (r.rows || []).map((row) => {
      const codInterno = String(row.CODIGO_PRODUTO_INTERNO || row.COD_PRODUTO_OL || '').trim();
      const mask = String(row.MASCARA_CODIGO_PRODUTO || '').trim();
      const qtPed = Number(row.QT_PEDIDA) || 0;
      const qtColRaw = row.QT_COLETADA;
      const qtCol = qtColRaw != null && qtColRaw !== '' ? Number(qtColRaw) : null;
      const st = situacaoLinha(qtPed, qtColRaw);
      const delta =
        qtCol != null && Number.isFinite(qtCol) ? Number((qtCol - qtPed).toFixed(6)) : null;
      const entregaOpl = extrairDataEntregaPedidoOpl(row);
      return {
        DH_REF: row.DH_REF,
        CD_OPL_ARQUIVO: row.CD_OPL_ARQUIVO,
        NM_ARQUIVO: row.NM_ARQUIVO || '',
        CD_DONO: row.CD_DONO,
        NM_DONO: row.NM_DONO || '',
        NUM_PEDIDO: row.NUM_PEDIDO || '',
        DATA_ENTREGA: entregaOpl.data || '',
        COD_DESTINATARIO: row.COD_DESTINATARIO || '',
        DESTINO: [row.COD_DESTINATARIO, row.RAZ_SOC_DEST].filter(Boolean).join(' — '),
        CIDADE_UF: [row.CIDADE_ENTREGA, row.UF_ENTREGA].filter(Boolean).join(' / '),
        CODIGO_PRODUTO: mask && codInterno ? applyProductMask(codInterno, mask) : codInterno,
        CODIGO_PRODUTO_INTERNO: codInterno,
        NM_PRODUTO: String(row.NM_CADASTRO || row.DS_OPL || '').trim(),
        TIPO_ARMAZENAGEM: row.TIPO_ARMAZENAGEM || '',
        QT_PEDIDA: Number(qtPed.toFixed(6)),
        QT_COLETADA: qtCol != null && Number.isFinite(qtCol) ? Number(qtCol.toFixed(6)) : null,
        DELTA: delta,
        ST_PICKING: st,
      };
    });
    let linhasFiltradas = linhas;
    if (tipoPeriodo === 'entrega') {
      linhasFiltradas = filtrarLinhasPorDataEntrega(linhasFiltradas, dtDe, dtAte);
    }
    const avisos = [...AVISOS_PADRAO];
    if (tipoPeriodo === 'entrega' && (dtDe || dtAte)) {
      avisos.push(
        'Período aplicado na coluna Entrega (programação OPL), não na data de importação do arquivo.'
      );
    }
    if (espF || Number.isFinite(cdOpl) || pedF || destF) {
      avisos.push(
        'Filtros de espelho/pedido/destino restringem o resultado ao lote ou rota desejados — use o resumo por espelho para ver em qual arquivo OPL o SKU aparece.'
      );
    }
    return { linhas: linhasFiltradas, avisos };
  } catch (e) {
    if (schemaMissing(e)) {
      const err = new Error(
        'Estrutura WMS de separação OPL ausente. Execute backend/scripts/wms_separacao_opl_postgres.sql.'
      );
      err.code = 'SCHEMA';
      throw err;
    }
    throw e;
  }
}

function resumirPorEspelho(linhas) {
  const map = new Map();
  for (const row of linhas || []) {
    const key = row.CD_OPL_ARQUIVO;
    const prev = map.get(key) || {
      CD_OPL_ARQUIVO: key,
      NM_ARQUIVO: row.NM_ARQUIVO || '',
      DH_REF: row.DH_REF,
      QT_PEDIDA: 0,
      QT_COLETADA: 0,
      LINHAS: 0,
      PEDIDOS: new Set(),
    };
    prev.QT_PEDIDA += Number(row.QT_PEDIDA) || 0;
    if (row.QT_COLETADA != null) prev.QT_COLETADA += Number(row.QT_COLETADA) || 0;
    prev.LINHAS += 1;
    if (row.NUM_PEDIDO) prev.PEDIDOS.add(row.NUM_PEDIDO);
    map.set(key, prev);
  }
  return [...map.values()]
    .map((x) => ({
      CD_OPL_ARQUIVO: x.CD_OPL_ARQUIVO,
      NM_ARQUIVO: x.NM_ARQUIVO,
      DH_REF: x.DH_REF,
      QT_PEDIDA: Number(x.QT_PEDIDA.toFixed(6)),
      QT_COLETADA: Number(x.QT_COLETADA.toFixed(6)),
      LINHAS: x.LINHAS,
      Q_PEDIDOS: x.PEDIDOS.size,
    }))
    .sort((a, b) => String(b.DH_REF || '').localeCompare(String(a.DH_REF || '')));
}

function resumirPorCodigo(linhas) {
  const map = new Map();
  for (const row of linhas || []) {
    const cod = String(row.CODIGO_PRODUTO || row.CODIGO_PRODUTO_INTERNO || '').trim();
    if (!cod) continue;
    const prev = map.get(cod) || {
      CODIGO_PRODUTO: cod,
      NM_PRODUTO: row.NM_PRODUTO || '',
      QT_PEDIDA: 0,
      QT_COLETADA: 0,
      LINHAS: 0,
      ESPelhos: new Set(),
    };
    prev.QT_PEDIDA += Number(row.QT_PEDIDA) || 0;
    if (row.QT_COLETADA != null) prev.QT_COLETADA += Number(row.QT_COLETADA) || 0;
    prev.LINHAS += 1;
    if (row.CD_OPL_ARQUIVO != null) prev.ESPelhos.add(row.CD_OPL_ARQUIVO);
    map.set(cod, prev);
  }
  return [...map.values()]
    .map((x) => ({
      CODIGO_PRODUTO: x.CODIGO_PRODUTO,
      NM_PRODUTO: x.NM_PRODUTO,
      QT_PEDIDA: Number(x.QT_PEDIDA.toFixed(6)),
      QT_COLETADA: Number(x.QT_COLETADA.toFixed(6)),
      LINHAS: x.LINHAS,
      Q_ESPELHOS: x.ESPelhos.size,
    }))
    .sort((a, b) => String(a.CODIGO_PRODUTO).localeCompare(String(b.CODIGO_PRODUTO)));
}

function linhasParaCsv(rows) {
  const cols = [
    'DH_REF',
    'CD_OPL_ARQUIVO',
    'NM_ARQUIVO',
    'CD_DONO',
    'NM_DONO',
    'NUM_PEDIDO',
    'DATA_ENTREGA',
    'DESTINO',
    'CIDADE_UF',
    'CODIGO_PRODUTO',
    'NM_PRODUTO',
    'TIPO_ARMAZENAGEM',
    'QT_PEDIDA',
    'QT_COLETADA',
    'DELTA',
    'ST_PICKING',
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

function linhasResumoParaCsv(rows) {
  const cols = ['CODIGO_PRODUTO', 'NM_PRODUTO', 'QT_PEDIDA', 'QT_COLETADA', 'LINHAS', 'Q_ESPELHOS'];
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
  listarSeparacaoOplItens,
  resumirPorCodigo,
  resumirPorEspelho,
  linhasParaCsv,
  linhasResumoParaCsv,
  montarRotuloFiltroSituacao,
  montarRotuloFiltroEspelho,
  montarRotuloFiltroPedidoDestino,
  montarRotuloTipoPeriodo,
  montarRotuloFiltroPeriodo,
  AVISOS_PADRAO,
};
