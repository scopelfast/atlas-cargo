#!/usr/bin/env node
'use strict';
/**
 * Importação OL completa: hierarquia (grupo/categoria) + conservação obrigatória + produtos.
 *
 * Hierarquia OL → WMS:
 *   CDNVPRODUTO 2 (Classe)  → WMS_GRUPO_PRODUTO
 *   CDNVPRODUTO 3 (Grupo)   → WMS_CATEGORIA_PRODUTO (nome = subgrupo nv3)
 *   CDNVPRODUTO 5 + CDPRODESTO → WMS_PRODUTO_DONO (estoque) + operacional
 *
 * Catálogo compartilhado: classificação e conservação aplicam em TODOS os donos do tenant
 * (mesmo código de estoque normalizado).
 *
 * Uso (pasta backend):
 *   node scripts/wms_import_catalogo_ol.js --arquivo "C:\...\exportar.xlsx" --tenant default --todos-donos
 *   node scripts/wms_import_catalogo_ol.js --arquivo "..." --somente-classificacao --tenant default
 *   node scripts/wms_import_catalogo_ol.js --arquivo "..." --cd-dono 2 --dry-run
 */

require('dotenv').config();
const path = require('path');
const XLSX = require('xlsx');
const { pool } = require('../config/db');
const { resolveCodigoProdutoDono, codigoProdutoMatchKey } = require('../utils/wms-codigo-produto-mask');
const { nivelOl } = require('../utils/wms-ol-arvore');
const {
  importarClassificacaoOl,
  listarDonosAtivos,
} = require('../services/wms-import-ol-classificacao.service');

function parseArgs() {
  const out = {
    arquivo: '',
    cdDono: null,
    tenant: process.env.DEFAULT_TENANT_ID || 'default',
    dryRun: false,
    somenteClassificacao: false,
    todosDonos: false,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--arquivo' && argv[i + 1]) out.arquivo = argv[++i];
    else if (argv[i] === '--cd-dono' && argv[i + 1]) out.cdDono = parseInt(argv[++i], 10);
    else if (argv[i] === '--tenant' && argv[i + 1]) out.tenant = argv[++i];
    else if (argv[i] === '--dry-run') out.dryRun = true;
    else if (argv[i] === '--somente-classificacao') out.somenteClassificacao = true;
    else if (argv[i] === '--todos-donos') out.todosDonos = true;
  }
  return out;
}

