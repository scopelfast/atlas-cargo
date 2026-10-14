#!/usr/bin/env node
/**
 * Executa um ciclo do relatório de vencimento WMS (todos os tenants com dono ativo) e sai.
 * Uso: cron / Task Scheduler — carregar .env do backend (mesmo diretório de execução = backend/).
 *
 *   cd backend && node scripts/run-wms-relatorio-vencimento-once.js
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const { executarCicloRelatorioVencimentoWms } = require('../jobs/wms-relatorio-vencimento-job');

executarCicloRelatorioVencimentoWms()
  .then((r) => {
    console.log('[run-wms-relatorio-vencimento-once] concluído:', r);
    process.exit(0);
  })
  .catch((e) => {
    console.error('[run-wms-relatorio-vencimento-once] falha:', e);
    process.exit(1);
  });
