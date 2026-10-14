'use strict';
/**
 * Auditoria peso carga 232 (Rota 98) — onde pode estar a divergência.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');
const { carregarMapaProdutosDonoPorDigitos } = require('../services/wms-produto-mapa-codigo.service');
const { digitosCodigoOl } = require('../services/wms-opl-relatorio-romaneio.service');
const { bucketConservacaoLinha } = require('../services/wms-carga-resumo-logistico.service');
const { nomeEntregaUnidadeOuLocalDestino } = require('../services/wms-nfe-saida-destino-display.service');

const CD_CARGA = 232;
const TID = 'default';

function toN(v) {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function parseLinhas(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const j = JSON.parse(raw);
      return Array.isArray(j) ? j : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

(async () => {
  const rN = await pool.query(
    `SELECT n."CD_NFE_SAIDA", n."NUMERO_NF", n."SERIE", n."CD_DONO",
            n."LINHAS_JSON", n."VNF_TOTAL",
            n."XNOME_ENTREGA", n."XNOME_DEST", n."XMUN_DEST", n."UF_DEST",
            n."CNPJ_ENTREGA", n."CNPJ_DEST",
            n."PESO_RESUMO_KG"
       FROM "WMS_CARGA_PROGRAMADA_NFE" j
       JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
      WHERE j."CD_CARGA" = $1::int AND n."TENANT_ID" = $2
      ORDER BY j."ORDEM", n."NUMERO_NF"`,
    [CD_CARGA, TID]
  );

  const nfes = rN.rows || [];
  console.log('NFs na carga', CD_CARGA, ':', nfes.length);

  // coletar dígitos
  const digitos = new Set();
  for (const n of nfes) {
    for (const ln of parseLinhas(n.LINHAS_JSON)) {
      const d = digitosCodigoOl(ln.cProd || ln.codigo || '');
      if (d) digitos.add(d);
    }
  }
  const cdDono = nfes[0] && Number(nfes[0].CD_DONO);
  const mapa = await carregarMapaProdutosDonoPorDigitos(TID, cdDono, [...digitos]);

  let totWms = 0;
  let totSeco = 0;
  let totFrio = 0;
  let totQcom = 0;
  let totPesoB = 0;
  const porNf = [];
  const topItens = [];
  const semPeso = [];
  const suspeitos = []; // PESO_KG alto demais vs descrição

  for (const n of nfes) {
    const linhas = parseLinhas(n.LINHAS_JSON);
    let wNf = 0;
    let seco = 0;
    let frio = 0;
    let qNf = 0;
    let pesoB = 0;
    const dest = nomeEntregaUnidadeOuLocalDestino(n);

    for (const ln of linhas) {
      if (!ln || ln._meta) continue;
      const dkey = digitosCodigoOl(ln.cProd || ln.codigo || '');
      const q = toN(ln.qCom ?? ln.quantidade);
      if (q <= 0 || !dkey) continue;
      qNf += q;
      totQcom += q;
      const cad = mapa[dkey];
      const pk = cad && cad.PESO_KG != null ? Number(cad.PESO_KG) : NaN;
      const w = Number.isFinite(pk) && pk > 0 ? q * pk : 0;
      const bucket = bucketConservacaoLinha(ln, mapa);
      if (w > 0) {
        wNf += w;
        if (bucket === 'REFRIG_CONG') frio += w;
        else seco += w;
        topItens.push({
          nf: n.NUMERO_NF,
          dest: String(dest || '').slice(0, 50),
          cod: cad ? cad.CODIGO : dkey,
          nome: String((cad && cad.NOME) || ln.xProd || '').slice(0, 55),
          q,
          pesoKgUnit: pk,
          pesoLinha: Number(w.toFixed(3)),
          bucket,
          um: (cad && cad.UNIDADE) || ln.uCom || '',
        });
      } else {
        semPeso.push({ nf: n.NUMERO_NF, cProd: ln.cProd, xProd: ln.xProd, q });
      }

      // heurística: caixa 20kg com PESO_KG != 20, ou unitário absurdo
      if (Number.isFinite(pk) && pk > 0) {
        const nome = String((cad && cad.NOME) || ln.xProd || '').toUpperCase();
        const mCx = nome.match(/CX\s*(\d+(?:[.,]\d+)?)\s*KG/);
        if (mCx) {
          const decl = Number(String(mCx[1]).replace(',', '.'));
          if (Number.isFinite(decl) && Math.abs(decl - pk) > 0.5) {
            suspeitos.push({
              tipo: 'CX_KG_DIVERGE',
              cod: cad.CODIGO,
              nome: nome.slice(0, 60),
              pesoCad: pk,
              kgNoNome: decl,
              q,
              pesoLinha: w,
              nf: n.NUMERO_NF,
            });
          }
        }
        // peso unitário > 50kg sem ser CX/BD/BOB
        if (pk > 50 && !/CX|BD|BOB|FD|GA/.test(String(cad.UNIDADE || '').toUpperCase()) && !/CX\s*\d/.test(nome)) {
          suspeitos.push({
            tipo: 'PESO_UNIT_ALTO',
            cod: cad.CODIGO,
            nome: nome.slice(0, 60),
            pesoCad: pk,
            q,
            pesoLinha: w,
            nf: n.NUMERO_NF,
          });
        }
      }

      // peso bruto da linha se existir no XML
      const pb = toN(ln.pesoB ?? ln.pesoBruto ?? ln.qTrib);
      // qTrib às vezes é kg — só anotar se uTrib = KG
      if (String(ln.uTrib || '').toUpperCase() === 'KG') {
        pesoB += toN(ln.qTrib);
      }
    }

    // meta NF
    for (const ln of linhas) {
      if (ln && ln._meta) {
        pesoB += toN(ln.pesoB ?? ln.pesoBruto);
      }
    }

    const pr = n.PESO_RESUMO_KG != null ? Number(n.PESO_RESUMO_KG) : null;
    totWms += wNf;
    totSeco += seco;
    totFrio += frio;
    totPesoB += pesoB;

    porNf.push({
      nf: `${n.NUMERO_NF}/${n.SERIE}`,
      dest: String(dest || '').slice(0, 55),
      qUn: Number(qNf.toFixed(2)),
      pesoWms: Number(wNf.toFixed(3)),
      seco: Number(seco.toFixed(3)),
      frio: Number(frio.toFixed(3)),
      pesoResumoPlanilha: pr,
      pesoBXml: pesoB > 0 ? Number(pesoB.toFixed(3)) : null,
      vnf: toN(n.VNF_TOTAL),
    });
  }

  topItens.sort((a, b) => b.pesoLinha - a.pesoLinha);

  console.log('\n=== POR NF ===');
  porNf.forEach((x) => console.log(JSON.stringify(x)));

  console.log('\n=== TOTAIS ===');
  console.log({
    totWms: Number(totWms.toFixed(3)),
    totSeco: Number(totSeco.toFixed(3)),
    totFrio: Number(totFrio.toFixed(3)),
    totQcom: Number(totQcom.toFixed(2)),
    totPesoBXml: Number(totPesoB.toFixed(3)),
    relatado: 3411.125,
  });

  console.log('\n=== TOP 25 ITENS POR PESO (WMS) ===');
  topItens.slice(0, 25).forEach((x, i) => {
    console.log(
      `${i + 1}. NF${x.nf} ${x.cod} q=${x.q} × ${x.pesoKgUnit}kg = ${x.pesoLinha} [${x.bucket}] ${x.nome}`
    );
  });

  const somaTop = topItens.slice(0, 10).reduce((s, x) => s + x.pesoLinha, 0);
  console.log('Soma top 10:', Number(somaTop.toFixed(3)), `(${((somaTop / totWms) * 100).toFixed(1)}% do total)`);

  console.log('\n=== SUSPEITOS CADASTRO ===');
  if (!suspeitos.length) console.log('(nenhum)');
  else suspeitos.forEach((s) => console.log(JSON.stringify(s)));

  console.log('\n=== SEM PESO CADASTRO ===', semPeso.length);
  semPeso.slice(0, 10).forEach((s) => console.log(JSON.stringify(s)));

  // Comparar com "volumes" do romaneio (se alguém somou volumes como kg)
  console.log('\n=== NOTA: romaneio mostra VOLUMES (qCom), NÃO kg ===');
  console.log('Total unidades/volumes nas NFs:', Number(totQcom.toFixed(2)));
  console.log('Se a pessoa somou volumes do picking pensando ser kg, confunde com', totQcom, '≠', totWms);

  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
