#!/usr/bin/env node
'use strict';
/**
 * Atualiza VALOR_REFERENCIA em WMS_PRODUTO_DONO a partir do CSV exportado
 * (Exportar sem preço / Exportar posição CSV) ou planilha .xlsx equivalente.
 *
 * Preencha a coluna VLR_UNITARIO (ou VALOR_REFERENCIA) e importe.
 * Match: CD_DONO + CD_PRODUTO (preferido) ou CD_DONO + CODIGO_PRODUTO.
 *
 * Uso (pasta backend):
 *   node scripts/wms_import_valor_referencia_planilha.js --arquivo "skus_sem_preco.csv" --dry-run
 *   node scripts/wms_import_valor_referencia_planilha.js --arquivo "skus_sem_preco.csv"
 */

require('dotenv').config();
const path = require('path');
const {
  carregarLinhasArquivoValorReferencia,
  linhasPlanilhaParaImportValorReferencia,
  aplicarImportValorReferencia,
} = require('../services/wms-estoque-valor.service');
const { pool } = require('../config/db');

function parseArgs() {
  const out = {
    arquivo: '',
    tenant: process.env.DEFAULT_TENANT_ID || 'default',
    dryRun: false,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--arquivo' && argv[i + 1]) out.arquivo = argv[++i];
    else if (argv[i].startsWith('--arquivo=')) out.arquivo = argv[i].slice('--arquivo='.length);
    else if (argv[i] === '--tenant' && argv[i + 1]) out.tenant = argv[++i];
    else if (argv[i] === '--dry-run') out.dryRun = true;
  }
  return out;
}

async function main() {
  const args = parseArgs();
  if (!args.arquivo) {
    console.error(
      'Uso: node scripts/wms_import_valor_referencia_planilha.js --arquivo "skus_sem_preco.csv" [--tenant default] [--dry-run]'
    );
    process.exit(1);
  }

  const arquivo = path.resolve(args.arquivo);
  const brutas = carregarLinhasArquivoValorReferencia(arquivo);
  const linhas = linhasPlanilhaParaImportValorReferencia(brutas);

  if (!linhas.length) {
    console.error('Nenhuma linha com CD_DONO e valor (VLR_UNITARIO ou VALOR_REFERENCIA).');
    process.exit(1);
  }

  const r = await aplicarImportValorReferencia(args.tenant, linhas, { dryRun: args.dryRun });
  await pool.end();

  console.log('Arquivo:', arquivo);
  console.log('Tenant:', args.tenant);
  console.log('Linhas com valor na planilha:', r.linhasComValor);
  console.log('Produtos atualizados:', r.atualizados);
  console.log('Linhas sem produto correspondente:', r.semProduto);
  if (args.dryRun) console.log('(dry-run — nenhuma alteração gravada)');
  if (r.amostra.length) {
    console.log('Amostra:');
    for (const a of r.amostra) {
      console.log(`  dono ${a.cdDono} #${a.cdProduto} ${a.codigo} → R$ ${a.valor}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
