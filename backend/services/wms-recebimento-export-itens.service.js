'use strict';

const { pool } = require('../config/db');

function isSchemaMissingErr(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function normCodigoExterno(cProd) {
  if (cProd == null) return '';
  return String(cProd).trim();
}

function deparaLookupKeysFromCProd(cProd) {
  const raw = normCodigoExterno(cProd);
  if (!raw) return [];
  const keys = new Set([raw.toLowerCase()]);
  if (/^\d+$/.test(raw)) keys.add(String(parseInt(raw, 10)).toLowerCase());
  return [...keys];
}

function buildDeparaHitMap(rows) {
  const by = new Map();
  for (const d of rows || []) {
    const ex = String(d.CODIGO_EXTERNO ?? d.codigo_externo ?? '').trim();
    if (!ex) continue;
    const k = ex.toLowerCase();
    by.set(k, d);
    if (/^\d+$/.test(ex)) by.set(String(parseInt(ex, 10)).toLowerCase(), d);
  }
  return by;
}

function hitDeparaFromMap(byMap, cProd) {
  for (const k of deparaLookupKeysFromCProd(cProd)) {
    if (byMap.has(k)) return byMap.get(k);
  }
  return null;
}

function parseQtdNfe(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function normFator(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Fator e qtd convertida — mesma regra da conferência/encerramento NF-e.
 * Base: qtdRecebida da conferência; se ausente, quantidade do XML (fornecedor).
 */
function resolverFatorEQtdConvertida(conf, hitDepara, qtdForn) {
  const qtdConf =
    conf?.qtdRecebida != null && String(conf.qtdRecebida).trim() !== ''
      ? parseQtdNfe(conf.qtdRecebida)
      : null;
  const qtdBase = qtdConf != null ? qtdConf : qtdForn;

  let fator = normFator(conf?.fatorConversao);
  if (fator == null && hitDepara?.FATOR_CONVERSAO != null) {
    fator = normFator(hitDepara.FATOR_CONVERSAO);
  }
  if (fator == null) fator = 0;

  let qtdConvertida = null;
  if (conf?.qtdConvertida != null && String(conf.qtdConvertida).trim() !== '') {
    qtdConvertida = parseQtdNfe(conf.qtdConvertida);
  }
  if (qtdConvertida == null && qtdBase != null) {
    const fatorMult = fator === 0 ? 1 : fator;
    qtdConvertida = Number((qtdBase * fatorMult).toFixed(6));
  }

  const fatorExibir = fator === 0 ? 1 : fator;
  return { fatorExibir, qtdConvertida };
}

/** Quantidade para CSV Excel BR: separador de colunas `;` e decimal `,`. */
function formatQtdCsvBr(v) {
  if (v == null || v === '') return '';
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  if (!Number.isFinite(n)) return String(v).trim();
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  let s = n.toFixed(6);
  s = s.replace(/\.?0+$/, '');
  return s.replace('.', ',');
}

function csvCell(v) {
  const s = v == null ? '' : String(v);
  if (/[",;\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function formatDataBrFromIsoYmd(v) {
  const s = v == null ? '' : String(v).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatDataEntradaBr(row) {
  if (row.DT_RECEBIMENTO) return formatDataBrFromIsoYmd(row.DT_RECEBIMENTO);
  if (row.DH_ENCERRAMENTO) return formatDataBrFromIsoYmd(row.DH_ENCERRAMENTO);
  if (row.DH_CONFERENCIA) return formatDataBrFromIsoYmd(row.DH_CONFERENCIA);
  if (row.DH_IMPORTACAO) return formatDataBrFromIsoYmd(row.DH_IMPORTACAO);
  return '';
}

function formatCnpjCsv(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (!d) return '';
  return d;
}

function mapConferenciaPorItem(confJson) {
  const arr = Array.isArray(confJson) ? confJson : [];
  const m = new Map();
  for (const it of arr) {
    const n = String(it?.nItem ?? '').trim();
    if (n) m.set(n, it);
  }
  return m;
}

async function carregarProdutosDonoPorIds(tenantId, cdDono, cdProdutos) {
  const ids = [...new Set((cdProdutos || []).filter((x) => Number.isFinite(x) && x > 0))];
  if (!ids.length || !Number.isFinite(cdDono)) return new Map();
  try {
    const r = await pool.query(
      `SELECT "CD_PRODUTO", "CODIGO", TRIM("NOME") AS "NM_PRODUTO"
         FROM "WMS_PRODUTO_DONO"
        WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer AND "CD_PRODUTO" = ANY($3::int[])`,
      [tenantId, cdDono, ids]
    );
    const m = new Map();
    for (const row of r.rows || []) {
      m.set(Number(row.CD_PRODUTO), row);
    }
    return m;
  } catch (e) {
    if (isSchemaMissingErr(e)) return new Map();
    throw e;
  }
}

async function carregarProdutosDonoPorCodigos(tenantId, cdDono, codigos) {
  const cods = [...new Set((codigos || []).map((c) => String(c || '').trim()).filter(Boolean))];
  if (!cods.length || !Number.isFinite(cdDono)) return new Map();
  try {
    const r = await pool.query(
      `SELECT "CD_PRODUTO", "CODIGO", TRIM("NOME") AS "NM_PRODUTO"
         FROM "WMS_PRODUTO_DONO"
        WHERE "TENANT_ID" = $1 AND "CD_DONO" = $2::integer AND TRIM("CODIGO") = ANY($3::text[])`,
      [tenantId, cdDono, cods]
    );
    const m = new Map();
    for (const row of r.rows || []) {
      const cod = String(row.CODIGO || '').trim();
      if (cod) m.set(cod.toLowerCase(), row);
    }
    return m;
  } catch (e) {
    if (isSchemaMissingErr(e)) return new Map();
    throw e;
  }
}

async function carregarDeparaPorExternos(tenantId, cdDono, externosKeys) {
  const keys = [...new Set((externosKeys || []).map((k) => String(k || '').toLowerCase()).filter(Boolean))];
  if (!keys.length || !Number.isFinite(cdDono)) return new Map();
  try {
    const r = await pool.query(
      `SELECT "CODIGO_EXTERNO", "CODIGO_INTERNO", "FATOR_CONVERSAO", "FGACTIVE"
         FROM "WMS_DEPARA_PRODUTO"
        WHERE "TENANT_ID" = $1
          AND "CD_DONO" = $2::integer
          AND "FGACTIVE" = 'S'
          AND LOWER(TRIM("CODIGO_EXTERNO")) = ANY($3::text[])`,
      [tenantId, cdDono, keys]
    );
    return buildDeparaHitMap(r.rows || []);
  } catch (e) {
    if (isSchemaMissingErr(e)) return new Map();
    throw e;
  }
}

/** Produtos por (cdDono, cdProduto) e por (cdDono, codigo lower). */
async function carregarProdutosDonoLote(tenantId, porDonoIds, porDonoCodigos) {
  const merged = new Map();
  const byCodigo = new Map();
  for (const [cdDono, ids] of porDonoIds.entries()) {
    const m = await carregarProdutosDonoPorIds(tenantId, cdDono, [...ids]);
    for (const [k, v] of m.entries()) {
      merged.set(`${cdDono}:${k}`, v);
    }
  }
  for (const [cdDono, cods] of (porDonoCodigos || new Map()).entries()) {
    const m = await carregarProdutosDonoPorCodigos(tenantId, cdDono, [...cods]);
    for (const [k, v] of m.entries()) {
      byCodigo.set(`${cdDono}:${k}`, v);
    }
  }
  return { porId: merged, porCodigo: byCodigo };
}

/** De-para por cdDono (chave externa lower). */
async function carregarDeparaLote(tenantId, porDonoKeys) {
  const merged = new Map();
  for (const [cdDono, keys] of porDonoKeys.entries()) {
    const m = await carregarDeparaPorExternos(tenantId, cdDono, [...keys]);
    for (const [k, v] of m.entries()) {
      merged.set(`${cdDono}:${k}`, v);
    }
  }
  return merged;
}

/**
 * Uma linha CSV por item de LINHAS_JSON da NF-e de entrada.
 * @param {object[]} docs — linhas WMS_NFE_ENTRADA com LINHAS_JSON
 * @param {string} tenantId
 */
async function montarLinhasExportItensRecebimento(docs, tenantId) {
  const porDonoProdIds = new Map();
  const porDonoCodigos = new Map();
  const porDonoDepKeys = new Map();
  for (const doc of docs || []) {
    const cdDono = doc.CD_DONO != null ? Number(doc.CD_DONO) : NaN;
    if (!Number.isFinite(cdDono)) continue;
    const linhas = Array.isArray(doc.LINHAS_JSON) ? doc.LINHAS_JSON : [];
    const confMap = mapConferenciaPorItem(doc.CONFERENCIA_JSON);
    if (!porDonoProdIds.has(cdDono)) porDonoProdIds.set(cdDono, new Set());
    if (!porDonoCodigos.has(cdDono)) porDonoCodigos.set(cdDono, new Set());
    if (!porDonoDepKeys.has(cdDono)) porDonoDepKeys.set(cdDono, new Set());
    for (const c of confMap.values()) {
      const cd = c?.cdProduto != null ? parseInt(c.cdProduto, 10) : NaN;
      if (Number.isFinite(cd) && cd > 0) porDonoProdIds.get(cdDono).add(cd);
      const cod = c?.codigoProduto != null ? String(c.codigoProduto).trim() : '';
      if (cod) porDonoCodigos.get(cdDono).add(cod);
    }
    for (const linha of linhas) {
      for (const k of deparaLookupKeysFromCProd(linha?.cProd)) {
        porDonoDepKeys.get(cdDono).add(k);
      }
    }
  }
  const { porId: prodLote, porCodigo: prodPorCodigo } = await carregarProdutosDonoLote(
    tenantId,
    porDonoProdIds,
    porDonoCodigos
  );
  const deparaLote = await carregarDeparaLote(tenantId, porDonoDepKeys);

  const out = [];
  for (const doc of docs || []) {
    const linhas = Array.isArray(doc.LINHAS_JSON) ? doc.LINHAS_JSON : [];
    if (!linhas.length) continue;
    const confMap = mapConferenciaPorItem(doc.CONFERENCIA_JSON);
    const cdDono = doc.CD_DONO != null ? Number(doc.CD_DONO) : NaN;

    const dtEmissao = formatDataBrFromIsoYmd(doc.DH_EMISSAO);
    const dtEntrada = formatDataEntradaBr(doc);

    for (const linha of linhas) {
      const nItem = String(linha?.nItem ?? '').trim();
      const conf = nItem ? confMap.get(nItem) : null;
      let codigoProdDono = conf?.codigoProduto != null ? String(conf.codigoProduto).trim() : '';
      let nomeProdDono = '';
      const cdProd =
        conf?.cdProduto != null && String(conf.cdProduto).trim() !== ''
          ? parseInt(conf.cdProduto, 10)
          : NaN;
      if (Number.isFinite(cdDono) && Number.isFinite(cdProd)) {
        const p = prodLote.get(`${cdDono}:${cdProd}`);
        if (p) {
          if (!codigoProdDono && p.CODIGO) codigoProdDono = String(p.CODIGO).trim();
          nomeProdDono = String(p.NM_PRODUTO || '').trim();
        }
      }
      let hitDepara = null;
      if (Number.isFinite(cdDono)) {
        for (const k of deparaLookupKeysFromCProd(linha?.cProd)) {
          hitDepara = deparaLote.get(`${cdDono}:${k}`);
          if (hitDepara) break;
        }
        if (!codigoProdDono && hitDepara?.CODIGO_INTERNO) {
          codigoProdDono = String(hitDepara.CODIGO_INTERNO).trim();
        }
      }
      if (codigoProdDono && !nomeProdDono && Number.isFinite(cdDono)) {
        const pCod = prodPorCodigo.get(`${cdDono}:${codigoProdDono.toLowerCase()}`);
        if (pCod) nomeProdDono = String(pCod.NM_PRODUTO || '').trim();
      }

      const qtdForn = parseQtdNfe(linha?.qCom ?? linha?.qTrib);
      const { fatorExibir, qtdConvertida } = resolverFatorEQtdConvertida(conf, hitDepara, qtdForn);

      out.push({
        CNPJ_FORNECEDOR: formatCnpjCsv(doc.CNPJ_EMITENTE),
        RAZAO_FORNECEDOR: doc.XNOME_EMIT || '',
        CNPJ_DESTINATARIO: formatCnpjCsv(doc.CNPJ_DEST),
        RAZAO_DESTINATARIO: doc.XNOME_DEST || '',
        NUMERO_NF: doc.NUMERO_NF || '',
        DATA_EMISSAO: dtEmissao,
        CHAVE_NFE: doc.CHAVE_NFE || '',
        DATA_ENTRADA: dtEntrada,
        N_ITEM: nItem || (conf?.nItem != null ? String(conf.nItem).trim() : ''),
        COD_PROD_FORNECEDOR: normCodigoExterno(linha?.cProd),
        NOME_PROD_FORNECEDOR: linha?.xProd != null ? String(linha.xProd) : '',
        UNID_FORNECEDOR: linha?.uCom != null ? String(linha.uCom) : linha?.uTrib != null ? String(linha.uTrib) : '',
        QTD_FORNECEDOR: formatQtdCsvBr(qtdForn),
        FATOR_CONVERSAO: formatQtdCsvBr(fatorExibir),
        QTD_CONVERTIDA: formatQtdCsvBr(qtdConvertida),
        COD_PROD_DONO: codigoProdDono,
        NOME_PROD_DONO: nomeProdDono,
      });
    }
  }
  return out;
}

const COLUNAS_CSV = [
  { key: 'CNPJ_FORNECEDOR', header: 'CNPJ Fornecedor' },
  { key: 'RAZAO_FORNECEDOR', header: 'Razão Social Fornecedor' },
  { key: 'CNPJ_DESTINATARIO', header: 'CNPJ Destinatário' },
  { key: 'RAZAO_DESTINATARIO', header: 'Razão Social Destinatário' },
  { key: 'NUMERO_NF', header: 'Número NF' },
  { key: 'DATA_EMISSAO', header: 'Data emissão' },
  { key: 'CHAVE_NFE', header: 'Chave NF-e' },
  { key: 'DATA_ENTRADA', header: 'Data entrada' },
  { key: 'N_ITEM', header: 'Sequência item (NF-e)' },
  { key: 'COD_PROD_FORNECEDOR', header: 'Código produto (fornecedor)' },
  { key: 'NOME_PROD_FORNECEDOR', header: 'Nome produto (fornecedor)' },
  { key: 'UNID_FORNECEDOR', header: 'Unidade medida (fornecedor)' },
  { key: 'QTD_FORNECEDOR', header: 'Quantidade (fornecedor / NF-e)' },
  { key: 'FATOR_CONVERSAO', header: 'Fator conversão' },
  { key: 'QTD_CONVERTIDA', header: 'Quantidade convertida (estoque)' },
  { key: 'COD_PROD_DONO', header: 'Código produto (de-para / dono)' },
  { key: 'NOME_PROD_DONO', header: 'Nome produto (de-para / dono)' },
];

function linhasItensParaCsvBody(rows, metaLinhas) {
  const hdr = COLUNAS_CSV.map((c) => csvCell(c.header)).join(';');
  const body = (rows || [])
    .map((row) => COLUNAS_CSV.map((c) => csvCell(row[c.key])).join(';'))
    .join('\n');
  const meta = metaLinhas || [];
  return { hdr, body, meta };
}

module.exports = {
  montarLinhasExportItensRecebimento,
  linhasItensParaCsvBody,
  formatQtdCsvBr,
  csvCell,
  COLUNAS_CSV,
  resolverFatorEQtdConvertida,
  normFator,
};
