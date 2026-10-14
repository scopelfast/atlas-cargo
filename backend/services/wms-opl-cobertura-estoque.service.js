'use strict';

const { pool } = require('../config/db');
const { resolverProdutoEstoque } = require('./wms-resolver-codigo-estoque.service');
const { listarPosicaoEstoque } = require('./wms-relatorio-posicao-estoque.service');
const { listarReservasOrfas } = require('./wms-diagnostico-reserva-opl.service');
const { codigoProdutoMatchKey } = require('../utils/wms-codigo-produto-mask');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function normCodigoExterno(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s.length > 64) return null;
  return s;
}

/**
 * De-para que mapeia código operacional/NF (ex. 6030303080) para irmão da mesma
 * família com sufixo diferente (ex. 6.03.03.030.40) — causa saída no SKU errado.
 * Códigos curtos de fornecedor (ex. 8741 → máscara) NÃO entram nesta regra.
 */
function deparaIrmaoFamiliaSuspeito(codigoExterno, codigoInterno) {
  const a = codigoProdutoMatchKey(codigoExterno);
  const b = codigoProdutoMatchKey(codigoInterno);
  if (!a || !b || a === b) return false;
  if (a.length < 8 || b.length < 8) return false;
  if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return false;
  if (Math.abs(a.length - b.length) > 2) return false;
  return a.slice(0, 8) === b.slice(0, 8);
}

function deparaLookupKeysFromCProd(cProd) {
  const raw = normCodigoExterno(cProd);
  if (!raw) return [];
  const keys = new Set([raw.toLowerCase()]);
  if (/^\d+$/.test(raw)) keys.add(String(parseInt(raw, 10)).toLowerCase());
  return [...keys];
}

function buildDeparaHitMap(rows) {
  const by = new Map();
  for (const d of rows || []) {
    const ex = String(d.CODIGO_EXTERNO ?? d.codigo_externo ?? '').trim();
    if (!ex) continue;
    const k = ex.toLowerCase();
    by.set(k, d);
    if (/^\d+$/.test(ex)) by.set(String(parseInt(ex, 10)).toLowerCase(), d);
  }
  return by;
}

function hitDeparaFromMap(byMap, cProd) {
  for (const k of deparaLookupKeysFromCProd(cProd)) {
    if (byMap.has(k)) return byMap.get(k);
  }
  return null;
}

/**
 * Saldo agregado por CD_PRODUTO a partir de NF-e encerradas (CONFERENCIA_JSON com cdProduto numérico).
 * @param {import('pg').Pool|import('pg').PoolClient} [executor] — default `pool` (mesma transação do picking).
 */
async function saldoPorCdProdutoRecebimentoEncerrado(tenantId, cdDono, executor) {
  const q = executor || pool;
  const r = await q.query(
    `WITH exp AS (
       SELECT e."CONFERENCIA_JSON" AS cj
         FROM "WMS_NFE_ENTRADA" e
        WHERE e."TENANT_ID" = $1
          AND e."CD_DONO" = $2::integer
          AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) = 'ENCERRADA'
          AND e."CONFERENCIA_JSON" IS NOT NULL
          AND jsonb_typeof(e."CONFERENCIA_JSON") = 'array'
     ),
     els AS (
       SELECT (elem->>'cdProduto')::integer AS cd_produto,
              COALESCE(NULLIF(TRIM(elem->>'qtdConvertida'), ''), '0')::numeric AS q
         FROM exp
         CROSS JOIN LATERAL jsonb_array_elements(exp.cj) AS elem
        WHERE (elem->>'cdProduto') ~ '^[0-9]+$'
     )
     SELECT cd_produto, SUM(q)::numeric AS saldo
       FROM els
      GROUP BY cd_produto`,
    [tenantId, cdDono]
  );
  const m = new Map();
  for (const row of r.rows || []) {
    const id = parseInt(row.cd_produto, 10);
    if (!Number.isFinite(id)) continue;
    const s = Number(row.saldo);
    m.set(id, Number.isFinite(s) ? s : 0);
  }
  return m;
}

/**
 * Saldo agregado por CD_PRODUTO a partir de NF-e de recebimento **não** encerradas (pipeline).
 * @param {import('pg').Pool|import('pg').PoolClient} [executor]
 */
