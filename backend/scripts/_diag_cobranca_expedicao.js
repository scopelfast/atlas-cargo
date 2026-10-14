'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const svc = require('../services/wms-cobranca-operacional.service');
const { isoDateFromDb } = require('../services/wms-estoque-valor.service');

const REF = { Nutriville: 20085.08, Mana: 133818.89 };

async function main() {
  const tenant = 'default';
  const dataIni = process.argv[2] || '2026-06-01';
  const dataFim = process.argv[3] || '2026-06-30';
  const dash = await svc.obterDashboardCobrancaOperacional(tenant, { dataIni, dataFim });

  console.log(`=== SISTEMA ${dataIni} a ${dataFim} ===`);
  for (const d of dash.expedicao.resumoPorDono) {
    console.log(
      d.NM_DONO,
      'NF:', d.valorNfTotal,
      'cobr:', d.cobrancaEstimada,
      'cargas:', d.qtdCargas,
      'nfs:', d.qtdNf,
      'sem valor:', d.qtdNfSemValor
    );
  }
  console.log('Total NF sistema:', dash.expedicao.valorNfTotal);
  console.log('Referência cobrança:', REF);

  const linhas = dash.expedicao.linhasNf || [];
  const dias = [...new Set(linhas.map((l) => isoDateFromDb(l.DH_SAIDA)))].filter(Boolean).sort();
  console.log('\n=== Últimos 12 dias com saída ===');
  for (const dt of dias.slice(-12)) {
    let mana = 0;
    let nutri = 0;
    for (const ln of linhas) {
      if (isoDateFromDb(ln.DH_SAIDA) !== dt) continue;
      const nome = (ln.NM_DONO || '').toLowerCase();
      if (nome.includes('mana')) mana += ln.VALOR_NF || 0;
      else if (nome.includes('nutri')) nutri += ln.VALOR_NF || 0;
    }
    console.log(dt, 'Mana:', mana.toFixed(2), 'Nutriville:', nutri.toFixed(2));
  }

  for (const corte of ['2026-06-15', '2026-06-20', '2026-06-25', '2026-06-28']) {
    const ate = { Mana: 0, Nutriville: 0, outros: 0 };
    const depois = { Mana: 0, Nutriville: 0, outros: 0 };
    for (const ln of linhas) {
      const dt = isoDateFromDb(ln.DH_SAIDA);
      const v = ln.VALOR_NF || 0;
      const nome = (ln.NM_DONO || '').toLowerCase();
      const bucket = nome.includes('mana') ? 'Mana' : nome.includes('nutri') ? 'Nutriville' : 'outros';
      if (dt <= corte) ate[bucket] += v;
      else depois[bucket] += v;
    }
    console.log(`\n--- Corte ${corte} ---`);
    console.log('Até:', ate, '| Depois:', depois);
    console.log(
      'Até diff Mana vs ref:',
      (ate.Mana - REF.Mana).toFixed(2),
      '| Nutriville:',
      (ate.Nutriville - REF.Nutriville).toFixed(2)
    );
  }

  const r = await pool.query(
    `SELECT n."CD_NFE_SAIDA", n."NUMERO_NF", n."SERIE", COUNT(*) AS cnt
       FROM "WMS_EXPEDICAO_CARGA" e
       INNER JOIN "WMS_CARGA_PROGRAMADA_NFE" j ON j."CD_CARGA" = e."CD_CARGA"
       INNER JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA" AND n."TENANT_ID" = e."TENANT_ID"
      WHERE e."TENANT_ID" = $1
        AND UPPER(COALESCE(e."ST_EXPEDICAO", '')) = 'EXPEDIDA'
        AND e."DH_SAIDA"::date BETWEEN $2::date AND $3::date
      GROUP BY 1,2,3 HAVING COUNT(*) > 1
      ORDER BY cnt DESC LIMIT 15`,
    [tenant, dataIni, dataFim]
  );
  console.log('\n=== NF com linha duplicada no JOIN ===', r.rows.length);
  if (r.rows.length) console.log(r.rows);

  const r2 = await pool.query(
    `SELECT d."NOME", COUNT(*) cnt,
            SUM(COALESCE(n."VNF_TOTAL",0)) sum_vnf,
            COUNT(*) FILTER (WHERE COALESCE(n."VNF_TOTAL",0) <= 0) sem_vnf
       FROM "WMS_EXPEDICAO_CARGA" e
       INNER JOIN "WMS_CARGA_PROGRAMADA_NFE" j ON j."CD_CARGA" = e."CD_CARGA"
       INNER JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA" AND n."TENANT_ID" = e."TENANT_ID"
       LEFT JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = n."CD_DONO" AND d."TENANT_ID" = e."TENANT_ID"
      WHERE e."TENANT_ID" = $1
        AND UPPER(COALESCE(e."ST_EXPEDICAO", '')) = 'EXPEDIDA'
        AND e."DH_SAIDA"::date BETWEEN $2::date AND $3::date
      GROUP BY d."NOME" ORDER BY 2 DESC`,
    [tenant, dataIni, dataFim]
  );
  console.log('\n=== SQL direto por dono (soma VNF_TOTAL bruto, pode duplicar) ===');
  console.log(r2.rows);

  // Cobrança 8% por dono (sistema)
  console.log('\n=== Cobrança sistema (8% típico) ===');
  for (const d of dash.expedicao.resumoPorDono) {
    const pct = d.PCT_COBRANCA_EXPEDICAO || 8;
    console.log(d.NM_DONO, 'cobr', d.cobrancaEstimada, `(${pct}%)`, 'ref diff', (d.cobrancaEstimada - (REF[d.NM_DONO] || REF[d.NM_DONO?.includes?.('Mana') ? 'Mana' : ''] || 0)).toFixed(2));
  }

  // Cargas por dono com cobrança
  const porCarga = {};
  for (const ln of linhas) {
    const nome = (ln.NM_DONO || '').toLowerCase();
    const dono = nome.includes('mana') ? 'Mana' : nome.includes('nutri') ? 'Nutriville' : 'outros';
    const k = ln.CD_CARGA;
    if (!porCarga[k]) porCarga[k] = { CD_CARGA: k, dono, nf: 0, nfs: 0, dt: isoDateFromDb(ln.DH_SAIDA) };
    porCarga[k].nf += ln.VALOR_NF || 0;
    porCarga[k].nfs += 1;
  }
  const cargasMana = Object.values(porCarga).filter((c) => c.dono === 'Mana').sort((a, b) => b.dt.localeCompare(a.dt) || b.nf - a.nf);
  const cargasNutri = Object.values(porCarga).filter((c) => c.dono === 'Nutriville').sort((a, b) => b.dt.localeCompare(a.dt) || b.nf - a.nf);
  console.log('\n=== Últimas 5 cargas Mana (por NF total) ===');
  console.log(cargasMana.slice(0, 5).map((c) => ({ ...c, nf: c.nf.toFixed(2), cobr8: (c.nf * 0.08).toFixed(2) })));
  console.log('\n=== Últimas 5 cargas Nutriville ===');
  console.log(cargasNutri.slice(0, 5).map((c) => ({ ...c, nf: c.nf.toFixed(2), cobr8: (c.nf * 0.08).toFixed(2) })));

  // Alternativa: data emissão NF
  const r3 = await pool.query(
    `SELECT d."NOME", COUNT(*) cnt,
            SUM(COALESCE(n."VNF_TOTAL",0))::numeric(15,2) sum_vnf
       FROM "WMS_EXPEDICAO_CARGA" e
       INNER JOIN "WMS_CARGA_PROGRAMADA_NFE" j ON j."CD_CARGA" = e."CD_CARGA"
       INNER JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA" AND n."TENANT_ID" = e."TENANT_ID"
       LEFT JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = n."CD_DONO" AND d."TENANT_ID" = e."TENANT_ID"
      WHERE e."TENANT_ID" = $1
        AND UPPER(COALESCE(e."ST_EXPEDICAO", '')) = 'EXPEDIDA'
        AND n."DH_EMISSAO"::date BETWEEN $2::date AND $3::date
      GROUP BY d."NOME" ORDER BY 2 DESC`,
    [tenant, dataIni, dataFim]
  );
  console.log('\n=== Por dono filtrando DH_EMISSAO (não DH_SAIDA) ===');
  console.log(r3.rows);

  // Status não expedida mas com saída?
  const r4 = await pool.query(
    `SELECT UPPER(COALESCE(e."ST_EXPEDICAO", '')) st, COUNT(DISTINCT e."CD_CARGA") cargas, COUNT(*) linhas
       FROM "WMS_EXPEDICAO_CARGA" e
       INNER JOIN "WMS_CARGA_PROGRAMADA_NFE" j ON j."CD_CARGA" = e."CD_CARGA"
       INNER JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA" AND n."TENANT_ID" = e."TENANT_ID"
      WHERE e."TENANT_ID" = $1
        AND e."DH_SAIDA"::date BETWEEN $2::date AND $3::date
      GROUP BY 1`,
    [tenant, dataIni, dataFim]
  );
  console.log('\n=== Cargas por ST_EXPEDICAO no período (DH_SAIDA) ===');
  console.log(r4.rows);

  const r5 = await pool.query(
    `SELECT d."NOME", d."PCT_COBRANCA_EXPEDICAO"
       FROM "WMS_DONO_ESTOQUE" d WHERE d."TENANT_ID" = $1 ORDER BY d."NOME"`,
    [tenant]
  );
  console.log('\n=== % cobrança expedição cadastrado ===');
  console.log(r5.rows);

  const rawRows = await pool.query(
    `SELECT e."CD_CARGA", e."DH_SAIDA", n."VNF_TOTAL", n."LINHAS_JSON", n."CD_DONO", d."NOME"
       FROM "WMS_EXPEDICAO_CARGA" e
       INNER JOIN "WMS_CARGA_PROGRAMADA_NFE" j ON j."CD_CARGA" = e."CD_CARGA"
       INNER JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA" AND n."TENANT_ID" = e."TENANT_ID"
       LEFT JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = n."CD_DONO" AND d."TENANT_ID" = e."TENANT_ID"
      WHERE e."TENANT_ID" = $1
        AND UPPER(COALESCE(e."ST_EXPEDICAO", '')) = 'EXPEDIDA'
        AND e."DH_SAIDA"::date BETWEEN $2::date AND $3::date`,
    [tenant, dataIni, dataFim]
  );
  const aggVnf = {};
  for (const r of rawRows.rows) {
    const nome = r.NOME || `dono${r.CD_DONO}`;
    const vnf = Number(r.VNF_TOTAL) || 0;
    const calc = svc.valorNfNota(r);
    if (!aggVnf[nome]) aggVnf[nome] = { vnf: 0, calc: 0, sobraVprod: 0, linhas: 0 };
    aggVnf[nome].vnf += vnf > 0 ? vnf : 0;
    aggVnf[nome].calc += calc;
    aggVnf[nome].linhas += 1;
    if (vnf <= 0 && calc > 0) aggVnf[nome].sobraVprod += calc;
  }
  console.log('\n=== VNF XML vs valor calculado (vNF ou soma vProd) ===');
  for (const [nome, v] of Object.entries(aggVnf)) {
    console.log(nome, {
      vnf: v.vnf.toFixed(2),
      calc: v.calc.toFixed(2),
      sobraVprod: v.sobraVprod.toFixed(2),
      cobr8_vnf: (v.vnf * 0.08).toFixed(2),
      cobr8_calc: (v.calc * 0.08).toFixed(2),
    });
  }

  const cortes = ['2026-06-26', '2026-06-27', '2026-06-28', '2026-06-29', '2026-06-30'];
  console.log('\n=== Cobrança 8% excluindo saídas a partir de... ===');
  for (const corte of cortes) {
    const t = { Mana: 0, Nutriville: 0 };
    for (const r of rawRows.rows) {
      const dt = isoDateFromDb(r.DH_SAIDA);
      if (!dt || dt >= corte) continue;
      const nome = (r.NOME || '').includes('Mana') ? 'Mana' : (r.NOME || '').includes('Nutri') ? 'Nutriville' : '?';
      t[nome] = (t[nome] || 0) + svc.valorNfNota(r);
    }
    console.log(
      '<' + corte,
      Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.toFixed(2)])),
      'cobr8',
      Object.fromEntries(Object.entries(t).map(([k, v]) => [k, (v * 0.08).toFixed(2)]))
    );
  }

  // Fonte valor no sistema
  const fontes = {};
  for (const ln of linhas) {
    fontes[ln.FONTE_VALOR] = (fontes[ln.FONTE_VALOR] || 0) + 1;
  }
  console.log('\n=== Fonte valor (linhas NF) ===', fontes);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
