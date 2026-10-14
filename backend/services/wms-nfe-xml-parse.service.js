'use strict';

const { XMLParser } = require('fast-xml-parser');

function digits(v) {
  return v != null ? String(v).replace(/\D/g, '') : '';
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** CPF (até 11 dígitos) ou CNPJ (12–14): completa zeros à esquerda. */
function normDocFiscal(v) {
  const x = digits(v);
  if (!x) return null;
  if (x.length <= 11) return x.padStart(11, '0').slice(-11);
  if (x.length > 14) return x.slice(-14);
  return x.padStart(14, '0');
}

/**
 * Extrai infNFe de NF-e 3.x/4.x (estrutura comum nfeProc/NFe ou NFe raiz).
 */
function extractInfNFe(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const proc = parsed.nfeProc || parsed.NFeProc;
  const nfe = (proc && (proc.NFe || proc.nfe)) || parsed.NFe || parsed.nfe;
  if (!nfe || typeof nfe !== 'object') return null;
  const inf = nfe.infNFe || nfe.InfNFe;
  return inf && typeof inf === 'object' ? inf : null;
}

/**
 * Parse mínimo de NF-e para WMS (entrada ou saída): chave, cabeçalho, linhas de produto.
 * @returns {{ err: string } | { ok: object }}
 */
function parseNfeXml(xmlString) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
  });
  const parsed = parser.parse(xmlString);
  const inf = extractInfNFe(parsed);
  if (!inf) {
    return { err: 'XML não reconhecido como NF-e (infNFe ausente).' };
  }
  const ide = inf.ide || {};
  const emit = inf.emit || {};
  const enderEmit = emit.enderEmit || {};
  const dest = inf.dest || {};
  const entrega = inf.entrega || {};
  const enderDest = dest.enderDest || {};
  const entregaAddr = {
    xLgr: entrega.xLgr || enderDest.xLgr || '',
    nro: entrega.nro || enderDest.nro || '',
    xCpl: entrega.xCpl || enderDest.xCpl || '',
    xBairro: entrega.xBairro || enderDest.xBairro || '',
    xMun: entrega.xMun || enderDest.xMun || '',
    UF: entrega.UF || enderDest.UF || '',
    CEP: entrega.CEP || enderDest.CEP || '',
  };
  const idRaw = inf['@_Id'] != null ? String(inf['@_Id']).trim() : '';
  const dch = digits(idRaw);
  const ch44 = dch.length >= 44 ? dch.slice(-44) : dch.length === 44 ? dch : null;
  if (!ch44) {
    return { err: 'Chave da NF-e (Id em infNFe) inválida ou ausente.' };
  }
  const dets = asArray(inf.det);
  const linhas = dets.map((det, idx) => {
    const nItem = det['@_nItem'] != null ? String(det['@_nItem']) : String(idx + 1);
    const prod = det.prod || {};
    return {
      nItem,
      cProd: prod.cProd != null ? String(prod.cProd) : '',
      xProd: prod.xProd != null ? String(prod.xProd) : '',
      NCM: prod.NCM != null ? String(prod.NCM) : '',
      CFOP: prod.CFOP != null ? String(prod.CFOP) : '',
      vProd: prod.vProd != null ? String(prod.vProd) : '',
      vUnCom: prod.vUnCom != null ? String(prod.vUnCom) : '',
      qCom: prod.qCom != null ? String(prod.qCom) : '',
      uCom: prod.uCom != null ? String(prod.uCom) : '',
      qTrib: prod.qTrib != null ? String(prod.qTrib) : '',
      uTrib: prod.uTrib != null ? String(prod.uTrib) : '',
      xPed: prod.xPed != null ? String(prod.xPed) : '',
      nItemPed: prod.nItemPed != null ? String(prod.nItemPed) : '',
      cEAN: prod.cEAN != null ? String(prod.cEAN) : '',
      cEANTrib: prod.cEANTrib != null ? String(prod.cEANTrib) : '',
    };
  });
  const dhEmi = ide.dhEmi || ide.DhEmi;
  let dhEmissao = null;
  if (dhEmi) {
    const d = new Date(String(dhEmi));
    if (!Number.isNaN(d.getTime())) dhEmissao = d.toISOString();
  }
  const dhSaida = parseDhSaidaNfeIde(ide);
  const tot = inf.total || inf.Total || {};
  const icmsTot = tot.ICMSTot || tot.icmsTot || {};
  const vnfRaw = icmsTot.vNF != null ? icmsTot.vNF : icmsTot.VNF;
  let vnfTotal = null;
  if (vnfRaw != null && String(vnfRaw).trim() !== '') {
    const vn = Number(String(vnfRaw).replace(',', '.'));
    if (Number.isFinite(vn)) vnfTotal = vn;
  }
  return {
    ok: {
      chave: ch44,
      numero_nf: ide.nNF != null ? String(ide.nNF) : '',
      serie: ide.serie != null ? String(ide.serie) : '',
      dh_emissao: dhEmissao,
      dh_saida: dhSaida,
      cnpj_emitente: normDocFiscal(emit.CNPJ || emit.CPF),
      xnome_emit: emit.xNome != null ? String(emit.xNome).slice(0, 255) : '',
      xmun_emit: enderEmit.xMun != null ? String(enderEmit.xMun).slice(0, 120) : '',
      uf_emit: enderEmit.UF != null ? String(enderEmit.UF).slice(0, 2) : '',
      cnpj_dest: normDocFiscal(dest.CNPJ || dest.CPF),
      xnome_dest: dest.xNome != null ? String(dest.xNome).slice(0, 255) : '',
      cnpj_entrega: normDocFiscal(entrega.CNPJ || entrega.CPF),
      xnome_entrega: entrega.xNome != null ? String(entrega.xNome).slice(0, 255) : '',
      xlgr_dest: entregaAddr.xLgr != null ? String(entregaAddr.xLgr).slice(0, 255) : '',
      nro_dest: entregaAddr.nro != null ? String(entregaAddr.nro).slice(0, 20) : '',
      xcpl_dest: entregaAddr.xCpl != null ? String(entregaAddr.xCpl).slice(0, 120) : '',
      xbairro_dest: entregaAddr.xBairro != null ? String(entregaAddr.xBairro).slice(0, 120) : '',
      xmun_dest: entregaAddr.xMun != null ? String(entregaAddr.xMun).slice(0, 120) : '',
      uf_dest: entregaAddr.UF != null ? String(entregaAddr.UF).slice(0, 2) : '',
      cep_dest: digits(entregaAddr.CEP || '').slice(0, 8) || '',
      email_entrega: entrega.email != null ? String(entrega.email).trim().slice(0, 120) : '',
      q_itens: linhas.length,
      linhas_json: linhas,
      vnf_total: vnfTotal,
    },
  };
}

/** Data/hora de saída da mercadoria (ide.dSaiEnt + hSaiEnt ou ide.dhSaiEnt). */
function parseDhSaidaNfeIde(ide) {
  if (!ide || typeof ide !== 'object') return null;
  const dhSaiEnt = ide.dhSaiEnt || ide.DhSaiEnt;
  if (dhSaiEnt) {
    const d = new Date(String(dhSaiEnt));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  const dSai = ide.dSaiEnt || ide.DSaiEnt;
  if (dSai) {
    const hSai = ide.hSaiEnt || ide.HSaiEnt || '00:00:00';
    const ds = String(dSai).trim();
    const hs = String(hSai).trim();
    const combined = hs.includes('T') ? `${ds}T${hs}` : `${ds}T${hs}`;
    const d = new Date(combined);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

module.exports = {
  parseNfeXml,
  parseDhSaidaNfeIde,
  extractInfNFe,
  digits,
  asArray,
  normDocFiscal,
};