async function saldoPorCdProdutoRecebimentoNaoEncerrado(tenantId, cdDono, executor) {
  const q = executor || pool;
  const r = await q.query(
    `WITH exp AS (
       SELECT e."CONFERENCIA_JSON" AS cj
         FROM "WMS_NFE_ENTRADA" e
        WHERE e."TENANT_ID" = $1
          AND e."CD_DONO" = $2::integer
          AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) <> 'ENCERRADA'
          AND e."CONFERENCIA_JSON" IS NOT NULL
          AND jsonb_typeof(e."CONFERENCIA_JSON") = 'array'
     ),
     els AS (
       SELECT (elem->>'cdProduto')::integer AS cd_produto,
              COALESCE(NULLIF(TRIM(elem->>'qtdConvertida'), ''), '0')::numeric AS q
         FROM exp
         CROSS JOIN LATERAL jsonb_array_elements(exp.cj) AS elem
        WHERE (elem->>'cdProduto') ~ '^[0-9]+$'
     )
     SELECT cd_produto, SUM(q)::numeric AS saldo
       FROM els
      GROUP BY cd_produto`,
    [tenantId, cdDono]
  );
  const m = new Map();
  for (const row of r.rows || []) {
    const id = parseInt(row.cd_produto, 10);
    if (!Number.isFinite(id)) continue;
    const s = Number(row.saldo);
    m.set(id, Number.isFinite(s) ? s : 0);
  }
  return m;
}

/**
 * Agrega quantidades por CD_PRODUTO a partir de linhas com código externo (NF-e ou OPL).
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @param {{ cod_ol: string, qtd: number|string }[]} demandRows
 */
async function agregarQtdPorCdProdutoCodigosExternos(db, tenantId, cdDono, demandRows) {
  const rows = demandRows || [];
  const allKeys = new Set();
  for (const row of rows) {
    for (const k of deparaLookupKeysFromCProd(row.cod_ol)) allKeys.add(k);
  }
  const keyArr = Array.from(allKeys).filter(Boolean);
  let byDep = new Map();
  if (keyArr.length) {
    const rDep = await db.query(
      `SELECT "CODIGO_EXTERNO", "CODIGO_INTERNO"
         FROM "WMS_DEPARA_PRODUTO"
        WHERE "TENANT_ID" = $1
          AND "CD_DONO" = $2::integer
          AND "FGACTIVE" = 'S'
          AND LOWER(TRIM("CODIGO_EXTERNO")) = ANY($3::text[])`,
      [tenantId, cdDono, keyArr]
    );
    byDep = buildDeparaHitMap(rDep.rows || []);
  }
  const internos = new Set();
  for (const row of rows) {
    const hit = hitDeparaFromMap(byDep, row.cod_ol);
    const interno = hit ? String(hit.CODIGO_INTERNO ?? hit.codigo_interno ?? '').trim() : '';
    if (interno && !deparaIrmaoFamiliaSuspeito(row.cod_ol, interno)) {
      internos.add(interno.toLowerCase());
    }
  }
  const intArr = Array.from(internos);
  const byCodigoProd = new Map();
  if (intArr.length) {
    const rPr = await db.query(
      `SELECT "CD_PRODUTO", LOWER(TRIM("CODIGO")) AS ck
         FROM "WMS_PRODUTO_DONO"
        WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer AND "FGACTIVE" = 'S'
          AND LOWER(TRIM("CODIGO")) = ANY($3::text[])`,
      [tenantId, cdDono, intArr]
    );
    for (const pr of rPr.rows || []) {
      const ck = String(pr.ck || '').trim();
      if (ck) byCodigoProd.set(ck, parseInt(pr.CD_PRODUTO, 10));
    }
  }
  const byCd = new Map();
  let itensSemMapeamento = 0;
  let qtdTotalColetadaSemMapa = 0;
  for (const row of rows) {
    const codOl = String(row.cod_ol || '').trim();
    const qPick = Number(row.qtd);
    const qtd = Number.isFinite(qPick) && qPick > 0 ? qPick : 0;
    if (qtd <= 0) continue;
    const hit = hitDeparaFromMap(byDep, codOl);
    const interno = hit ? String(hit.CODIGO_INTERNO ?? hit.codigo_interno ?? '').trim() : '';
    const deparaConfiavel = interno && !deparaIrmaoFamiliaSuspeito(codOl, interno);
    let cdProduto = deparaConfiavel ? byCodigoProd.get(interno.toLowerCase()) : null;
    if (!Number.isFinite(cdProduto)) {
      const resolv = await resolverProdutoEstoque(db, tenantId, cdDono, codOl, {
        codigoExterno: codOl,
      });
      if (resolv && Number.isFinite(resolv.cdProduto)) cdProduto = resolv.cdProduto;
    }
    if (!Number.isFinite(cdProduto)) {
      itensSemMapeamento += 1;
      qtdTotalColetadaSemMapa += qtd;
      continue;
    }
    const prev = byCd.get(cdProduto) || 0;
    byCd.set(cdProduto, Number((prev + qtd).toFixed(6)));
  }
  return { byCd, itensSemMapeamento, qtdTotalColetadaSemMapa };
}

/**
 * Soma QT_COLETADA por CD_PRODUTO (de-para + produto dono) para itens já coletados do espelho.
 * @param {import('pg').Pool|import('pg').PoolClient} db
 * @returns {Promise<{ byCd: Map<number, number>; itensSemMapeamento: number; qtdTotalColetadaSemMapa: number }>}
 */
