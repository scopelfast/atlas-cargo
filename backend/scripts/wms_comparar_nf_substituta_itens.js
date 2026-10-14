#!/usr/bin/env node
'use strict';
/**
 * Compara itens (LINHAS_JSON) entre NF cancelada e NF substituta importadas no WMS.
 * Uso típico — pares Rota 01/06 (canceladas × substitutas carga 573):
 *
 *   node scripts/wms_comparar_nf_substituta_itens.js
 *   node scripts/wms_comparar_nf_substituta_itens.js --tenant default --saida comparacao.csv
 *   node scripts/wms_comparar_nf_substituta_itens.js --pares 18017:18159,18022:18160
 *
 * Saída: resumo no console + CSV opcional (--saida).
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');

/** Pares conhecidos: NF cancelada → NF substituta (Mana 01/06). */
const PARES_ROTA_0106 = [
  { nfVelha: '18017', nfNova: '18159', rotulo: 'RENAUXVIEW — Brusque' },
  { nfVelha: '18022', nfNova: '18160', rotulo: 'RIOSULENSE — Rio do Sul' },
  { nfVelha: '18028', nfNova: '18161', rotulo: 'H BREMER — Rio do Sul' },
  { nfVelha: '18039', nfNova: '18162', rotulo: 'PAXÁ — Gaspar' },
  { nfVelha: '18052', nfNova: '18163', rotulo: 'ZANELLA — Rio do Sul' },
  { nfVelha: '18061', nfNova: '18164', rotulo: 'IRANI — Vargem Bonita' },
  { nfVelha: '18086', nfNova: '18165', rotulo: 'CRISTALCOPO MATRIZ — Içara' },
  { nfVelha: '18087', nfNova: '18166', rotulo: 'CRISTALCOPO PP — Criciúma' },
  { nfVelha: '18088', nfNova: '18167', rotulo: 'CRISTALCOPO XPS — Criciúma' },
];

function parseArgs() {
  const out = {
    tenant: process.env.DEFAULT_TENANT_ID || 'default',
    pares: null,
    saida: '',
    serie: '',
    tolQtd: 0.0005,
    tolValor: 0.02,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tenant' && argv[i + 1]) out.tenant = argv[++i];
    else if (argv[i] === '--pares' && argv[i + 1]) out.pares = argv[++i];
    else if (argv[i] === '--saida' && argv[i + 1]) out.saida = argv[++i];
    else if (argv[i] === '--serie' && argv[i + 1]) out.serie = String(argv[++i]).trim();
    else if (argv[i] === '--tol-qtd' && argv[i + 1]) out.tolQtd = Number(argv[++i]);
    else if (argv[i] === '--tol-valor' && argv[i + 1]) out.tolValor = Number(argv[++i]);
    else if (argv[i] === '--help' || argv[i] === '-h') out.help = true;
  }
  return out;
}

