'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const val = require('../services/wms-carga-validacao.service');

function normPed(p) {
  return String(p || '').replace(/^0+/, '').trim();
}

function codOl(c) {
  return String(c || '').replace(/\D/g, '');
}

(async () => {
  const cargas = [187, 188, 189, 190, 191, 192, 193, 194];
  const nfAll = [];
  for (const cd of cargas) {
    const itens = await val.carregarItensNfCarga('default', cd);
    for (const i of itens) {
      if (!String(i.descricao || '').toUpperCase().includes('CAMISETA')) continue;
      nfAll.push({ cdCarga: cd, ...i });
    }
  }

  const oplL05 = await pool.query(
    `SELECT regexp_replace(TRIM(p."NUM_PEDIDO"), '^0+', '') AS ped,
            TRIM(p."COD_DESTINATARIO") AS dest, TRIM(p."RAZ_SOC_DEST") AS razao,
            i."COD_PRODUTO_OL", i."DESCRICAO", i."QT_PEDIDA"::numeric AS qtd
       FROM "WMS_OPL_PEDIDO" p
       JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
      WHERE p."CD_OPL_ARQUIVO" = 140
        AND i."DESCRICAO" ILIKE '%camiseta%'
      ORDER BY dest, i."COD_PRODUTO_OL", ped`
  );

  const oplL06 = await pool.query(
    `SELECT regexp_replace(TRIM(p."NUM_PEDIDO"), '^0+', '') AS ped,
            TRIM(p."COD_DESTINATARIO") AS dest, TRIM(p."RAZ_SOC_DEST") AS razao,
            i."COD_PRODUTO_OL", i."DESCRICAO", i."QT_PEDIDA"::numeric AS qtd
       FROM "WMS_OPL_PEDIDO" p
       JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
      WHERE p."CD_OPL_ARQUIVO" = 143
        AND i."DESCRICAO" ILIKE '%camiseta%'`
  );

  // destinatário NF via pedido OPL quando existir, senão via cadastro
  const pedOplMap = new Map();
  for (const r of oplL05.rows) {
    pedOplMap.set(r.ped, { dest: r.dest, razao: r.razao });
  }
  const pedL06 = await pool.query(
    `SELECT regexp_replace(TRIM(p."NUM_PEDIDO"), '^0+', '') AS ped,
            TRIM(p."COD_DESTINATARIO") AS dest, TRIM(p."RAZ_SOC_DEST") AS razao
       FROM "WMS_OPL_PEDIDO" p WHERE p."CD_OPL_ARQUIVO" IN (139, 140, 143)`
  );
  const pedDest = new Map(pedL06.rows.map((r) => [r.ped, r]));

  const sum = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);

  const totNf = { M: 0, GG: 0, P: 0, out: 0 };
  const totL05 = { M: 0, GG: 0, P: 0, out: 0 };
  for (const n of nfAll) {
    const d = String(n.descricao || '').toUpperCase();
    if (d.includes('CAMISETA M')) totNf.M += n.qtd;
    else if (d.includes('CAMISETA GG')) totNf.GG += n.qtd;
    else if (d.includes('CAMISETA P')) totNf.P += n.qtd;
    else totNf.out += n.qtd;
  }
  for (const r of oplL05.rows) {
    const d = String(r.descricao || '').toUpperCase();
    const q = Number(r.qtd) || 0;
    if (d.includes('CAMISETA M')) totL05.M += q;
    else if (d.includes('CAMISETA GG')) totL05.GG += q;
    else if (d.includes('CAMISETA P')) totL05.P += q;
    else totL05.out += q;
  }

  console.log('=== TOTAIS CAMISETA (todas rotas 187-194 NF vs Lote 05 OPL) ===');
  console.log('NF 8 rotas:', totNf, 'linhas', nfAll.length);
  console.log('Lote 05 OPL:', totL05, 'linhas', oplL05.rows.length);
  console.log('Lote 06 OPL linhas camiseta:', oplL06.rows.length);

  const nf194 = nfAll.filter((x) => x.cdCarga === 194);
  const tot194 = { M: 0, GG: 0, P: 0 };
  for (const n of nf194) {
    const d = String(n.descricao || '').toUpperCase();
    if (d.includes(' M ')) tot194.M += n.qtd;
    else if (d.includes(' GG ')) tot194.GG += n.qtd;
    else if (d.includes(' P ')) tot194.P += n.qtd;
  }
  console.log('\n=== Só carga 194 NF camisetas ===', tot194, 'pedidos', [...new Set(nf194.map((x) => normPed(x.pedido)))]);

  // Por carga
  console.log('\n=== NF camisetas por carga ===');
  for (const cd of cargas) {
    const sub = nfAll.filter((x) => x.cdCarga === cd);
    if (!sub.length) continue;
    let m = 0,
      gg = 0,
      p = 0;
    for (const s of sub) {
      const d = String(s.descricao || '').toUpperCase();
      if (d.includes(' M ')) m += s.qtd;
      else if (d.includes(' GG ')) gg += s.qtd;
      else if (d.includes(' P ')) p += s.qtd;
    }
    console.log(`  #${cd}: M=${m} GG=${gg} P=${p} (${sub.length} linhas)`);
  }

  // Match NF ped -> Lote05?
  console.log('\n=== Pedidos NF com camiseta (194) vs OPL ===');
  for (const n of nf194) {
    const ped = normPed(n.pedido);
    const in05 = oplL05.rows.some((r) => r.ped === ped);
    const in06 = oplL06.rows.some((r) => r.ped === ped);
    const dest = pedDest.get(ped);
    console.log(
      `  ped ${n.pedido} | ${n.descricao?.slice(0, 30)} x${n.qtd} | L05:${in05 ? 'SIM' : 'não'} L06:${in06 ? 'SIM' : 'não'} | dest OPL:${dest ? dest.dest + ' ' + (dest.razao || '').slice(0, 20) : '?'}`
    );
  }

  // Agregar L05 por dest+cod
  const aggL05 = new Map();
  for (const r of oplL05.rows) {
    const k = `${r.dest}|${codOl(r.COD_PRODUTO_OL)}`;
    const prev = aggL05.get(k) || { dest: r.dest, razao: r.razao, cod: r.COD_PRODUTO_OL, desc: r.DESCRICAO, qtd: 0, pedidos: [] };
    prev.qtd += Number(r.qtd) || 0;
    prev.pedidos.push(r.ped);
    aggL05.set(k, prev);
  }

  // NF 194 - try match dest from any espelho ped
  console.log('\n=== Sugestão: mesmo dest+SKU no Lote 05? (carga 194) ===');
  for (const n of nf194) {
    const ped = normPed(n.pedido);
    const dest = pedDest.get(ped);
    const cod = codOl(n.codigoLiteral || n.codigo);
    const alts = [...aggL05.values()].filter((a) => codOl(a.cod) === cod);
    const sameDest = dest ? alts.filter((a) => a.dest === dest.dest) : [];
    console.log(
      `  NF ped ${ped} ${n.descricao?.slice(0, 25)} x${n.qtd} | dest NF-ped:${dest?.dest || '?'} | L05 mesmo SKU:${alts.length} mesmo dest+SKU:${sameDest.length}`,
      sameDest.length
        ? `→ L05 ped(s) ${sameDest[0].pedidos.join(',')} qtd total ${sameDest[0].qtd}`
        : alts.length
          ? `→ outros dest L05: ${alts.map((a) => a.dest + ' x' + a.qtd).join('; ')}`
          : ''
    );
  }

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
