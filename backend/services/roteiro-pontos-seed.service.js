// Cria automaticamente os dois primeiros pontos (origem / destino) em ROTEIROPONTOS
// com base nas cidades do roteiro e geocodificação Nominatim (mesma ideia da API /cidades/coordenadas).

const axios = require('axios');
const sql = require('../config/mssql-compat');
const { getForwardGeocodingUrl } = require('../config/nominatim');
const { getFirstNumericValue } = require('../config/db');

const ESTADOS_BRASIL = [
  { uf: 'AC', nome: 'Acre' }, { uf: 'AL', nome: 'Alagoas' }, { uf: 'AP', nome: 'Amapá' },
  { uf: 'AM', nome: 'Amazonas' }, { uf: 'BA', nome: 'Bahia' }, { uf: 'CE', nome: 'Ceará' },
  { uf: 'DF', nome: 'Distrito Federal' }, { uf: 'ES', nome: 'Espírito Santo' }, { uf: 'GO', nome: 'Goiás' },
  { uf: 'MA', nome: 'Maranhão' }, { uf: 'MT', nome: 'Mato Grosso' }, { uf: 'MS', nome: 'Mato Grosso do Sul' },
  { uf: 'MG', nome: 'Minas Gerais' }, { uf: 'PA', nome: 'Pará' }, { uf: 'PB', nome: 'Paraíba' },
  { uf: 'PR', nome: 'Paraná' }, { uf: 'PE', nome: 'Pernambuco' }, { uf: 'PI', nome: 'Piauí' },
  { uf: 'RJ', nome: 'Rio de Janeiro' }, { uf: 'RN', nome: 'Rio Grande do Norte' }, { uf: 'RS', nome: 'Rio Grande do Sul' },
  { uf: 'RO', nome: 'Rondônia' }, { uf: 'RR', nome: 'Roraima' }, { uf: 'SC', nome: 'Santa Catarina' },
  { uf: 'SP', nome: 'São Paulo' }, { uf: 'SE', nome: 'Sergipe' }, { uf: 'TO', nome: 'Tocantins' }
];

function nomeEstadoPorUF(uf) {
  const u = String(uf || '').trim().toUpperCase();
  const e = ESTADOS_BRASIL.find((x) => x.uf === u);
  return e ? e.nome : String(uf || '').trim();
}

function getRow(r, key) {
  if (!r || typeof r !== 'object') return undefined;
  if (r[key] !== undefined && r[key] !== null) return r[key];
  const lower = key.toLowerCase();
  if (r[lower] !== undefined && r[lower] !== null) return r[lower];
  return r[key];
}

async function loadCidade(pool, cdcidade) {
  const id = parseInt(cdcidade, 10);
  if (!Number.isFinite(id)) return null;
  const r = await pool
    .request()
    .input('ID', sql.Int, id)
    .query(`
      SELECT [NMCIDADE], [ESTADO], [CDPAIS]
      FROM [dbo].[CIDADE]
      WHERE [CDCIDADE] = @ID
    `);
  if (!r.recordset || !r.recordset.length) return null;
  const row = r.recordset[0];
  return {
    NMCIDADE: String(getRow(row, 'NMCIDADE') || '').trim(),
    ESTADO: String(getRow(row, 'ESTADO') || '').trim(),
    CDPAIS: getRow(row, 'CDPAIS')
  };
}

async function resolveNomePais(pool, cdPais) {
  if (cdPais == null || cdPais === '') return '';
  const p = parseInt(cdPais, 10);
  if (!Number.isFinite(p)) return '';
  try {
    const r = await pool
      .request()
      .input('p', sql.SmallInt, p)
      .query(`SELECT [DSPAIS] FROM [dbo].[PAIS] WHERE [CDPAIS] = @p`);
    if (r.recordset && r.recordset[0]) {
      return String(getRow(r.recordset[0], 'DSPAIS') || '').trim();
    }
  } catch (_) { /* ignore */ }
  return '';
}

async function geocodeCidade(pool, nmcidade, estadoUF, cdPais) {
  const city = String(nmcidade || '').trim();
  const uf = String(estadoUF || '').trim();
  if (!city || !uf) return { lat: null, lon: null, display_name: null };

  const nomeEstado = nomeEstadoPorUF(uf);
  const isBrasil = ESTADOS_BRASIL.some((e) => e.uf === uf.toUpperCase());

  let url;
  if (isBrasil) {
    const q = `${city}, ${nomeEstado}, Brasil`;
    url = getForwardGeocodingUrl(q, { limit: 8, countrycodes: 'br' });
  } else {
    const paisNome = await resolveNomePais(pool, cdPais);
    const q = paisNome ? `${city}, ${uf}, ${paisNome}` : `${city}, ${uf}`;
    url = getForwardGeocodingUrl(q, { limit: 8 });
  }

  let data;
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': 'AtlasCargo-RoteiroPontosSeed/1.0' },
      timeout: 15000
    });
    data = Array.isArray(res.data) ? res.data : [];
  } catch (err) {
    console.warn('[RoteiroPontosSeed] Nominatim falhou:', err.message);
    return { lat: null, lon: null, display_name: null };
  }

  const pick = data.find((x) => x && x.lat != null && x.lon != null) || null;
  if (!pick) return { lat: null, lon: null, display_name: null };
  return {
    lat: parseFloat(pick.lat),
    lon: parseFloat(pick.lon),
    display_name: pick.display_name ? String(pick.display_name) : null
  };
}

