'use strict';

/**
 * Demanda do dia — uma linha por carga na data de entrega (OPL).
 * Frio junta resfriado e congelado. Receita = valor das notas × % de expedição do dono.
 */

const { pool } = require('../config/db');
const { digitosCodigoOl, extrairDataEntregaPedidoOpl } = require('./wms-opl-relatorio-romaneio.service');
const { carregarMapaProdutosDonoPorDigitos } = require('./wms-produto-mapa-codigo.service');
const { nomeEntregaUnidadeOuLocalDestino } = require('./wms-nfe-saida-destino-display.service');
const {
  cnpj14Pad,
  carregarMapaNrRotaPorChaveImport,
  carregarIndiceRotaPorCodigoDestinatario,
  resolverNrRotaNfSaida,
} = require('./cadastro-endereco-entrega-match.service');

const MAX_DIAS = 92;

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function filtroErro(message) {
  const e = new Error(message);
  e.code = 'FILTRO';
  return e;
}

function toNumber(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function round3(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

function parseIso(v) {
  const s = v != null ? String(v).trim().slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function brParaIso(br) {
  const m = String(br || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function isoParaBr(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function padPedido(raw) {
  const dig = String(raw == null ? '' : raw).replace(/\D/g, '');
  if (!dig) return '';
  return dig.length >= 10 ? dig : dig.padStart(10, '0');
}

function parseLinhas(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function qtdComercial(ln) {
  const q = toNumber(ln.qCom ?? ln.quantidade);
  return q > 0 ? q : 0;
}

function valorLinha(ln) {
  const vProd = toNumber(ln.vProd);
  if (vProd > 0) return vProd;
  const vu = toNumber(ln.vUnCom);
  const q = qtdComercial(ln);
  if (vu > 0 && q > 0) return vu * q;
  return 0;
}

/** Só o cadastro. Sem TIPO_ARMAZENAGEM não chuta por NCM nem pela descrição. */
function tipoDoCadastro(cad) {
  const t = String((cad && cad.TIPO_ARMAZENAGEM) || '').toUpperCase();
  if (!t.trim()) return 'SEM_TIPO';
  if (t.includes('CONGEL')) return 'CONGELADO';
  if (t.includes('REFRIG') || t.includes('RESFRI')) return 'RESFRIADO';
  if (t.includes('SECO') || t.includes('AMBIENT')) return 'SECO';
  return 'SEM_TIPO';
}

function grupoPesoValor(tipo) {
  if (tipo === 'CONGELADO' || tipo === 'RESFRIADO') return 'FRIO';
  if (tipo === 'SECO') return 'SECO';
  return 'SEM';
}

function pctParte(parte, total) {
  if (!total || parte <= 0) return 0;
  return Math.round((100 * parte) / total);
}

function tomFrio(pctPeso, pctValor, pesoFrio, valorFrio) {
  if (pesoFrio <= 0 && valorFrio <= 0) return 'seco';
  if (pctPeso < 20 && pctValor < 20) return 'seco';
  if (pctPeso >= 50 && pctValor >= 50) return 'frio';
  return 'misto';
}

function leituraGrupo(pesoFrio, pesoSeco, valorFrio, valorSeco, escopo) {
  const pPeso = pctParte(pesoFrio, (pesoFrio || 0) + (pesoSeco || 0));
  const pValor = pctParte(valorFrio, (valorFrio || 0) + (valorSeco || 0));
  const tom = tomFrio(pPeso, pValor, pesoFrio, valorFrio);
  const curto =
    pesoFrio <= 0 && valorFrio <= 0
      ? 'Só seco'
      : pesoSeco <= 0 && valorSeco <= 0
        ? 'Só frio'
        : 'Frio ' + pPeso + '% do peso · ' + pValor + '% do valor';
  if (escopo === 'carga') {
    return { tom, pctPeso: pPeso, pctValor: pValor, texto: curto };
  }
  const onde = escopo === 'periodo' ? 'No período' : 'Neste dia';
  if (pesoFrio <= 0 && valorFrio <= 0) {
    return { tom, pctPeso: pPeso, pctValor: pValor, texto: onde + ' não houve resfriado nem congelado.' };
  }
  if (pesoSeco <= 0 && valorSeco <= 0) {
    return { tom, pctPeso: pPeso, pctValor: pValor, texto: onde + ' o movimento é só frio.' };
  }
  let fechamento = 'Frio e seco dividem o movimento.';
  if (tom === 'seco') fechamento = 'O frio sai com volume e valor baixos.';
  else if (tom === 'frio') fechamento = 'A demanda de frio sustenta o envio.';
  else if (pPeso - pValor >= 15) fechamento = 'O peso do frio passa o valor da nota.';
  else if (pValor - pPeso >= 15) fechamento = 'O valor do frio passa o peso.';
  return {
    tom,
    pctPeso: pPeso,
    pctValor: pValor,
    texto: onde + ' o frio é ' + pPeso + '% do peso e ' + pValor + '% do valor das notas. ' + fechamento,
  };
}

function textoRotas(numeros) {
  const nums = [...numeros].filter((n) => n != null && Number.isFinite(n)).sort((a, b) => a - b);
  if (!nums.length) return '—';
  return nums.join(' / ');
}

function chaveParada(n) {
  const uf = String(n.UF_DEST || '').trim().toUpperCase().slice(0, 2);
  const mun = String(n.XMUN_DEST || '').trim();
  const nome = nomeEntregaUnidadeOuLocalDestino(n) || '';
  const cnpj = String(n.CNPJ_ENTREGA || n.CNPJ_DEST || '').replace(/\D/g, '');
  return uf + '|' + mun + '|' + cnpj + '|' + nome;
}

function cargaPassaRota(rotas, temSemRota, filtros) {
  if (filtros.semRota) return temSemRota;
  if (filtros.nrRota != null) return rotas.has(filtros.nrRota);
  return true;
}

function receitaDaCarga(valorPorDono, pctMap) {
  let receita = 0;
  let aplicou = false;
  let semPct = false;
  for (const [cd, valor] of valorPorDono) {
    const v = round2(valor);
    if (!(v > 0)) continue;
    const pct = pctMap.has(cd) ? pctMap.get(cd) : null;
    if (pct == null || !Number.isFinite(pct)) {
      semPct = true;
      continue;
    }
    aplicou = true;
    receita = round2(receita + round2(v * (pct / 100)));
  }
  return { receita: aplicou ? receita : null, semPct };
}

function normalizarFiltros(query) {
  let dtDe = parseIso(query.dtDe ?? query.dt_de ?? query.dataEntregaDe);
  let dtAte = parseIso(query.dtAte ?? query.dt_ate ?? query.dataEntregaAte);
  if (!dtDe || !dtAte) {
    throw filtroErro('Informe o período da data de entrega (de e até).');
  }
  if (dtDe > dtAte) {
    const t = dtDe;
    dtDe = dtAte;
    dtAte = t;
  }
  const dias = Math.round((Date.parse(dtAte + 'T00:00:00') - Date.parse(dtDe + 'T00:00:00')) / 86400000);
  if (dias > MAX_DIAS) {
    throw filtroErro('O período da entrega pode ter no máximo ' + MAX_DIAS + ' dias.');
  }
  const situacaoRaw = String(query.situacao ?? query.stExpedicao ?? 'ambas')
    .trim()
    .toLowerCase();
  const situacao = situacaoRaw === 'programada' || situacaoRaw === 'expedida' ? situacaoRaw : 'ambas';
  let cdDono = null;
  if (query.cdDono != null && String(query.cdDono).trim() !== '') {
    const n = parseInt(query.cdDono, 10);
    if (Number.isFinite(n) && n > 0) cdDono = n;
  }
  const rotaRaw = String(query.nrRota ?? query.rota ?? '').trim().toLowerCase();
  let nrRota = null;
  let semRota = false;
  if (rotaRaw === 'sem' || rotaRaw === 'sem_rota') semRota = true;
  else if (rotaRaw) {
    const n = parseInt(rotaRaw, 10);
    if (Number.isFinite(n)) nrRota = n;
  }
  return { dtDe, dtAte, situacao, cdDono, nrRota, semRota };
}

function anosDoPeriodo(dtDe, dtAte) {
  const a = parseInt(dtDe.slice(0, 4), 10);
  const b = parseInt(dtAte.slice(0, 4), 10);
  const anos = [];
  for (let y = a; y <= b; y++) anos.push(String(y));
  return anos;
}

async function mapaPedidosNoPeriodo(tenantId, dtDe, dtAte) {
  const anos = anosDoPeriodo(dtDe, dtAte);
  const likeAnos = anos.map((y) => '%' + y + '%');
  const r = await pool.query(
    `SELECT p."NUM_PEDIDO", p."LINHA2_RAW", p."DADOS_JSON", p."DATA_PEDIDO", a."DH_IMPORT"
       FROM "WMS_OPL_PEDIDO" p
       JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO" = p."CD_OPL_ARQUIVO"
      WHERE a."TENANT_ID" = $1
        AND trim(COALESCE(p."NUM_PEDIDO", '')) <> ''
        AND (
          right(substring(rpad(COALESCE(p."LINHA2_RAW", ''), 283, ' '), 276, 8), 4) = ANY($2::text[])
          OR COALESCE(p."DADOS_JSON"->>'DATA_ENTREGA', '') LIKE ANY($3::text[])
          OR COALESCE(p."DADOS_JSON"->>'dataEntrega', '') LIKE ANY($3::text[])
          OR COALESCE(p."DADOS_JSON"->>'data_entrega', '') LIKE ANY($3::text[])
          OR (
            length(regexp_replace(COALESCE(p."DATA_PEDIDO", ''), '[^0-9]', '', 'g')) = 6
            AND (
              CASE
                WHEN right(regexp_replace(COALESCE(p."DATA_PEDIDO", ''), '[^0-9]', '', 'g'), 2)::int <= 50
                  THEN '20' || right(regexp_replace(COALESCE(p."DATA_PEDIDO", ''), '[^0-9]', '', 'g'), 2)
                ELSE '19' || right(regexp_replace(COALESCE(p."DATA_PEDIDO", ''), '[^0-9]', '', 'g'), 2)
              END
            ) = ANY($2::text[])
          )
        )`,
    [tenantId, anos, likeAnos]
  );
  const best = new Map();
  let usouDataPedido = 0;
  for (const row of r.rows || []) {
    const ent = extrairDataEntregaPedidoOpl(row);
    const iso = brParaIso(ent.data);
    if (!iso || iso < dtDe || iso > dtAte) continue;
    const num = padPedido(row.NUM_PEDIDO);
    if (!num) continue;
    const dh = row.DH_IMPORT ? new Date(row.DH_IMPORT).getTime() : 0;
    const prev = best.get(num);
    if (!prev || dh >= prev.dh) best.set(num, { iso, dh, fonte: ent.fonte });
  }
  const mapa = new Map();
  for (const [num, info] of best) {
    mapa.set(num, info.iso);
    if (info.fonte === 'data_pedido') usouDataPedido += 1;
  }
  mapa.usouDataPedido = usouDataPedido;
  return mapa;
}

async function carregarNotas(tenantId, pedidos, filtros) {
  const nums = [...pedidos.keys()];
  if (!nums.length) return [];
  const params = [tenantId, nums];
  let donoSql = '';
  if (filtros.cdDono) {
    params.push(filtros.cdDono);
    donoSql = ` AND COALESCE(n."CD_DONO", c."CD_DONO") = $${params.length}::integer`;
  }
  let sitSql = '';
  if (filtros.situacao === 'expedida') {
    sitSql = ` AND UPPER(TRIM(COALESCE(ex."ST_EXPEDICAO", ''))) = 'EXPEDIDA'`;
  } else if (filtros.situacao === 'programada') {
    sitSql = ` AND UPPER(TRIM(COALESCE(ex."ST_EXPEDICAO", ''))) <> 'EXPEDIDA'`;
  }
  const sqlBase = (pesoCol) => `
    SELECT c."CD_CARGA", c."NM_DESCRICAO", c."CD_DONO" AS "CD_DONO_CARGA",
           ex."ST_EXPEDICAO",
           j."ORDEM",
           n."CD_NFE_SAIDA", n."CD_DONO", n."NUMERO_NF", n."LINHAS_JSON", n."VNF_TOTAL",
           ${pesoCol}
           n."XMUN_DEST", n."UF_DEST", n."CNPJ_ENTREGA", n."CNPJ_DEST",
           n."XNOME_ENTREGA", n."XNOME_DEST", n."XLGR_DEST", n."NRO_DEST", n."CEP_DEST", n."XCPL_DEST"
      FROM "WMS_CARGA_PROGRAMADA" c
      JOIN "WMS_CARGA_PROGRAMADA_NFE" j ON j."CD_CARGA" = c."CD_CARGA"
      JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA" AND n."TENANT_ID" = c."TENANT_ID"
      LEFT JOIN LATERAL (
        SELECT e."ST_EXPEDICAO"
          FROM "WMS_EXPEDICAO_CARGA" e
         WHERE e."CD_CARGA" = c."CD_CARGA" AND e."TENANT_ID" = c."TENANT_ID"
         ORDER BY e."DH_SAIDA" DESC NULLS LAST
         LIMIT 1
      ) ex ON true
     WHERE c."TENANT_ID" = $1
       ${donoSql}
       ${sitSql}
       AND EXISTS (
         SELECT 1
           FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(n."LINHAS_JSON") = 'array' THEN n."LINHAS_JSON" ELSE '[]'::jsonb END
           ) ln
          WHERE (ln ? 'xPed' OR ln ? 'xped')
            AND lpad(regexp_replace(trim(COALESCE(ln->>'xPed', ln->>'xped', '')), '[^0-9]', '', 'g'), 10, '0') = ANY($2::text[])
       )`;
  try {
    const r = await pool.query(sqlBase('n."PESO_RESUMO_KG",'), params);
    return r.rows || [];
  } catch (e) {
    if (!schemaMissing(e)) throw e;
    const r = await pool.query(sqlBase(''), params);
    return r.rows || [];
  }
}

async function nrRotaDaNota(tenantId, n, mapaNr, indice, cache) {
  const cnpj = cnpj14Pad(n.CNPJ_ENTREGA || n.CNPJ_DEST);
  const key = [
    cnpj,
    String(n.XMUN_DEST || ''),
    String(n.XLGR_DEST || ''),
    String(n.NRO_DEST || ''),
    String(n.CEP_DEST || ''),
    nomeEntregaUnidadeOuLocalDestino(n) || '',
  ].join('|');
  if (cache.has(key)) return cache.get(key);
  const hit = await resolverNrRotaNfSaida(pool, tenantId, n, mapaNr, indice, {});
  const nr = hit && hit.nrRota != null && Number.isFinite(Number(hit.nrRota)) ? Number(hit.nrRota) : null;
  cache.set(key, nr);
  return nr;
}

function round1(n) {
  return Math.round((Number(n) || 0) * 10) / 10;
}

function novoBucket() {
  return {
    rotas: new Set(),
    temSemRota: false,
    paradas: new Set(),
    expedida: false,
    pesoFrio: 0,
    pesoSeco: 0,
    valorFrio: 0,
    valorSeco: 0,
    valorPorDono: new Map(),
  };
}

async function mapaPctExpedicao(tenantId, donos) {
  const ids = [...donos].filter((n) => Number.isFinite(n));
  const mapa = new Map();
  if (!ids.length) return mapa;
  try {
    const r = await pool.query(
      `SELECT "CD_DONO", "PCT_COBRANCA_EXPEDICAO"
         FROM "WMS_DONO_ESTOQUE"
        WHERE "TENANT_ID" = $1 AND "CD_DONO" = ANY($2::int[])`,
      [tenantId, ids]
    );
    for (const row of r.rows || []) {
      const p = row.PCT_COBRANCA_EXPEDICAO != null ? Number(row.PCT_COBRANCA_EXPEDICAO) : null;
      mapa.set(Number(row.CD_DONO), Number.isFinite(p) ? p : null);
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  return mapa;
}

async function mapaKmCarga(tenantId, ids) {
  const mapa = new Map();
  if (!ids.length) return mapa;
  try {
    const r = await pool.query(
      `SELECT DISTINCT ON (r."CD_CARGA") r."CD_CARGA", r."DISTANCIA_M"
         FROM "WMS_CARGA_ROTA_OPERACIONAL" r
        WHERE r."TENANT_ID" = $1
          AND r."CD_CARGA" = ANY($2::int[])
          AND r."DISTANCIA_M" IS NOT NULL
          AND r."DISTANCIA_M" > 0
        ORDER BY r."CD_CARGA", r."VERSAO" DESC`,
      [tenantId, ids]
    );
    for (const row of r.rows || []) {
      mapa.set(Number(row.CD_CARGA), round1(Number(row.DISTANCIA_M) / 1000));
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  return mapa;
}

function csvEsc(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[";\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function numCsv(n, dec) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '';
  return x.toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function demandaDiaParaCsv(data) {
  const linhas = [
    'Período da entrega;' + csvEsc((data.filtros && data.filtros.periodoLabel) || ''),
    'Situação;' + csvEsc((data.filtros && data.filtros.situacaoLabel) || ''),
    'Rota;' + csvEsc((data.filtros && data.filtros.rotaLabel) || ''),
    'Dono;' + csvEsc((data.filtros && data.filtros.donoLabel) || 'Todos'),
    '',
  ];
  const head = [
    'Data',
    'Carga',
    'Situação',
    'Rotas',
    'Entregas',
    'Km',
    'Peso frio (kg)',
    'Peso seco (kg)',
    'Peso total (kg)',
    'Nota frio',
    'Nota seco',
    'Nota total',
    'Receita',
    'Leitura',
  ];
  linhas.push(head.join(';'));
  for (const dia of data.dias || []) {
    for (const c of dia.cargas || []) {
      linhas.push(
        [
          dia.dataBr,
          String(c.cdCarga),
          c.situacao,
          c.rotasTexto,
          String(c.entregas),
          c.km == null ? '' : numCsv(c.km, 1),
          numCsv(c.pesoFrio, 3),
          numCsv(c.pesoSeco, 3),
          numCsv(c.pesoTotal, 3),
          numCsv(c.valorFrio, 2),
          numCsv(c.valorSeco, 2),
          numCsv(c.valorTotal, 2),
          c.receita == null ? '' : numCsv(c.receita, 2),
          c.leitura && c.leitura.texto ? c.leitura.texto : '',
        ]
          .map(csvEsc)
          .join(';')
      );
    }
    const t = dia.total || {};
    linhas.push(
      [
        'Total ' + dia.dataBr,
        (t.qtdCargas || 0) + ' cargas',
        '',
        (t.qtdRotas || 0) + (t.qtdRotas === 1 ? ' rota' : ' rotas'),
        String(t.entregas || 0),
        t.km == null ? '' : numCsv(t.km, 1),
        numCsv(t.pesoFrio, 3),
        numCsv(t.pesoSeco, 3),
        numCsv(t.pesoTotal, 3),
        numCsv(t.valorFrio, 2),
        numCsv(t.valorSeco, 2),
        numCsv(t.valorTotal, 2),
        t.receita == null ? '' : numCsv(t.receita, 2),
        dia.leitura && dia.leitura.texto ? dia.leitura.texto : '',
      ]
        .map(csvEsc)
        .join(';')
    );
  }
  return linhas.join('\n');
}

async function listarRotasDemandaDia(tenantId) {
  const r = await pool.query(
    `SELECT DISTINCT e."NR_ROTA"
       FROM "CADASTRO_ENDERECO_ENTREGA" e
      WHERE e."TENANT_ID" = $1
        AND e."FGACTIVE" = 'A'
        AND e."NR_ROTA" IS NOT NULL
      ORDER BY e."NR_ROTA"`,
    [tenantId]
  );
  return (r.rows || []).map((row) => Number(row.NR_ROTA)).filter((n) => Number.isFinite(n));
}

async function montarDemandaDia(tenantId, query) {
  const filtros = normalizarFiltros(query || {});
  const pedidoData = await mapaPedidosNoPeriodo(tenantId, filtros.dtDe, filtros.dtAte);
  const notas = await carregarNotas(tenantId, pedidoData, filtros);

  const avisos = [];
  if (!pedidoData.size) {
    avisos.push('Nenhum pedido OPL com data de entrega neste período.');
  } else if (pedidoData.usouDataPedido > 0) {
    avisos.push(
      pedidoData.usouDataPedido +
        ' pedido(s) sem data de entrega no OPL (posição 276 vazia). Nesses, o dia usa a data do pedido.'
    );
  }

  const donos = new Set();
  const digitos = new Set();
  for (const n of notas) {
    const cd = n.CD_DONO != null ? Number(n.CD_DONO) : n.CD_DONO_CARGA != null ? Number(n.CD_DONO_CARGA) : null;
    if (cd != null && Number.isFinite(cd)) donos.add(cd);
    for (const ln of parseLinhas(n.LINHAS_JSON)) {
      if (!ln || ln._meta) continue;
      const d = digitosCodigoOl(ln.cProd || ln.codigo || '');
      if (d) digitos.add(d);
    }
  }
  const mapas = {};
  const listaDig = [...digitos];
  if (donos.size) {
    for (const cd of donos) {
      mapas[cd] = await carregarMapaProdutosDonoPorDigitos(tenantId, cd, listaDig);
    }
  } else if (listaDig.length) {
    mapas._fallback = await carregarMapaProdutosDonoPorDigitos(tenantId, null, listaDig);
  }

  const cnpjs = notas.map((n) => cnpj14Pad(n.CNPJ_ENTREGA || n.CNPJ_DEST)).filter((c) => c.length === 14);
  const mapaNr = await carregarMapaNrRotaPorChaveImport(pool, tenantId, cnpjs);
  const indice = await carregarIndiceRotaPorCodigoDestinatario(pool, tenantId);
  const cacheRota = new Map();

  let linhasSemTipo = 0;
  let linhasSemPeso = 0;
  let linhasSemData = 0;

  /** @type {Map<string, any>} chave iso|cdCarga */
  const porCargaData = new Map();

  for (const n of notas) {
    const linhas = parseLinhas(n.LINHAS_JSON).filter((ln) => ln && !ln._meta);
    const cdDono = n.CD_DONO != null ? Number(n.CD_DONO) : n.CD_DONO_CARGA != null ? Number(n.CD_DONO_CARGA) : null;
    const mapa = cdDono != null && mapas[cdDono] ? mapas[cdDono] : mapas._fallback || {};
    const datasVistas = new Set();
    for (const ln of linhas) {
      const ped = padPedido(ln.xPed ?? ln.xped);
      if (ped && pedidoData.has(ped)) datasVistas.add(pedidoData.get(ped));
    }
    const dataUnica = datasVistas.size === 1 ? [...datasVistas][0] : null;
    const nr = await nrRotaDaNota(tenantId, n, mapaNr, indice, cacheRota);
    const expedida = String(n.ST_EXPEDICAO || '').toUpperCase() === 'EXPEDIDA';
    const cdCarga = Number(n.CD_CARGA);

    const itens = [];
    for (const ln of linhas) {
      const q = qtdComercial(ln);
      const valor = valorLinha(ln);
      if (q <= 0 && valor <= 0) continue;
      let iso = null;
      const ped = padPedido(ln.xPed ?? ln.xped);
      if (ped && pedidoData.has(ped)) iso = pedidoData.get(ped);
      else iso = dataUnica;
      const dkey = digitosCodigoOl(ln.cProd || ln.codigo || '');
      const cad = dkey && mapa[dkey] ? mapa[dkey] : null;
      const tipo = tipoDoCadastro(cad);
      const w = cad && cad.PESO_KG != null ? Number(cad.PESO_KG) : NaN;
      let peso = 0;
      const temPeso = q > 0 && Number.isFinite(w) && w > 0;
      if (temPeso) peso = q * w;
      itens.push({ iso, tipo, peso, valor, semData: !iso, semPeso: q > 0 && !temPeso });
    }

    const pr = n.PESO_RESUMO_KG != null ? Number(n.PESO_RESUMO_KG) : NaN;
    if (Number.isFinite(pr) && pr >= 0 && itens.length) {
      const base = itens.reduce((a, it) => a + it.peso, 0);
      if (base > 1e-9) {
        const f = pr / base;
        for (const it of itens) it.peso *= f;
      }
    }

    const vnf = n.VNF_TOTAL != null ? Number(n.VNF_TOTAL) : NaN;
    if (Number.isFinite(vnf) && vnf > 0 && itens.length) {
      const base = itens.reduce((a, it) => a + it.valor, 0);
      if (base > 1e-9) {
        const f = vnf / base;
        for (const it of itens) it.valor *= f;
      } else {
        const alvo = itens.filter((it) => !it.semData);
        const lista = alvo.length ? alvo : itens;
        const pesoBase = lista.reduce((a, it) => a + it.peso, 0);
        if (pesoBase > 1e-9) {
          for (const it of lista) it.valor = vnf * (it.peso / pesoBase);
        } else if (lista.length) {
          const cada = vnf / lista.length;
          for (const it of lista) it.valor = cada;
        }
      }
    }

    const datasDaNota = new Set();
    for (const it of itens) {
      if (it.semData) {
        linhasSemData += 1;
        continue;
      }
      if (it.semPeso) linhasSemPeso += 1;
      if (it.tipo === 'SEM_TIPO') linhasSemTipo += 1;
      datasDaNota.add(it.iso);
      const key = it.iso + '|' + cdCarga;
      if (!porCargaData.has(key)) porCargaData.set(key, novoBucket());
      const bucket = porCargaData.get(key);
      bucket.expedida = expedida;
      const grupo = grupoPesoValor(it.tipo);
      if (grupo === 'FRIO') {
        bucket.pesoFrio += it.peso;
        bucket.valorFrio += it.valor;
      } else if (grupo === 'SECO') {
        bucket.pesoSeco += it.peso;
        bucket.valorSeco += it.valor;
      }
      const donoChave = cdDono != null && Number.isFinite(cdDono) ? cdDono : 0;
      bucket.valorPorDono.set(donoChave, (bucket.valorPorDono.get(donoChave) || 0) + it.valor);
    }
    if (!datasDaNota.size) continue;
    const parada = chaveParada(n);
    for (const iso of datasDaNota) {
      const bucket = porCargaData.get(iso + '|' + cdCarga);
      if (!bucket) continue;
      if (parada.replace(/\|/g, '')) bucket.paradas.add(parada);
      if (nr == null) bucket.temSemRota = true;
      else bucket.rotas.add(nr);
    }
  }

  const chaves = [...porCargaData.keys()].filter((key) => {
    const bucket = porCargaData.get(key);
    return cargaPassaRota(bucket.rotas, bucket.temSemRota, filtros);
  });

  const donosUsados = new Set();
  const cargasIds = new Set();
  for (const key of chaves) {
    const bucket = porCargaData.get(key);
    cargasIds.add(Number(key.split('|')[1]));
    for (const cd of bucket.valorPorDono.keys()) donosUsados.add(cd);
  }
  const pctMap = await mapaPctExpedicao(tenantId, donosUsados);
  const kmMap = await mapaKmCarga(tenantId, [...cargasIds]);

  const porDia = new Map();
  let cargasSemPct = 0;
  let cargasSemKm = 0;
  const datasPorCarga = new Map();
  for (const key of chaves) {
    const iso = key.slice(0, 10);
    const cdCarga = Number(key.slice(11));
    const bucket = porCargaData.get(key);
    const rec = receitaDaCarga(bucket.valorPorDono, pctMap);
    if (rec.semPct) cargasSemPct += 1;
    const km = kmMap.has(cdCarga) ? kmMap.get(cdCarga) : null;
    if (km == null) cargasSemKm += 1;
    const arrDatas = datasPorCarga.get(cdCarga) || [];
    arrDatas.push(iso);
    datasPorCarga.set(cdCarga, arrDatas);
    const linha = {
      cdCarga,
      situacao: bucket.expedida ? 'Expedida' : 'Programada',
      rotas: [...bucket.rotas].sort((a, b) => a - b),
      rotasTexto: textoRotas(bucket.rotas),
      entregas: bucket.paradas.size,
      km,
      pesoFrio: round3(bucket.pesoFrio),
      pesoSeco: round3(bucket.pesoSeco),
      pesoTotal: round3(bucket.pesoFrio + bucket.pesoSeco),
      valorFrio: round2(bucket.valorFrio),
      valorSeco: round2(bucket.valorSeco),
      valorTotal: round2(bucket.valorFrio + bucket.valorSeco),
      receita: rec.receita,
      leitura: leituraGrupo(bucket.pesoFrio, bucket.pesoSeco, bucket.valorFrio, bucket.valorSeco, 'carga'),
    };
    if (!porDia.has(iso)) porDia.set(iso, []);
    porDia.get(iso).push(linha);
  }

  const dias = [...porDia.keys()].sort().map((iso) => {
    const cargas = porDia.get(iso).sort((a, b) => {
      const ra = a.rotas.length ? a.rotas[0] : 99999;
      const rb = b.rotas.length ? b.rotas[0] : 99999;
      return ra - rb || a.cdCarga - b.cdCarga;
    });
    const rotasDia = new Set();
    let entregas = 0;
    let km = 0;
    let temKm = false;
    let pesoFrio = 0;
    let pesoSeco = 0;
    let pesoTotal = 0;
    let valorFrio = 0;
    let valorSeco = 0;
    let valorTotal = 0;
    let receita = 0;
    let temReceita = false;
    for (const c of cargas) {
      for (const nr of c.rotas) rotasDia.add(nr);
      entregas += c.entregas;
      if (c.km != null) {
        temKm = true;
        km = round1(km + c.km);
      }
      pesoFrio += c.pesoFrio;
      pesoSeco += c.pesoSeco;
      pesoTotal += c.pesoTotal;
      valorFrio += c.valorFrio;
      valorSeco += c.valorSeco;
      valorTotal += c.valorTotal;
      if (c.receita != null) {
        temReceita = true;
        receita = round2(receita + c.receita);
      }
    }
    return {
      data: iso,
      dataBr: isoParaBr(iso),
      cargas,
      total: {
        qtdCargas: cargas.length,
        qtdRotas: rotasDia.size,
        entregas,
        km: temKm ? round1(km) : null,
        pesoFrio: round3(pesoFrio),
        pesoSeco: round3(pesoSeco),
        pesoTotal: round3(pesoTotal),
        valorFrio: round2(valorFrio),
        valorSeco: round2(valorSeco),
        valorTotal: round2(valorTotal),
        receita: temReceita ? receita : null,
      },
      leitura: leituraGrupo(pesoFrio, pesoSeco, valorFrio, valorSeco, 'dia'),
    };
  });

  if (linhasSemTipo > 0) {
    avisos.push(
      linhasSemTipo +
        ' linha(s) sem TIPO_ARMAZENAGEM no cadastro. O valor entra na receita e fica fora das colunas frio e seco.'
    );
  }
  if (linhasSemPeso > 0) {
    avisos.push(linhasSemPeso + ' linha(s) sem PESO_KG no cadastro — o peso dessas linhas fica de fora.');
  }
  if (linhasSemData > 0) {
    avisos.push(linhasSemData + ' linha(s) da nota sem data de entrega no pedido OPL — ficam de fora do dia.');
  }
  if (cargasSemPct > 0) {
    avisos.push(
      cargasSemPct +
        ' carga(s) com dono sem percentual de expedição. A receita dessas notas fica em branco.'
    );
  }
  if (cargasSemKm > 0) {
    avisos.push(cargasSemKm + ' carga(s) sem quilometragem de rota calculada.');
  }
  let cargasEmMaisDeUmDia = 0;
  for (const datas of datasPorCarga.values()) {
    if (new Set(datas).size > 1) cargasEmMaisDeUmDia += 1;
  }
  if (cargasEmMaisDeUmDia > 0) {
    avisos.push(
      cargasEmMaisDeUmDia +
        ' carga(s) com entrega em mais de uma data. Cada data leva a parte daquele dia; o km da rota repete.'
    );
  }
  if (pedidoData.size && !dias.length) {
    avisos.push('Há pedido com entrega no período, mas nenhuma carga com nota ligada a esse pedido passou nos filtros.');
  }

  let donoLabel = 'Todos';
  if (filtros.cdDono) {
    try {
      const rd = await pool.query(
        `SELECT "NOME", "CODIGO" FROM "WMS_DONO_ESTOQUE" WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2 LIMIT 1`,
        [tenantId, filtros.cdDono]
      );
      const row = rd.rows && rd.rows[0];
      donoLabel = row ? (row.CODIGO ? row.CODIGO + ' — ' : '') + (row.NOME || '') : 'Dono ' + filtros.cdDono;
    } catch (e) {
      if (!schemaMissing(e)) throw e;
      donoLabel = 'Dono ' + filtros.cdDono;
    }
  }

  const situacaoLabel =
    filtros.situacao === 'programada'
      ? 'Só programadas'
      : filtros.situacao === 'expedida'
        ? 'Só expedidas'
        : 'Programadas e expedidas';
  const rotaLabel = filtros.semRota ? 'Sem rota' : filtros.nrRota != null ? 'Rota ' + filtros.nrRota : 'Todas';

  let entregas = 0;
  let pesoFrio = 0;
  let pesoSeco = 0;
  let valorFrio = 0;
  let valorSeco = 0;
  let receita = 0;
  let temReceita = false;
  const cargasUnicas = new Set();
  for (const dia of dias) {
    for (const c of dia.cargas) cargasUnicas.add(c.cdCarga);
    entregas += dia.total.entregas;
    pesoFrio += dia.total.pesoFrio;
    pesoSeco += dia.total.pesoSeco;
    valorFrio += dia.total.valorFrio;
    valorSeco += dia.total.valorSeco;
    if (dia.total.receita != null) {
      temReceita = true;
      receita = round2(receita + dia.total.receita);
    }
  }

  return {
    filtros: {
      dtDe: filtros.dtDe,
      dtAte: filtros.dtAte,
      periodoLabel: isoParaBr(filtros.dtDe) + ' a ' + isoParaBr(filtros.dtAte),
      situacao: filtros.situacao,
      situacaoLabel,
      nrRota: filtros.nrRota,
      semRota: filtros.semRota,
      rotaLabel,
      cdDono: filtros.cdDono,
      donoLabel,
    },
    avisos,
    dias,
    totais: {
      dias: dias.length,
      cargas: cargasUnicas.size,
      entregas,
      pesoFrio: round3(pesoFrio),
      pesoSeco: round3(pesoSeco),
      valorFrio: round2(valorFrio),
      valorSeco: round2(valorSeco),
      receita: temReceita ? receita : null,
      leitura: leituraGrupo(pesoFrio, pesoSeco, valorFrio, valorSeco, 'periodo'),
    },
  };
}

module.exports = {
  montarDemandaDia,
  listarRotasDemandaDia,
  demandaDiaParaCsv,
};
