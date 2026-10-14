'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../config/db');
const { nivelOl } = require('../utils/wms-ol-arvore');

const xlsx = process.argv[2] || 'C:\\Users\\scope\\Downloads\\exportar_.xlsx';

async function main() {
  const tid = 'default';

  const wb = XLSX.readFile(xlsx);
  const sheet = wb.SheetNames.includes('Exportar Planilha') ? 'Exportar Planilha' : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' });

  const nv2 = rows
    .filter((r) => nivelOl(r) === 2)
    .map((r) => ({
      cod: String(r.CDPRODUTO || '').trim(),
      nome: String(r.NMPRODUTO || '').trim(),
    }))
    .sort((a, b) => a.cod.localeCompare(b.cod));

  const rDb = await pool.query(
    `SELECT "CD_GRUPO", "CODIGO", "NOME", "ORDEM", "FGACTIVE"
       FROM "WMS_GRUPO_PRODUTO"
      WHERE "TENANT_ID" = $1
      ORDER BY "ORDEM", "CODIGO"`,
    [tid]
  );

  const dbByCod = new Map();
  for (const g of rDb.rows) {
    const c = String(g.CODIGO || '').trim();
    if (!dbByCod.has(c)) dbByCod.set(c, []);
    dbByCod.get(c).push(g);
  }

  console.log('=== PLANILHA OL — CDNVPRODUTO=2 (grupos WMS) ===');
  console.log('Total nv2:', nv2.length);
  for (const g of nv2) console.log(' ', g.cod, g.nome);

  console.log('\n=== CADASTRO WMS_GRUPO_PRODUTO ===');
  console.log('Total:', rDb.rows.length);
  for (const g of rDb.rows) {
    console.log(
      ' ',
      g.FGACTIVE === 'S' ? 'ATIVO ' : 'INATIV',
      '| cod',
      g.CODIGO,
      '|',
      g.NOME,
      '| ordem',
      g.ORDEM
    );
  }

  console.log('\n=== OL nv2 AUSENTES NO WMS (ativo) ===');
  let miss = 0;
  for (const g of nv2) {
    const hits = dbByCod.get(g.cod) || [];
    const ativo = hits.find((h) => h.FGACTIVE === 'S');
    if (!ativo) {
      miss++;
      console.log('  FALTA:', g.cod, g.nome, hits.length ? '(existe inativo)' : '');
    }
  }
  if (!miss) console.log('  Nenhum — todos os nv2 da planilha têm grupo ativo no WMS.');

  console.log('\n=== WMS ATIVOS QUE NÃO ESTÃO NA PLANILHA nv2 ===');
  const olCods = new Set(nv2.map((g) => g.cod));
  let extra = 0;
  for (const g of rDb.rows.filter((x) => x.FGACTIVE === 'S')) {
    if (!olCods.has(String(g.CODIGO).trim())) {
      extra++;
      console.log('  EXTRA WMS:', g.CODIGO, g.NOME);
    }
  }
  if (!extra) console.log('  Nenhum extra.');

  console.log('\n=== LEGADO INATIVO (códigos 1,2,3…) ===');
  for (const g of rDb.rows.filter((x) => x.FGACTIVE !== 'S')) {
    console.log(' ', g.CODIGO, g.NOME);
  }

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