async function countPontosRoteiro(pool, idRoteiro) {
  const r = await pool
    .request()
    .input('ID', sql.Decimal(15, 0), parseFloat(idRoteiro))
    .query(`SELECT COUNT(*) AS [cnt] FROM [dbo].[ROTEIROPONTOS] WHERE [IDROTEIRO] = @ID`);
  return getFirstNumericValue(r.recordset, 0);
}

async function insertPonto(pool, idRoteiro, sequencia, ordem, row) {
  const dslocal = String(row.DSLOCAL || '').substring(0, 100);
  const dsposicao = String(row.DSPOSICAO || '').substring(0, 100);
  const tplocal = row.TPLOCAL ? String(row.TPLOCAL).toUpperCase().substring(0, 2) : null;
  const est = row.ESTADOPASSAGEM ? String(row.ESTADOPASSAGEM).toUpperCase().substring(0, 3) : null;
  await pool
    .request()
    .input('IDROTEIRO', sql.Decimal(15, 0), parseFloat(idRoteiro))
    .input('SEQUENCIA', sql.SmallInt, sequencia)
    .input('ORDEM', sql.SmallInt, ordem)
    .input('DSLOCAL', dslocal)
    .input('DSPOSICAO', dsposicao)
    .input('LATITUDE', row.LATITUDE != null ? parseFloat(row.LATITUDE) : null)
    .input('LONGITUDE', row.LONGITUDE != null ? parseFloat(row.LONGITUDE) : null)
    .input('TPLOCAL', tplocal)
    .input('KMENTREPONTOS', null)
    .input('CDPAISPASSAGEM', row.CDPAISPASSAGEM != null ? parseInt(row.CDPAISPASSAGEM, 10) : null)
    .input('ESTADOPASSAGEM', est)
    .query(`
      INSERT INTO [dbo].[ROTEIROPONTOS] (
        [IDROTEIRO], [SEQUENCIA], [ORDEM], [DSLOCAL], [DSPOSICAO],
        [LATITUDE], [LONGITUDE], [TPLOCAL], [KMENTREPONTOS],
        [CDPAISPASSAGEM], [ESTADOPASSAGEM],
        [DHMAINTENANCE], [SGUSER], [SERVERORIG]
      )
      VALUES (
        @IDROTEIRO, @SEQUENCIA, @ORDEM, @DSLOCAL, @DSPOSICAO,
        @LATITUDE, @LONGITUDE, @TPLOCAL, @KMENTREPONTOS,
        @CDPAISPASSAGEM, @ESTADOPASSAGEM,
        GETDATE(), 'SYSTEM', 'AppDVcargas'
      )
    `);
}

/**
 * Se o roteiro ainda não tiver pontos, insere origem (ORDEM 1, TPLOCAL O) e destino (ORDEM 100, TPLOCAL D).
 * @returns {{ seeded: boolean, reason?: string }}
 */
async function seedOrigemDestinoSeVazio(pool, idRoteiro, cdcidadeOrigem, cdcidadeDestino) {
  const id = parseFloat(idRoteiro);
  if (!Number.isFinite(id) || id <= 0) return { seeded: false, reason: 'invalid_id' };

  const n = await countPontosRoteiro(pool, id);
  if (n > 0) return { seeded: false, reason: 'already_has_points' };

  const origem = await loadCidade(pool, cdcidadeOrigem);
  const destino = await loadCidade(pool, cdcidadeDestino);
  if (!origem || !destino || !origem.NMCIDADE || !destino.NMCIDADE) {
    return { seeded: false, reason: 'city_not_found' };
  }

  const [go, gd] = await Promise.all([
    geocodeCidade(pool, origem.NMCIDADE, origem.ESTADO, origem.CDPAIS),
    geocodeCidade(pool, destino.NMCIDADE, destino.ESTADO, destino.CDPAIS)
  ]);

  const dspOrigem = `${origem.NMCIDADE}/${origem.ESTADO}`.substring(0, 100);
  const dspDest = `${destino.NMCIDADE}/${destino.ESTADO}`.substring(0, 100);

  const paisO = origem.CDPAIS != null ? parseInt(origem.CDPAIS, 10) : null;
  const paisD = destino.CDPAIS != null ? parseInt(destino.CDPAIS, 10) : null;

  await insertPonto(pool, id, 1, 1, {
    DSLOCAL: origem.NMCIDADE.substring(0, 100),
    DSPOSICAO: dspOrigem,
    LATITUDE: Number.isFinite(go.lat) ? go.lat : null,
    LONGITUDE: Number.isFinite(go.lon) ? go.lon : null,
    TPLOCAL: 'O',
    CDPAISPASSAGEM: Number.isFinite(paisO) ? paisO : null,
    ESTADOPASSAGEM: origem.ESTADO || null
  });

  await insertPonto(pool, id, 2, 100, {
    DSLOCAL: destino.NMCIDADE.substring(0, 100),
    DSPOSICAO: dspDest,
    LATITUDE: Number.isFinite(gd.lat) ? gd.lat : null,
    LONGITUDE: Number.isFinite(gd.lon) ? gd.lon : null,
    TPLOCAL: 'D',
    CDPAISPASSAGEM: Number.isFinite(paisD) ? paisD : null,
    ESTADOPASSAGEM: destino.ESTADO || null
  });

  return { seeded: true };
}

module.exports = {
  seedOrigemDestinoSeVazio,
  countPontosRoteiro
};
