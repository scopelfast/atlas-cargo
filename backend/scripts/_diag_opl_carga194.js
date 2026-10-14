'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const v = require('../services/wms-carga-validacao.service');

(async () => {
  const nf = await v.carregarItensNfCarga('default', 194);
  const ped = [...new Set(nf.map((x) => v.normPedido(x.pedido)).filter(Boolean))];
  const cds = await v.carregarCdsDonoCarga('default', 194);
  const opl = await v.carregarSeparacaoOplPorPedidosNfMulti('default', ped, { cdsDonoCarga: cds });
  console.log('espelhos', opl.origem);
  console.log('itens sep', opl.itens.length, 'espelhosAtivos', opl.espelhosAtivos);
  const cam = opl.itens.filter((i) => String(i.descricao || '').toUpperCase().includes('CAMISETA'));
  console.log('camisetas in sep', cam.length);
  const pedCamNf = ped.filter((p) =>
    nf.some((n) => v.normPedido(n.pedido) === p && String(n.descricao || '').toUpperCase().includes('CAMISETA'))
  );
  console.log('pedidos camiseta NF', pedCamNf);
  await pool.end();
})();