function parseParesArg(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((chunk) => {
      const m = chunk.match(/^(\d+)\s*[:→>-]\s*(\d+)(?:\|(.+))?$/);
      if (!m) throw new Error(`Par inválido "${chunk}" — use NUM_VELHA:NUM_NOVA`);
      return { nfVelha: m[1], nfNova: m[2], rotulo: m[3] || '' };
    });
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

function normCodigo(v) {
  return String(v || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

function parseLinhasJson(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

/** Chave de conciliação: pedido + código (mesmo critério da validação de carga). */
function chaveItem(ln) {
  return `${normPedido(ln.xPed || ln.xped || '')}|${normCodigo(ln.cProd || ln.codigo || '')}`;
}

function extrairItensMap(linhas) {
  const map = new Map();
  for (const ln of linhas) {
    const codigo = normCodigo(ln.cProd || ln.codigo || '');
    const qtd = toNumber(ln.qCom || ln.quantidade || 0);
    if (!codigo || qtd <= 0) continue;
    const key = chaveItem(ln);
    const item = {
      key,
      pedido: normPedido(ln.xPed || ln.xped || ''),
      codigo,
      codigoXml: String(ln.cProd || ln.codigo || '').trim(),
      descricao: String(ln.xProd || ln.descricao || '').trim(),
      unidade: String(ln.uCom || ln.unidade || '').trim().toUpperCase(),
      qtd,
      vUnCom: toNumber(ln.vUnCom),
      vProd: toNumber(ln.vProd),
      ncm: String(ln.NCM || '').trim(),
      cfop: String(ln.CFOP || '').trim(),
      nItem: String(ln.nItem || ''),
    };
    if (map.has(key)) {
      const prev = map.get(key);
      prev.qtd += item.qtd;
      prev.vProd += item.vProd;
      prev.nItem += ',' + item.nItem;
    } else {
      map.set(key, item);
    }
  }
  return map;
}

function near(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

function compararMaps(mapVelha, mapNova, opts) {
  const diffs = [];
  const keys = new Set([...mapVelha.keys(), ...mapNova.keys()]);
  for (const key of keys) {
    const v = mapVelha.get(key);
    const n = mapNova.get(key);
    if (v && !n) {
      diffs.push({
        tipo: 'SOMENTE_CANCELADA',
        severidade: 'BLOQUEIO',
        key,
        codigo: v.codigoXml,
        pedido: v.pedido,
        descricao: v.descricao,
        detalhe: `Item na NF cancelada (qtd ${v.qtd} ${v.unidade}) — ausente na substituta`,
        qtdVelha: v.qtd,
        qtdNova: 0,
      });
      continue;
    }
    if (!v && n) {
      diffs.push({
        tipo: 'SOMENTE_SUBSTITUTA',
        severidade: 'BLOQUEIO',
        key,
        codigo: n.codigoXml,
        pedido: n.pedido,
        descricao: n.descricao,
        detalhe: `Item só na NF substituta (qtd ${n.qtd} ${n.unidade})`,
        qtdVelha: 0,
        qtdNova: n.qtd,
      });
      continue;
    }
    const partes = [];
    let severidade = 'OK';
    if (v.unidade !== n.unidade) {
      partes.push(`unidade ${v.unidade} → ${n.unidade}`);
      severidade = 'BLOQUEIO';
    }
    if (!near(v.qtd, n.qtd, opts.tolQtd)) {
      partes.push(`qtd ${v.qtd} → ${n.qtd}`);
      severidade = 'BLOQUEIO';
    }
    if (!near(v.vUnCom, n.vUnCom, opts.tolValor) && (v.vUnCom > 0 || n.vUnCom > 0)) {
      partes.push(`vUnCom ${v.vUnCom} → ${n.vUnCom}`);
      if (severidade === 'OK') severidade = 'AVISO';
    }
    if (!near(v.vProd, n.vProd, opts.tolValor) && (v.vProd > 0 || n.vProd > 0)) {
      partes.push(`vProd ${v.vProd.toFixed(2)} → ${n.vProd.toFixed(2)}`);
      if (severidade === 'OK') severidade = 'AVISO';
    }
    if (v.descricao !== n.descricao && v.descricao && n.descricao) {
      partes.push('descrição alterada');
      if (severidade === 'OK') severidade = 'AVISO';
    }
    if (v.ncm !== n.ncm && v.ncm && n.ncm) {
      partes.push(`NCM ${v.ncm} → ${n.ncm}`);
      if (severidade === 'OK') severidade = 'AVISO';
    }
    if (v.cfop !== n.cfop && v.cfop && n.cfop) {
      partes.push(`CFOP ${v.cfop} → ${n.cfop}`);
      if (severidade === 'OK') severidade = 'AVISO';
    }
    if (partes.length) {
      diffs.push({
        tipo: 'DIVERGENTE',
        severidade,
        key,
        codigo: v.codigoXml,
        pedido: v.pedido,
        descricao: v.descricao || n.descricao,
        detalhe: partes.join('; '),
        qtdVelha: v.qtd,
        qtdNova: n.qtd,
      });
    }
  }
  return diffs;
}

async function carregarNfPorNumero(tenantId, numeroNf, serie) {
  const params = [tenantId, String(numeroNf).trim()];
  let sql = `
    SELECT n."CD_NFE_SAIDA", n."NUMERO_NF", n."SERIE", n."CHAVE_NFE",
           n."Q_ITENS", n."VNF_TOTAL", n."XNOME_ENTREGA", n."XMUN_DEST", n."UF_DEST",
           n."LINHAS_JSON"
      FROM "WMS_NFE_SAIDA" n
     WHERE n."TENANT_ID" = $1
       AND regexp_replace(trim(COALESCE(n."NUMERO_NF", '')), '[^0-9]', '', 'g')
           = regexp_replace($2, '[^0-9]', '', 'g')`;
  if (serie) {
    params.push(serie);
    sql += ` AND trim(COALESCE(n."SERIE", '')) = $${params.length}`;
  }
  sql += ` ORDER BY n."DH_IMPORTACAO" DESC, n."CD_NFE_SAIDA" DESC LIMIT 1`;
  const r = await pool.query(sql, params);
  return r.rows[0] || null;
}

function escCsv(v) {
  const s = String(v ?? '');
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function compararCabecalho(velha, nova, tolValor) {
  const avisos = [];
  const qV = Number(velha.Q_ITENS || 0);
  const qN = Number(nova.Q_ITENS || 0);
  if (qV !== qN) avisos.push(`Q_ITENS ${qV} → ${qN}`);
  const vV = toNumber(velha.VNF_TOTAL);
  const vN = toNumber(nova.VNF_TOTAL);
  if (!near(vV, vN, tolValor) && (vV > 0 || vN > 0)) {
    avisos.push(`VNF_TOTAL ${vV.toFixed(2)} → ${vN.toFixed(2)}`);
  }
  return avisos;
}

async function compararPar(tenantId, par, opts) {
  const velha = await carregarNfPorNumero(tenantId, par.nfVelha, opts.serie);
  const nova = await carregarNfPorNumero(tenantId, par.nfNova, opts.serie);
  const erros = [];
  if (!velha) erros.push(`NF cancelada ${par.nfVelha} não encontrada no WMS`);
  if (!nova) erros.push(`NF substituta ${par.nfNova} não encontrada no WMS`);
  if (erros.length) {
    return {
      par,
      ok: false,
      erros,
      diffs: [],
      resumo: { bloqueio: 0, aviso: 0, ok: 0 },
    };
  }

  const linhasV = parseLinhasJson(velha.LINHAS_JSON);
  const linhasN = parseLinhasJson(nova.LINHAS_JSON);
  const mapV = extrairItensMap(linhasV);
  const mapN = extrairItensMap(linhasN);
  const diffs = compararMaps(mapV, mapN, opts);
  const cab = compararCabecalho(velha, nova, opts.tolValor);
  for (const msg of cab) {
    diffs.push({
      tipo: 'CABECALHO',
      severidade: msg.startsWith('Q_ITENS') ? 'BLOQUEIO' : 'AVISO',
      key: '',
      codigo: '',
      pedido: '',
      descricao: '',
      detalhe: msg,
      qtdVelha: '',
      qtdNova: '',
    });
  }

  const bloqueio = diffs.filter((d) => d.severidade === 'BLOQUEIO').length;
  const aviso = diffs.filter((d) => d.severidade === 'AVISO').length;
  return {
    par,
    velha,
    nova,
    ok: bloqueio === 0 && erros.length === 0,
    erros,
    diffs,
    resumo: {
      itensVelha: mapV.size,
      itensNova: mapN.size,
      linhasVelha: linhasV.length,
      linhasNova: linhasN.length,
      bloqueio,
      aviso,
    },
  };
}

function imprimirRelatorio(resultados) {
  let totalBloqueio = 0;
  let totalOk = 0;
  console.log('');
  console.log('=== Comparação NF cancelada × substituta (itens) ===');
  console.log('');
  for (const r of resultados) {
    const titulo = r.par.rotulo
      ? `${r.par.nfVelha} → ${r.par.nfNova} (${r.par.rotulo})`
      : `${r.par.nfVelha} → ${r.par.nfNova}`;
    console.log('--- ' + titulo + ' ---');
    if (r.erros.length) {
      r.erros.forEach((e) => console.log('  ERRO: ' + e));
      console.log('');
      continue;
    }
    console.log(
      `  Cancelada: NF ${r.velha.NUMERO_NF} | chave …${String(r.velha.CHAVE_NFE || '').slice(-8)} | ${r.resumo.linhasVelha} linhas XML, ${r.resumo.itensVelha} chaves`
    );
    console.log(
      `  Substituta: NF ${r.nova.NUMERO_NF} | chave …${String(r.nova.CHAVE_NFE || '').slice(-8)} | ${r.resumo.linhasNova} linhas XML, ${r.resumo.itensNova} chaves`
    );
    if (!r.diffs.length) {
      console.log('  ✓ ITENS IDÊNTICOS (quantidade/unidade/código por pedido)');
      totalOk++;
    } else {
      if (r.resumo.bloqueio === 0) {
        console.log(`  ⚠ ${r.diffs.length} diferença(s) — só avisos (valores/descrição)`);
        totalOk++;
      } else {
        console.log(`  ✗ ${r.resumo.bloqueio} BLOQUEIO(S), ${r.resumo.aviso} aviso(s)`);
      }
      for (const d of r.diffs) {
        const tag = d.severidade === 'BLOQUEIO' ? 'BLOQ' : d.severidade === 'AVISO' ? 'AVISO' : 'OK';
        const cod = d.codigo ? ` cod=${d.codigo}` : '';
        console.log(`    [${tag}] ${d.tipo}${cod} — ${d.detalhe}`);
      }
      totalBloqueio += r.resumo.bloqueio;
    }
    console.log('');
  }
  console.log('=== Resumo geral ===');
  console.log(`Pares analisados: ${resultados.length}`);
  console.log(`Pares OK para expedição (sem bloqueio): ${resultados.filter((x) => x.ok).length}`);
  console.log(`Total divergências BLOQUEIO: ${totalBloqueio}`);
  console.log('');
  if (totalBloqueio > 0) {
    console.log('ATENÇÃO: há diferença de itens que pode gerar erro na expedição/separação.');
  } else if (resultados.every((x) => x.ok && !x.erros.length)) {
    console.log('Nenhuma divergência crítica de itens entre canceladas e substitutas.');
  }
}

function gravarCsv(resultados, arquivo) {
  const lines = [
    [
      'NF_CANCELADA',
      'NF_SUBSTITUTA',
      'CLIENTE',
      'TIPO',
      'SEVERIDADE',
      'PEDIDO',
      'CODIGO',
      'DESCRICAO',
      'DETALHE',
      'QTD_CANCELADA',
      'QTD_SUBSTITUTA',
    ].join(';'),
  ];
  for (const r of resultados) {
    if (r.erros.length) {
      lines.push(
        [
          r.par.nfVelha,
          r.par.nfNova,
          r.par.rotulo || '',
          'ERRO',
          'BLOQUEIO',
          '',
          '',
          '',
          r.erros.join(' | '),
          '',
          '',
        ]
          .map(escCsv)
          .join(';')
      );
      continue;
    }
    if (!r.diffs.length) {
      lines.push(
        [r.par.nfVelha, r.par.nfNova, r.par.rotulo || '', 'OK', 'OK', '', '', '', 'Itens idênticos', '', '']
          .map(escCsv)
          .join(';')
      );
      continue;
    }
    for (const d of r.diffs) {
      lines.push(
        [
          r.par.nfVelha,
          r.par.nfNova,
          r.par.rotulo || '',
          d.tipo,
          d.severidade,
          d.pedido,
          d.codigo,
          d.descricao,
          d.detalhe,
          d.qtdVelha,
          d.qtdNova,
        ]
          .map(escCsv)
          .join(';')
      );
    }
  }
  fs.writeFileSync(arquivo, '\uFEFF' + lines.join('\r\n'), 'utf8');
  console.log('CSV gravado: ' + path.resolve(arquivo));
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    console.log(`Uso: node scripts/wms_comparar_nf_substituta_itens.js [opções]

Opções:
  --tenant ID       Tenant (default: DEFAULT_TENANT_ID ou "default")
  --pares V:N,...   Pares cancelada:substituta (default: 9 notas Rota 01/06)
  --serie N         Filtrar série NF (opcional)
  --saida arquivo   Gravar relatório CSV
  --tol-qtd N       Tolerância quantidade (default 0.0005)
  --tol-valor N     Tolerância R$ (default 0.02)
`);
    process.exit(0);
  }

  const pares = args.pares ? parseParesArg(args.pares) : PARES_ROTA_0106;
  const opts = { serie: args.serie, tolQtd: args.tolQtd, tolValor: args.tolValor };

  console.log('Tenant:', args.tenant, '| pares:', pares.length);

  const resultados = [];
  for (const par of pares) {
    resultados.push(await compararPar(args.tenant, par, opts));
  }

  imprimirRelatorio(resultados);

  if (args.saida) gravarCsv(resultados, args.saida);

  const temBloqueio = resultados.some((r) => r.resumo && r.resumo.bloqueio > 0);
  const temErro = resultados.some((r) => r.erros && r.erros.length);
  await pool.end();
  process.exit(temBloqueio || temErro ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch (_) {}
  process.exit(1);
});
