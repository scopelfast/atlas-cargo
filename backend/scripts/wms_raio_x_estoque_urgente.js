#!/usr/bin/env node
/**
 * Raio-X urgente de furos de estoque — roda em ~30s sem UI.
 *
 *   cd backend
 *   node scripts/wms_raio_x_estoque_urgente.js [tenantId]
 *   node scripts/wms_raio_x_estoque_urgente.js mana
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const { pool, poolPromise } = require('../config/db');
const aud = require('../services/wms-auditoria-saude.service');
const {
  executarCicloSincronizarLedgerExpedicao,
} = require('../jobs/wms-sincronizar-ledger-expedicao-job');

const tenantId = process.argv[2] || process.env.DEFAULT_TENANT_ID || 'default';
const donoArg = process.argv.find((a) => a.startsWith('--dono='));
const cdDonoFiltro = donoArg ? parseInt(donoArg.split('=')[1], 10) : null;

function sep(title) {
  console.log('\n' + '='.repeat(72));
  console.log(title);
  console.log('='.repeat(72));
}

function fmt(n) {
  if (n == null) return '—';
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  return v.toFixed(4).replace(/\.?0+$/, '').replace('.', ',');
}

async function topExpedicaoDivergente(tid) {
  const r = await pool.query(
    `WITH ult AS (
       SELECT DISTINCT ON (v."CD_CARGA")
              v."CD_CARGA", v."QT_FALTAS", v."QT_SOBRAS", v."QT_SEM_NF", v."QT_SEM_PEDIDO", v."GERADO_EM"
         FROM "WMS_CARGA_VALIDACAO" v
        WHERE v."TENANT_ID" = $1
        ORDER BY v."CD_CARGA", v."GERADO_EM" DESC, v."CD_VALIDACAO" DESC
     )
     SELECT c."CD_CARGA", c."NM_DESCRICAO", c."ST_CARGA",
            COALESCE(e."ST_EXPEDICAO", '—') AS st_exp,
            u."QT_FALTAS", u."QT_SOBRAS", u."QT_SEM_NF", u."QT_SEM_PEDIDO", u."GERADO_EM"
       FROM ult u
       JOIN "WMS_CARGA_PROGRAMADA" c ON c."CD_CARGA" = u."CD_CARGA" AND c."TENANT_ID" = $1
       LEFT JOIN "WMS_EXPEDICAO_CARGA" e ON e."CD_CARGA" = c."CD_CARGA" AND e."TENANT_ID" = $1
      WHERE (u."QT_FALTAS" + u."QT_SOBRAS" + u."QT_SEM_NF" + u."QT_SEM_PEDIDO") > 0
      ORDER BY (u."QT_FALTAS" + u."QT_SOBRAS" + u."QT_SEM_NF" + u."QT_SEM_PEDIDO") DESC, c."CD_CARGA" DESC
      LIMIT 15`,
    [tid]
  );
  return r.rows;
}

(async () => {
  await poolPromise;
  const inicio = Date.now();
  sep(`RAIO-X URGENTE DE ESTOQUE — tenant: ${tenantId}${cdDonoFiltro != null ? ` · dono #${cdDonoFiltro}` : ''}`);
  console.log(`Gerado em: ${new Date().toLocaleString('pt-BR')}`);

  sep('1) AUDITORIA DE SAÚDE (causas estruturais)');
  const saude = await aud.auditarSaudeEstoque(tenantId, cdDonoFiltro, 7);
  if (saude.err) {
    console.error('ERRO:', saude.err);
    process.exit(1);
  }
  const s = saude.ok.resumo;
  console.log(`  Saldo negativo (SKUs):        ${s.skusSaldoNegativo}`);
  console.log(`  Só movimento (sem NF enc.):   ${s.skusSoMovimento}`);
  console.log(`  NF entrada abertas >7 dias:   ${s.nfsAbertasAntigas}`);
  console.log(`  Conferência inválida:         ${s.itensConferenciaInvalidos}`);
  console.log(`  Cadastros duplicados:         ${s.cadastrosDuplicados}`);
  console.log(`  Reservas OPL órfãs:           ${s.reservasOrfasEspelhos} espelho(s), ${s.reservasOrfasLinhas} linha(s)`);

  if (saude.ok.skusSaldoNegativo.length) {
    console.log('\n  Top saldo negativo:');
    saude.ok.skusSaldoNegativo.slice(0, 10).forEach((row) => {
      console.log(
        `    Dono ${row.CD_DONO} | ${row.CODIGO_PRODUTO || '?'} | ${(row.NM_PRODUTO || '').slice(0, 40)} | saldo ${fmt(row.QTD_SALDO_SKU)}`
      );
    });
  }

  if (saude.ok.skusSoMovimento.length) {
    console.log('\n  Top só movimento (saída sem entrada NF):');
    saude.ok.skusSoMovimento.slice(0, 8).forEach((row) => {
      console.log(
        `    Dono ${row.CD_DONO} | ${row.CODIGO_PRODUTO || '?'} | mov ${fmt(row.QTD_MOVIMENTOS)}`
      );
    });
  }

  sep('2) CARGAS EXPEDIDAS SEM BAIXA NO LEDGER (dry-run)');
  const ledger = await executarCicloSincronizarLedgerExpedicao({
    dryRun: true,
    tenantId,
    sgUser: 'RAIO_X_URGENTE',
  });
  console.log(`  Cargas analisadas:   ${ledger.cargasAnalisadas}`);
  console.log(`  Com pendência:       ${ledger.cargasComPendencia}`);
  const det = (ledger.porTenant && ledger.porTenant[0] && ledger.porTenant[0].detalhes) || [];
  if (det.length) {
    console.log('\n  Cargas sem EXPEDICAO_SAIDA (amostra):');
    det.slice(0, 12).forEach((d) => {
      console.log(`    #${d.cdCarga} — ${d.motivo || d.status || 'pendente'} — ${d.itensPendentes || '?'} item(ns)`);
    });
    if (det.length > 12) console.log(`    ... +${det.length - 12} cargas`);
  }

  sep('3) CARGAS COM MAIS DIVERGÊNCIA NF × OPL (última validação)');
  try {
    const divs = await topExpedicaoDivergente(tenantId);
    if (!divs.length) {
      console.log('  Nenhuma carga com divergência registrada (ou sem validação persistida).');
    } else {
      divs.forEach((c) => {
        const tot =
          Number(c.QT_FALTAS || 0) +
          Number(c.QT_SOBRAS || 0) +
          Number(c.QT_SEM_NF || 0) +
          Number(c.QT_SEM_PEDIDO || 0);
        console.log(
          `    #${c.CD_CARGA} ${c.st_exp} | faltas ${c.QT_FALTAS} sobras ${c.QT_SOBRAS} sep.semNF ${c.QT_SEM_NF} semPed ${c.QT_SEM_PEDIDO} | ${(c.NM_DESCRICAO || '').slice(0, 35)}`
        );
      });
    }
  } catch (e) {
    console.log('  (validação não disponível:', e.message, ')');
  }

  sep('AÇÕES IMEDIATAS SUGERIDAS');
  const acoes = [];
  if (s.skusSaldoNegativo > 0) acoes.push('→ Relatório Posição: filtrar SKUs negativos e usar lupa (diagnóstico por SKU).');
  if (s.skusSoMovimento > 0) acoes.push('→ Conferir recebimentos: NF encerrada com cdProduto e fator de conversão.');
  if (ledger.cargasComPendencia > 0) {
    acoes.push(
      `→ ${ledger.cargasComPendencia} carga(s) expedida(s) SEM baixa no ledger — avaliar: npm run wms:sync-ledger-dry (diagnóstico) e depois wms:sync-ledger-once (reparar).`
    );
  }
  if (s.itensConferenciaInvalidos > 0) acoes.push('→ Corrigir linhas de conferência inválidas antes de confiar no saldo.');
  if (s.cadastrosDuplicados > 0) acoes.push('→ Unificar cadastros duplicados (mesmo código OL, 2 CD_PRODUTO).');
  if (s.reservasOrfasLinhas > 0) acoes.push('→ Limpar reservas OPL órfãs na auditoria de saúde.');
  acoes.push('→ Expedição: revalidar cargas recentes + painel azul (xPed ≠ OPL).');
  if (!acoes.length) acoes.push('→ Nenhum alerta crítico automático; revisar inventário e movimentação manual.');
  acoes.forEach((a) => console.log(' ', a));

  console.log(`\nConcluído em ${((Date.now() - inicio) / 1000).toFixed(1)}s.`);
  await pool.end();
})().catch((e) => {
  console.error('\nFALHA:', e.message || e);
  process.exit(1);
});
