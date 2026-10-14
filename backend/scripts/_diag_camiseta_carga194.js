'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const val = require('../services/wms-carga-validacao.service');

const PEDIDOS_CAMISETA = ['78338', '78339', '78342', '78349', '78356', '78358'];

(async () => {
  const r = await val.validarCargaProgramada('default', 194, {});
  const divs = (r.divergencias || []).filter(
    (d) => String(d.descricao || '').toUpperCase().includes('CAMISETA') || String(d.codigo || '').includes('65250')
  );
  console.log('=== Divergências camiseta carga 194 ===');
  for (const d of divs) {
    console.log(d.tipo, 'ped', d.pedido, 'cod', d.codigoLiteral || d.codigo, 'sep', d.qtdPedido, 'nf', d.qtdNf, 'aviso', d.aviso || '');
  }

  const oplPed = await pool.query(
    `SELECT a."CD_OPL_ARQUIVO", a."NM_ARQUIVO", p."NUM_PEDIDO", p."COD_DESTINATARIO", p."RAZ_SOC_DEST",
            i."COD_PRODUTO_OL", i."QT_PEDIDA"
       FROM "WMS_OPL_ARQUIVO" a
       JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
       JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
      WHERE a."TENANT_ID" = 'default'
        AND regexp_replace(TRIM(p."NUM_PEDIDO"), '^0+', '') = ANY($1::text[])
      ORDER BY p."NUM_PEDIDO", i."COD_PRODUTO_OL"`,
    [PEDIDOS_CAMISETA]
  );
  console.log('\n=== OPL linhas nos pedidos da NF (qualquer SKU) ===', oplPed.rows.length);
  console.log(oplPed.rows.slice(0, 5));

  const oplCamL05 = await pool.query(
    `SELECT regexp_replace(TRIM(p."NUM_PEDIDO"), '^0+', '') AS ped, i."COD_PRODUTO_OL", SUM(i."QT_PEDIDA")::int AS qtd
       FROM "WMS_OPL_PEDIDO" p
       JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
      WHERE p."CD_OPL_ARQUIVO" = 140
        AND (i."COD_PRODUTO_OL" LIKE '%65250132%' OR i."COD_PRODUTO_OL" LIKE '%65250134%')
      GROUP BY 1, 2 ORDER BY 2, 1`
  );
  const totL05 = await pool.query(
    `SELECT i."COD_PRODUTO_OL", SUM(i."QT_PEDIDA")::int AS qtd, COUNT(DISTINCT p."NUM_PEDIDO")::int AS pedidos
       FROM "WMS_OPL_PEDIDO" p JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
      WHERE p."CD_OPL_ARQUIVO" = 140 AND (i."COD_PRODUTO_OL" LIKE '%65250132%' OR i."COD_PRODUTO_OL" LIKE '%65250134%')
      GROUP BY 1`
  );
  console.log('\n=== Lote 05 #140 camisetas M/G ===', totL05.rows);

  const anyEsp = await pool.query(
    `SELECT a."CD_OPL_ARQUIVO", a."NM_ARQUIVO", regexp_replace(TRIM(p."NUM_PEDIDO"), '^0+', '') AS ped,
            i."COD_PRODUTO_OL", i."QT_PEDIDA"
       FROM "WMS_OPL_ARQUIVO" a
       JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
       JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
      WHERE a."TENANT_ID" = 'default'
        AND (i."COD_PRODUTO_OL" LIKE '%65250132%' OR i."COD_PRODUTO_OL" LIKE '%65250134%')
        AND regexp_replace(TRIM(p."NUM_PEDIDO"), '^0+', '') = ANY($1::text[])
      ORDER BY a."CD_OPL_ARQUIVO"`,
    [PEDIDOS_CAMISETA]
  );
  console.log('\n=== Camisetas M/G nos pedidos NF em QUALQUER espelho ===', anyEsp.rows.length);

  const nfItens = await val.carregarItensNfCarga('default', 194);
  const pedidos = [...new Set(nfItens.map((x) => x.pedido).filter(Boolean))];
  const cdsDono = await val.carregarCdsDonoCarga('default', 194);
  const opl = await val.carregarSeparacaoOplPorPedidosNfMulti('default', pedidos, { cdsDonoCarga: cdsDono });
  const nfCam = nfItens.filter((i) => String(i.descricao || '').toUpperCase().includes('CAMISETA'));
  const sepCam = (opl.itens || []).filter((i) => String(i.descricao || '').toUpperCase().includes('CAMISETA'));
  console.log('\n=== NF camisetas ===', nfCam.length, 'linhas');
  for (const n of nfCam) console.log(' ', n.pedido, n.codigoLiteral, n.qtd);
  console.log('=== SEP OPL camisetas (multi-espelho) ===', sepCam.length);
  for (const s of sepCam) console.log(' ', s.pedido, s.codigoLiteral, s.qtd);
  console.log('Origem OPL multi:', opl.origem);
  console.log('Origem validação:', r.origemSeparacao);

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
