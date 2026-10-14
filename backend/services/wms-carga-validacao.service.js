'use strict';

const { pool } = require('../config/db');
const { codigoProdutoMatchKey } = require('../utils/wms-codigo-produto-mask');
const { resolverProdutoEstoque } = require('./wms-resolver-codigo-estoque.service');
const {
  extrairCodigoDestinatarioCadastro,
} = require('./cadastro-endereco-entrega-match.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function toNumber(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function normPedido(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d ? d.padStart(10, '0') : '';
}

/** Expressão SQL: NUM_PEDIDO OPL no mesmo formato do xPed da NF (10 dígitos). */
const SQL_EXPR_NUM_PEDIDO_OPL = `LPAD(regexp_replace(trim(COALESCE(p."NUM_PEDIDO", '')), '[^0-9]', '', 'g'), 10, '0')`;

function sqlFiltroPedidosOplNorm(paramIndex) {
  return `${SQL_EXPR_NUM_PEDIDO_OPL} = ANY($${paramIndex}::text[])`;
}

/** Chave canônica para match NF (cProd/de-para) × OPL (COD_PRODUTO_OL). */
function chaveCodigoCanonico(v) {
  const k = codigoProdutoMatchKey(v);
  if (k) return k.toUpperCase();
  return String(v || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

function normCodigo(v) {
  return chaveCodigoCanonico(v);
}

/** Resolve produto → código de estoque + fator (árvore OL / de-para), com cache por validação. */
async function resolverEstoqueCached(cache, tenantId, cdDono, codigoRaw) {
  const cod = String(codigoRaw || '').trim();
  const cd = parseInt(cdDono, 10);
  if (!cod || !Number.isFinite(cd)) return null;
  const ck = `${tenantId}|${cd}|${chaveCodigoCanonico(cod)}`;
  if (cache.has(ck)) return cache.get(ck);
  let hit = null;
  try {
    hit = await resolverProdutoEstoque(pool, tenantId, cd, cod, {});
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  cache.set(ck, hit);
  return hit;
}

/**
 * Converte linhas NF/OPL para unidade de estoque (qtd × fator da árvore/de-para).
 * Sem cadastro: mantém código e quantidade originais (comportamento anterior).
 */
async function normalizarItensParaEstoque(tenantId, itens, resolverDono, cache) {
  const preRows = [];
  const resolvePendente = [];
  const resolveVisto = new Set();
  for (const item of itens || []) {
    const cdDono = typeof resolverDono === 'function' ? resolverDono(item) : resolverDono;
    const codigoLiteral = String(item.codigoLiteral || item.codigoNf || item.codigo || '').trim();
    const qtdOriginal = toNumber(item.qtd);
    if (!codigoLiteral || qtdOriginal <= 0) continue;
    const cd = parseInt(cdDono, 10);
    const ck = Number.isFinite(cd) ? `${tenantId}|${cd}|${chaveCodigoCanonico(codigoLiteral)}` : null;
    if (ck && !resolveVisto.has(ck)) {
      resolveVisto.add(ck);
      resolvePendente.push(resolverEstoqueCached(cache, tenantId, cd, codigoLiteral));
    }
    preRows.push({ item, cdDono, codigoLiteral, qtdOriginal, ck });
  }
  if (resolvePendente.length) await Promise.all(resolvePendente);

  const out = [];
  for (const { item, codigoLiteral, qtdOriginal, ck } of preRows) {
    const hit = ck && cache.has(ck) ? cache.get(ck) : null;
    if (!hit || !hit.codigoEstoque) {
      out.push({
        ...item,
        codigo: normCodigo(codigoLiteral),
        codigoLiteral,
        codigoEstoque: null,
        qtd: qtdOriginal,
        qtdOriginal,
        conversaoEmbalagem: false,
      });
      continue;
    }

    const fator = hit.fatorConversao > 0 ? hit.fatorConversao : 1;
    const qtdEstoque = Number((qtdOriginal * fator).toFixed(6));
    const codigoEstoque = String(hit.codigoEstoque).trim();
    out.push({
      ...item,
      codigo: chaveCodigoCanonico(codigoEstoque),
      codigoLiteral,
      codigoEstoque,
      codigoOperacional: hit.codigoOperacional || null,
      cdProduto: hit.cdProduto,
      unidadeEstoque: hit.unidade || null,
      fatorConversao: fator,
      qtd: qtdEstoque,
      qtdOriginal,
      conversaoEmbalagem: fator !== 1 || chaveCodigoCanonico(codigoLiteral) !== chaveCodigoCanonico(codigoEstoque),
      conversaoOrigem: hit.origem || null,
    });
  }
  return out;
}

function formatarAvisoConversaoEmbalagem(nf, sep) {
  const partes = [];
  if (nf?.conversaoEmbalagem && nf.codigoLiteral) {
    partes.push(
      `NF ${nf.codigoLiteral}${nf.unidade ? ' ' + nf.unidade : ''}: ${formatarQtdAviso(nf.qtdOriginal)} → ${formatarQtdAviso(nf.qtd)} em estoque (${nf.codigoEstoque || '—'})`
    );
  }
  if (sep?.conversaoEmbalagem && sep.codigoLiteral) {
    partes.push(
      `Sep. ${sep.codigoLiteral}${sep.unidade ? ' ' + sep.unidade : ''}: ${formatarQtdAviso(sep.qtdOriginal)} → ${formatarQtdAviso(sep.qtd)} em estoque (${sep.codigoEstoque || '—'})`
    );
  }
  if (!partes.length) return null;
  return `Comparado em unidade de estoque (árvore/de-para). ${partes.join(' · ')}`;
}

function codigoExibicaoDivergencia(item) {
  return item?.codigoEstoque || item?.codigoLiteral || item?.codigo || '';
}

/** NF e OPL com mesma qtd “na tela” (ex. 1 × 1), mas códigos/unidades de embalagem diferentes. */
function isEmbalagemDivergenteNfOpl(nf, sep, difEstoque, qtdPedidoExibir, qtdNfExibir) {
  if (Math.abs(Number(qtdNfExibir) - Number(qtdPedidoExibir)) >= 1e-4) return false;
  if (Math.abs(difEstoque) < 1e-4) return false;
  const litNf = String(nf.codigoLiteral || '').trim();
  const litSep = String(sep.codigoLiteral || '').trim();
  if (!litNf || !litSep) return false;
  if (chaveCodigoCanonico(litNf) === chaveCodigoCanonico(litSep)) return false;
  return !!(nf.conversaoEmbalagem || sep.conversaoEmbalagem);
}

function formatarAvisoEmbalagemDivergente(nf, sep, avisoEmb) {
  const partes = [];
  if (avisoEmb) partes.push(avisoEmb);
  const qNf = formatarQtdAviso(nf.qtdOriginal != null ? nf.qtdOriginal : nf.qtd);
  const qSep = formatarQtdAviso(sep.qtdOriginal != null ? sep.qtdOriginal : sep.qtd);
  const uNf = nf.unidade || nf.unidadeEstoque || '—';
  const uSep = sep.unidade || sep.unidadeEstoque || '—';
  partes.push(
    `Mesma quantidade aparente (${qNf} ${uNf} na NF × ${qSep} ${uSep} no OPL), mas códigos de embalagem diferentes: NF ${litCod(nf.codigoLiteral)} × OPL ${litCod(sep.codigoLiteral)}. ` +
      'O ERP pode ter baixado em pacote (PC) enquanto o espelho pedia caixa (CX). Revise o espelho ou a NF — não é “sobra” de pacotes extras.'
  );
  return partes.join(' ');
}

function litCod(v) {
  const s = String(v || '').trim();
  return s || '—';
}

function deparaLookupKeysFromCProd(cProd) {
  const raw = String(cProd ?? '').trim();
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
    by.set(ex.toLowerCase(), d);
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

async function carregarMapasCodigoDono(tenantId, cdDono, executor) {
  const q = executorOuPool(executor);
  const [rDep, rPr] = await Promise.all([
    q.query(
      `SELECT "CODIGO_EXTERNO", "CODIGO_INTERNO"
         FROM "WMS_DEPARA_PRODUTO"
        WHERE "TENANT_ID" = $1
          AND "CD_DONO" = $2::integer
          AND COALESCE(TRIM(UPPER("FGACTIVE")), 'S') = 'S'`,
      [tenantId, cdDono]
    ),
    q.query(
      `SELECT LOWER(TRIM("CODIGO")) AS ck, "CODIGO"
         FROM "WMS_PRODUTO_DONO"
        WHERE "TENANT_ID" = $1
          AND "CD_DONO" = $2::integer
          AND COALESCE(TRIM(UPPER("FGACTIVE")), 'S') = 'S'`,
      [tenantId, cdDono]
    ),
  ]);
  const byDep = buildDeparaHitMap(rDep.rows || []);
  const byCodigo = new Map();
  for (const row of rPr.rows || []) {
    const cod = String(row.CODIGO || '').trim();
    if (!cod) continue;
    byCodigo.set(chaveCodigoCanonico(cod), cod);
  }
  return { byDep, byCodigo };
}

function resolverCodigoOlLinhaNf(cProdRaw, mapasDono) {
  const raw = String(cProdRaw || '').trim();
  if (!raw) return '';
  const { byDep, byCodigo } = mapasDono;
  const hit = hitDeparaFromMap(byDep, raw);
  if (hit) {
    const interno = String(hit.CODIGO_INTERNO ?? hit.codigo_interno ?? '').trim();
    if (interno) return chaveCodigoCanonico(interno);
  }
  const canon = chaveCodigoCanonico(raw);
  if (byCodigo.has(canon)) return canon;
  return canon;
}

/** Código destinatário OPL/cadastro: só dígitos, sem zeros à esquerda. */
function normCodDestinatario(c) {
  return String(c || '')
    .replace(/\D/g, '')
    .replace(/^0+/, '') || '';
}

/**
 * Match cross-pedido só é seguro quando o cliente da NF (ponto de entrega)
 * e o COD_DESTINATARIO do OPL coincidem — ou quando um dos lados não tem código
 * (aí mantém o comportamento legado, com cautela).
 */
function clientesCompativeisCross(nf, sep) {
  const a = normCodDestinatario(nf && nf.codDestinatario);
  const b = normCodDestinatario(sep && sep.codDestinatario);
  if (!a || !b) return true;
  return a === b;
}

/** 0 = mesmo cliente, 1 = neutro (falta código), 2 = diverge (não usar em auto-match). */
function scoreClienteCross(nf, sep) {
  const a = normCodDestinatario(nf && nf.codDestinatario);
  const b = normCodDestinatario(sep && sep.codDestinatario);
  if (a && b && a === b) return 0;
  if (!a || !b) return 1;
  return 2;
}

/**
 * NF com xPed errado mas mesmo SKU/qtd no espelho em outro pedido da carga.
 * Ex.: NF xPed 72662 × feijão 170 ↔ OPL pedido 72554 × feijão 170.
 * Prefere o mesmo COD_DESTINATARIO; nunca auto-reconcilia cliente diferente.
 */
function aplicarReconciliacaoCrossPedido(mapNf, mapSep) {
  const pareamentos = new Map();
  const nfReconciliados = new Set();
  const sepReconciliados = new Set();

  const candidatos = [];
  for (const [sepKey, sep] of mapSep.entries()) {
    if (mapNf.has(sepKey)) continue;
    for (const [nfKey, nf] of mapNf.entries()) {
      if (nf.codigo !== sep.codigo) continue;
      if (nf.pedido === sep.pedido) continue;
      if (Math.abs(Number(nf.qtd) - Number(sep.qtd)) > 1e-4) continue;
      if (!clientesCompativeisCross(nf, sep)) continue;
      candidatos.push({
        nfKey,
        sepKey,
        scoreCli: scoreClienteCross(nf, sep),
        pedNf: nf.pedido,
        pedSep: sep.pedido,
      });
    }
  }
  candidatos.sort(
    (a, b) =>
      a.scoreCli - b.scoreCli ||
      String(a.pedNf).localeCompare(String(b.pedNf)) ||
      String(a.pedSep).localeCompare(String(b.pedSep))
  );
  for (const c of candidatos) {
    if (nfReconciliados.has(c.nfKey) || sepReconciliados.has(c.sepKey)) continue;
    pareamentos.set(c.nfKey, c.sepKey);
    nfReconciliados.add(c.nfKey);
    sepReconciliados.add(c.sepKey);
  }
  return { pareamentos, nfReconciliados, sepReconciliados };
}

/**
 * Net por cliente + SKU quando a soma NF = soma OPL, mesmo com xPeds diferentes.
 * Ex.: pedido OPL 15 → coleta 20 (pacote 10); NFs 15 + 5 em xPeds distintos.
 * Só ativa com COD_DESTINATARIO igual e não vazio nos dois lados.
 */
function aplicarReconciliacaoNetClienteSku(mapNf, mapSep, nfJaReconciliados, sepJaReconciliados) {
  const nfNetados = new Set();
  const sepNetados = new Set();
  const avisos = [];

  const grupos = new Map();
  const ensure = (gk) => {
    if (!grupos.has(gk)) grupos.set(gk, { nfKeys: [], sepKeys: [], qtdNf: 0, qtdSep: 0, codigo: '', cli: '' });
    return grupos.get(gk);
  };

  for (const [nfKey, nf] of mapNf.entries()) {
    if (nfJaReconciliados.has(nfKey)) continue;
    const cli = normCodDestinatario(nf.codDestinatario);
    if (!cli || !nf.codigo) continue;
    const gk = `${cli}|${nf.codigo}`;
    const g = ensure(gk);
    g.nfKeys.push(nfKey);
    g.qtdNf += Number(nf.qtd) || 0;
    g.codigo = nf.codigo;
    g.cli = cli;
    g.descricao = nf.descricao || g.descricao || '';
  }
  for (const [sepKey, sep] of mapSep.entries()) {
    if (sepJaReconciliados.has(sepKey)) continue;
    const cli = normCodDestinatario(sep.codDestinatario);
    if (!cli || !sep.codigo) continue;
    const gk = `${cli}|${sep.codigo}`;
    if (!grupos.has(gk)) continue;
    const g = grupos.get(gk);
    g.sepKeys.push(sepKey);
    g.qtdSep += Number(sep.qtd) || 0;
    g.descricao = g.descricao || sep.descricao || '';
  }

  for (const g of grupos.values()) {
    if (!g.nfKeys.length || !g.sepKeys.length) continue;
    if (Math.abs(Number(g.qtdNf) - Number(g.qtdSep)) >= 1e-4) continue;
    const soDireto =
      g.nfKeys.length === 1 &&
      g.sepKeys.length === 1 &&
      g.nfKeys[0] === g.sepKeys[0];
    if (soDireto) continue;

    for (const k of g.nfKeys) nfNetados.add(k);
    for (const k of g.sepKeys) sepNetados.add(k);

    const pedsNf = [...new Set(g.nfKeys.map((k) => k.split('|')[0]))].sort();
    const pedsSep = [...new Set(g.sepKeys.map((k) => k.split('|')[0]))].sort();
    avisos.push({
      tipo: 'CONF_NET_CLIENTE_SKU',
      severidade: 'AVISO',
      pedido: pedsNf[0] || '',
      pedidosNf: pedsNf,
      pedidoOpl: pedsSep.join(' + '),
      pedidosOplAlternativos: pedsSep,
      codigo: g.codigo,
      descricao: g.descricao || '',
      unidadePedido: null,
      unidadeNf: null,
      qtdPedido: Number(g.qtdSep.toFixed(4)),
      qtdNf: Number(g.qtdNf.toFixed(4)),
      qtdDif: 0,
      reconciliado: true,
      somaOpl: true,
      situacao: 'NET CLIENTE+SKU OK',
      codDestinatarioNf: g.cli,
      codDestinatarioOpl: g.cli,
      aviso:
        `Soma NF (${formatarQtdAviso(g.qtdNf)}) = soma OPL (${formatarQtdAviso(g.qtdSep)}) ` +
        `para cliente ${g.cli} / ${g.codigo}. ` +
        `xPeds NF: ${pedsNf.join(', ')} · pedidos OPL: ${pedsSep.join(', ')}. ` +
        'Típico de complemento de embalagem (ex.: pacote 10 com pedido ímpar).',
    });
  }

  return { nfNetados, sepNetados, avisos };
}

function obterSepParaNf(nfKey, mapSep, pareamentos) {
  if (mapSep.has(nfKey)) return mapSep.get(nfKey);
  const sepKey = pareamentos.get(nfKey);
  return sepKey ? mapSep.get(sepKey) : null;
}

/** Índice código → linhas OPL/separação (vários pedidos podem ter o mesmo SKU). */
function indiceSepPorCodigo(mapSep) {
  const idx = new Map();
  for (const sep of mapSep.values()) {
    const cod = sep.codigo;
    if (!cod) continue;
    if (!idx.has(cod)) idx.set(cod, []);
    idx.get(cod).push(sep);
  }
  return idx;
}

/** Mesmo SKU no OPL sob outro NUM_PEDIDO (xPed da NF ≠ espelho). */
function buscarOplAlternativas(codigo, pedidoNf, idxPorCodigo) {
  const ped = normPedido(pedidoNf);
  const cod = normCodigo(codigo);
  const lista = idxPorCodigo.get(cod) || [];
  return lista
    .filter((s) => s.pedido !== ped)
    .map((s) => ({
      pedido: s.pedido,
      qtd: s.qtd,
      unidade: s.unidade || null,
      descricao: s.descricao || '',
      codDestinatario: s.codDestinatario ? String(s.codDestinatario).trim() : '',
    }));
}

function formatarQtdAviso(q) {
  const n = Number(q);
  if (!Number.isFinite(n)) return String(q ?? '');
  const fixed = n.toFixed(4).replace(/\.?0+$/, '');
  return fixed.replace('.', ',');
}

function formatarAvisoOplAlternativas(alternativas) {
  if (!alternativas?.length) return null;
  const partes = alternativas.map((a) => {
    const un = a.unidade ? ` ${a.unidade}` : '';
    const cli = a.codDestinatario ? ` — cliente ${a.codDestinatario}` : '';
    return `pedido ${a.pedido}, qtd ${formatarQtdAviso(a.qtd)}${un}${cli}`;
  });
  return (
    `No OPL (outro xPed): ${partes.join('; ')}. ` +
    'A coluna "qtd separada" 0 refere-se ao pedido da NF — o item pode constar no romaneio sob outro pedido.'
  );
}

function formatarAvisoConferenciaCross(nf, sep, reconciliado, dif) {
  const cli = sep.codDestinatario ? ` (cliente OPL ${sep.codDestinatario})` : '';
  const base = `NF xPed ${nf.pedido} ↔ OPL pedido ${sep.pedido}${cli}`;
  if (reconciliado && Math.abs(dif) < 1e-4) {
    return `${base}: SKU e quantidade conferem (números de pedido diferentes).`;
  }
  if (Math.abs(dif) < 1e-4) {
    return `${base}: mesmo SKU e quantidade; validar se o xPed da NF corresponde ao pedido OPL.`;
  }
  return (
    `${base}: mesmo SKU, quantidades diferem (OPL ${formatarQtdAviso(sep.qtd)} × NF ${formatarQtdAviso(nf.qtd)}).`
  );
}

/**
 * Uma sugestão OPL por linha da NF (evita explosão combinatória NF×OPL).
 * Se vários pedidos OPL do mesmo cliente tiverem o mesmo SKU, usa a soma das qtds
 * quando isso explica melhor a NF do que um único pedido (ex.: NF 3 × OPL 2+1).
 */
function escolherMelhorOplParaLinhaNf(nf, nfKey, mapSep, pareamentos) {
  if (mapSep.has(nfKey)) return null;

  const sepKeyPareado = pareamentos.get(nfKey);
  if (sepKeyPareado && mapSep.has(sepKeyPareado)) {
    const sep = mapSep.get(sepKeyPareado);
    return {
      sep,
      reconciliado: true,
      ambiguos: null,
      clienteDivergente: !clientesCompativeisCross(nf, sep),
      somaOpl: false,
    };
  }

  const candidatos = [];
  for (const [, sep] of mapSep.entries()) {
    if (sep.codigo !== nf.codigo) continue;
    if (sep.pedido === nf.pedido) continue;
    candidatos.push({
      sep,
      difQtd: Math.abs(Number(nf.qtd) - Number(sep.qtd)),
      scoreCli: scoreClienteCross(nf, sep),
    });
  }
  if (!candidatos.length) return null;

  candidatos.sort(
    (a, b) =>
      a.scoreCli - b.scoreCli ||
      a.difQtd - b.difQtd ||
      String(a.sep.pedido).localeCompare(String(b.sep.pedido))
  );
  const melhorDif = candidatos[0].difQtd;
  const melhorCli = candidatos[0].scoreCli;

  /** Soma OPL (mesmo cliente) — evita NF 3 × “melhor pedido” 2 quando existe 2+1. */
  const grupoSoma = candidatos.filter((c) => c.scoreCli === melhorCli && melhorCli < 2);
  if (grupoSoma.length > 1) {
    const qtdSoma = grupoSoma.reduce((acc, c) => acc + Number(c.sep.qtd || 0), 0);
    const difSoma = Math.abs(Number(nf.qtd) - qtdSoma);
    if (difSoma + 1e-9 < melhorDif || Math.abs(difSoma) < 1e-4) {
      const pedidos = grupoSoma
        .map((c) => c.sep.pedido)
        .sort((a, b) => String(a).localeCompare(String(b)));
      const base = grupoSoma[0].sep;
      return {
        sep: { ...base, qtd: Number(qtdSoma.toFixed(4)) },
        reconciliado: false,
        ambiguos: pedidos,
        clienteDivergente: false,
        somaOpl: true,
      };
    }
  }

  const empatados = candidatos.filter(
    (c) => c.scoreCli === melhorCli && Math.abs(c.difQtd - melhorDif) < 1e-4
  );
  const ambiguos = empatados.length > 1 ? empatados.map((c) => c.sep.pedido) : null;

  return {
    sep: empatados[0].sep,
    reconciliado: false,
    ambiguos,
    clienteDivergente: melhorCli === 2,
    somaOpl: false,
  };
}

function rotuloSituacaoConferencia(esc, dif) {
  if (esc.clienteDivergente) return 'REVISAR — cliente diverge';
  if (esc.reconciliado && Math.abs(dif) < 1e-4) return 'CONFERE (match auto)';
  if (esc.somaOpl && Math.abs(dif) < 1e-4) return 'XPED ERRADO — QTD OK (soma OPL)';
  if (esc.ambiguos && esc.ambiguos.length > 1 && !esc.somaOpl) return 'VER CLIENTE NA NF';
  if (Math.abs(dif) < 1e-4) return 'XPED ERRADO — QTD OK';
  return 'CONFERIR QTD';
}

function formatarAvisoConferenciaPratico(nf, sep, esc, dif) {
  const cli = sep.codDestinatario ? ` cliente ${sep.codDestinatario}` : '';
  const cliNf = nf.codDestinatario ? ` (NF cliente ${nf.codDestinatario})` : '';
  if (esc.clienteDivergente) {
    return (
      `xPed ${nf.pedido} ausente no OPL${cliNf}. ` +
      `Casou só por quantidade com pedido ${sep.pedido}${cli ? ` (${cli.trim()})` : ''} — ` +
      'não é match automático.'
    );
  }
  if (esc.somaOpl && esc.ambiguos && esc.ambiguos.length > 1) {
    const lista = esc.ambiguos.join(', ');
    const oplRef = sep.cdOplArquivo ? ` (espelho OPL #${sep.cdOplArquivo})` : '';
    if (Math.abs(dif) < 1e-4) {
      return (
        `xPed NF ${nf.pedido} ≠ OPL. Soma OPL nos pedidos ${lista}${cli}${oplRef}: ` +
        `qtd ${formatarQtdAviso(sep.qtd)} = NF ${formatarQtdAviso(nf.qtd)}. Só corrigir o xPed.`
      );
    }
    return (
      `xPed NF ${nf.pedido} ≠ OPL. Soma OPL nos pedidos ${lista}${cli}${oplRef}: ` +
      `qtd ${formatarQtdAviso(sep.qtd)} × NF ${formatarQtdAviso(nf.qtd)}.`
    );
  }
  if (esc.ambiguos && esc.ambiguos.length > 1) {
    return (
      `Mesma qtd em ${esc.ambiguos.length} pedidos OPL (${esc.ambiguos.join(', ')}). ` +
      'Abra o romaneio por NF e confira qual cliente/unidade bate.'
    );
  }
  const oplRef = sep.cdOplArquivo ? ` · espelho OPL #${sep.cdOplArquivo}` : '';
  if (Math.abs(dif) < 1e-4) {
    return `Provável pedido OPL: ${sep.pedido}${cli ? ` (${cli})` : ''}${oplRef}. xPed na NF está como ${nf.pedido}.`;
  }
  return `OPL ${sep.pedido}${cli ? ` (${cli})` : ''}${oplRef}: qtd ${formatarQtdAviso(sep.qtd)} × NF ${formatarQtdAviso(nf.qtd)}.`;
}

/**
 * Uma linha por item da NF cujo xPed não bate com o pedido OPL do mesmo SKU.
 * Não lista todas as combinações — só a melhor sugestão (ou aviso de ambiguidade).
 * Mesma quantidade em outro cliente: "REVISAR — cliente diverge" (não bloqueia, não é CONFERE).
 * Quantidade diferente + cliente divergente continua em PEDIDO_NAO_ENCONTRADO.
 */
function gerarConferenciasCrossPedido(mapNf, mapSep, pareamentos) {
  const out = [];
  const vistos = new Set();

  for (const [nfKey, nf] of mapNf.entries()) {
    if (!nf.pedido || !nf.codigo) continue;
    if (vistos.has(nfKey)) continue;
    vistos.add(nfKey);

    const esc = escolherMelhorOplParaLinhaNf(nf, nfKey, mapSep, pareamentos);
    if (!esc) continue;
    const sep = esc.sep;
    const dif = Number((Number(nf.qtd) - Number(sep.qtd)).toFixed(4));
    if (esc.clienteDivergente && Math.abs(dif) >= 1e-4) continue;
    const tipo = Math.abs(dif) < 1e-4 ? 'CONF_XPED_OK' : 'CONF_XPED_QTD';

    out.push({
      tipo,
      severidade: 'AVISO',
      pedido: nf.pedido,
      pedidoOpl: esc.somaOpl && esc.ambiguos && esc.ambiguos.length
        ? esc.ambiguos.join(' + ')
        : sep.pedido,
      pedidosOplAlternativos: esc.ambiguos || [],
      codigo: nf.codigo,
      descricao: nf.descricao || sep.descricao,
      unidadePedido: sep.unidade,
      unidadeNf: nf.unidade,
      qtdPedido: sep.qtd,
      qtdNf: nf.qtd,
      qtdDif: dif,
      reconciliado: esc.reconciliado,
      somaOpl: !!esc.somaOpl,
      cdOplArquivo: sep.cdOplArquivo || null,
      codDestinatarioOpl: sep.codDestinatario ? String(sep.codDestinatario).trim() : '',
      codDestinatarioNf: nf.codDestinatario ? String(nf.codDestinatario).trim() : '',
      situacao: rotuloSituacaoConferencia(esc, dif),
      aviso: formatarAvisoConferenciaPratico(nf, sep, esc, dif),
    });
  }

  return out.sort(
    (a, b) =>
      String(a.pedido).localeCompare(String(b.pedido)) ||
      String(a.codigo).localeCompare(String(b.codigo))
  );
}

function isConferenciaCrossPedido(d) {
  const t = String(d?.tipo || d?.TP_DIVERGENCIA || '').toUpperCase();
  return (
    t === 'CONF_XPED_OK' ||
    t === 'CONF_XPED_QTD' ||
    t === 'CONF_NET_CLIENTE_SKU' ||
    t === 'CONFERENCIA_PEDIDO_CRUZADO' ||
    t === 'CONFERENCIA_PEDIDO_CRUZADO_QTD_DIF'
  );
}

function separarDivergenciasEConferencias(divergencias) {
  const lista = Array.isArray(divergencias) ? divergencias : [];
  const bloqueantes = [];
  const conferencias = [];
  for (const d of lista) {
    if (isConferenciaCrossPedido(d)) conferencias.push(d);
    else bloqueantes.push(d);
  }
  return { divergencias: bloqueantes, conferenciasCrossPedido: conferencias };
}

/** Anexa NF (nº/série) e destino às divergências a partir dos itens da carga — para conferência operacional. */
function enriquecerDivergenciasComContextoNf(lista, itensNf) {
  const byKey = new Map();
  for (const it of itensNf || []) {
    const ped = normPedido(it.pedido);
    const cod = normCodigo(it.codigo);
    if (!cod) continue;
    const ctx = {
      numeroNf: it.numeroNf || '',
      serieNf: it.serieNf || '',
      nfLabel: it.nfLabel || '',
      destino: it.destino || '',
      cdNfeSaida: it.cdNfeSaida != null ? it.cdNfeSaida : null,
    };
    if (!ctx.nfLabel && !ctx.destino && ctx.cdNfeSaida == null) continue;
    const k1 = `${ped}|${cod}`;
    if (!byKey.has(k1)) byKey.set(k1, ctx);
    const k2 = `|${cod}`;
    if (!byKey.has(k2)) byKey.set(k2, ctx);
  }
  for (const d of lista || []) {
    if ((d.nfLabel || d.NF_LABEL) && (d.destino || d.DESTINO)) continue;
    const ped = normPedido(d.pedido || d.NR_PEDIDO);
    const cod = normCodigo(d.codigo || d.COD_PRODUTO);
    const ctx = byKey.get(`${ped}|${cod}`) || byKey.get(`|${cod}`);
    if (!ctx) continue;
    if (!d.nfLabel && !d.NF_LABEL) {
      d.nfLabel = ctx.nfLabel;
      d.numeroNf = ctx.numeroNf;
      d.serieNf = ctx.serieNf;
    }
    if (!d.destino && !d.DESTINO) d.destino = ctx.destino;
    if (d.cdNfeSaida == null && d.CD_NFE_SAIDA == null) d.cdNfeSaida = ctx.cdNfeSaida;
  }
}

function chaveAvisoDivergencia(d) {
  return `${String(d.tipo || d.TP_DIVERGENCIA || '').toUpperCase()}|${normPedido(d.pedido || d.NR_PEDIDO)}|${normCodigo(d.codigo || d.COD_PRODUTO)}`;
}

/**
 * Enriquece itens persistidos (relatório) com avisos OPL calculados na validação ao vivo.
 * @param {string|number} tenantId
 * @param {Map<number, { itens: object[] }>} divergenciasPorCarga
 */
async function enriquecerAvisosOplDivergenciasPorCargaMap(tenantId, divergenciasPorCarga) {
  const tiposComAviso = new Set(['PEDIDO_NAO_ENCONTRADO', 'NAO_SEPARADO_NA_CARGA']);
  for (const [cdCarga, dv] of divergenciasPorCarga.entries()) {
    if (!dv) continue;
    const itens = dv.itens || [];
    const precisaAviso = itens.some((it) =>
      tiposComAviso.has(String(it.TP_DIVERGENCIA || '').toUpperCase())
    );
    const precisaConferencia =
      !Array.isArray(dv.conferenciasCrossPedido) ||
      itens.some((it) => isConferenciaCrossPedido(it));
    if (!precisaAviso && !precisaConferencia) continue;
    try {
      const fresh = await validarCargaProgramada(tenantId, cdCarga, { persist: false });
      const avisoMap = new Map();
      for (const d of fresh.divergencias || []) {
        if (d.aviso) avisoMap.set(chaveAvisoDivergencia(d), d.aviso);
      }
      for (const it of dv.itens) {
      if (isConferenciaCrossPedido(it)) continue;
        const k = chaveAvisoDivergencia({
          tipo: it.TP_DIVERGENCIA,
          pedido: it.NR_PEDIDO,
          codigo: it.COD_PRODUTO,
        });
        if (avisoMap.has(k)) it.DS_AVISO = avisoMap.get(k);
      }
      const confDb = (dv.itens || []).filter(isConferenciaCrossPedido);
      dv.conferenciasCrossPedido =
        (fresh.conferenciasCrossPedido && fresh.conferenciasCrossPedido.length
          ? fresh.conferenciasCrossPedido
          : confDb
        ).map((c) => ({
          TP_DIVERGENCIA: c.tipo || c.TP_DIVERGENCIA,
          NR_PEDIDO: c.pedido || c.NR_PEDIDO,
          NR_PEDIDO_OPL: c.pedidoOpl || c.NR_PEDIDO_OPL,
          PEDIDOS_OPL_ALT: c.pedidosOplAlternativos || c.PEDIDOS_OPL_ALT || [],
          COD_PRODUTO: c.codigo || c.COD_PRODUTO,
          DS_PRODUTO: c.descricao || c.DS_PRODUTO,
          UNIDADE_PEDIDO: c.unidadePedido || c.UNIDADE_PEDIDO,
          UNIDADE_NF: c.unidadeNf || c.UNIDADE_NF,
          QTD_PEDIDO: c.qtdPedido ?? c.QTD_PEDIDO,
          QTD_NF: c.qtdNf ?? c.QTD_NF,
          QTD_DIF: c.qtdDif ?? c.QTD_DIF,
          DS_AVISO: c.aviso || c.DS_AVISO,
          SITUACAO: c.situacao || c.SITUACAO,
          RECONCILIADO: c.reconciliado ?? c.RECONCILIADO,
          COD_DESTINATARIO_OPL: c.codDestinatarioOpl || c.COD_DESTINATARIO_OPL,
        }));
      dv.itens = (dv.itens || []).filter((it) => !isConferenciaCrossPedido(it));
    } catch (_) {
      /* ignora falha por carga individual */
    }
  }
}

function classifyStatus(divergencias) {
  const bloq = divergenciasBloqueantes(divergencias);
  if (!bloq.length) return (divergencias || []).length ? 'AVISO' : 'OK';
  return 'BLOQUEIO';
}

function divergenciasBloqueantes(divergencias) {
  return (divergencias || []).filter(
    (d) => String(d.severidade || 'BLOQUEIO').toUpperCase() !== 'AVISO'
  );
}

function executorOuPool(executor) {
  return executor && typeof executor.query === 'function' ? executor : pool;
}

/** Cargas de baixa (ajuste/saída sem fluxo OPL completo) — detectadas pela descrição/observação. */
function isCargaBaixaEstoque(meta) {
  const txt = `${meta?.NM_DESCRICAO || meta?.nmDescricao || ''} ${meta?.OBS || meta?.obs || ''}`.toLowerCase();
  return /\bbaixa\b/.test(txt);
}

async function carregarMetaCargaProgramada(tenantId, cdCarga, executor) {
  const r = await executorOuPool(executor).query(
    `SELECT "CD_DONO", "ST_CARGA", "NM_DESCRICAO", "OBS"
       FROM "WMS_CARGA_PROGRAMADA"
      WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
    [cdCarga, tenantId]
  );
  return r.rowCount ? r.rows[0] : null;
}

async function carregarItensNfCarga(tenantId, cdCarga, executor) {
  const q = executorOuPool(executor);
  let r;
  try {
    r = await q.query(
      `SELECT n."CD_DONO", n."CD_NFE_SAIDA", n."NUMERO_NF", n."SERIE",
              n."XNOME_DEST", n."XNOME_ENTREGA", n."XMUN_DEST", n."UF_DEST",
              n."LINHAS_JSON", e."DS_PONTO_ENTREGA"
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
         LEFT JOIN "CADASTRO_ENDERECO_ENTREGA" e
           ON e."CD_ENDERECO_ENTREGA" = n."CD_ENDERECO_ENTREGA"
          AND e."TENANT_ID" = n."TENANT_ID"
        WHERE j."CD_CARGA" = $1::integer
          AND n."TENANT_ID" = $2`,
      [cdCarga, tenantId]
    );
  } catch (e) {
    if (!schemaMissing(e)) throw e;
    r = await q.query(
      `SELECT n."CD_DONO", n."CD_NFE_SAIDA", n."NUMERO_NF", n."SERIE",
              n."XNOME_DEST", n."XNOME_ENTREGA", n."XMUN_DEST", n."UF_DEST",
              n."LINHAS_JSON"
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
        WHERE j."CD_CARGA" = $1::integer
          AND n."TENANT_ID" = $2`,
      [cdCarga, tenantId]
    );
  }

  const mapasPorDono = new Map();
  const out = [];
  for (const row of r.rows) {
    const cdDono = row.CD_DONO != null ? parseInt(String(row.CD_DONO), 10) : NaN;
    if (!Number.isFinite(cdDono)) continue;
    if (!mapasPorDono.has(cdDono)) {
      try {
        mapasPorDono.set(cdDono, await carregarMapasCodigoDono(tenantId, cdDono, q));
      } catch (e) {
        if (schemaMissing(e)) mapasPorDono.set(cdDono, { byDep: new Map(), byCodigo: new Map() });
        else throw e;
      }
    }
    const mapas = mapasPorDono.get(cdDono);
    const linhas = Array.isArray(row.LINHAS_JSON) ? row.LINHAS_JSON : [];
    const codDestinatario = extrairCodigoDestinatarioCadastro(row.DS_PONTO_ENTREGA);
    const numeroNf = String(row.NUMERO_NF != null ? row.NUMERO_NF : '').trim();
    const serieNf = String(row.SERIE != null ? row.SERIE : '').trim();
    const nfLabel = numeroNf ? (serieNf ? `${numeroNf}/${serieNf}` : numeroNf) : '';
    const nomeDest = String(row.XNOME_ENTREGA || row.XNOME_DEST || '').trim();
    const pontoEntrega = String(row.DS_PONTO_ENTREGA || '').trim();
    const mun = String(row.XMUN_DEST || '').trim();
    const uf = String(row.UF_DEST || '').trim();
    const local = [mun, uf].filter(Boolean).join('/');
    const principalDest = pontoEntrega || nomeDest;
    const destino =
      principalDest && local ? `${principalDest} · ${local}` : principalDest || local || '';
    for (const ln of linhas) {
      const pedido = normPedido(ln.xPed || ln.xped || '');
      const codigoRaw = String(ln.cProd || ln.codigo || '').trim();
      const codigo = resolverCodigoOlLinhaNf(codigoRaw, mapas);
      const descricao = String(ln.xProd || ln.descricao || '').trim();
      const unidade = String(ln.uCom || ln.unidade || '').trim();
      const qtd = toNumber(ln.qCom || ln.quantidade || 0);
      if (!codigo || qtd <= 0) continue;
      out.push({
        pedido,
        codigo,
        codigoLiteral: codigoRaw,
        codigoNf: normCodigo(codigoRaw),
        descricao,
        unidade,
        qtd,
        cdDono,
        codDestinatario: codDestinatario || '',
        cdNfeSaida: row.CD_NFE_SAIDA != null ? Number(row.CD_NFE_SAIDA) : null,
        numeroNf,
        serieNf,
        nfLabel,
        destino,
      });
    }
  }
  return out;
}

async function carregarItensSeparacao(tenantId, cdCarga, executor) {
  const r = await executorOuPool(executor).query(
    `SELECT "NR_PEDIDO", "COD_PRODUTO", "DS_PRODUTO", "UNIDADE", "QTD_SEPARADA"
       FROM "WMS_SEPARACAO_PEDIDO_ITEM"
      WHERE "TENANT_ID" = $1
        AND "CD_CARGA" = $2::integer`,
    [tenantId, cdCarga]
  );
  return r.rows.map((row) => ({
    pedido: normPedido(row.NR_PEDIDO),
    codigo: normCodigo(row.COD_PRODUTO),
    codigoLiteral: String(row.COD_PRODUTO || '').trim(),
    descricao: String(row.DS_PRODUTO || '').trim(),
    unidade: String(row.UNIDADE || '').trim(),
    qtd: toNumber(row.QTD_SEPARADA),
  }));
}

async function carregarSeparacaoOplPorPedidosNf(tenantId, pedidosNf, executor) {
  const pedidos = [...new Set((pedidosNf || []).map(normPedido).filter(Boolean))];
  if (!pedidos.length) return { itens: [], origem: null };

  const cand = await executorOuPool(executor).query(
    `SELECT a."CD_OPL_ARQUIVO",
            a."DH_IMPORT",
            COUNT(DISTINCT p."NUM_PEDIDO")::integer AS q_match
       FROM "WMS_OPL_ARQUIVO" a
       JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
      WHERE a."TENANT_ID" = $1
        AND ${sqlFiltroPedidosOplNorm(2)}
      GROUP BY a."CD_OPL_ARQUIVO", a."DH_IMPORT"
      ORDER BY q_match DESC, a."DH_IMPORT" DESC
      LIMIT 1`,
    [tenantId, pedidos]
  );
  if (!cand.rowCount) return { itens: [], origem: null };
  const cdOplArquivo = cand.rows[0].CD_OPL_ARQUIVO;
  const r = await executorOuPool(executor).query(
    `SELECT p."NUM_PEDIDO" AS pedido,
            i."COD_PRODUTO_OL" AS codigo,
            i."DESCRICAO" AS descricao,
            SUM(COALESCE(i."QT_COLETADA", i."QT_PEDIDA", 0))::numeric AS qtd
       FROM "WMS_OPL_PEDIDO" p
       JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
      WHERE p."CD_OPL_ARQUIVO" = $1::integer
        AND ${sqlFiltroPedidosOplNorm(2)}
      GROUP BY p."NUM_PEDIDO", i."COD_PRODUTO_OL", i."DESCRICAO"
      ORDER BY p."NUM_PEDIDO"`,
    [cdOplArquivo, pedidos]
  );
  return {
    origem: { tipo: 'OPL_ARQUIVO', CD_OPL_ARQUIVO: cdOplArquivo },
    itens: r.rows.map((row) => ({
      pedido: normPedido(row.pedido),
      codigo: normCodigo(row.codigo),
      codigoLiteral: String(row.codigo || '').trim(),
      descricao: String(row.descricao || '').trim(),
      unidade: null,
      qtd: toNumber(row.qtd),
    })),
  };
}

/** Expressão SQL: código OPL normalizado (só dígitos) para match com NF. */
const SQL_EXPR_COD_OPL_NORM = `regexp_replace(trim(COALESCE(i."COD_PRODUTO_OL", '')), '[^0-9]', '', 'g')`;

/**
 * Lista espelhos OPL candidatos: por pedido da NF e/ou por SKU demandado.
 * @returns {Promise<Array<{ CD_OPL_ARQUIVO: number, DH_IMPORT: Date }>>}
 */
async function listarEspelhosOplCandidatos(tenantId, { pedidos, codigos, cdsDono, executor }) {
  const exec = executorOuPool(executor);
  const pedidosNorm = [...new Set((pedidos || []).map(normPedido).filter(Boolean))];
  const codigosNorm = [...new Set((codigos || []).map(normCodigo).filter(Boolean))];
  const cdsDonoArr = Array.isArray(cdsDono)
    ? cdsDono.map((v) => parseInt(v, 10)).filter((n) => Number.isFinite(n))
    : [];
  if (!pedidosNorm.length && !codigosNorm.length) return [];

  const porArquivo = new Map();
  const filtroDono = (paramIdx) =>
    cdsDonoArr.length
      ? `AND (a."CD_DONO" IS NULL OR a."CD_DONO" = ANY($${paramIdx}::int[]))`
      : '';

  if (pedidosNorm.length) {
    const params = [tenantId, pedidosNorm];
    if (cdsDonoArr.length) params.push(cdsDonoArr);
    const r = await exec.query(
      `WITH ranked AS (
         SELECT ${SQL_EXPR_NUM_PEDIDO_OPL} AS ped_norm,
                a."CD_OPL_ARQUIVO",
                a."DH_IMPORT",
                ROW_NUMBER() OVER (
                  PARTITION BY ${SQL_EXPR_NUM_PEDIDO_OPL}
                  ORDER BY a."DH_IMPORT" DESC, a."CD_OPL_ARQUIVO" DESC
                ) AS rn
           FROM "WMS_OPL_PEDIDO" p
           JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO" = p."CD_OPL_ARQUIVO"
          WHERE a."TENANT_ID" = $1
            AND ${sqlFiltroPedidosOplNorm(2)}
            ${filtroDono(cdsDonoArr.length ? 3 : 0)}
       )
       SELECT "CD_OPL_ARQUIVO", MAX("DH_IMPORT") AS "DH_IMPORT"
         FROM ranked
        WHERE rn = 1
        GROUP BY "CD_OPL_ARQUIVO"`,
      params
    );
    for (const row of r.rows) {
      if (!porArquivo.has(row.CD_OPL_ARQUIVO)) {
        porArquivo.set(row.CD_OPL_ARQUIVO, row.DH_IMPORT);
      }
    }
  }

  if (codigosNorm.length) {
    const params = [tenantId, codigosNorm];
    if (cdsDonoArr.length) params.push(cdsDonoArr);
    const r = await exec.query(
      `SELECT DISTINCT a."CD_OPL_ARQUIVO", a."DH_IMPORT"
         FROM "WMS_OPL_ARQUIVO" a
         JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
         JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
        WHERE a."TENANT_ID" = $1
          AND ${SQL_EXPR_COD_OPL_NORM} = ANY($2::text[])
          ${filtroDono(cdsDonoArr.length ? 3 : 0)}
        ORDER BY a."DH_IMPORT" DESC, a."CD_OPL_ARQUIVO" DESC
        LIMIT 30`,
      params
    );
    for (const row of r.rows) {
      if (!porArquivo.has(row.CD_OPL_ARQUIVO)) {
        porArquivo.set(row.CD_OPL_ARQUIVO, row.DH_IMPORT);
      }
    }
  }

  return Array.from(porArquivo.entries())
    .map(([CD_OPL_ARQUIVO, DH_IMPORT]) => ({ CD_OPL_ARQUIVO, DH_IMPORT }))
    .sort((a, b) => new Date(b.DH_IMPORT) - new Date(a.DH_IMPORT) || b.CD_OPL_ARQUIVO - a.CD_OPL_ARQUIVO);
}

/**
 * Versão MULTI-arquivo: ao contrário de `carregarSeparacaoOplPorPedidosNf` (que
 * pega LIMIT 1 e funciona para casos de UM arquivo OPL único), esta função agrega
 * a separação de TODOS os arquivos OPL que cobrem qualquer pedido da NF.
 *
 * Cenário típico que motivou esta função: o usuário separa uma mesma carga em
 * vários espelhos OPL distintos (ex.: "Lote 01 Feijão" + "Lote 05") — antes, o
 * validador de divergências cuspia `PEDIDO_NAO_ENCONTRADO` para os pedidos do
 * espelho não escolhido pelo LIMIT 1. Agora todos os espelhos relevantes
 * contribuem para o mapa de separação.
 *
 * Regras:
 *   - Filtra pelos donos da carga quando `cdsDonoCarga` é fornecido.
 *   - Espelhos **só por pedido da NF desta carga** (igual ao painel Estoque/OPL).
 *     Não puxa espelho antigo só porque tem o mesmo SKU (falso “granola OK”).
 *   - Fallback por SKU apenas se nenhum espelho cobrir os xPeds da NF.
 *   - Carrega TODOS os itens dos espelhos escolhidos (cross-ped dentro do lote certo).
 *   - Quando o mesmo (pedido, código) aparece em mais de um arquivo OPL
 *     (reimportação ou sobreposição), preserva o valor do arquivo MAIS RECENTE
 *     (`DH_IMPORT DESC`) e ignora os demais — evita double counting.
 *
 * @param {string|number} tenantId
 * @param {string[]} pedidosNf
 * @param {object} [opts]
 * @param {string[]} [opts.codigosNf] Fallback se nenhum espelho cobrir os pedidos.
 * @param {number[]} [opts.cdsDonoCarga] CDs de dono da carga (filtra arquivos OPL).
 * @param {import('pg').PoolClient} [opts.executor]
 * @returns {Promise<{ itens: object[], origem: { tipo: string, CD_OPL_ARQUIVOS: number[] } | null, espelhosAtivos?: object[] }>}
 */
async function carregarSeparacaoOplPorPedidosNfMulti(tenantId, pedidosNf, opts = {}) {
  const pedidos = [...new Set((pedidosNf || []).map(normPedido).filter(Boolean))];
  const codigos = [...new Set((opts.codigosNf || []).map(normCodigo).filter(Boolean))];
  if (!pedidos.length && !codigos.length) return { itens: [], origem: null };

  const exec = executorOuPool(opts.executor);
  const cdsDono = Array.isArray(opts.cdsDonoCarga)
    ? opts.cdsDonoCarga.map((v) => parseInt(v, 10)).filter((n) => Number.isFinite(n))
    : [];

  let candRows = pedidos.length
    ? await listarEspelhosOplCandidatos(tenantId, {
        pedidos,
        codigos: [],
        cdsDono,
        executor: exec,
      })
    : [];
  let origemTipo = 'OPL_ARQUIVOS';
  if (!candRows.length && codigos.length) {
    candRows = await listarEspelhosOplCandidatos(tenantId, {
      pedidos: [],
      codigos,
      cdsDono,
      executor: exec,
    });
    origemTipo = 'OPL_ARQUIVOS_POR_SKU';
  }
  if (!candRows.length) return { itens: [], origem: null };

  const cdsArquivos = candRows.map((r) => r.CD_OPL_ARQUIVO);
  const rFull = await exec.query(
    `SELECT p."CD_OPL_ARQUIVO" AS cdarq,
            p."NUM_PEDIDO" AS pedido,
            MAX(p."COD_DESTINATARIO") AS cod_dest,
            i."COD_PRODUTO_OL" AS codigo,
            i."DESCRICAO" AS descricao,
            SUM(COALESCE(i."QT_COLETADA", i."QT_PEDIDA", 0))::numeric AS qtd
       FROM "WMS_OPL_PEDIDO" p
       JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
      WHERE p."CD_OPL_ARQUIVO" = ANY($1::int[])
      GROUP BY p."CD_OPL_ARQUIVO", p."NUM_PEDIDO", i."COD_PRODUTO_OL", i."DESCRICAO"`,
    [cdsArquivos]
  );

  /** Ordem de preferência: arquivo mais recente vence em caso de empate de chave. */
  const ordemArq = new Map();
  candRows.forEach((row, idx) => ordemArq.set(row.CD_OPL_ARQUIVO, idx));
  const rowsSorted = rFull.rows
    .slice()
    .sort((a, b) => (ordemArq.get(a.cdarq) || 0) - (ordemArq.get(b.cdarq) || 0));

  const vistos = new Map();
  const porEspelho = new Map();
  for (const row of rowsSorted) {
    const pedido = normPedido(row.pedido);
    const codigo = normCodigo(row.codigo);
    const key = `${pedido}|${codigo}`;
    if (vistos.has(key)) continue;
    const cdOpl = parseInt(String(row.cdarq), 10);
    vistos.set(key, {
      pedido,
      codigo,
      codigoLiteral: String(row.codigo || '').trim(),
      descricao: String(row.descricao || '').trim(),
      unidade: null,
      qtd: toNumber(row.qtd),
      codDestinatario: String(row.cod_dest || '').trim(),
      cdOplArquivo: Number.isFinite(cdOpl) ? cdOpl : null,
    });
    if (Number.isFinite(cdOpl)) {
      if (!porEspelho.has(cdOpl)) {
        porEspelho.set(cdOpl, { CD_OPL_ARQUIVO: cdOpl, pedidos: new Set(), qItens: 0 });
      }
      const agg = porEspelho.get(cdOpl);
      agg.pedidos.add(pedido);
      agg.qItens += 1;
    }
  }

  const espelhosAtivos = Array.from(porEspelho.values()).map((e) => ({
    CD_OPL_ARQUIVO: e.CD_OPL_ARQUIVO,
    qItens: e.qItens,
    pedidos: [...e.pedidos],
  }));

  return {
    origem: { tipo: origemTipo, CD_OPL_ARQUIVOS: cdsArquivos },
    itens: Array.from(vistos.values()),
    espelhosAtivos,
  };
}

function chave(pedido, codigo) {
  return `${pedido}|${codigo}`;
}

function codigosDemandadosNf(mapNf) {
  return new Set([...mapNf.values()].map((n) => n.codigo).filter(Boolean));
}

/** Pool OPL só com SKUs presentes na NF desta carga (ignora linhas de outras rotas no mesmo lote). */
function montarPoolSep(itensSep, codigosNf) {
  const poolSep = new Map();
  const pedidosSep = new Set();
  for (const i of itensSep) {
    if (!codigosNf.has(i.codigo)) continue;
    pedidosSep.add(i.pedido);
    const k = chave(i.pedido, i.codigo);
    const prev = poolSep.get(k) || { ...i, qtd: 0 };
    prev.qtd += i.qtd;
    poolSep.set(k, prev);
  }
  return { poolSep, pedidosSep };
}

/** Linhas OPL alocadas a esta carga: match direto NF×pedido (não inclui pareamento cross-ped). */
function construirMapSepDireto(mapNf, poolSep, pareamentos) {
  const direto = new Map();
  for (const nfKey of mapNf.keys()) {
    const sepKey = pareamentos.get(nfKey) || nfKey;
    if (poolSep.has(sepKey)) direto.set(sepKey, poolSep.get(sepKey));
  }
  return direto;
}

/**
 * @param {object} [meta]
 * @param {string} [meta.momento] VALIDACAO | INICIO_EXPEDICAO | SAIDA | SANACAO
 * @param {string} [meta.dsEvento]
 * @param {object} [meta.payload] JSON completo para auditoria
 */
async function persistirValidacao(tenantId, cdCarga, sgUser, resumo, divergencias, meta = {}) {
  const c = resumo.contadores || {};
  const momento = String(meta.momento || 'VALIDACAO').toUpperCase().slice(0, 32);
  const dsEvento = meta.dsEvento != null ? String(meta.dsEvento).slice(0, 500) : null;
  const payload =
    meta.payload != null
      ? meta.payload
      : {
          status: resumo.status,
          contadores: c,
          divergencias: divergencias || [],
          conferenciasCrossPedido: resumo.conferenciasCrossPedido || [],
          momento,
        };
  const itens = Array.isArray(divergencias) ? divergencias : [];
  let head;
  try {
    head = await pool.query(
      `INSERT INTO "WMS_CARGA_VALIDACAO"
        ("TENANT_ID","CD_CARGA","ST_VALIDACAO","QT_FALTAS","QT_SOBRAS","QT_INVERSOES","QT_SEM_PEDIDO","QT_SEM_NF","SG_USER",
         "TP_MOMENTO","PAYLOAD_JSON","DS_EVENTO")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
       RETURNING "CD_VALIDACAO"`,
      [
        tenantId,
        cdCarga,
        resumo.status,
        c.faltas || 0,
        c.sobras || 0,
        c.inversoes || 0,
        c.semPedido || 0,
        c.semNf || 0,
        sgUser || null,
        momento,
        JSON.stringify(payload),
        dsEvento,
      ]
    );
  } catch (e) {
    if (e && e.code === '42703') {
      head = await pool.query(
        `INSERT INTO "WMS_CARGA_VALIDACAO"
          ("TENANT_ID","CD_CARGA","ST_VALIDACAO","QT_FALTAS","QT_SOBRAS","QT_INVERSOES","QT_SEM_PEDIDO","QT_SEM_NF","SG_USER")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING "CD_VALIDACAO"`,
        [
          tenantId,
          cdCarga,
          resumo.status,
          c.faltas || 0,
          c.sobras || 0,
          c.inversoes || 0,
          c.semPedido || 0,
          c.semNf || 0,
          sgUser || null,
        ]
      );
    } else {
      throw e;
    }
  }
  const cdValidacao = head.rows[0].CD_VALIDACAO;
  for (const d of itens) {
    const tipo = d.tipo || d.TP_DIVERGENCIA;
    if (!tipo) continue;
    await pool.query(
      `INSERT INTO "WMS_CARGA_VALIDACAO_ITEM"
        ("CD_VALIDACAO","NR_PEDIDO","COD_PRODUTO","DS_PRODUTO","UNIDADE_PEDIDO","UNIDADE_NF","QTD_PEDIDO","QTD_NF","QTD_DIF","TP_DIVERGENCIA","SEVERIDADE")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        cdValidacao,
        d.pedido || d.NR_PEDIDO || null,
        d.codigo || d.COD_PRODUTO || null,
        d.descricao || d.DS_PRODUTO || null,
        d.unidadePedido || d.UNIDADE_PEDIDO || null,
        d.unidadeNf || d.UNIDADE_NF || null,
        d.qtdPedido != null ? d.qtdPedido : d.QTD_PEDIDO,
        d.qtdNf != null ? d.qtdNf : d.QTD_NF,
        d.qtdDif != null ? d.qtdDif : d.QTD_DIF,
        tipo,
        d.severidade || d.SEVERIDADE || null,
      ]
    );
  }
  return cdValidacao;
}

/** Último snapshot por momento (SAIDA preferencial para auditoria pós-expedição). */
async function carregarSnapshotValidacao(tenantId, cdCarga, momentosPreferidos = ['SAIDA', 'INICIO_EXPEDICAO']) {
  const momentos = Array.isArray(momentosPreferidos) ? momentosPreferidos : [momentosPreferidos];
  try {
    const r = await pool.query(
      `SELECT v."CD_VALIDACAO", v."ST_VALIDACAO", v."QT_FALTAS", v."QT_SOBRAS", v."QT_INVERSOES",
              v."QT_SEM_PEDIDO", v."QT_SEM_NF", v."GERADO_EM", v."SG_USER",
              v."TP_MOMENTO", v."PAYLOAD_JSON", v."DS_EVENTO"
         FROM "WMS_CARGA_VALIDACAO" v
        WHERE v."TENANT_ID" = $1
          AND v."CD_CARGA" = $2::integer
          AND COALESCE(v."TP_MOMENTO", 'VALIDACAO') = ANY($3::text[])
        ORDER BY array_position($3::text[], COALESCE(v."TP_MOMENTO", 'VALIDACAO')),
                 v."GERADO_EM" DESC, v."CD_VALIDACAO" DESC
        LIMIT 1`,
      [tenantId, cdCarga, momentos]
    );
    if (!r.rowCount) return null;
    const cab = r.rows[0];
    const itensR = await pool.query(
      `SELECT "NR_PEDIDO","COD_PRODUTO","DS_PRODUTO","UNIDADE_PEDIDO","UNIDADE_NF",
              "QTD_PEDIDO","QTD_NF","QTD_DIF","TP_DIVERGENCIA","SEVERIDADE"
         FROM "WMS_CARGA_VALIDACAO_ITEM"
        WHERE "CD_VALIDACAO" = $1
        ORDER BY "TP_DIVERGENCIA", "NR_PEDIDO", "COD_PRODUTO"`,
      [cab.CD_VALIDACAO]
    );
    return { cabecalho: cab, itens: itensR.rows };
  } catch (e) {
    if (e && e.code === '42703') {
      try {
        const r2 = await pool.query(
          `SELECT v."CD_VALIDACAO", v."ST_VALIDACAO", v."QT_FALTAS", v."QT_SOBRAS", v."QT_INVERSOES",
                  v."QT_SEM_PEDIDO", v."QT_SEM_NF", v."GERADO_EM", v."SG_USER"
             FROM "WMS_CARGA_VALIDACAO" v
            WHERE v."TENANT_ID" = $1 AND v."CD_CARGA" = $2::integer
            ORDER BY v."GERADO_EM" DESC, v."CD_VALIDACAO" DESC
            LIMIT 1`,
          [tenantId, cdCarga]
        );
        if (!r2.rowCount) return null;
        const cab = { ...r2.rows[0], TP_MOMENTO: 'VALIDACAO' };
        const itensR = await pool.query(
          `SELECT "NR_PEDIDO","COD_PRODUTO","DS_PRODUTO","UNIDADE_PEDIDO","UNIDADE_NF",
                  "QTD_PEDIDO","QTD_NF","QTD_DIF","TP_DIVERGENCIA","SEVERIDADE"
             FROM "WMS_CARGA_VALIDACAO_ITEM"
            WHERE "CD_VALIDACAO" = $1`,
          [cab.CD_VALIDACAO]
        );
        return { cabecalho: cab, itens: itensR.rows };
      } catch (e2) {
        if (schemaMissing(e2)) return null;
        throw e2;
      }
    }
    if (schemaMissing(e)) return null;
    throw e;
  }
}

async function listarSanacoesValidacao(tenantId, cdCarga, limite = 10) {
  try {
    const r = await pool.query(
      `SELECT "CD_VALIDACAO", "GERADO_EM", "SG_USER", "DS_EVENTO", "PAYLOAD_JSON", "ST_VALIDACAO"
         FROM "WMS_CARGA_VALIDACAO"
        WHERE "TENANT_ID" = $1
          AND "CD_CARGA" = $2::integer
          AND COALESCE("TP_MOMENTO", '') = 'SANACAO'
        ORDER BY "GERADO_EM" DESC, "CD_VALIDACAO" DESC
        LIMIT $3::integer`,
      [tenantId, cdCarga, limite]
    );
    return r.rows;
  } catch (e) {
    if (e && (e.code === '42703' || schemaMissing(e))) return [];
    throw e;
  }
}

/**
 * Após importar OPL: se cargas já expedidas/em expedição tinham PEDIDO_NAO_ENCONTRADO
 * e o pedido agora existe no espelho, grava evento SANACAO (auditoria — não apaga o snapshot).
 */
async function registrarSanacoesAposImportOpl(tenantId, cdOplArquivo, sgUser, opts = {}) {
  const nmArquivo = opts.nmArquivo != null ? String(opts.nmArquivo) : '';
  const pedR = await pool.query(
    `SELECT DISTINCT
            LPAD(regexp_replace(trim(COALESCE(p."NUM_PEDIDO", '')), '[^0-9]', '', 'g'), 10, '0') AS ped
       FROM "WMS_OPL_PEDIDO" p
      WHERE p."CD_OPL_ARQUIVO" = $1::integer
        AND NULLIF(trim(COALESCE(p."NUM_PEDIDO", '')), '') IS NOT NULL`,
    [cdOplArquivo]
  );
  const pedidos = pedR.rows.map((x) => x.ped).filter(Boolean);
  if (!pedidos.length) return { sanacoes: 0, cargas: [] };

  const cargasR = await pool.query(
    `SELECT DISTINCT c."CD_CARGA",
            COALESCE(e."ST_EXPEDICAO", c."ST_CARGA") AS "ST_EXP"
       FROM "WMS_CARGA_PROGRAMADA" c
       JOIN "WMS_CARGA_PROGRAMADA_NFE" j ON j."CD_CARGA" = c."CD_CARGA"
       JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA" AND n."TENANT_ID" = c."TENANT_ID"
       LEFT JOIN "WMS_EXPEDICAO_CARGA" e
         ON e."CD_CARGA" = c."CD_CARGA" AND e."TENANT_ID" = c."TENANT_ID"
      WHERE c."TENANT_ID" = $1
        AND COALESCE(e."ST_EXPEDICAO", c."ST_CARGA", '') IN ('EM_EXPEDICAO', 'EXPEDIDA')
        AND EXISTS (
          SELECT 1
            FROM jsonb_array_elements(COALESCE(n."LINHAS_JSON", '[]'::jsonb)) ln
           WHERE LPAD(regexp_replace(trim(COALESCE(ln->>'xPed', ln->>'xped', '')), '[^0-9]', '', 'g'), 10, '0')
                 = ANY($2::text[])
        )`,
    [tenantId, pedidos]
  );

  const pedSet = new Set(pedidos);
  const resultado = [];
  for (const row of cargasR.rows) {
    const cdCarga = row.CD_CARGA;
    const snap = await carregarSnapshotValidacao(tenantId, cdCarga, [
      'SAIDA',
      'INICIO_EXPEDICAO',
      'VALIDACAO',
    ]);
    if (!snap || !snap.itens.length) continue;
    const pedAusentesAntes = new Set();
    for (const it of snap.itens) {
      if (String(it.TP_DIVERGENCIA || '').toUpperCase() !== 'PEDIDO_NAO_ENCONTRADO') continue;
      const p = normPedido(it.NR_PEDIDO);
      if (p && pedSet.has(p)) pedAusentesAntes.add(p);
    }
    if (!pedAusentesAntes.size) continue;

    let live;
    try {
      live = await validarCargaProgramada(tenantId, cdCarga, { persist: false });
    } catch (e) {
      if (schemaMissing(e)) continue;
      throw e;
    }
    const aindaAusentes = new Set();
    for (const d of live.divergencias || []) {
      if (String(d.tipo || '').toUpperCase() !== 'PEDIDO_NAO_ENCONTRADO') continue;
      if (String(d.severidade || '').toUpperCase() === 'AVISO') continue;
      const p = normPedido(d.pedido);
      if (p && pedAusentesAntes.has(p)) aindaAusentes.add(p);
    }
    const sanados = [...pedAusentesAntes].filter((p) => !aindaAusentes.has(p));
    if (!sanados.length) continue;

    const dsEvento = `Sanção após OPL #${cdOplArquivo}${nmArquivo ? ` (${nmArquivo})` : ''}: pedido(s) ${sanados.join(', ')} passaram a existir no espelho.`;
    const payload = {
      momento: 'SANACAO',
      cdOplArquivo,
      nmArquivo: nmArquivo || null,
      pedidosSanados: sanados,
      stCargaNaSanacao: row.ST_EXP,
      snapshotRef: snap.cabecalho.CD_VALIDACAO,
      snapshotMomento: snap.cabecalho.TP_MOMENTO,
      liveStatus: live.status,
    };
    const cdVal = await persistirValidacao(
      tenantId,
      cdCarga,
      sgUser,
      {
        status: 'SANACAO',
        contadores: {
          faltas: 0,
          sobras: 0,
          inversoes: 0,
          semPedido: 0,
          semNf: 0,
        },
        conferenciasCrossPedido: [],
      },
      sanados.map((p) => ({
        tipo: 'PEDIDO_SANADO_POS_OPL',
        severidade: 'AVISO',
        pedido: p,
        codigo: null,
        descricao: dsEvento,
        qtdPedido: 0,
        qtdNf: 0,
        qtdDif: 0,
      })),
      { momento: 'SANACAO', dsEvento, payload }
    );
    resultado.push({ cdCarga, cdValidacao: cdVal, pedidosSanados: sanados });
  }
  return { sanacoes: resultado.length, cargas: resultado };
}

/**
 * Lê CDs de dono do estoque ligados à carga (via NF-e). Usado pelo validador
 * para restringir o lookup de OPL apenas aos espelhos do(s) mesmo(s) dono(s).
 */
/**
 * Pedidos distintos (xPed das NF-e) agrupados por CD_DONO da nota.
 * @returns {Promise<Map<number, Set<string>>>}
 */
async function carregarPedidosPorDonoNfCarga(tenantId, cdCarga, executor) {
  const map = new Map();
  try {
    const r = await executorOuPool(executor).query(
      `SELECT n."CD_DONO", n."LINHAS_JSON"
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
        WHERE j."CD_CARGA" = $1::integer
          AND n."TENANT_ID" = $2`,
      [cdCarga, tenantId]
    );
    for (const row of r.rows) {
      const cdDono = row.CD_DONO != null ? parseInt(String(row.CD_DONO), 10) : NaN;
      if (!Number.isFinite(cdDono)) continue;
      if (!map.has(cdDono)) map.set(cdDono, new Set());
      const pedidos = map.get(cdDono);
      const linhas = Array.isArray(row.LINHAS_JSON) ? row.LINHAS_JSON : [];
      for (const ln of linhas) {
        const pedido = normPedido(ln.xPed || ln.xped || '');
        if (pedido) pedidos.add(pedido);
      }
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  return map;
}

/**
 * Demanda agregada por código OL e por dono (NF-e da carga).
 * @returns {Promise<Map<number, Map<string, number>>>} cdDono → (codigo → qtd)
 */
async function carregarDemandaCodigoPorDonoNfCarga(tenantId, cdCarga, executor) {
  const map = new Map();
  try {
    const r = await executorOuPool(executor).query(
      `SELECT n."CD_DONO", n."LINHAS_JSON"
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
        WHERE j."CD_CARGA" = $1::integer
          AND n."TENANT_ID" = $2`,
      [cdCarga, tenantId]
    );
    for (const row of r.rows) {
      const cdDono = row.CD_DONO != null ? parseInt(String(row.CD_DONO), 10) : NaN;
      if (!Number.isFinite(cdDono)) continue;
      if (!map.has(cdDono)) map.set(cdDono, new Map());
      const agg = map.get(cdDono);
      const linhas = Array.isArray(row.LINHAS_JSON) ? row.LINHAS_JSON : [];
      for (const ln of linhas) {
        const codigo = normCodigo(ln.cProd || ln.codigo || '');
        const qtd = toNumber(ln.qCom || ln.quantidade || 0);
        if (!codigo || qtd <= 0) continue;
        agg.set(codigo, Number(((agg.get(codigo) || 0) + qtd).toFixed(6)));
      }
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  return map;
}

/**
 * Demanda agregada por código OL e dono — apenas linhas da NF **sem** xPed (expedição sem OPL).
 * @returns {Promise<Map<number, Map<string, number>>>}
 */
async function carregarDemandaCodigoSemPedidoPorDonoNfCarga(tenantId, cdCarga, executor) {
  const map = new Map();
  try {
    const r = await executorOuPool(executor).query(
      `SELECT n."CD_DONO", n."LINHAS_JSON"
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
        WHERE j."CD_CARGA" = $1::integer
          AND n."TENANT_ID" = $2`,
      [cdCarga, tenantId]
    );
    for (const row of r.rows) {
      const cdDono = row.CD_DONO != null ? parseInt(String(row.CD_DONO), 10) : NaN;
      if (!Number.isFinite(cdDono)) continue;
      if (!map.has(cdDono)) map.set(cdDono, new Map());
      const agg = map.get(cdDono);
      const linhas = Array.isArray(row.LINHAS_JSON) ? row.LINHAS_JSON : [];
      for (const ln of linhas) {
        const pedido = normPedido(ln.xPed || ln.xped || '');
        if (pedido) continue;
        const codigo = normCodigo(ln.cProd || ln.codigo || '');
        const qtd = toNumber(ln.qCom || ln.quantidade || 0);
        if (!codigo || qtd <= 0) continue;
        agg.set(codigo, Number(((agg.get(codigo) || 0) + qtd).toFixed(6)));
      }
    }
  } catch (e) {
    if (!schemaMissing(e)) throw e;
  }
  return map;
}

/**
 * Melhor espelho OPL para um dono e conjunto de pedidos (maior cobertura, mais recente).
 */
async function melhorEspelhoOplParaDono(tenantId, cdDono, pedidos, executor) {
  const lista = Array.isArray(pedidos) ? pedidos : [...(pedidos || [])];
  if (!lista.length) return null;
  const q = executorOuPool(executor);
  try {
    const r = await q.query(
      `SELECT a."CD_OPL_ARQUIVO", a."NM_ARQUIVO", a."CD_DONO",
              COUNT(DISTINCT p."NUM_PEDIDO")::int AS q_match
         FROM "WMS_OPL_ARQUIVO" a
         JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
        WHERE a."TENANT_ID" = $1
          AND a."CD_DONO" = $2::integer
          AND ${sqlFiltroPedidosOplNorm(3)}
        GROUP BY a."CD_OPL_ARQUIVO", a."NM_ARQUIVO", a."CD_DONO", a."DH_IMPORT"
        ORDER BY q_match DESC, a."DH_IMPORT" DESC
        LIMIT 1`,
      [tenantId, cdDono, lista]
    );
    if (!r.rowCount) return null;
    const row = r.rows[0];
    return {
      CD_OPL_ARQUIVO: parseInt(String(row.CD_OPL_ARQUIVO), 10),
      NM_ARQUIVO: String(row.NM_ARQUIVO || '').trim(),
      CD_DONO: cdDono,
      qMatchPedidos: Number(row.q_match) || 0,
    };
  } catch (e) {
    if (schemaMissing(e)) return null;
    throw e;
  }
}

/** Espelhos OPL da carga (um por dono quando há NF de vários donos). */
async function resolverEspelhosOplParaCarga(tenantId, cdCarga, executor) {
  const q = executorOuPool(executor);
  const itensSep = await carregarItensSeparacao(tenantId, cdCarga, q);
  if (itensSep.length) return [];

  const pedidosPorDono = await carregarPedidosPorDonoNfCarga(tenantId, cdCarga, q);
  const donosNf = [...pedidosPorDono.keys()].sort((a, b) => a - b);
  if (!donosNf.length) {
    const itensNf = await carregarItensNfCarga(tenantId, cdCarga, q);
    const pedidosNf = [...new Set(itensNf.map((x) => x.pedido).filter(Boolean))];
    const opl = await carregarSeparacaoOplPorPedidosNf(tenantId, pedidosNf, q);
    const cdOpl =
      opl.origem && opl.origem.CD_OPL_ARQUIVO != null
        ? parseInt(String(opl.origem.CD_OPL_ARQUIVO), 10)
        : NaN;
    if (!Number.isFinite(cdOpl)) return [];
    const rA = await q.query(
      `SELECT "NM_ARQUIVO", "CD_DONO" FROM "WMS_OPL_ARQUIVO"
        WHERE "CD_OPL_ARQUIVO" = $1::integer AND "TENANT_ID" = $2`,
      [cdOpl, tenantId]
    );
    if (!rA.rowCount) return [];
    const cdDono =
      rA.rows[0].CD_DONO != null ? parseInt(String(rA.rows[0].CD_DONO), 10) : null;
    return [
      {
        CD_OPL_ARQUIVO: cdOpl,
        NM_ARQUIVO: String(rA.rows[0].NM_ARQUIVO || '').trim(),
        CD_DONO: Number.isFinite(cdDono) ? cdDono : null,
      },
    ];
  }

  const out = [];
  for (const cdDono of donosNf) {
    const pedidos = [...(pedidosPorDono.get(cdDono) || [])];
    const esp = await melhorEspelhoOplParaDono(tenantId, cdDono, pedidos, q);
    if (esp) out.push(esp);
  }
  return out;
}

async function carregarCdsDonoCarga(tenantId, cdCarga, executor) {
  try {
    const r = await executorOuPool(executor).query(
      `SELECT DISTINCT n."CD_DONO"
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
        WHERE j."CD_CARGA" = $1::integer
          AND n."TENANT_ID" = $2
          AND n."CD_DONO" IS NOT NULL`,
      [cdCarga, tenantId]
    );
    return r.rows.map((row) => parseInt(row.CD_DONO, 10)).filter((n) => Number.isFinite(n));
  } catch (e) {
    if (schemaMissing(e)) return [];
    throw e;
  }
}

async function validarCargaProgramada(tenantId, cdCarga, opts = {}) {
  const metaCarga = await carregarMetaCargaProgramada(tenantId, cdCarga);
  let itensNf = await carregarItensNfCarga(tenantId, cdCarga);

  if (isCargaBaixaEstoque(metaCarga)) {
    const resumoBaixa = {
      status: itensNf.length ? 'OK' : 'BLOQUEIO',
      podeExpedir: itensNf.length > 0,
      contadores: { faltas: 0, sobras: 0, inversoes: 0, semPedido: 0, semNf: 0 },
      itensNf: itensNf.length,
      itensSeparacao: 0,
      origemSeparacao: { tipo: 'BAIXA_ESTOQUE', CD_CARGA: cdCarga },
      divergencias: itensNf.length
        ? []
        : [
            {
              tipo: 'SEM_NFE_CARGA',
              severidade: 'BLOQUEIO',
              pedido: '',
              codigo: '',
              descricao: 'Carga de baixa sem NF-e vinculada.',
              unidadePedido: null,
              unidadeNf: null,
              qtdPedido: 0,
              qtdNf: 0,
              qtdDif: 0,
            },
          ],
      modoBaixaEstoque: true,
    };
    if (opts.persist && resumoBaixa.podeExpedir) {
      try {
        await persistirValidacao(tenantId, cdCarga, opts.sgUser, resumoBaixa, resumoBaixa.divergencias);
      } catch (e) {
        if (!schemaMissing(e)) throw e;
      }
    }
    return resumoBaixa;
  }

  let itensSep = await carregarItensSeparacao(tenantId, cdCarga);
  let origemSeparacao = { tipo: 'CARGA', CD_CARGA: cdCarga };
  if (!itensSep.length) {
    const pedidosNf = itensNf.map((x) => x.pedido).filter(Boolean);
    try {
      /** Usa a variante MULTI: agrega todos os espelhos OPL que cobrem os pedidos
       *  da NF, evitando o bug em que pedidos legítimos eram marcados como
       *  PEDIDO_NAO_ENCONTRADO só porque estavam em um espelho diferente do
       *  "vencedor por contagem". Filtra pelos donos da carga para reduzir falso
       *  match com espelhos de outros donos. */
      const cdsDonoCarga = await carregarCdsDonoCarga(tenantId, cdCarga);
      const codigosNf = [...new Set(itensNf.map((x) => x.codigo).filter(Boolean))];
      const opl = await carregarSeparacaoOplPorPedidosNfMulti(tenantId, pedidosNf, {
        cdsDonoCarga,
        codigosNf,
      });
      if (opl.itens.length) {
        itensSep = opl.itens;
        origemSeparacao = opl.origem;
      }
    } catch (e) {
      if (!schemaMissing(e)) throw e;
    }
  }

  const pedidoParaDono = new Map();
  for (const i of itensNf) {
    if (i.pedido && Number.isFinite(i.cdDono)) pedidoParaDono.set(i.pedido, i.cdDono);
  }
  const cdsDonoCarga = await carregarCdsDonoCarga(tenantId, cdCarga);
  const cdDonoFallback = cdsDonoCarga.length ? cdsDonoCarga[0] : null;
  const cacheResolucao = new Map();
  itensNf = await normalizarItensParaEstoque(
    tenantId,
    itensNf,
    (item) => item.cdDono,
    cacheResolucao
  );
  itensSep = await normalizarItensParaEstoque(
    tenantId,
    itensSep,
    (item) => pedidoParaDono.get(item.pedido) ?? cdDonoFallback,
    cacheResolucao
  );

  const mapNf = new Map();
  const divergencias = [];

  for (const i of itensNf) {
    const k = chave(i.pedido, i.codigo);
    const prev = mapNf.get(k) || { ...i, qtd: 0 };
    prev.qtd += i.qtd;
    mapNf.set(k, prev);
  }

  const codigosNf = codigosDemandadosNf(mapNf);
  const { poolSep, pedidosSep } = montarPoolSep(itensSep, codigosNf);

  const { pareamentos, nfReconciliados, sepReconciliados } = aplicarReconciliacaoCrossPedido(
    mapNf,
    poolSep
  );
  const {
    nfNetados,
    sepNetados,
    avisos: avisosNetClienteSku,
  } = aplicarReconciliacaoNetClienteSku(mapNf, poolSep, nfReconciliados, sepReconciliados);
  for (const k of nfNetados) nfReconciliados.add(k);
  for (const k of sepNetados) sepReconciliados.add(k);

  const idxSepPorCodigo = indiceSepPorCodigo(poolSep);
  let conferenciasCrossPedido = gerarConferenciasCrossPedido(mapNf, poolSep, pareamentos);
  conferenciasCrossPedido = conferenciasCrossPedido.filter(
    (c) => !nfNetados.has(chave(c.pedido, c.codigo))
  );
  conferenciasCrossPedido.push(...avisosNetClienteSku);
  const mapSepDireto = construirMapSepDireto(mapNf, poolSep, pareamentos);
  const confKeysXpedsOk = new Set(
    conferenciasCrossPedido
      .filter((c) => c.tipo === 'CONF_XPED_OK')
      .map((c) => chave(c.pedido, c.codigo))
  );

  for (const i of itensNf) {
    if (!i.pedido) {
      divergencias.push({
        tipo: 'SEM_PEDIDO',
        severidade: 'AVISO',
        pedido: '',
        codigo: i.codigo,
        descricao: i.descricao,
        unidadePedido: null,
        unidadeNf: i.unidade,
        qtdPedido: 0,
        qtdNf: i.qtd,
        qtdDif: i.qtd,
      });
      continue;
    }
    const k = chave(i.pedido, i.codigo);
    if (nfReconciliados.has(k)) continue;
    if (!pedidosSep.has(i.pedido)) {
      const kPed = chave(i.pedido, i.codigo);
      const escCross = escolherMelhorOplParaLinhaNf(i, kPed, poolSep, pareamentos);
      const qtdEsc = escCross && escCross.sep ? Number(escCross.sep.qtd) : NaN;
      const qtdBateEsc = Number.isFinite(qtdEsc) && Math.abs(Number(i.qtd) - qtdEsc) < 1e-4;
      // Sep. e NF iguais: não é falta. Vai para "A conferir" (mesmo cliente ou REVISAR).
      if (escCross && qtdBateEsc) {
        continue;
      }
      const oplAlternativas = buscarOplAlternativas(i.codigo, i.pedido, idxSepPorCodigo);
      const altQtdOk = oplAlternativas.find((a) => Math.abs(Number(a.qtd) - Number(i.qtd)) < 1e-4);
      const altMesmoCli = oplAlternativas.find(
        (a) =>
          Math.abs(Number(a.qtd) - Number(i.qtd)) < 1e-4 &&
          clientesCompativeisCross(i, { codDestinatario: a.codDestinatario })
      );
      const cliNf = normCodDestinatario(i.codDestinatario);
      let avisoExtra = formatarAvisoOplAlternativas(oplAlternativas);
      if (cliNf && !altMesmoCli && altQtdOk) {
        const prefix =
          `xPed ${i.pedido} ausente no OPL para o cliente ${cliNf}. ` +
          `Há mesma quantidade em outro cliente — não é match automático.`;
        avisoExtra = avisoExtra ? `${prefix} ${avisoExtra}` : prefix;
      } else if (!oplAlternativas.length) {
        const prefix = cliNf
          ? `Produto ${i.codigo} não existe nos espelhos OPL desta carga (cliente ${cliNf}, xPed ${i.pedido}).`
          : `Produto ${i.codigo} não existe nos espelhos OPL desta carga (xPed ${i.pedido}).`;
        avisoExtra = prefix;
      } else if (cliNf && !altQtdOk) {
        const prefix = `xPed ${i.pedido} ausente no OPL para o cliente ${cliNf}.`;
        avisoExtra = avisoExtra ? `${prefix} ${avisoExtra}` : prefix;
      }
      const qtdSepExibir = altQtdOk ? Number(altQtdOk.qtd) : 0;
      const qtdDifExibir = Number((Number(i.qtd) - qtdSepExibir).toFixed(4));
      const qtdBate = Math.abs(qtdDifExibir) < 1e-4;
      divergencias.push({
        tipo: 'PEDIDO_NAO_ENCONTRADO',
        severidade: qtdBate ? 'AVISO' : 'BLOQUEIO',
        pedido: i.pedido,
        codigo: i.codigo,
        descricao: i.descricao,
        unidadePedido: altQtdOk?.unidade || null,
        unidadeNf: i.unidade,
        qtdPedido: qtdSepExibir,
        qtdNf: i.qtd,
        qtdDif: qtdDifExibir,
        oplAlternativas,
        aviso: avisoExtra,
        semImpactoMonetario: qtdBate,
        codDestinatarioNf: cliNf || '',
      });
    }
  }

  for (const [k, nf] of mapNf.entries()) {
    if (confKeysXpedsOk.has(k)) continue;
    if (nfReconciliados.has(k)) continue;
    const sep = obterSepParaNf(k, poolSep, pareamentos);
    if (!sep) {
      if (nf.pedido && pedidosSep.has(nf.pedido)) {
        const oplAlternativas = buscarOplAlternativas(nf.codigo, nf.pedido, idxSepPorCodigo);
        divergencias.push({
          tipo: 'NAO_SEPARADO_NA_CARGA',
          severidade: 'BLOQUEIO',
          pedido: nf.pedido,
          codigo: codigoExibicaoDivergencia(nf),
          descricao: nf.descricao,
          unidadePedido: null,
          unidadeNf: nf.unidade,
          qtdPedido: 0,
          qtdNf: nf.qtdOriginal != null ? nf.qtdOriginal : nf.qtd,
          qtdDif: nf.qtdOriginal != null ? nf.qtdOriginal : nf.qtd,
          qtdNfEstoque: nf.qtd,
          oplAlternativas,
          aviso: formatarAvisoOplAlternativas(oplAlternativas),
        });
      }
      continue;
    }
    const dif = Number((nf.qtd - sep.qtd).toFixed(4));
    const avisoEmb = formatarAvisoConversaoEmbalagem(nf, sep);
    if (Math.abs(dif) < 1e-4) {
      continue;
    }
    const usaEstoque = nf.conversaoEmbalagem || sep.conversaoEmbalagem;
    const qtdPedidoExibir = sep.qtdOriginal != null ? sep.qtdOriginal : sep.qtd;
    const qtdNfExibir = nf.qtdOriginal != null ? nf.qtdOriginal : nf.qtd;
    const qtdDifExibir = usaEstoque ? dif : Number((qtdNfExibir - qtdPedidoExibir).toFixed(4));
    const unidadeSep = String(sep.unidade || sep.unidadeEstoque || '').trim();
    const unidadeNf = String(nf.unidade || nf.unidadeEstoque || '').trim();
    if (!usaEstoque && unidadeSep && unidadeNf && unidadeSep !== unidadeNf) {
      divergencias.push({
        tipo: 'UNIDADE_DIVERGENTE',
        severidade: 'BLOQUEIO',
        pedido: nf.pedido,
        codigo: codigoExibicaoDivergencia(nf),
        descricao: nf.descricao || sep.descricao,
        unidadePedido: unidadeSep,
        unidadeNf: unidadeNf,
        qtdPedido: qtdPedidoExibir,
        qtdNf: qtdNfExibir,
        qtdPedidoEstoque: sep.qtd,
        qtdNfEstoque: nf.qtd,
        qtdDif: qtdDifExibir,
        aviso: avisoEmb,
      });
      continue;
    }
    if (isEmbalagemDivergenteNfOpl(nf, sep, dif, qtdPedidoExibir, qtdNfExibir)) {
      divergencias.push({
        tipo: 'EMBALAGEM_DIVERGENTE_NF_OPL',
        severidade: 'BLOQUEIO',
        pedido: nf.pedido,
        codigo: codigoExibicaoDivergencia(nf),
        descricao: nf.descricao || sep.descricao,
        unidadePedido: sep.unidade,
        unidadeNf: nf.unidade,
        qtdPedido: qtdPedidoExibir,
        qtdNf: qtdNfExibir,
        qtdPedidoEstoque: sep.qtd,
        qtdNfEstoque: nf.qtd,
        qtdDif: 0,
        qtdDifEstoque: dif,
        semImpactoMonetario: true,
        codigoNfLiteral: nf.codigoLiteral,
        codigoSepLiteral: sep.codigoLiteral,
        aviso: formatarAvisoEmbalagemDivergente(nf, sep, avisoEmb),
      });
      continue;
    }
    if (dif < 0) {
      divergencias.push({
        tipo: 'NAO_FATURADO_NA_NF',
        severidade: 'BLOQUEIO',
        pedido: nf.pedido,
        codigo: codigoExibicaoDivergencia(nf),
        descricao: nf.descricao || sep.descricao,
        unidadePedido: sep.unidade,
        unidadeNf: nf.unidade,
        qtdPedido: qtdPedidoExibir,
        qtdNf: qtdNfExibir,
        qtdPedidoEstoque: sep.qtd,
        qtdNfEstoque: nf.qtd,
        qtdDif: qtdDifExibir,
        aviso: avisoEmb,
      });
    } else if (dif > 0) {
      divergencias.push({
        tipo: 'FALTA_PARA_ATENDER_NF',
        severidade: 'BLOQUEIO',
        pedido: nf.pedido,
        codigo: codigoExibicaoDivergencia(nf),
        descricao: nf.descricao || sep.descricao,
        unidadePedido: sep.unidade,
        unidadeNf: nf.unidade,
        qtdPedido: qtdPedidoExibir,
        qtdNf: qtdNfExibir,
        qtdPedidoEstoque: sep.qtd,
        qtdNfEstoque: nf.qtd,
        qtdDif: qtdDifExibir,
        aviso: avisoEmb,
      });
    }
  }

  for (const [k, sep] of mapSepDireto.entries()) {
    if (sepReconciliados.has(k)) continue;
    if (mapNf.has(k)) continue;
    if ([...pareamentos.values()].includes(k)) continue;
    divergencias.push({
      tipo: 'SEPARADO_SEM_NF',
      severidade: 'BLOQUEIO',
      pedido: sep.pedido,
      codigo: codigoExibicaoDivergencia(sep),
      descricao: sep.descricao,
      unidadePedido: sep.unidade,
      unidadeNf: null,
      qtdPedido: sep.qtdOriginal != null ? sep.qtdOriginal : sep.qtd,
      qtdNf: 0,
      qtdPedidoEstoque: sep.qtd,
      qtdDif: -(sep.qtdOriginal != null ? sep.qtdOriginal : sep.qtd),
      aviso: formatarAvisoConversaoEmbalagem(null, sep),
    });
  }

  const divergenciasFiltradas = divergencias.filter((d) => {
    if (d.tipo !== 'PEDIDO_NAO_ENCONTRADO') return true;
    const k = chave(d.pedido, d.codigo);
    return !confKeysXpedsOk.has(k);
  });
  divergenciasFiltradas.push(...conferenciasCrossPedido);

  enriquecerDivergenciasComContextoNf(divergenciasFiltradas, itensNf);
  enriquecerDivergenciasComContextoNf(conferenciasCrossPedido, itensNf);

  const contadores = {
    faltas: divergenciasFiltradas.filter((d) => d.tipo === 'FALTA_PARA_ATENDER_NF').length,
    sobras: divergenciasFiltradas.filter((d) => d.tipo === 'NAO_FATURADO_NA_NF').length,
    inversoes: divergenciasFiltradas.filter((d) => d.tipo === 'NAO_SEPARADO_NA_CARGA').length,
    semPedido: divergenciasFiltradas.filter(
      (d) =>
        d.tipo === 'SEM_PEDIDO' ||
        (d.tipo === 'PEDIDO_NAO_ENCONTRADO' && String(d.severidade || '').toUpperCase() !== 'AVISO')
    ).length,
    semNf: divergenciasFiltradas.filter((d) => d.tipo === 'SEPARADO_SEM_NF').length,
    crossPedido: conferenciasCrossPedido.length,
  };
  const resumo = {
    status: classifyStatus(divergenciasFiltradas),
    podeExpedir: divergenciasBloqueantes(divergenciasFiltradas).length === 0,
    contadores,
    itensNf: itensNf.length,
    itensSeparacao: itensSep.length,
    origemSeparacao,
    divergencias: divergenciasFiltradas,
    conferenciasCrossPedido,
  };

  if (opts.persist) {
    try {
      await persistirValidacao(tenantId, cdCarga, opts.sgUser, resumo, divergenciasFiltradas, {
        momento: opts.momento || 'VALIDACAO',
        dsEvento: opts.dsEvento || null,
        payload: {
          status: resumo.status,
          contadores: resumo.contadores,
          divergencias: divergenciasFiltradas,
          conferenciasCrossPedido: resumo.conferenciasCrossPedido || [],
          momento: opts.momento || 'VALIDACAO',
        },
      });
    } catch (e) {
      if (!schemaMissing(e)) throw e;
    }
  }
  return resumo;
}

module.exports = {
  validarCargaProgramada,
  persistirValidacao,
  carregarSnapshotValidacao,
  listarSanacoesValidacao,
  registrarSanacoesAposImportOpl,
  schemaMissing,
  carregarItensNfCarga,
  carregarItensSeparacao,
  carregarSeparacaoOplPorPedidosNf,
  carregarSeparacaoOplPorPedidosNfMulti,
  listarEspelhosOplCandidatos,
  sqlFiltroPedidosOplNorm,
  SQL_EXPR_NUM_PEDIDO_OPL,
  normPedido,
  carregarCdsDonoCarga,
  carregarPedidosPorDonoNfCarga,
  carregarDemandaCodigoPorDonoNfCarga,
  carregarDemandaCodigoSemPedidoPorDonoNfCarga,
  divergenciasBloqueantes,
  isCargaBaixaEstoque,
  carregarMetaCargaProgramada,
  melhorEspelhoOplParaDono,
  resolverEspelhosOplParaCarga,
  enriquecerAvisosOplDivergenciasPorCargaMap,
  chaveAvisoDivergencia,
  formatarAvisoOplAlternativas,
  gerarConferenciasCrossPedido,
  isConferenciaCrossPedido,
  separarDivergenciasEConferencias,
  normalizarItensParaEstoque,
};
