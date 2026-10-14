#!/usr/bin/env node
'use strict';
/**
 * Relatório de produtos sem categoria e/ou sem conservação.
 *
 *   node scripts/wms_relatorio_pendencias_cadastro.js
 *   node scripts/wms_relatorio_pendencias_cadastro.js --cd-dono 2 --tipo sem_categoria
 */

require('dotenv').config();
const { pool } = require('../config/db');
const { listarPendenciasCadastro } = require('../services/wms-import-ol-classificacao.service');

function parseArgs() {
  const out = { tenant: process.env.DEFAULT_TENANT_ID || 'default', cdDono: null, tipo: 'pendente' };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tenant' && argv[i + 1]) out.tenant = argv[++i];
    else if (argv[i] === '--cd-dono' && argv[i + 1]) out.cdDono = parseInt(argv[++i], 10);
    else if (argv[i] === '--tipo' && argv[i + 1]) out.tipo = argv[++i];
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const out = await listarPendenciasCadastro(pool, {
    tenantId: args.tenant,
    cdDono: args.cdDono,
    tipo: args.tipo,
    limit: 2000,
  });
  console.log('Tenant:', args.tenant, '| tipo:', args.tipo, args.cdDono != null ? '| dono ' + args.cdDono : '');
  console.log('Resumo:', out.resumo);
  console.log('--- Lista (' + out.rows.length + ' linhas) ---');
  for (const r of out.rows) {
    console.log(
      [
        'dono=' + r.CD_DONO,
        r.NM_DONO,
        'id=' + r.CD_PRODUTO,
        'cod=' + r.CODIGO,
        r.MOTIVO_PENDENCIA,
        'cons=' + (r.TIPO_ARMAZENAGEM || '(vazio)'),
        r.NM_CATEGORIA || '(sem cat)',
      ].join(' | ')
    );
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
