#!/usr/bin/env node
/**
 * Repara movimentos de saída WMS faltantes em TODAS as cargas expedidas (todos os tenants).
 * Corrige o bug da chave idempotente sem sequência N (2ª confirmação após reabrir).
 *
 *   cd backend
 *   node scripts/run-wms-sincronizar-ledger-expedicao-once.js          # repara
 *   node scripts/run-wms-sincronizar-ledger-expedicao-once.js --dry-run  # só diagnóstico
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const {
  executarCicloSincronizarLedgerExpedicao,
} = require('../jobs/wms-sincronizar-ledger-expedicao-job');

const dryRun = process.argv.includes('--dry-run') || process.argv.includes('--dryRun');
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='));
const tenantId = tenantArg ? tenantArg.split('=')[1] : undefined;

executarCicloSincronizarLedgerExpedicao({ dryRun, tenantId, sgUser: 'WMS_SYNC_SCRIPT' })
  .then((r) => {
    console.log('[run-wms-sincronizar-ledger-expedicao-once] concluído:', JSON.stringify(r, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error('[run-wms-sincronizar-ledger-expedicao-once] falha:', e);
    process.exit(1);
  });