function normFator(v) {
  if (v === '' || v == null) return 1;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function lerPlanilhaOl(arquivo) {
  const abs = path.resolve(arquivo);
  const wb = XLSX.readFile(abs);
  const sheet = wb.SheetNames.includes('Exportar Planilha') ? 'Exportar Planilha' : wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' });
  return { rows, sheet, abs };
}

async function upsertProdutoEstoque(
  client,
  tenantId,
  cdDono,
  codigoEstoque,
  nome,
  unidade,
  pesoKg,
  classif,
  sgUser
) {
  const codigo = await resolveCodigoProdutoDono(client, tenantId, cdDono, codigoEstoque);
  if (!codigo) throw new Error('Código estoque inválido: ' + codigoEstoque);

  const cdCat = classif && classif.cdCategoria > 0 ? classif.cdCategoria : null;
  const tipoArm = classif && classif.tipoArmazenagem ? classif.tipoArmazenagem : 'SECO';

  const r = await client.query(
    `SELECT "CD_PRODUTO" FROM "WMS_PRODUTO_DONO"
      WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer
        AND LOWER(regexp_replace(TRIM("CODIGO"), '[^0-9A-Za-z]', '', 'g'))
          = LOWER(regexp_replace(TRIM($3::text), '[^0-9A-Za-z]', '', 'g'))
      LIMIT 1`,
    [tenantId, cdDono, codigo]
  );
  if (r.rows[0]) {
    await client.query(
      `UPDATE "WMS_PRODUTO_DONO"
          SET "NOME" = $2, "UNIDADE" = COALESCE(NULLIF($3::text,''), "UNIDADE"),
              "PESO_KG" = COALESCE($4::numeric, "PESO_KG"),
              "CD_CATEGORIA" = COALESCE($5::integer, "CD_CATEGORIA"),
              "TIPO_ARMAZENAGEM" = COALESCE(NULLIF($6::text,''), "TIPO_ARMAZENAGEM"),
              "ORIGEM_CADASTRO" = 'IMPORT_OL',
              "FG_FORNECEDOR_REF" = 'N',
              "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
              "SG_USER" = $7
        WHERE "CD_PRODUTO" = $1::integer`,
      [r.rows[0].CD_PRODUTO, nome, unidade || null, pesoKg, cdCat, tipoArm, sgUser]
    );
    return { cdProduto: parseInt(r.rows[0].CD_PRODUTO, 10), novo: false };
  }
  const ins = await client.query(
    `INSERT INTO "WMS_PRODUTO_DONO" (
       "TENANT_ID", "CD_DONO", "CODIGO", "NOME", "UNIDADE", "PESO_KG",
       "CD_CATEGORIA", "TIPO_ARMAZENAGEM",
       "ORIGEM_CADASTRO", "FG_FORNECEDOR_REF", "FGACTIVE", "SG_USER"
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'IMPORT_OL', 'N', 'S', $9)
     RETURNING "CD_PRODUTO"`,
    [tenantId, cdDono, codigo, nome, unidade || null, pesoKg, cdCat, tipoArm, sgUser]
  );
  return { cdProduto: parseInt(ins.rows[0].CD_PRODUTO, 10), novo: true };
}

async function upsertOperacional(client, tenantId, cdDono, cdProduto, row, codigoEstoqueMask, sgUser) {
  const codOp = String(row.CDPRODUTO || '').trim();
  const un = String(row.SGUNIDADE || '').trim().slice(0, 10);
  const fator = normFator(row.VRFATOCONV);
  const indice =
    row.VRARREDEMPPR !== '' && row.VRARREDEMPPR != null ? Number(row.VRARREDEMPPR) : null;
  const nv = nivelOl(row);
  const ex = await client.query(
    `SELECT "CD_OPERACIONAL" FROM "WMS_PRODUTO_OPERACIONAL"
      WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer
        AND LOWER(TRIM("CODIGO_OPERACIONAL")) = LOWER(TRIM($3::text))
      LIMIT 1`,
    [tenantId, cdDono, codOp]
  );
  if (ex.rows[0]) {
    await client.query(
      `UPDATE "WMS_PRODUTO_OPERACIONAL"
          SET "CD_PRODUTO" = $1, "CODIGO_ESTOQUE" = $2, "UNIDADE" = $3,
              "FATOR_CONVERSAO" = $4, "INDICE_ARRED" = $5, "NIVEL_OL" = $6,
              "FGACTIVE" = 'S', "DH_MAINTENANCE" = CURRENT_TIMESTAMP, "SG_USER" = $7
        WHERE "CD_OPERACIONAL" = $8`,
      [cdProduto, codigoEstoqueMask, un, fator, indice, nv, sgUser, ex.rows[0].CD_OPERACIONAL]
    );
  } else {
    await client.query(
      `INSERT INTO "WMS_PRODUTO_OPERACIONAL" (
         "TENANT_ID", "CD_DONO", "CD_PRODUTO", "CODIGO_OPERACIONAL", "CODIGO_ESTOQUE",
         "UNIDADE", "FATOR_CONVERSAO", "INDICE_ARRED", "NIVEL_OL", "FGACTIVE", "SG_USER"
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'S', $10)`,
      [tenantId, cdDono, cdProduto, codOp, codigoEstoqueMask, un, fator, indice, nv, sgUser]
    );
  }
}

async function importarProdutosPorDono(client, args, rows, mapaEstoque) {
  const folhas = rows.filter((r) => nivelOl(r) === 5);
  const stats = { estoqueNovos: 0, estoqueAtualizados: 0, operacional: 0, ignorados: 0, erros: 0 };
  const sgUser = 'import_catalogo_ol';
  const estoqueCache = new Map();

  for (const row of folhas) {
    const codEsto = String(row.CDPRODESTO || '').trim();
    const codOp = String(row.CDPRODUTO || '').trim();
    const nome = String(row.NMPRODUTO || '').trim().slice(0, 200);
    const un = String(row.SGUNIDADE || '').trim();
    if (!codEsto || !codOp || !nome) {
      stats.ignorados++;
      continue;
    }
    const classif = mapaEstoque.get(codigoProdutoMatchKey(codEsto)) || null;
    try {
      let cached = estoqueCache.get(codEsto);
      if (!cached) {
        if (args.dryRun) {
          cached = { cdProduto: -1, novo: false };
        } else {
          const peso = row.VRPESOUNID !== '' && row.VRPESOUNID != null ? Number(row.VRPESOUNID) : null;
          const res = await upsertProdutoEstoque(
            client,
            args.tenant,
            args.cdDono,
            codEsto,
            nome,
            un,
            Number.isFinite(peso) ? peso : null,
            classif,
            sgUser
          );
          cached = res;
          if (res.novo) stats.estoqueNovos++;
          else stats.estoqueAtualizados++;
        }
        estoqueCache.set(codEsto, cached);
      }
      if (!args.dryRun && cached.cdProduto > 0) {
        const codMask = await resolveCodigoProdutoDono(client, args.tenant, args.cdDono, codEsto);
        await upsertOperacional(client, args.tenant, args.cdDono, cached.cdProduto, row, codMask, sgUser);
        stats.operacional++;
      }
    } catch (e) {
      stats.erros++;
      if (stats.erros <= 5) console.error('Erro produto', codOp, e.message);
    }
  }
  return stats;
}

async function relatorioPendencias(client, tenantId) {
  const r = await client.query(
    `SELECT
       COUNT(*)::integer AS total,
       COUNT(*) FILTER (WHERE "CD_CATEGORIA" IS NULL)::integer AS sem_categoria,
       COUNT(*) FILTER (WHERE COALESCE(TRIM("TIPO_ARMAZENAGEM"), '') = '')::integer AS sem_conservacao
     FROM "WMS_PRODUTO_DONO"
     WHERE "TENANT_ID" = $1 AND COALESCE("FG_FORNECEDOR_REF", 'N') = 'N'`,
    [tenantId]
  );
  return r.rows[0] || {};
}

async function main() {
  const args = parseArgs();
  if (!args.arquivo) {
    console.error('Informe --arquivo caminho/exportar.xlsx');
    process.exit(1);
  }

  const { rows, sheet, abs } = lerPlanilhaOl(args.arquivo);
  const folhas = rows.filter((r) => nivelOl(r) === 5);
  console.log('Arquivo:', abs);
  console.log('Aba:', sheet, '| Linhas:', rows.length, '| Nível 5:', folhas.length);

  if (!args.somenteClassificacao && !args.todosDonos && !Number.isFinite(args.cdDono)) {
    console.error('Informe --cd-dono N ou use --todos-donos / --somente-classificacao');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    if (!args.dryRun) await client.query('BEGIN');

    console.log('\n--- Fase 1: Grupos (nv2), Categorias (nv3), Conservação + vínculo em todos os donos ---');
    const classOut = await importarClassificacaoOl(client, {
      tenantId: args.tenant,
      rows,
      dryRun: args.dryRun,
      sgUser: 'import_ol_classificacao',
    });
    console.log('Classificação:', classOut.stats, args.dryRun ? '(dry-run)' : '');

    if (!args.somenteClassificacao) {
      const donos =
        args.todosDonos
          ? await listarDonosAtivos(client, args.tenant)
          : [{ CD_DONO: args.cdDono }];

      console.log('\n--- Fase 2: Produtos + operacional por dono:', donos.map((d) => d.CD_DONO).join(', '), '---');
      for (const d of donos) {
        const cd = parseInt(d.CD_DONO, 10);
        console.log('Dono', cd, d.NOME || '');
        const st = await importarProdutosPorDono(
          client,
          { ...args, cdDono: cd },
          rows,
          classOut.mapaEstoque
        );
        console.log('  Produtos:', st);
      }
    }

    if (!args.dryRun) await client.query('COMMIT');

    const pend = await relatorioPendencias(client, args.tenant);
    console.log('\n--- Pendências no tenant (todos os donos) ---');
    console.log(pend);
    if (Number(pend.sem_conservacao) > 0) {
      console.warn('ATENÇÃO: ainda existem produtos sem conservação. Rode scripts/wms_preencher_conservacao_ol.js');
    }
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
