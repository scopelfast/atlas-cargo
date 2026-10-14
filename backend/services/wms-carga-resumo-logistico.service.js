'use strict';

const { pool } = require('../config/db');
const { collectDigitosCargaNfe, classificarFrioPorNcm } = require('./wms-carga-relatorio-html.service');
const { classificarConservacao, digitosCodigoOl } = require('./wms-opl-relatorio-romaneio.service');
const { carregarMapaProdutosDonoPorDigitos } = require('./wms-produto-mapa-codigo.service');
const { nomeEntregaUnidadeOuLocalDestino } = require('./wms-nfe-saida-destino-display.service');

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function toNumber(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function parseLinhasJson(raw) {
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

function bucketConservacaoLinha(linha, produtoPorDigitos) {
  const desc = String(linha.xProd || linha.descricao || '').trim();
  const dkey = digitosCodigoOl(linha.cProd || linha.codigo || '');
  const cad = dkey && produtoPorDigitos ? produtoPorDigitos[dkey] : null;
  const bucketOpl = classificarConservacao(desc, cad);
  if (bucketOpl === 'REFRIG_CONG') return 'REFRIG_CONG';
  /** Cadastro SECO já fechou em classificarConservacao — não reabrir por NCM da NF. */
  const tipoCad = String((cad && cad.TIPO_ARMAZENAGEM) || '').toUpperCase();
  if (tipoCad.includes('SECO') || tipoCad.includes('AMBIENT')) return 'SECO_AMB';
  const tipoNcm = classificarFrioPorNcm(linha.NCM != null ? linha.NCM : linha.ncm);
  if (tipoNcm) return 'REFRIG_CONG';
  return 'SECO_AMB';
}

function pesoLinhaKg(linha, produtoPorDigitos) {
  const dkey = digitosCodigoOl(linha.cProd || linha.codigo || '');
  const cad = dkey && produtoPorDigitos ? produtoPorDigitos[dkey] : null;
  const q = toNumber(linha.qCom ?? linha.quantidade ?? 0);
  if (q <= 0) return { qtd: 0, peso: 0, semPeso: false };
  if (!cad || cad.PESO_KG == null) return { qtd: q, peso: 0, semPeso: true };
  const w = Number(cad.PESO_KG);
  if (!Number.isFinite(w) || w <= 0) return { qtd: q, peso: 0, semPeso: true };
  return { qtd: q, peso: q * w, semPeso: false };
}

async function carregarMapaProdutosDono(tenantId, cdDono, digitosList) {
  return carregarMapaProdutosDonoPorDigitos(tenantId, cdDono, digitosList);
}

function chaveDestinoNf(n) {
  const uf = String(n.UF_DEST || '').trim().toUpperCase().slice(0, 2);
  const mun = String(n.XMUN_DEST || '').trim();
  const nome = nomeEntregaUnidadeOuLocalDestino(n);
  const cnpj = String(n.CNPJ_ENTREGA || n.CNPJ_DEST || '').replace(/\D/g, '');
  return `${uf}|${mun}|${cnpj}|${nome}`;
}

/**
 * Resumo para programação de entregas (peso, unidades, conservação, destinos) a partir das NF-e da carga.
 */
async function montarResumoLogisticoCarga(tenantId, cdCarga) {
  const rC = await pool.query(
    `SELECT "CD_CARGA", "CD_DONO", "NM_DESCRICAO", "ST_CARGA"
       FROM "WMS_CARGA_PROGRAMADA"
      WHERE "CD_CARGA" = $1::integer AND "TENANT_ID" = $2`,
    [cdCarga, tenantId]
  );
  if (!rC.rowCount) return null;

  const carga = rC.rows[0];
  let cdDono =
    carga.CD_DONO != null && Number.isFinite(Number(carga.CD_DONO)) ? Number(carga.CD_DONO) : null;

  const rN = await pool.query(
    `SELECT j."ORDEM", n.*
       FROM "WMS_CARGA_PROGRAMADA_NFE" j
       JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
      WHERE j."CD_CARGA" = $1::integer AND n."TENANT_ID" = $2
      ORDER BY j."ORDEM", j."CD_NFE_SAIDA"`,
    [cdCarga, tenantId]
  );
  const nfes = rN.rows || [];
  if (!nfes.length) {
    return {
      carga: {
        CD_CARGA: cdCarga,
        CD_DONO: cdDono,
        NM_DESCRICAO: carga.NM_DESCRICAO,
      },
      totais: {
        qtdNfes: 0,
        qtdParadas: 0,
        qtdUnidades: 0,
        pesoKg: 0,
        pesoKgSeco: 0,
        pesoKgFrio: 0,
        qtdLinhas: 0,
        itensSemPeso: 0,
        pctCoberturaPeso: 100,
      },
      porDestino: [],
      porConservacao: {
        SECO_AMB: { pesoKg: 0, qtdUnidades: 0 },
        REFRIG_CONG: { pesoKg: 0, qtdUnidades: 0 },
      },
      aviso: 'Nenhuma NF-e vinculada à carga.',
    };
  }

  const setDonoNf = new Set();
  for (const n of nfes) {
    if (n.CD_DONO != null && Number.isFinite(Number(n.CD_DONO))) setDonoNf.add(Number(n.CD_DONO));
  }
  if (cdDono == null && setDonoNf.size === 1) cdDono = [...setDonoNf][0];

  const digitos = collectDigitosCargaNfe(nfes);
  const produtoPorDigitos = await carregarMapaProdutosDono(tenantId, cdDono, digitos);

  const porDestinoMap = new Map();
  const porConservacao = {
    SECO_AMB: { pesoKg: 0, qtdUnidades: 0 },
    REFRIG_CONG: { pesoKg: 0, qtdUnidades: 0 },
  };

  let qtdLinhas = 0;
  let itensSemPeso = 0;
  let linhasComPeso = 0;
  let pesoTotal = 0;
  let qtdUnidades = 0;

  for (const n of nfes) {
    const chDest = chaveDestinoNf(n);
    if (!porDestinoMap.has(chDest)) {
      porDestinoMap.set(chDest, {
        chaveDestino: chDest,
        uf: String(n.UF_DEST || '').trim().toUpperCase().slice(0, 2),
        municipio: String(n.XMUN_DEST || '').trim(),
        nmEntrega: nomeEntregaUnidadeOuLocalDestino(n),
        cnpjEntrega: String(n.CNPJ_ENTREGA || n.CNPJ_DEST || '').replace(/\D/g, '') || null,
        qtdNfes: 0,
        qtdUnidades: 0,
        pesoKg: 0,
        pesoKgSeco: 0,
        pesoKgFrio: 0,
        cdNfes: [],
      });
    }
    const dest = porDestinoMap.get(chDest);
    dest.qtdNfes += 1;
    if (n.CD_NFE_SAIDA != null) dest.cdNfes.push(Number(n.CD_NFE_SAIDA));

    const linhas = parseLinhasJson(n.LINHAS_JSON);
    for (const ln of linhas) {
      const cod = digitosCodigoOl(ln.cProd || ln.codigo || '');
      if (!cod) continue;
      const { qtd, peso, semPeso } = pesoLinhaKg(ln, produtoPorDigitos);
      if (qtd <= 0) continue;
      qtdLinhas += 1;
      qtdUnidades += qtd;
      dest.qtdUnidades += qtd;
      pesoTotal += peso;
      dest.pesoKg += peso;
      if (semPeso) itensSemPeso += 1;
      else linhasComPeso += 1;

      const bucket = bucketConservacaoLinha(ln, produtoPorDigitos);
      porConservacao[bucket].qtdUnidades += qtd;
      porConservacao[bucket].pesoKg += peso;
      if (bucket === 'REFRIG_CONG') dest.pesoKgFrio += peso;
      else dest.pesoKgSeco += peso;
    }
  }

  const paradasSet = new Set(nfes.map((n) => chaveDestinoNf(n)));
  const pctCoberturaPeso =
    qtdLinhas > 0 ? Math.round((100 * linhasComPeso) / qtdLinhas) : 100;

  const porDestino = Array.from(porDestinoMap.values()).sort((a, b) => {
    const ca = `${a.uf}|${a.municipio}`.localeCompare(`${b.uf}|${b.municipio}`, 'pt-BR');
    if (ca !== 0) return ca;
    return (a.nmEntrega || '').localeCompare(b.nmEntrega || '', 'pt-BR');
  });

  for (const d of porDestino) {
    d.pesoKg = Number(d.pesoKg.toFixed(3));
    d.pesoKgSeco = Number(d.pesoKgSeco.toFixed(3));
    d.pesoKgFrio = Number(d.pesoKgFrio.toFixed(3));
    d.qtdUnidades = Number(d.qtdUnidades.toFixed(4));
  }

  return {
    carga: {
      CD_CARGA: cdCarga,
      CD_DONO: cdDono,
      NM_DESCRICAO: carga.NM_DESCRICAO,
      qtdDonosNf: setDonoNf.size,
    },
    totais: {
      qtdNfes: nfes.length,
      qtdParadas: paradasSet.size,
      qtdUnidades: Number(qtdUnidades.toFixed(4)),
      pesoKg: Number(pesoTotal.toFixed(3)),
      pesoKgSeco: Number(porConservacao.SECO_AMB.pesoKg.toFixed(3)),
      pesoKgFrio: Number(porConservacao.REFRIG_CONG.pesoKg.toFixed(3)),
      qtdLinhas,
      itensSemPeso,
      pctCoberturaPeso,
    },
    porDestino,
    porConservacao: {
      SECO_AMB: {
        pesoKg: Number(porConservacao.SECO_AMB.pesoKg.toFixed(3)),
        qtdUnidades: Number(porConservacao.SECO_AMB.qtdUnidades.toFixed(4)),
      },
      REFRIG_CONG: {
        pesoKg: Number(porConservacao.REFRIG_CONG.pesoKg.toFixed(3)),
        qtdUnidades: Number(porConservacao.REFRIG_CONG.qtdUnidades.toFixed(4)),
      },
    },
    legenda: {
      qtdUnidades:
        'Soma das quantidades (qCom) das linhas das NF-e — equivalente ao “vol.” do romaneio; não é palete nem m³.',
      pesoKg:
        'PESO_KG do cadastro WMS × quantidade por linha da NF (igual ao «Resumo programação»). Romaneio filtrado por destino mostra peso parcial.',
      conservacao: 'NCM + TIPO_ARMAZENAGEM + descrição do produto (mesma regra do romaneio).',
    },
  };
}

module.exports = {
  montarResumoLogisticoCarga,
  chaveDestinoNf,
  bucketConservacaoLinha,
  pesoLinhaKg,
};