async function agregarQtColetadaPorCdProdutoOpl(db, tenantId, cdDono, cdOplArquivo) {
  const rIt = await db.query(
    `SELECT TRIM(COALESCE(i."COD_PRODUTO_OL", '')) AS cod_ol,
            SUM(COALESCE(i."QT_COLETADA", 0))::numeric AS qtd
       FROM "WMS_OPL_ITEM" i
       JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_PEDIDO" = i."CD_OPL_PEDIDO"
      WHERE p."CD_OPL_ARQUIVO" = $1::integer
        AND i."QT_COLETADA" IS NOT NULL
      GROUP BY TRIM(COALESCE(i."COD_PRODUTO_OL", ''))
     HAVING TRIM(COALESCE(i."COD_PRODUTO_OL", '')) <> ''`,
    [cdOplArquivo]
  );
  return agregarQtdPorCdProdutoCodigosExternos(db, tenantId, cdDono, rIt.rows || []);
}

/**
 * Soma movimentos gravados (QTD pode ser negativa).
 * @param {import('pg').Pool|import('pg').PoolClient} [executor]
 */
async function somaMovimentosPorCdProduto(tenantId, cdDono, executor) {
  const q = executor || pool;
  try {
    const r = await q.query(
      `SELECT "CD_PRODUTO", SUM("QTD")::numeric AS q
         FROM "WMS_MOVIMENTO_ESTOQUE"
        WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer
        GROUP BY "CD_PRODUTO"`,
      [tenantId, cdDono]
    );
    const m = new Map();
    for (const row of r.rows || []) {
      const id = parseInt(row.CD_PRODUTO ?? row.cd_produto, 10);
      if (!Number.isFinite(id)) continue;
      const v = Number(row.q);
      m.set(id, Number.isFinite(v) ? v : 0);
    }
    return m;
  } catch (e) {
    if (schemaMissing(e)) return new Map();
    throw e;
  }
}

/**
 * Saldo de referência para simulação/reserva: entradas encerradas (CONFERENCIA_JSON) + soma dos movimentos (MVP).
 * @param {import('pg').Pool|import('pg').PoolClient} [executor]
 */
async function saldoPorCdProdutoRecebimentoEncerradoMaisMovimentos(tenantId, cdDono, executor) {
  const enc = await saldoPorCdProdutoRecebimentoEncerrado(tenantId, cdDono, executor);
  const mov = await somaMovimentosPorCdProduto(tenantId, cdDono, executor);
  const out = new Map(enc);
  for (const [cd, v] of mov) {
    const w = Number(v);
    if (!Number.isFinite(w) || Math.abs(w) < 1e-12) continue;
    out.set(cd, Number(((out.get(cd) || 0) + w).toFixed(6)));
  }
  return out;
}

/**
 * Soma `QTD_RESERVADA` por CD_PRODUTO em outros espelhos OPL (exclui o arquivo atual).
 * @param {import('pg').Pool|import('pg').PoolClient} [executor]
 */
async function mapReservaOutrosEspelhosOplPorCdProduto(tenantId, cdDono, cdOplArquivoExcluir, executor) {
  const q = executor || pool;
  const r = await q.query(
    `SELECT "CD_PRODUTO", SUM("QTD_RESERVADA")::numeric AS q
       FROM "WMS_RESERVA_ESTOQUE_OPL"
      WHERE "TENANT_ID" = $1
        AND "CD_DONO" = $2::integer
        AND "CD_OPL_ARQUIVO" <> $3::integer
      GROUP BY "CD_PRODUTO"`,
    [tenantId, cdDono, cdOplArquivoExcluir]
  );
  const m = new Map();
  for (const row of r.rows || []) {
    const id = parseInt(row.CD_PRODUTO ?? row.cd_produto, 10);
    if (!Number.isFinite(id)) continue;
    const v = Number(row.q);
    m.set(id, Number.isFinite(v) ? v : 0);
  }
  return m;
}

/** Soma QTD_RESERVADA órfã (espelho com todas cargas expedidas) por CD_PRODUTO. */
async function mapReservaOrfasDeletaveisPorCdProduto(tenantId, cdDono) {
  const m = new Map();
  const r = await listarReservasOrfas(tenantId, cdDono);
  if (r.err) return m;
  for (const o of r.ok.orfas || []) {
    const cd = parseInt(o.CD_PRODUTO, 10);
    if (!Number.isFinite(cd)) continue;
    const q = Number(o.QTD_RESERVADA) || 0;
    m.set(cd, (m.get(cd) || 0) + q);
  }
  return m;
}

