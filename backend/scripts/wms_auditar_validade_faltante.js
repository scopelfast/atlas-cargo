#!/usr/bin/env node
'use strict';
/**
 * Lista SKUs com FG_CONTROLA_VALIDADE=S, saldo > 0 e sem rastreio adequado de validade.
 *
 * Uso:
 *   node scripts/wms_auditar_validade_faltante.js [--tenant default] [--dono 1|2] [--csv]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const {
  listarValidadeFaltante,
  linhasValidadeFaltanteParaCsv,
  ROTULO_SITUACAO,
} = require('../services/wms-relatorio-validade-faltante.service');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  if (i === -1) return def;
  const v = process.argv[i + 1];
  return v != null && v !== '' ? v : def;
}

const TENANT = arg('--tenant', 'default');
const DONO = arg('--dono', '');
const CSV = process.argv.includes('--csv');

async function main() {
  const cdDono = DONO !== '' ? parseInt(DONO, 10) : null;
  if (DONO !== '' && !Number.isFinite(cdDono)) {
    console.error('Dono inválido:', DONO);
    process.exit(1);
  }

  const { rows } = await listarValidadeFaltante(TENANT, cdDono);

  const porSit = {};
  for (const row of rows) {
    const sit = row.situacao || row.SITUACAO;
    porSit[sit] = (porSit[sit] || 0) + 1;
  }

  if (CSV) {
    console.log(linhasValidadeFaltanteParaCsv(rows));
    return;
  }

  console.log('=== AUDITORIA URGENTE: validade faltante ===');
  console.log('Tenant:', TENANT, cdDono != null ? `Dono: ${cdDono}` : 'Todos os donos');
  console.log('Gerado:', new Date().toLocaleString('pt-BR'));
  console.log('Total SKUs com problema:', rows.length);
  console.log('Por situação:', porSit);
  console.log('');

  const ordem = [
    'SO_MOVIMENTO_SEM_NF',
    'ENTRADA_SEM_VALIDADE',
    'VALIDADE_PARCIAL',
    'SO_INVENTARIO_SEM_NF',
  ];

  for (const sit of ordem) {
    const grupo = rows.filter((x) => (x.situacao || x.SITUACAO) === sit);
    if (!grupo.length) continue;
    console.log(`--- ${sit} (${grupo.length}) — ${ROTULO_SITUACAO[sit] || sit} ---`);
    for (const row of grupo.slice(0, 80)) {
      console.log(
        [
          `dono ${row.CD_DONO}`,
          row.CODIGO_PRODUTO,
          (row.NM_PRODUTO || '').slice(0, 50),
          `saldo=${Number(row.qtd_saldo_sku ?? row.QTD_SALDO_SKU)}`,
          `nf+val=${Number(row.qtd_nf_com_validade ?? row.QTD_NF_COM_VALIDADE)}`,
          `nf-sem=${Number(row.qtd_nf_sem_validade ?? row.QTD_NF_SEM_VALIDADE)}`,
          `inv+val=${Number(row.qtd_inv_com_validade ?? row.QTD_INV_COM_VALIDADE)}`,
          `mov=${Number(row.qtd_mov ?? row.QTD_MOV)}`,
        ].join(' | ')
      );
    }
    if (grupo.length > 80) console.log(`... +${grupo.length - 80} itens (use --csv para lista completa)`);
    console.log('');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
