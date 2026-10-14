#!/usr/bin/env node
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const XLSX = require('xlsx');
const { pool } = require('../config/db');
const { indexarPlanilhaOl, ancestraisOl, nomeCategoriaWmsNv3 } = require('../utils/wms-ol-arvore');

const xlsx = process.argv[2] || 'C:\\Users\\scope\\Downloads\\exportar_.xlsx';

async function main() {
  const wb = XLSX.readFile(xlsx);
  const sheet = wb.SheetNames.includes('Exportar Planilha') ? 'Exportar Planilha' : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' });
  const index = indexarPlanilhaOl(rows);

  // nv3 esperados da planilha (categoria WMS = subgrupo OL)
  const esperados = new Map();
  for (const node of index.byLevel[3] || []) {
    const anc = ancestraisOl(node.cod, index);
    const nome = nomeCategoriaWmsNv3(anc);
    const cod = String(node.cod).trim();
    const g = anc.n2 ? anc.n2.cod : '';
    esperados.set(cod, { cod, nome, grupoCod: g, grupoNome: anc.n2?.nome || '' });
  }

  const rG = await pool.query(
    `SELECT g."CD_GRUPO", g."CODIGO" AS g_cod, g."NOME" AS g_nome, g."FGACTIVE" AS g_ativo,
            c."CD_CATEGORIA", c."CODIGO" AS c_cod, c."NOME" AS c_nome, c."FGACTIVE" AS c_ativo
       FROM "WMS_CATEGORIA_PRODUTO" c
       JOIN "WMS_GRUPO_PRODUTO" g ON g."CD_GRUPO" = c."CD_GRUPO" AND g."TENANT_ID" = c."TENANT_ID"
      WHERE c."TENANT_ID" = 'default'
      ORDER BY g."CODIGO", c."CODIGO"`
  );

  const noWms = new Map();
  const legado = [];
  for (const row of rG.rows) {
    const cod = String(row.c_cod).trim();
    if (/^\d{3}/.test(cod)) {
      noWms.set(cod, row);
    } else {
      legado.push(row);
    }
  }

  const faltamNoWms = [];
  for (const [cod, e] of esperados) {
    if (!noWms.has(cod)) faltamNoWms.push(e);
  }
  const extrasNoWms = [];
  for (const [cod, row] of noWms) {
    if (!esperados.has(cod)) extrasNoWms.push(row);
  }

  const nomeErrado = [];
  for (const [cod, row] of noWms) {
    const e = esperados.get(cod);
    if (e && String(row.c_nome).trim() !== e.nome) {
      nomeErrado.push({ cod, wms: row.c_nome, ol: e.nome });
    }
  }

  console.log('=== REGRA (confirmada no código) ===');
  console.log('OL CDNVPRODUTO=2 (classe) → WMS Grupo produto');
  console.log('OL CDNVPRODUTO=3 (subgrupo) → WMS Categoria produto (nome = subgrupo OL, formato "GRUPO › SUBGRUPO")');
  console.log('Código categoria WMS = código OL nv3 (ex.: 60101272)');
  console.log('');
  console.log('Planilha nv3:', esperados.size);
  console.log('WMS categorias ativas OL (cód. numérico):', noWms.size);
  console.log('Faltam no WMS:', faltamNoWms.length);
  console.log('Extras no WMS (não na planilha):', extrasNoWms.length);
  console.log('Nome divergente OL vs WMS:', nomeErrado.length);
  console.log('Legado (código não numérico OL):', legado.length);

  if (legado.length) {
    console.log('\n--- LEGADO (desativar ou ignorar) ---');
    for (const r of legado.slice(0, 15)) {
      console.log(' ', r.g_nome, '/', r.c_nome, '| ativo g/c:', r.g_ativo, r.c_ativo);
    }
    if (legado.length > 15) console.log(' ... +' + (legado.length - 15));
  }

  if (faltamNoWms.length) {
    console.log('\n--- FALTAM (amostra) ---');
    faltamNoWms.slice(0, 10).forEach((e) => console.log(' ', e.cod, e.nome));
  }

  // Grupos legado
  const rGr = await pool.query(
    `SELECT "CD_GRUPO","CODIGO","NOME","FGACTIVE" FROM "WMS_GRUPO_PRODUTO" WHERE "TENANT_ID"='default' ORDER BY "CODIGO"`
  );
  const gruposOl = rGr.rows.filter((g) => /^\d{3}$/.test(String(g.CODIGO)));
  const gruposLeg = rGr.rows.filter((g) => !/^\d{3}$/.test(String(g.CODIGO)));
  console.log('\nGrupos OL (cod 601,602...):', gruposOl.length);
  console.log('Grupos legado (Carnes /Embutidos, etc.):', gruposLeg.length);

  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
