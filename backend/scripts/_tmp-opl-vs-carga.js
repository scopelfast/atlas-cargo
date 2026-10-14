const { montarProgramacaoAntecipadaOpl } = require('../services/wms-opl-programacao-antecipada.service');
const { agregarPesosConservacaoPorCargas } = require('../services/wms-carga-resumo-programacao.service');
const { pool } = require('../config/db');

(async () => {
  const opl = await montarProgramacaoAntecipadaOpl('default', {
    dataEntregaDe: '2026-07-24',
    dataEntregaAte: '2026-07-24',
    nmArquivo: '24.07',
    uf: 'PR',
  });

  console.log('aviso', opl.aviso);
  console.log('espelhos', (opl.espelhosConsiderados || []).map((e) => e.CD_OPL_ARQUIVO || e.cdOplArquivo));
  console.log('totaisGeral', opl.totaisGeral);
  for (const d of opl.porDataEntrega || []) {
    console.log('dia', d.dataEntrega || d.data, {
      peso: d.totais?.pesoKg ?? d.pesoKg,
      seco: d.totais?.pesoKgSeco ?? d.pesoKgSeco,
      frio: d.totais?.pesoKgFrio ?? d.pesoKgFrio,
      ped: d.totais?.qtdPedidos ?? d.qtdPedidos,
      paradas: d.totais?.qtdParadas ?? d.qtdParadas,
      un: d.totais?.unidades ?? d.unidades,
    });
  }

  const cargas = await agregarPesosConservacaoPorCargas('default', [254, 255, 256, 257, 258]);
  let ps = 0,
    pf = 0,
    pt = 0;
  for (const id of [254, 255, 256, 257, 258]) {
    const p = cargas.get(id);
    ps += p.pesoSeco;
    pf += p.pesoFrio;
    pt += p.pesoProduto;
  }
  console.log('cargas 254-258', { seco: +ps.toFixed(3), frio: +pf.toFixed(3), total: +pt.toFixed(3) });

  const tg = opl.totaisGeral || {};
  console.log('diff OPL-carga', {
    total: +(tg.pesoKg - pt).toFixed(3),
    seco: +(tg.pesoKgSeco - ps).toFixed(3),
    frio: +(tg.pesoKgFrio - pf).toFixed(3),
  });

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
