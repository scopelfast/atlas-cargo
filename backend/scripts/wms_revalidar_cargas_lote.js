#!/usr/bin/env node
/**
 * Revalida cargas em lote (persiste WMS_CARGA_VALIDACAO).
 *
 *   cd backend
 *   node scripts/wms_revalidar_cargas_lote.js 141 142 143 ... 150
 *   node scripts/wms_revalidar_cargas_lote.js --141-150
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const { pool, poolPromise } = require('../config/db');
const {
  validarCargaProgramada,
  divergenciasBloqueantes,
} = require('../services/wms-carga-validacao.service');

const tenantId = process.env.DEFAULT_TENANT_ID || 'default';
const SG_USER = 'LOTE_REVALIDAR_SCRIPT';

function parseCargas(argv) {
  const out = [];
  for (const a of argv) {
    const m = String(a).match(/^--?(\d+)-(\d+)$/);
    if (m) {
      const ini = parseInt(m[1], 10);
      const fim = parseInt(m[2], 10);
      for (let i = ini; i <= fim; i++) out.push(i);
      continue;
    }
    const n = parseInt(a, 10);
    if (Number.isFinite(n)) out.push(n);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

(async () => {
  await poolPromise;
  const cargas = parseCargas(process.argv.slice(2));
  if (!cargas.length) {
    console.error('Informe CD_CARGA(s) ou --141-150');
    process.exit(1);
  }

  console.log(`Revalidando ${cargas.length} carga(s) [${cargas.join(', ')}] — tenant ${tenantId}\n`);
  console.log(
    'CD_CARGA | STATUS   | BLOQ | CONF xPed | Faltas | Sobras | Sep.semNF | SemPed | Descrição'
  );
  console.log('-'.repeat(100));

  const resumo = { ok: 0, bloqueio: 0, aviso: 0, erros: 0 };

  for (const cd of cargas) {
    try {
      const meta = await pool.query(
        `SELECT c."NM_DESCRICAO", COALESCE(e."ST_EXPEDICAO", c."ST_CARGA") AS st
           FROM "WMS_CARGA_PROGRAMADA" c
           LEFT JOIN "WMS_EXPEDICAO_CARGA" e
             ON e."CD_CARGA" = c."CD_CARGA" AND e."TENANT_ID" = c."TENANT_ID"
          WHERE c."CD_CARGA" = $1::integer AND c."TENANT_ID" = $2`,
        [cd, tenantId]
      );
      if (!meta.rowCount) {
        console.log(`${String(cd).padStart(8)} | —        | —    | —         | —      | —      | —         | —      | (carga não encontrada)`);
        resumo.erros += 1;
        continue;
      }

      const v = await validarCargaProgramada(tenantId, cd, { persist: true, sgUser: SG_USER });
      const bloq = divergenciasBloqueantes(v.divergencias || []).length;
      const conf = (v.conferenciasCrossPedido || []).length;
      const c = v.contadores || {};

      if (v.status === 'BLOQUEIO') resumo.bloqueio += 1;
      else if (v.status === 'AVISO') resumo.aviso += 1;
      else resumo.ok += 1;

      const desc = String(meta.rows[0].NM_DESCRICAO || '').slice(0, 32);
      console.log(
        `${String(cd).padStart(8)} | ${String(v.status || '—').padEnd(8)} | ${String(bloq).padStart(4)} | ${String(conf).padStart(9)} | ${String(c.faltas || 0).padStart(6)} | ${String(c.sobras || 0).padStart(6)} | ${String(c.semNf || 0).padStart(9)} | ${String(c.semPedido || 0).padStart(6)} | ${desc}`
      );
    } catch (e) {
      console.log(`${String(cd).padStart(8)} | ERRO     | —    | —         | —      | —      | —         | —      | ${e.message || e}`);
      resumo.erros += 1;
    }
  }

  console.log('-'.repeat(100));
  console.log(
    `Concluído: ${resumo.ok} OK · ${resumo.aviso} com aviso (xPed) · ${resumo.bloqueio} bloqueio · ${resumo.erros} erro(s)`
  );
  await pool.end();
})().catch((e) => {
  console.error('FALHA:', e.message || e);
  process.exit(1);
});
