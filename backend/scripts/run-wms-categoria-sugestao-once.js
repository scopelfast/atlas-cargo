'use strict';

/**
 * Execução manual do job de categoria (alta confiança).
 *
 * Exemplos (PowerShell):
 *   cd backend
 *   $env:WMS_CATEGORIA_JOB_DRY_RUN='S'; $env:WMS_CATEGORIA_JOB_CD_DONOS='1'; node scripts/run-wms-categoria-sugestao-once.js
 *   $env:WMS_CATEGORIA_JOB_DRY_RUN='N'; $env:WMS_CATEGORIA_JOB_CD_DONOS='1'; node scripts/run-wms-categoria-sugestao-once.js
 *
 * Variáveis:
 *   WMS_CATEGORIA_JOB_TENANT_ID  — opcional
 *   WMS_CATEGORIA_JOB_CD_DONOS   — ex.: 1 (Mana) ou 1,2
 *   WMS_CATEGORIA_JOB_DRY_RUN    — S = só simula, N = aplica
 */

require('dotenv').config();
const { executarCicloCategoriaAltaConfianca } = require('../jobs/wms-categoria-sugestao-job');

executarCicloCategoriaAltaConfianca()
  .then((r) => {
    console.log('[run-wms-categoria-sugestao-once] concluído:', r);
    process.exit(0);
  })
  .catch((e) => {
    console.error('[run-wms-categoria-sugestao-once] falha:', e);
    process.exit(1);
  });