/** Agrega posição de estoque (relatório) por CD_PRODUTO para o dono. */
async function mapPosicaoSkuPorCdProduto(tenantId, cdDono) {
  const m = new Map();
  try {
    const { linhas } = await listarPosicaoEstoque(tenantId, cdDono);
    for (const L of linhas || []) {
      const cd = parseInt(L.CD_PRODUTO, 10);
      if (!Number.isFinite(cd)) continue;
      const prev = m.get(cd) || {
        qtdEntradaEncerrada: 0,
        qtdSaldoSku: 0,
        qtdDisponivelSku: 0,
        semEntradaEncerrada: false,
        codigoExibicao: L.CODIGO_PRODUTO || '',
        nomeProduto: L.NM_PRODUTO || '',
      };
      prev.qtdEntradaEncerrada += Number(L.QTD_ENTRADA) || 0;
      prev.qtdSaldoSku += Number(L.QTD_SALDO_SKU) || 0;
      prev.qtdDisponivelSku += Number(L.QTD_DISPONIVEL_SKU) || 0;
      if (L.SEM_ENTRADA_ENCERRADA) prev.semEntradaEncerrada = true;
      if (L.CODIGO_PRODUTO) prev.codigoExibicao = L.CODIGO_PRODUTO;
      if (L.NM_PRODUTO) prev.nomeProduto = L.NM_PRODUTO;
      m.set(cd, prev);
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  return m;
}

function diagnosticoLinhaCobertura(L) {
  if (L.semDepara) return 'Sem de-para ou produto ativo no dono — cadastre em Cadastros WMS';
  const enc = Number(L.saldoNfeEncerrada) || 0;
  const abr = Number(L.saldoRecebimentosAbertos) || 0;
  const pos = L.saldoPosicaoSku != null ? Number(L.saldoPosicaoSku) : null;
  const falta = L.possivelFalta != null ? Number(L.possivelFalta) : 0;
  const ro = Number(L.reservaOutrosEspelhos) || 0;
  if (falta <= 1e-9) return 'Cobertura OK na fórmula da trava';
  /** Cada linha pode acumular múltiplas causas — o diagnóstico anterior
   *  retornava só a primeira (NF não soma), escondendo que TAMBÉM havia
   *  reservas órfãs descontando indevidamente. Agora junta os motivos
   *  separados por " • " para o operador ver os dois. */
  const motivos = [];
  if (enc <= 1e-9 && abr <= 1e-9 && (pos == null || pos <= 1e-9)) {
    motivos.push('Sem saldo em NF encerrada nem em posição — conferir recebimento encerrado e inventário');
  } else if (enc <= 1e-9 && abr > 1e-9) {
    motivos.push('Quantidade só em NF-e ainda não encerrada — encerre recebimento ou marque checkbox pipeline');
  } else if (enc <= 1e-9 && pos != null && pos > 1e-9) {
    motivos.push('Posição de estoque existe (movimento/inventário), mas NF encerrada não soma — revisar conferência cdProduto');
  }
  const roOrfa = Number(L.reservaOrfasDeletaveis) || 0;
  if (ro > 1e-9) {
    if (roOrfa > 1e-9) {
      motivos.push(
        'Reservas ÓRFÃS em outros espelhos: ' +
          roOrfa +
          ' un liberáveis pelo botão (de ' +
          ro +
          ' un reservadas no total em outros espelhos)'
      );
    } else {
      motivos.push(
        'Reservas de outros espelhos OPL descontando ' +
          ro +
          ' un — nenhuma é órfã (cargas ainda pendentes). Aguarde expedição ou use Auditoria de Saúde'
      );
    }
  }
  if (motivos.length) return motivos.join(' • ');
  return 'Demanda do espelho maior que saldo usado na trava (NF encerrada + movimentos' + (abr > 0 ? ' + abertas' : '') + ')';
}

function csvCellCobertura(v) {
  const s = v == null ? '' : String(v);
  if (/[",;\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/**
 * CSV para conferência física / validação operacional (separador ; BOM UTF-8).
 * @param {object} sim — retorno de simularCoberturaOplArquivo
 * @param {{ somenteProblemas?: boolean, nmArquivo?: string }} [meta]
 */
function montarCsvCoberturaOpl(sim, meta) {
  meta = meta || {};
  const somenteProblemas = meta.somenteProblemas !== false;
  let linhas = Array.isArray(sim.linhas) ? sim.linhas : [];
  if (somenteProblemas) {
    linhas = linhas.filter((L) => L.semDepara || (L.possivelFalta != null && L.possivelFalta > 1e-9));
  }
  const hdr =
    'Código OL;Código estoque;Descrição;CD produto;Qtd pedida espelho;Saldo NF encerrada;Saldo movimentos;Saldo NF abertas;Reserva outros OPL;Saldo trava simulação;Saldo posição SKU;Disponível posição SKU;Entrada encerrada posição;Falta;Diagnóstico;Sem de-para';
  const body = linhas.map((L) => {
    const cols = [
      L.codProdutoOl,
      L.codigoInterno,
      L.descricao,
      L.cdProduto,
      L.qtdPedidaAgregada,
      L.saldoNfeEncerrada,
      L.saldoMovimentosEstoque,
      L.saldoRecebimentosAbertos != null ? L.saldoRecebimentosAbertos : '',
      L.reservaOutrosEspelhos != null ? L.reservaOutrosEspelhos : '',
      L.saldoEstimadoUsado != null ? L.saldoEstimadoUsado : L.saldoDisponivelAposReservasOutros,
      L.saldoPosicaoSku,
      L.saldoDisponivelPosicaoSku,
      L.temEntradaEncerradaPosicao === true ? 'S' : L.temEntradaEncerradaPosicao === false ? 'N' : '',
      L.possivelFalta,
      L.diagnostico,
      L.semDepara ? 'S' : 'N',
    ];
    return cols.map(csvCellCobertura).join(';');
  });
  const ag = sim.agregado || {};
  const metaLines = [
    `Arquivo;${csvCellCobertura(meta.nmArquivo || '')}`,
    `Dono CD;${csvCellCobertura(sim.cdDono != null ? sim.cdDono : '')}`,
    `Inclui NF abertas;${sim.incluirRecebimentosAbertos ? 'S' : 'N'}`,
    `SKU espelho;${ag.totalSkusOpl != null ? ag.totalSkusOpl : linhas.length}`,
    `SKU com falta;${ag.linhasComPossivelFalta != null ? ag.linhasComPossivelFalta : ''}`,
    `SKU sem de-para;${ag.linhasSemDepara != null ? ag.linhasSemDepara : ''}`,
    `Filtro exportação;${somenteProblemas ? 'Somente problemas' : 'Todos SKU do espelho'}`,
    '',
  ];
  return metaLines.join('\n') + hdr + '\n' + body.join('\n');
}

/**
 * Agrega demanda do espelho OPL por código OL; cruza de-para → produto dono → saldo de entradas encerradas.
 * @param {object} [opts]
 * @param {boolean} [opts.incluirRecebimentosAbertos] — soma também conferências em NF-e ainda não encerradas (Fase B).
 */
async function simularCoberturaOplArquivo(tenantId, cdOplArquivo, opts) {
  opts = opts || {};
  const incluirAbertos = !!opts.incluirRecebimentosAbertos;
  const avisos = [
    incluirAbertos
      ? 'Simulação: saldo = NF-e encerradas + NF-e de recebimento ainda não encerradas (conferência com cdProduto) + movimentos (ex.: saída por expedição confirmada). Pipeline pode não vir a encerrar.'
      : 'Simulação: soma quantidades conferidas em NF-e de entrada encerrada (cdProduto) + movimentos de estoque (MVP: saídas na expedição); opcionalmente inclui recebimentos abertos pelo checkbox.',
  ];
  const rArq = await pool.query(
    `SELECT "CD_OPL_ARQUIVO", "CD_DONO" FROM "WMS_OPL_ARQUIVO" WHERE "CD_OPL_ARQUIVO" = $1::integer AND "TENANT_ID" = $2`,
    [cdOplArquivo, tenantId]
  );
  if (!rArq.rows.length) {
    return { ok: false, erro: 'Importação não encontrada.', linhas: [], agregado: {}, avisos };
  }
  const cdDonoRaw = rArq.rows[0].CD_DONO ?? rArq.rows[0].cd_dono;
  const cdDono = typeof cdDonoRaw === 'number' ? cdDonoRaw : parseInt(cdDonoRaw, 10);
  if (!Number.isFinite(cdDono)) {
    return {
      ok: false,
      erro: 'Espelho sem dono do estoque (CD_DONO). Associe o dono na importação para simular cobertura.',
      linhas: [],
      agregado: { totalSkusOpl: 0, linhasComPossivelFalta: 0, linhasSemDepara: 0 },
      avisos,
    };
  }

  let usarQtColetada = opts.usarQtColetada === true;
  if (opts.usarQtColetada !== false && !usarQtColetada) {
    const rPick = await pool.query(
      `SELECT COUNT(i."CD_OPL_ITEM")::int AS tot,
              COUNT(i."CD_OPL_ITEM") FILTER (WHERE i."QT_COLETADA" IS NOT NULL)::int AS com_pick
         FROM "WMS_OPL_ITEM" i
         JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_PEDIDO" = i."CD_OPL_PEDIDO"
        WHERE p."CD_OPL_ARQUIVO" = $1::integer`,
      [cdOplArquivo]
    );
    const totPick = Number(rPick.rows[0]?.tot) || 0;
    const comPick = Number(rPick.rows[0]?.com_pick) || 0;
    usarQtColetada = totPick > 0 && comPick >= totPick;
  }
  if (usarQtColetada) {
    avisos.push(
      'Picking encerrado: a demanda da simulação usa as quantidades coletadas (não a pedida). SKU com coletada 0 não exige saldo.'
    );
  }

  const exprQtd = usarQtColetada
    ? `SUM(COALESCE(i."QT_COLETADA", 0))::numeric`
    : `SUM(COALESCE(i."QT_PEDIDA", 0))::numeric`;

  const rDem = await pool.query(
    `SELECT TRIM(COALESCE(i."COD_PRODUTO_OL", '')) AS cod_ol,
            MAX(COALESCE(i."DESCRICAO", '')) AS descr,
            ${exprQtd} AS qtd_ped
       FROM "WMS_OPL_ITEM" i
       JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_PEDIDO" = i."CD_OPL_PEDIDO"
      WHERE p."CD_OPL_ARQUIVO" = $1::integer
      GROUP BY TRIM(COALESCE(i."COD_PRODUTO_OL", ''))
     HAVING TRIM(COALESCE(i."COD_PRODUTO_OL", '')) <> ''`,
    [cdOplArquivo]
  );

  const demandRows = rDem.rows || [];
  const allKeys = new Set();
  for (const row of demandRows) {
    for (const k of deparaLookupKeysFromCProd(row.cod_ol)) allKeys.add(k);
  }
  const keyArr = Array.from(allKeys).filter(Boolean);
  let byDep = new Map();
  if (keyArr.length) {
    const rDep = await pool.query(
      `SELECT "CODIGO_EXTERNO", "CODIGO_INTERNO"
         FROM "WMS_DEPARA_PRODUTO"
        WHERE "TENANT_ID" = $1
          AND "CD_DONO" = $2::integer
          AND "FGACTIVE" = 'S'
          AND LOWER(TRIM("CODIGO_EXTERNO")) = ANY($3::text[])`,
      [tenantId, cdDono, keyArr]
    );
    byDep = buildDeparaHitMap(rDep.rows || []);
  }

  const internos = new Set();
  for (const row of demandRows) {
    const hit = hitDeparaFromMap(byDep, row.cod_ol);
    const interno = hit ? String(hit.CODIGO_INTERNO ?? hit.codigo_interno ?? '').trim() : '';
    if (interno && !deparaIrmaoFamiliaSuspeito(row.cod_ol, interno)) {
      internos.add(interno.toLowerCase());
    }
  }
  const intArr = Array.from(internos);
  const byCodigoProd = new Map();
  if (intArr.length) {
    const rPr = await pool.query(
      `SELECT "CD_PRODUTO", LOWER(TRIM("CODIGO")) AS ck
         FROM "WMS_PRODUTO_DONO"
        WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer AND "FGACTIVE" = 'S'
          AND LOWER(TRIM("CODIGO")) = ANY($3::text[])`,
      [tenantId, cdDono, intArr]
    );
    for (const pr of rPr.rows || []) {
      const ck = String(pr.ck || '').trim();
      if (ck) byCodigoProd.set(ck, parseInt(pr.CD_PRODUTO, 10));
    }
  }

  let saldoSomenteNfeEncPorCd = new Map();
  let saldoMovimentosPorCd = new Map();
  let saldoEncerradasPorCd = new Map();
  let saldoAbertosPorCd = new Map();
  let posicaoPorCd = new Map();
  try {
    saldoSomenteNfeEncPorCd = await saldoPorCdProdutoRecebimentoEncerrado(tenantId, cdDono);
    saldoMovimentosPorCd = await somaMovimentosPorCdProduto(tenantId, cdDono);
    saldoEncerradasPorCd = await saldoPorCdProdutoRecebimentoEncerradoMaisMovimentos(tenantId, cdDono);
    if (incluirAbertos) {
      try {
        saldoAbertosPorCd = await saldoPorCdProdutoRecebimentoNaoEncerrado(tenantId, cdDono);
      } catch (e2) {
        if (!schemaMissing(e2)) throw e2;
        avisos.push('Saldo de recebimentos abertos indisponível (estrutura incompleta).');
      }
    }
    posicaoPorCd = await mapPosicaoSkuPorCdProduto(tenantId, cdDono);
    avisos.push(
      'Colunas “posição SKU”: mesmo critério do relatório Posição de estoque (entradas encerradas por lote + movimentos − reservas OPL).'
    );
  } catch (e) {
    if (!schemaMissing(e)) throw e;
    avisos.push('Saldo de recebimento indisponível (estrutura incompleta).');
  }

  let reservaOutrosPorCd = new Map();
  let reservaOrfasDeletaveisPorCd = new Map();
  let descontaReservasOutrosEspelhos = false;
  try {
    reservaOutrosPorCd = await mapReservaOutrosEspelhosOplPorCdProduto(tenantId, cdDono, cdOplArquivo);
    reservaOrfasDeletaveisPorCd = await mapReservaOrfasDeletaveisPorCdProduto(tenantId, cdDono);
    descontaReservasOutrosEspelhos = true;
    let somaRes = 0;
    reservaOutrosPorCd.forEach((v) => {
      somaRes += Number(v) || 0;
    });
    if (somaRes > 1e-9) {
      avisos.push(
        'Saldo disponível na simulação desconta reservas de outros espelhos OPL (picking já encerrado neste dono).'
      );
    }
  } catch (eR) {
    if (!schemaMissing(eR)) throw eR;
  }

  const linhas = [];
  let linhasSemDepara = 0;
  let linhasComPossivelFalta = 0;

  for (const row of demandRows) {
    const codOl = String(row.cod_ol || '').trim();
    const qPed = Number(row.qtd_ped);
    const qtdPedida = Number.isFinite(qPed) ? qPed : 0;
    const descr = String(row.descr || '').trim();
    const hit = hitDeparaFromMap(byDep, codOl);
    let interno = hit ? String(hit.CODIGO_INTERNO ?? hit.codigo_interno ?? '').trim() : '';
    const deparaConfiavel = interno && !deparaIrmaoFamiliaSuspeito(codOl, interno);
    let cdProduto = deparaConfiavel ? byCodigoProd.get(interno.toLowerCase()) : null;
    if (!Number.isFinite(cdProduto)) {
      const resolv = await resolverProdutoEstoque(pool, tenantId, cdDono, codOl, {});
      if (resolv && Number.isFinite(resolv.cdProduto)) {
        cdProduto = resolv.cdProduto;
        interno = String(resolv.codigoEstoque || interno || codOl).trim();
      }
    }
    const semDepara = !Number.isFinite(cdProduto);
    if (semDepara) linhasSemDepara += 1;
    const sNfeEnc = Number.isFinite(cdProduto) ? saldoSomenteNfeEncPorCd.get(cdProduto) || 0 : 0;
    const sMov = Number.isFinite(cdProduto) ? saldoMovimentosPorCd.get(cdProduto) || 0 : 0;
    const sEnc = Number.isFinite(cdProduto) ? saldoEncerradasPorCd.get(cdProduto) || 0 : 0;
    const resOut = Number.isFinite(cdProduto) ? reservaOutrosPorCd.get(cdProduto) || 0 : 0;
    const sEncLivre = Number.isFinite(cdProduto) ? Number(Math.max(0, sEnc - resOut).toFixed(6)) : 0;
    const sAbrt = incluirAbertos && Number.isFinite(cdProduto) ? saldoAbertosPorCd.get(cdProduto) || 0 : 0;
    const saldoUsado = Number.isFinite(cdProduto) ? Number((sEncLivre + sAbrt).toFixed(6)) : 0;
    const possivelFalta = semDepara ? null : Math.max(0, Number((qtdPedida - saldoUsado).toFixed(6)));
    if (!semDepara && possivelFalta > 1e-9) linhasComPossivelFalta += 1;
    const pos = Number.isFinite(cdProduto) ? posicaoPorCd.get(cdProduto) : null;
    const rowOut = {
      codProdutoOl: codOl,
      descricao: descr,
      qtdPedidaAgregada: qtdPedida,
      codigoInterno: interno || null,
      cdProduto: Number.isFinite(cdProduto) ? cdProduto : null,
      saldoNfeEncerrada: semDepara ? null : Number(sNfeEnc.toFixed(6)),
      saldoMovimentosEstoque: semDepara ? null : Number(sMov.toFixed(6)),
      saldoEncerradas: semDepara ? null : sEnc,
      possivelFalta,
      semDepara,
    };
    if (!semDepara) {
      rowOut.saldoDisponivelAposReservasOutros = sEncLivre;
      if (resOut > 1e-9) rowOut.reservaOutrosEspelhos = resOut;
      const roOrfa = Number.isFinite(cdProduto) ? reservaOrfasDeletaveisPorCd.get(cdProduto) || 0 : 0;
      if (roOrfa > 1e-9) rowOut.reservaOrfasDeletaveis = roOrfa;
      rowOut.saldoEstimadoUsado = saldoUsado;
    }
    if (incluirAbertos && !semDepara) rowOut.saldoRecebimentosAbertos = sAbrt;
    if (pos) {
      rowOut.saldoPosicaoSku = Number(pos.qtdSaldoSku.toFixed(6));
      rowOut.saldoDisponivelPosicaoSku = Number(pos.qtdDisponivelSku.toFixed(6));
      rowOut.temEntradaEncerradaPosicao = !pos.semEntradaEncerrada && pos.qtdEntradaEncerrada > 1e-9;
      if (!rowOut.descricao && pos.nomeProduto) rowOut.descricao = pos.nomeProduto;
    }
    rowOut.diagnostico = diagnosticoLinhaCobertura(rowOut);
    linhas.push(rowOut);
  }
  linhas.sort((a, b) => {
    const fa = a.possivelFalta != null ? a.possivelFalta : 0;
    const fb = b.possivelFalta != null ? b.possivelFalta : 0;
    if (fb !== fa) return fb - fa;
    return String(a.codProdutoOl).localeCompare(String(b.codProdutoOl));
  });

  return {
    ok: true,
    cdDono,
    incluirRecebimentosAbertos: incluirAbertos,
    descontaReservasOutrosEspelhos,
    linhas,
    agregado: {
      totalSkusOpl: linhas.length,
      linhasSemDepara,
      linhasComPossivelFalta,
    },
    avisos,
  };
}

/**
 * Valida se o espelho pode encerrar picking (cobertura de estoque + de-para).
 * @returns {Promise<{ ok: boolean, error?: string, code?: string, agregado?: object, linhasProblema?: object[] }>}
 */
async function validarCoberturaEncerramentoPicking(tenantId, cdOplArquivo, opts) {
  opts = opts || {};
  const incluirAbertos = !!opts.incluirRecebimentosAbertos;
  if (opts.ignorarTravaCobertura) {
    return {
      ok: true,
      agregado: {},
      avisos: ['Trava de cobertura ignorada por liberação autorizada.'],
      liberacaoAplicada: true,
      autorizador: opts.autorizadorLogin || null,
    };
  }
  const sim = await simularCoberturaOplArquivo(tenantId, cdOplArquivo, opts);
  if (!sim.ok) {
    return {
      ok: false,
      code: 'SEM_DONO',
      error: sim.erro || 'Simulação de estoque indisponível.',
      agregado: sim.agregado,
    };
  }
  const ag = sim.agregado || {};
  const semDep = Number(ag.linhasSemDepara) || 0;
  const falta = Number(ag.linhasComPossivelFalta) || 0;
  if (semDep > 0 || falta > 0) {
    const linhasProblema = (sim.linhas || []).filter(
      (L) => L.semDepara || (L.possivelFalta != null && L.possivelFalta > 1e-9)
    );
    const parts = [];
    if (semDep > 0) parts.push(`${semDep} código(s) OL sem de-para/produto no dono`);
    if (falta > 0) parts.push(`${falta} SKU(s) com saldo insuficiente`);
    const baseSaldo = incluirAbertos
      ? 'NF-e encerradas + conferência em NF-e ainda não encerradas (checkbox da simulação)'
      : 'somente NF-e de recebimento já encerradas (conferência gravada com cdProduto)';

    const fmtQ = (n) => {
      const v = Number(n);
      if (!Number.isFinite(v)) return '—';
      return String(Number(v.toFixed(3))).replace(/\.?0+$/, '').replace('.', ',');
    };
    const detalheSkus = linhasProblema.slice(0, 8).map((L) => {
      const ol = String(L.codProdutoOl || '?').trim();
      const interno = L.codigoInterno ? ` → ${L.codigoInterno}` : '';
      const desc = L.descricao ? ` (${String(L.descricao).slice(0, 40)})` : '';
      if (L.semDepara) return `${ol}${interno}${desc}: sem de-para/produto no dono`;
      const ped = L.qtdPedidaAgregada;
      const sal =
        L.saldoDisponivelAposReservasOutros != null
          ? L.saldoDisponivelAposReservasOutros
          : L.saldoEstimadoUsado != null
            ? L.saldoEstimadoUsado
            : L.saldoEncerradas;
      const faltaSku = L.possivelFalta;
      let s = `${ol}${interno}${desc}: pedido ${fmtQ(ped)}, saldo disp. ${fmtQ(sal)}`;
      if (faltaSku != null && faltaSku > 1e-9) s += `, falta ${fmtQ(faltaSku)}`;
      return s;
    });
    const mais = linhasProblema.length > 8 ? ` (+${linhasProblema.length - 8} SKU)` : '';
    const blocoFalta =
      detalheSkus.length > 0
        ? ` Falta cobrir: ${detalheSkus.join(' | ')}${mais}.`
        : '';

    return {
      ok: false,
      code: 'COBERTURA_INSUFICIENTE',
      error:
        `Não é possível encerrar o picking: ${parts.join('; ')}.${blocoFalta} ` +
        `Saldo usado na trava: ${baseSaldo}, menos reservas de outros espelhos OPL. ` +
        `Encerre recebimentos, ative o checkbox de NF abertas, ou libere com supervisor autorizado.`,
      agregado: ag,
      linhasProblema: linhasProblema.slice(0, 50),
      avisos: sim.avisos,
      incluirRecebimentosAbertos: incluirAbertos,
    };
  }
  return { ok: true, agregado: ag, avisos: sim.avisos };
}

module.exports = {
  simularCoberturaOplArquivo,
  validarCoberturaEncerramentoPicking,
  montarCsvCoberturaOpl,
  saldoPorCdProdutoRecebimentoEncerrado,
  saldoPorCdProdutoRecebimentoEncerradoMaisMovimentos,
  saldoPorCdProdutoRecebimentoNaoEncerrado,
  agregarQtColetadaPorCdProdutoOpl,
  agregarQtdPorCdProdutoCodigosExternos,
};
