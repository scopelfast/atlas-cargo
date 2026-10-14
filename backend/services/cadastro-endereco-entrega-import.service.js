'use strict';

const XLSX = require('xlsx');
const crypto = require('crypto');

/** Cabeçalhos esperados no modelo Mana / Nutriville (Planilha1). */
const COL_ENUF = 'ENUF';
const COL_MUN = 'ENxMun';
const COL_CEP = 'ENCEP';
const COL_LGR = 'ENxLgr';
const COL_NRO = 'ENnro';
const COL_CNPJ = 'ENCNPJ';
const COL_NOME = 'ENxNome';
const COL_LL = 'ENLatLon';
const COL_ROTA = 'Rota';

const COLS_OBRIGATORIAS = [COL_ENUF, COL_MUN, COL_CEP, COL_LGR, COL_NRO, COL_CNPJ, COL_NOME, COL_LL, COL_ROTA];

function normKey(k) {
  return String(k == null ? '' : k).trim();
}

function rowGet(row, canonical) {
  const want = canonical.toLowerCase();
  const keys = Object.keys(row || {});
  for (let i = 0; i < keys.length; i++) {
    if (normKey(keys[i]).toLowerCase() === want) return row[keys[i]];
  }
  return '';
}

function onlyDigits(s) {
  return String(s == null ? '' : s).replace(/\D/g, '');
}

/**
 * Alinha número entre NF-e (ex.: "N.181") e planilha/cadastro ("181").
 * Usado na CHAVE_IMPORT para match estável.
 */
function normalizeNumeroEntregaMatch(raw) {
  let s = String(raw == null ? '' : raw)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '');
  if (!s || s === 'S/N' || s === 'SN' || s === '-' || s === '.') return 'SN';
  s = s.replace(/^N\./i, '');
  s = s.replace(/^N[°º]/i, '');
  if (!s || s === 'S/N' || s === 'SN') return 'SN';
  const t = s.replace(/[^A-Z0-9]/g, '');
  return t || 'SN';
}

function parseLatLon(s) {
  const raw = String(s == null ? '' : s).trim();
  if (!raw) return { lat: null, lon: null, erro: 'Coordenadas vazias.' };
  const parts = raw.split(',').map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return { lat: null, lon: null, erro: 'Use o formato latitude, longitude (vírgula).' };
  const lat = Number(parts[0]);
  const lon = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { lat: null, lon: null, erro: 'Latitude ou longitude não numérica.' };
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return { lat: null, lon: null, erro: 'Coordenadas fora da faixa válida.' };
  }
  return { lat, lon, erro: null };
}

function buildChaveImport(tenantId, cnpj, ponto, log, num, cep) {
  const h = crypto.createHash('sha256');
  h.update(
    [
      String(tenantId || '').trim(),
      String(cnpj || '').trim(),
      String(ponto || '').trim(),
      String(log || '').trim(),
      normalizeNumeroEntregaMatch(num),
      String(cep || '').trim(),
    ].join('|')
  );
  return h.digest('hex').substring(0, 64);
}

/**
 * Lê buffer .xlsx (aba Planilha1 ou primeira aba).
 * @returns {{ erro: string|null, linhas: object[] }}
 */
function parseEnderecosEntregaXlsx(buffer) {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames.includes('Planilha1') ? 'Planilha1' : wb.SheetNames[0];
    if (!sheetName) return { erro: 'Arquivo sem abas.', linhas: [] };
    const sh = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sh, { defval: '', raw: false });
    if (!rows.length) return { erro: 'Planilha vazia.', linhas: [] };
    const first = rows[0];
    const keys = Object.keys(first || {});
    const missing = [];
    for (let c = 0; c < COLS_OBRIGATORIAS.length; c++) {
      const col = COLS_OBRIGATORIAS[c];
      const ok = keys.some((k) => normKey(k).toLowerCase() === col.toLowerCase());
      if (!ok) missing.push(col);
    }
    if (missing.length) {
      return { erro: `Colunas obrigatórias ausentes: ${missing.join(', ')}.`, linhas: [] };
    }
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const cnpj = onlyDigits(rowGet(row, COL_CNPJ));
      if (!cnpj || cnpj.length < 11) continue;
      const ufRaw = String(rowGet(row, COL_ENUF) || '').trim().toUpperCase();
      const uf = ufRaw.substring(0, 2);
      const ufErro = /^[A-Z]{2}$/.test(uf) ? null : 'UF inválida: use 2 letras (ex.: SC).';
      const municipio = String(rowGet(row, COL_MUN) || '').trim();
      const cep = onlyDigits(rowGet(row, COL_CEP));
      const logradouro = String(rowGet(row, COL_LGR) || '').trim();
      let numero = String(rowGet(row, COL_NRO) == null ? '' : rowGet(row, COL_NRO)).trim();
      if (numero === '.' || numero === '-' || numero === '') numero = 'S/N';
      const dsPonto = String(rowGet(row, COL_NOME) || '').trim();
      const ll = rowGet(row, COL_LL);
      const rotaRaw = rowGet(row, COL_ROTA);
      const nrRota = rotaRaw === '' || rotaRaw == null ? null : parseInt(String(rotaRaw).replace(/\D/g, ''), 10);
      const geo = parseLatLon(ll);
      out.push({
        linhaPlanilha: i + 2,
        uf,
        municipio,
        cep,
        logradouro,
        numero,
        cnpj,
        dsPonto,
        latLonTexto: String(ll || '').trim(),
        latitude: geo.lat,
        longitude: geo.lon,
        geoErro: geo.erro || null,
        ufErro,
        nrRota: Number.isFinite(nrRota) ? nrRota : null,
      });
    }
    return { erro: null, linhas: out };
  } catch (e) {
    return { erro: e.message || 'Falha ao ler Excel.', linhas: [] };
  }
}

module.exports = {
  parseEnderecosEntregaXlsx,
  parseLatLon,
  normalizeNumeroEntregaMatch,
  buildChaveImport,
  onlyDigits,
  COLS_OBRIGATORIAS,
};
