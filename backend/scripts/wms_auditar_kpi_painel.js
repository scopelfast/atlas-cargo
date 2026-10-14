'use strict';

/**
 * Confronta cada KPI do painel WMS com a mesma regra usada nos módulos.
 * Uso: node scripts/wms_auditar_kpi_painel.js [tenantId]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const svc = require('../services/wms-dashboard-resumo.service');

const tenantId = process.argv[2] || 'default';

async function queryExpedicaoEmAndamento(tid) {
  const r = await pool.query(
    `SELECT c."CD_CARGA", c."NM_DESCRICAO", c."ST_CARGA", e."ST_EXPEDICAO"
       FROM "WMS_CARGA_PROGRAMADA" c
       INNER JOIN "WMS_EXPEDICAO_CARGA" e
         ON e."CD_CARGA" = c."CD_CARGA" AND e."TENANT_ID" = c."TENANT_ID"
      WHERE c."TENANT_ID" = $1
        AND UPPER(TRIM(COALESCE(e."ST_EXPEDICAO", ''))) = 'EM_EXPEDICAO'
      ORDER BY c."CD_CARGA"`,
    [tid]
  );
  return r.rows;
}

async function queryMontagem(tid) {
  const r = await pool.query(
    `SELECT c."CD_CARGA", c."NM_DESCRICAO", c."ST_CARGA",
            COALESCE(e."ST_EXPEDICAO", '—') AS st_exp
       FROM "WMS_CARGA_PROGRAMADA" c
       LEFT JOIN "WMS_EXPEDICAO_CARGA" e
         ON e."CD_CARGA" = c."CD_CARGA" AND e."TENANT_ID" = c."TENANT_ID"
      WHERE c."TENANT_ID" = $1
        AND UPPER(TRIM(COALESCE(c."ST_CARGA", ''))) IN ('RASCUNHO', 'CONFIRMADA')
      ORDER BY c."CD_CARGA" DESC`,
    [tid]
  );
  return r.rows;
}

async function queryOplPickingPendente(tid) {
  const r = await pool.query(
    `SELECT a."CD_OPL_ARQUIVO", a."NM_ARQUIVO", a."Q_ITENS"
       FROM "WMS_OPL_ARQUIVO" a
      WHERE a."TENANT_ID" = $1
        AND COALESCE(a."Q_ITENS", 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM "WMS_OPL_PEDIDO" p
            JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
           WHERE p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
             AND i."QT_COLETADA" IS NOT NULL
        )
      ORDER BY a."CD_OPL_ARQUIVO" DESC`,
    [tid]
  );
  return r.rows;
}

async function queryDesyncStCarga(tid) {
  const r = await pool.query(
    `SELECT c."CD_CARGA", c."ST_CARGA", e."ST_EXPEDICAO"
       FROM "WMS_CARGA_PROGRAMADA" c
       INNER JOIN "WMS_EXPEDICAO_CARGA" e
         ON e."CD_CARGA" = c."CD_CARGA" AND e."TENANT_ID" = c."TENANT_ID"
      WHERE c."TENANT_ID" = $1
        AND UPPER(TRIM(COALESCE(c."ST_CARGA", ''))) <>
            UPPER(TRIM(COALESCE(e."ST_EXPEDICAO", '')))`,
    [tid]
  );
  return r.rows;
}

function line(title, value, ids) {
  const idStr = ids && ids.length ? ` → IDs: ${ids.join(', ')}` : '';
  console.log(`  ${title}: ${value}${idStr}`);
}

(async () => {
  console.log(`\n=== Auditoria KPI painel WMS — tenant "${tenantId}" ===\n`);

  const resumo = await svc.obterResumoDashboard(tenantId);
  const montagem = await queryMontagem(tenantId);
  const expEm = await queryExpedicaoEmAndamento(tenantId);
  const oplPick = await queryOplPickingPendente(tenantId);
  const desync = await queryDesyncStCarga(tenantId);

  console.log('Cards (API /api/wms/dashboard/resumo):');
  line('NF-e em operação', resumo.nfAbertas);
  line('NF-e encerradas', resumo.nfEncerradas);
  line('Espelhos OPL (total importações)', resumo.oplEspelhos);
  line('OPL picking pendente', resumo.oplPickingPendentes, oplPick.map((r) => r.CD_OPL_ARQUIVO));
  line('Cargas programadas (total)', resumo.cargasTotal);
  line('Cargas em montagem', resumo.separacaoPendentes, montagem.map((r) => r.CD_CARGA));
  line('Expedição pendente (saída)', resumo.expedicaoPendentes, expEm.map((r) => r.CD_CARGA));
  line('Validade no horizonte', resumo.shelfLifeTotal);
  line('Saldo negativo (SKUs)', resumo.saldoNegativos);
  line('Inventários abertos', resumo.inventariosAbertos);

  console.log('\nConferência cruzada:');
  const okMontagem = montagem.length === (resumo.separacaoPendentes || 0);
  const okOpl = oplPick.length === (resumo.oplPickingPendentes || 0);
  const okExp = expEm.length === (resumo.expedicaoPendentes || 0);
  console.log(`  Montagem: ${okMontagem ? 'OK' : 'DIVERGENTE'} (lista ${montagem.length} vs card ${resumo.separacaoPendentes})`);
  console.log(`  OPL picking: ${okOpl ? 'OK' : 'DIVERGENTE'} (lista ${oplPick.length} vs card ${resumo.oplPickingPendentes})`);
  console.log(`  Expedição saída: ${okExp ? 'OK' : 'DIVERGENTE'} (lista ${expEm.length} vs card ${resumo.expedicaoPendentes})`);

  if (desync.length) {
    console.log(`\n⚠ ST_CARGA ≠ ST_EXPEDICAO em ${desync.length} carga(s):`);
    desync.forEach((r) =>
      console.log(`    #${r.CD_CARGA}: ST_CARGA=${r.ST_CARGA} | ST_EXPEDICAO=${r.ST_EXPEDICAO}`)
    );
    console.log('  → Rode backend/scripts/wms_sync_st_carga_from_expedicao_postgres.sql se necessário.');
  } else {
    console.log('\n✓ ST_CARGA alinhado com ST_EXPEDICAO onde há registro de expedição.');
  }

  if (montagem.length) {
    console.log('\nCargas em montagem (detalhe):');
    montagem.forEach((r) =>
      console.log(`    #${r.CD_CARGA} ${r.NM_DESCRICAO} | ST_CARGA=${r.ST_CARGA} | exp=${r.st_exp}`)
    );
  }

  if (expEm.length) {
    console.log('\nExpedição aguardando saída (detalhe):');
    expEm.forEach((r) =>
      console.log(`    #${r.CD_CARGA} ${r.NM_DESCRICAO} | ST_CARGA=${r.ST_CARGA} | ST_EXPEDICAO=${r.ST_EXPEDICAO}`)
    );
  }

  console.log('');
  process.exit(okMontagem && okOpl && okExp ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
