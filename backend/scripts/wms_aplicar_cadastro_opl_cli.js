'use strict';
/**
 * CLI: prévia e aplicação de cadastro automático OPL (cadastro principal + de-para).
 * Uso:
 *   node scripts/wms_aplicar_cadastro_opl_cli.js --cd-opl 123
 *   node scripts/wms_aplicar_cadastro_opl_cli.js --cd-opl 123 --aplicar
 *   node scripts/wms_aplicar_cadastro_opl_cli.js --ultimo-mana --aplicar
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const {
  simularCadastroAutomaticoOpl,
  aplicarCadastroAutomaticoOpl,
} = require('../services/wms-opl-cadastro-automatico.service');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

const aplicar = process.argv.includes('--aplicar');
const tenantId = arg('--tenant') || process.env.DEFAULT_TENANT_ID || 'default';

async function resolverCdOpl() {
  const cdArg = arg('--cd-opl');
  if (cdArg) return parseInt(cdArg, 10);
  if (process.argv.includes('--ultimo-mana')) {
    const r = await pool.query(
      `SELECT "CD_OPL_ARQUIVO" FROM "WMS_OPL_ARQUIVO"
        WHERE "TENANT_ID" = $1 AND "CD_DONO" = 1
        ORDER BY "DH_IMPORT" DESC NULLS LAST LIMIT 1`,
      [tenantId]
    );
    return r.rows[0]?.CD_OPL_ARQUIVO;
  }
  const r = await pool.query(
    `SELECT "CD_OPL_ARQUIVO", "NM_ARQUIVO", "CD_DONO", "DH_IMPORT"
       FROM "WMS_OPL_ARQUIVO"
      WHERE "TENANT_ID" = $1
      ORDER BY "DH_IMPORT" DESC NULLS LAST LIMIT 8`,
    [tenantId]
  );
  console.log('Importações recentes:');
  for (const row of r.rows) {
    console.log(`  CD_OPL_ARQUIVO=${row.CD_OPL_ARQUIVO} dono=${row.CD_DONO} ${row.NM_ARQUIVO}`);
  }
  return null;
}

async function main() {
  const cd = await resolverCdOpl();
  if (!Number.isFinite(cd)) {
    console.error('Informe --cd-opl N ou --ultimo-mana');
    process.exit(1);
  }
  console.log(`Tenant=${tenantId} CD_OPL_ARQUIVO=${cd} aplicar=${aplicar}`);

  if (!aplicar) {
    const prev = await simularCadastroAutomaticoOpl(tenantId, cd);
    if (prev.err) {
      console.error(prev.err);
      process.exit(1);
    }
    console.log(JSON.stringify({ resumo: prev.resumo, itens: prev.itens, mensagem: prev.mensagem }, null, 2));
    console.log('\nUse --aplicar para gravar.');
    return;
  }

  const r = await aplicarCadastroAutomaticoOpl(tenantId, cd, 'cli/cadastro-opl-auto');
  if (r.err) {
    console.error(r.err);
    process.exit(1);
  }
  console.log(JSON.stringify(r, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
