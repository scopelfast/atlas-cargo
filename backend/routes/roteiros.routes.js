// backend/routes/roteiros.routes.js
// Gerenciar Roteiros - API
// Versão: 1.3
// Atlas Cargo
// Data: 2026-01-13
// Última atualização: Adicionado suporte ao campo RESUMOROTA

const express = require('express');
const sql = require('../config/mssql-compat');
const router = express.Router();
const { poolPromise, getFirstNumericValue, createTransaction } = require('../config/db');
const axios = require('axios');
const { getReverseGeocodingUrl } = require('../config/nominatim');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');
const { tenantIdForRequest } = require('../utils/tenant-context');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const { seedOrigemDestinoSeVazio } = require('../services/roteiro-pontos-seed.service');
const { fetchRouteResumoSegment } = require('../services/mapa-rota-fetch.service');

function toNullableNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

router.use(towerAuthAndTenant);

/** Retorna { ok, tenantIdDb } | { error: 'not_found' } | { error: 'forbidden_catalog' } */
async function assertRoteiroAcesso(pool, idRoteiro, req, { exigeMutacao }) {
  const tidReq = tenantIdForRequest(req);
  const result = await pool
    .request()
    .input('IDROTEIRO', sql.Decimal(15, 0), parseFloat(idRoteiro))
    .query(`SELECT [TENANT_ID] AS tdb FROM [dbo].[ROTEIRO] WHERE [IDROTEIRO] = @IDROTEIRO`);
  if (!result.recordset.length) return { error: 'not_found' };
  const row = result.recordset[0];
  let tenantIdDb = row.tdb != null && String(row.tdb).trim() !== '' ? String(row.tdb).trim() : '';
  if (!tenantIdDb) {
    const alt = row.TENANT_ID != null ? row.TENANT_ID : row.tenant_id;
    if (alt != null && String(alt).trim() !== '') tenantIdDb = String(alt).trim();
  }
  if (!tenantIdDb) tenantIdDb = getDefaultTenantId();
  const visivel = tenantIdDb === 'default' || tenantIdDb === String(tidReq);
  if (!visivel) return { error: 'not_found' };
  // Mutação só no roteiro do próprio tenant (inclui TENANT_ID = default para usuário default).
  // Não usar "tenantIdDb === 'default' → bloquear": isso impedia o dono da instalação padrão de editar/gerar resumo.
  if (exigeMutacao && String(tenantIdDb) !== String(tidReq)) {
    return { error: 'forbidden_catalog' };
  }
  return { ok: true, tenantIdDb };
}

// Mapeamento de nomes de estados para UF
const ESTADOS_PARA_UF = {
  'Acre': 'AC',
  'Alagoas': 'AL',
  'Amapá': 'AP',
  'Amazonas': 'AM',
  'Bahia': 'BA',
  'Ceará': 'CE',
  'Distrito Federal': 'DF',
  'Espírito Santo': 'ES',
  'Goiás': 'GO',
  'Maranhão': 'MA',
  'Mato Grosso': 'MT',
  'Mato Grosso do Sul': 'MS',
  'Minas Gerais': 'MG',
  'Pará': 'PA',
  'Paraíba': 'PB',
  'Paraná': 'PR',
  'Pernambuco': 'PE',
  'Piauí': 'PI',
  'Rio de Janeiro': 'RJ',
  'Rio Grande do Norte': 'RN',
  'Rio Grande do Sul': 'RS',
  'Rondônia': 'RO',
  'Roraima': 'RR',
  'Santa Catarina': 'SC',
  'São Paulo': 'SP',
  'Sergipe': 'SE',
  'Tocantins': 'TO'
};

// Função para converter nome de estado para UF
function converterEstadoParaUF(estado) {
  if (!estado) return '';
  
  // Se já é uma UF (2 letras), retornar como está
  if (estado.length === 2 && /^[A-Z]{2}$/i.test(estado)) {
    return estado.toUpperCase();
  }
  
  // Buscar no mapeamento
  const estadoNormalizado = estado.trim();
  const uf = ESTADOS_PARA_UF[estadoNormalizado];
  
  if (uf) {
    return uf;
  }
  
  // Tentar busca case-insensitive
  for (const [nome, sigla] of Object.entries(ESTADOS_PARA_UF)) {
    if (nome.toLowerCase() === estadoNormalizado.toLowerCase()) {
      return sigla;
    }
  }
  
  // Se não encontrou, retornar o original (pode ser uma UF não mapeada)
  return estado;
}

// Helper: PostgreSQL retorna colunas em minúsculas; ler com qualquer casing
function getRow(r, key) {
  if (r[key] !== undefined && r[key] !== null) return r[key];
  const lower = key.toLowerCase();
  if (r[lower] !== undefined && r[lower] !== null) return r[lower];
  return r[key];
}

// Função para formatar cidade com UF (converte nome de estado para UF se necessário)
function formatarCidadeComUF(cidade, estado) {
  if (!cidade) return '';
  
  // Limpar cidade primeiro: remover vírgulas, pontos e estados que possam estar no nome
  let cidadeLimpa = cidade.trim()
    .replace(/,\s*[A-Z]{2}$/i, '') // Remove ",SP", ",MG", etc do final
    .replace(/\.\s*[A-Z]{2}$/i, '') // Remove ".SP", ".MG", etc do final
    .replace(/\s+[A-Z]{2}$/i, '') // Remove " SP", " MG", etc do final
    .replace(/,\s*[A-Za-z\s]+$/i, '') // Remove vírgulas e texto após
    .trim();
  
  // Se a cidade já vem no formato "Cidade/Estado", converter o estado para UF
  if (cidadeLimpa.includes('/')) {
    const partes = cidadeLimpa.split('/');
    const nomeCidade = partes[0].trim();
    const estadoNome = partes[1]?.trim() || estado;
    const uf = converterEstadoParaUF(estadoNome);
    return uf ? `${nomeCidade}/${uf}` : nomeCidade;
  }
  
  // Se não tem estado na cidade, usar o estado fornecido
  const uf = converterEstadoParaUF(estado);
  return uf ? `${cidadeLimpa}/${uf}` : cidadeLimpa;
}

function nomeCidadeBaseFmt(s) {
  if (!s) return '';
  return String(s).split('/')[0].trim().toLowerCase();
}

/** Extrai [lon,lat][] da geometria OSRM/GeoJSON da rota. */
function extrairCoordsGeometriaRota(route) {
  const g = route && route.geometry;
  if (!g || !g.coordinates || !Array.isArray(g.coordinates)) return [];
  const c = g.coordinates;
  if (g.type === 'LineString') return c.length >= 2 ? c : [];
  if (g.type === 'MultiLineString') {
    const flat = [];
    for (const ring of c) {
      if (Array.isArray(ring)) flat.push(...ring);
    }
    return flat.length >= 2 ? flat : [];
  }
  if (Array.isArray(c[0]) && typeof c[0][0] === 'number') return c.length >= 2 ? c : [];
  return [];
}

function distanciaKm(lon1, lat1, lon2, lat2) {
  const R = 6371;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function comprimentoPolilinhaKm(coords) {
  let t = 0;
  for (let i = 1; i < coords.length; i++) {
    t += distanciaKm(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
  }
  return t;
}

/** Ponto [lon,lat] na polilinha após percorrer ~`kmGeo` km ao longo dos vértices. */
function pontoAoLongoPolilinha(coords, kmGeo) {
  if (!coords || coords.length < 2 || kmGeo <= 0) {
    const p0 = coords && coords[0];
    return p0 ? [p0[0], p0[1]] : null;
  }
  let restante = kmGeo;
  for (let i = 1; i < coords.length; i++) {
    const [lon0, lat0] = coords[i - 1];
    const [lon1, lat1] = coords[i];
    const seg = distanciaKm(lon0, lat0, lon1, lat1);
    if (seg < 1e-9) continue;
    if (restante <= seg) {
      const t = restante / seg;
      return [lon0 + t * (lon1 - lon0), lat0 + t * (lat1 - lat0)];
    }
    restante -= seg;
  }
  const last = coords[coords.length - 1];
  return [last[0], last[1]];
}

/** Projeção escalar de (px,py) no segmento [x0,y0]-[x1,y1] em graus (trechos curtos PR). */
function projectTOnSegmentLonLat(x0, y0, x1, y1, px, py) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return 0;
  let t = ((px - x0) * dx + (py - y0) * dy) / len2;
  return Math.max(0, Math.min(1, t));
}

/** Km acumulados ao longo da polilinha até o ponto da malha mais próximo de (lon,lat). */
function kmAoLongoAteProjecao(coords, lon, lat) {
  if (!coords || coords.length < 2) return 0;
  let bestDist = Infinity;
  let bestAccum = 0;
  let accum = 0;
  for (let i = 1; i < coords.length; i++) {
    const [x0, y0] = coords[i - 1];
    const [x1, y1] = coords[i];
    const segLen = distanciaKm(x0, y0, x1, y1);
    if (segLen < 1e-9) continue;
    const t = projectTOnSegmentLonLat(x0, y0, x1, y1, lon, lat);
    const mx = x0 + t * (x1 - x0);
    const my = y0 + t * (y1 - y0);
    const d = distanciaKm(mx, my, lon, lat);
    if (d < bestDist) {
      bestDist = d;
      bestAccum = accum + t * segLen;
    }
    accum += segLen;
  }
  return bestAccum;
}

async function nominatimCidadeFormatada(lat, lon) {
  try {
    const nominatimUrl = getReverseGeocodingUrl(lat, lon);
    const nomResponse = await axios.get(nominatimUrl, {
      headers: { 'User-Agent': 'AtlasCargo/2.0' },
      timeout: 8000,
    });
    const info = nomResponse.data;
    let cidade =
      info.address?.city ||
      info.address?.town ||
      info.address?.village ||
      info.address?.municipality ||
      info.address?.county ||
      '';
    if (cidade) {
      cidade = cidade
        .trim()
        .replace(/,\s*[A-Z]{2}$/i, '')
        .replace(/\.\s*[A-Z]{2}$/i, '')
        .replace(/\s+[A-Z]{2}$/i, '')
        .replace(/,\s*[A-Za-z\s]+$/i, '')
        .trim();
    }
    const estadoNome = info.address?.state || info.address?.state_code || '';
    if (!cidade || cidade.length < 2) return null;
    const cidadeLower = cidade.toLowerCase().trim();
    if (['brasil', 'brazil', 'unknown', 'desconhecido'].includes(cidadeLower)) return null;
    return formatarCidadeComUF(cidade.trim(), estadoNome);
  } catch (_) {
    return null;
  }
}

/**
 * Amostra pontos ao longo da geometria e consulta Nominatim em série (respeito à política de uso).
 */
async function coletarCidadesAmostragemRota(coords, distanciaTotalKm) {
  const resultado = [];
  if (!coords || coords.length < 2) return resultado;
  const comprimentoGeo = comprimentoPolilinhaKm(coords);
  const refKm = distanciaTotalKm > 0 ? distanciaTotalKm : comprimentoGeo;
  if (refKm < 2 || comprimentoGeo < 0.5) return resultado;

  const intervalo = Math.max(18, Math.min(48, refKm / 11));
  const maxChamadas = 22;
  const evitarPontasKm = Math.min(10, refKm * 0.035);
  let kmCursor = evitarPontasKm;
  let chamadas = 0;
  while (kmCursor < refKm - evitarPontasKm && chamadas < maxChamadas) {
    const frac = kmCursor / refKm;
    const kmGeo = frac * comprimentoGeo;
    const pt = pontoAoLongoPolilinha(coords, kmGeo);
    if (pt) {
      const [lon, lat] = pt;
      // eslint-disable-next-line no-await-in-loop
      const fmt = await nominatimCidadeFormatada(lat, lon);
      if (fmt) {
        const base = nomeCidadeBaseFmt(fmt);
        const ultimo = resultado.length ? nomeCidadeBaseFmt(resultado[resultado.length - 1].fmt) : '';
        if (!ultimo || base !== ultimo) resultado.push({ fmt, kmAlong: kmGeo });
      }
      chamadas += 1;
    }
    kmCursor += intervalo;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 115));
  }
  return resultado;
}

/**
 * Monta sequência origem → cidades (amostras + paradas) → destino na ordem do percurso.
 * Paradas do roteiro são posicionadas pela projeção na geometria OSRM (evita empilhar tudo antes do destino).
 * @param {Array<{ label: string, lat: number, lon: number, ordem?: number }>} intermediariosComCoord
 * @param {Array<{ fmt: string, kmAlong: number }|string>} amostrasComKm
 * @param {Array<[number,number]>} coordsGeo [lon,lat][]
 */
function montarLinhaCidadesMotorista(origFmt, destFmt, intermediariosComCoord, amostrasComKm, coordsGeo) {
  const nb = nomeCidadeBaseFmt;
  const comprimento =
    coordsGeo && coordsGeo.length >= 2 ? comprimentoPolilinhaKm(coordsGeo) : 0;

  const amostrasNorm = (amostrasComKm || [])
    .map((x) => (typeof x === 'string' ? { fmt: x, kmAlong: 0 } : x))
    .filter((x) => x && x.fmt);

  if (comprimento < 0.5) {
    const interLabels = (intermediariosComCoord || [])
      .slice()
      .sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
      .map((w) => w.label)
      .filter(Boolean);
    const raw = [origFmt, ...amostrasNorm.map((a) => a.fmt), ...interLabels, destFmt].filter(Boolean);
    const out = [];
    for (const c of raw) {
      if (!out.length || nb(c) !== nb(out[out.length - 1])) out.push(c);
    }
    return out;
  }

  const items = [];
  items.push({ fmt: origFmt, km: 0 });
  for (const a of amostrasNorm) {
    const km = typeof a.kmAlong === 'number' && a.kmAlong >= 0 ? a.kmAlong : 0;
    items.push({ fmt: a.fmt, km });
  }
  for (const w of intermediariosComCoord || []) {
    if (!w || !w.label) continue;
    const la = Number(w.lat);
    const lo = Number(w.lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) continue;
    items.push({ fmt: w.label, km: kmAoLongoAteProjecao(coordsGeo, lo, la) });
  }
  items.push({ fmt: destFmt, km: comprimento });
  items.sort((a, b) => a.km - b.km || String(a.fmt).localeCompare(String(b.fmt)));

  const out = [];
  for (const it of items) {
    if (!it.fmt) continue;
    const last = out[out.length - 1];
    if (!last || nb(last) !== nb(it.fmt)) out.push(it.fmt);
  }
  return out;
}

/**
 * Monta rota completa: se só 2 pontos, uma chamada; senão, um trecho por par consecutivo (evita falha/timeout em rotas longas).
 * Usa o mesmo gateway lógico de GET /api/mapa/rota-osrm (router no banco, ORS, espelhos) + fallback sem steps.
 * Trechos com coords iguais (ex.: 2 entregas no mesmo GPS) ou falha OSRM → reta haversine (não aborta o resumo inteiro).
 */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function rotaTrechoReta(lon1, lat1, lon2, lat2) {
  const dist = haversineMeters(lat1, lon1, lat2, lon2);
  const dur = Math.max(1, Math.round(dist / 12)); // ~43 km/h
  return {
    code: 'Ok',
    routes: [
      {
        distance: dist,
        duration: dur,
        legs: [{ distance: dist, duration: dur, steps: [] }],
        geometry: {
          type: 'LineString',
          coordinates: [
            [lon1, lat1],
            [lon2, lat2],
          ],
        },
      },
    ],
  };
}

async function obterRotaMontadaTrechos(pontosOrdenados, tenantId) {
  if (!pontosOrdenados || pontosOrdenados.length < 2) return null;

  const lon = (p) => parseFloat(getRow(p, 'LONGITUDE') != null ? getRow(p, 'LONGITUDE') : p.LONGITUDE);
  const lat = (p) => parseFloat(getRow(p, 'LATITUDE') != null ? getRow(p, 'LATITUDE') : p.LATITUDE);

  async function trechoEntre(i, j) {
    const lo1 = lon(pontosOrdenados[i]);
    const la1 = lat(pontosOrdenados[i]);
    const lo2 = lon(pontosOrdenados[j]);
    const la2 = lat(pontosOrdenados[j]);
    if (![lo1, la1, lo2, la2].every(Number.isFinite)) return null;

    // Mesmo GPS (duas NF no mesmo endereço) — OSRM costuma falhar; trata como trecho zero
    const dApprox = haversineMeters(la1, lo1, la2, lo2);
    if (dApprox < 8) {
      return rotaTrechoReta(lo1, la1, lo2, la2);
    }

    const coordsStr = `${lo1},${la1};${lo2},${la2}`;
    try {
      const data = await fetchRouteResumoSegment(coordsStr, tenantId);
      if (data && data.code === 'Ok' && data.routes && data.routes[0]) return data;
    } catch (e) {
      console.warn(`[Resumo Rota] Trecho ${i + 1}→${j + 1} OSRM:`, e && e.message ? e.message : e);
    }
    console.warn(`[Resumo Rota] Trecho ${i + 1}→${j + 1}: fallback linha reta (${(dApprox / 1000).toFixed(2)} km)`);
    return rotaTrechoReta(lo1, la1, lo2, la2);
  }

  if (pontosOrdenados.length === 2) {
    return trechoEntre(0, 1);
  }

  const nSeg = pontosOrdenados.length - 1;
  // Sequencial com leve pausa: evita rate-limit do OSRM público em 12+ trechos paralelos
  const resultados = [];
  for (let i = 0; i < nSeg; i++) {
    // eslint-disable-next-line no-await-in-loop
    const data = await trechoEntre(i, i + 1);
    if (!data || data.code !== 'Ok' || !data.routes || !data.routes[0]) {
      console.error(`[Resumo Rota] Falha definitiva no trecho ${i + 1}/${nSeg}`);
      return null;
    }
    resultados.push({ i, data });
    if (i < nSeg - 1) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  let totalDist = 0;
  let totalDur = 0;
  const mergedLegs = [];
  const coordsMerged = [];

  for (const { data } of resultados) {
    const r0 = data.routes[0];
    totalDist += r0.distance || 0;
    totalDur += r0.duration || 0;
    if (r0.legs && r0.legs.length) {
      mergedLegs.push(...r0.legs);
    }
    const g = r0.geometry && r0.geometry.coordinates;
    if (g && g.length) {
      if (coordsMerged.length === 0) coordsMerged.push(...g);
      else coordsMerged.push(...g.slice(1));
    }
  }

  return {
    code: 'Ok',
    routes: [
      {
        distance: totalDist,
        duration: totalDur,
        legs: mergedLegs,
        geometry: coordsMerged.length ? { type: 'LineString', coordinates: coordsMerged } : undefined,
      },
    ],
  };
}

// Listar roteiros com filtros
router.get('/roteiros', async (req, res) => {
  try {
    const { 
      codigo, 
      descricao, 
      origemPais, origemEstado, origemCidade, 
      destinoPais, destinoEstado, destinoCidade 
    } = req.query;
    
    // Verificar se a tabela tem campo FGACTIVE
    const pool = await poolPromise;
    const checkColumn = await pool
      .request()
      .query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'ROTEIRO' AND COLUMN_NAME = 'FGACTIVE'
      `);
    
    const temFGACTIVE = checkColumn.recordset.length > 0;
    
    let query = `
      SELECT 
        [r].[IDROTEIRO],
        [r].[DSROTEIRO],
        [r].[DISTANCIAKM],
        [r].[CDCIDADEORIGEM],
        [co].[CDPAIS] AS ORIGEM_CDPAIS,
        [co].[ESTADO] AS ORIGEM_ESTADO,
        [co].[NMCIDADE] AS ORIGEM_CIDADE,
        [r].[CDCIDADEDESTINO],
        [cd].[CDPAIS] AS DESTINO_CDPAIS,
        [cd].[ESTADO] AS DESTINO_ESTADO,
        [cd].[NMCIDADE] AS DESTINO_CIDADE,
        [r].[RESUMOROTA]
    `;
    
    if (temFGACTIVE) {
      query += `, COALESCE([r].[FGACTIVE], 'S') AS FGACTIVE`;
    } else {
      query += `, 'S' AS FGACTIVE`;
    }
    
    query += `
      FROM [dbo].[ROTEIRO] r
      LEFT JOIN [dbo].[CIDADE] co ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
      LEFT JOIN [dbo].[CIDADE] cd ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
      WHERE 1=1
        AND ([r].[TENANT_ID] = @TID OR [r].[TENANT_ID] = 'default')
    `;

    const params = [];
    if (codigo) {
      query += ` AND [r].[IDROTEIRO] = @CODIGO`;
      params.push({ name: 'CODIGO', value: codigo });
    }
    if (descricao) {
      query += ` AND [r].[DSROTEIRO] LIKE @DESCRICAO`;
      params.push({ name: 'DESCRICAO', value: `%${descricao}%` });
    }
    if (origemPais) {
      query += ` AND [co].[CDPAIS] = @ORIGEM_PAIS`;
      params.push({ name: 'ORIGEM_PAIS', value: origemPais });
    }
    if (origemEstado) {
      query += ` AND [co].[ESTADO] = @ORIGEM_ESTADO`;
      params.push({ name: 'ORIGEM_ESTADO', value: origemEstado });
    }
    if (origemCidade) {
      query += ` AND [co].[NMCIDADE] LIKE @ORIGEM_CIDADE`;
      params.push({ name: 'ORIGEM_CIDADE', value: `%${origemCidade}%` });
    }
    if (destinoPais) {
      query += ` AND [cd].[CDPAIS] = @DESTINO_PAIS`;
      params.push({ name: 'DESTINO_PAIS', value: destinoPais });
    }
    if (destinoEstado) {
      query += ` AND [cd].[ESTADO] = @DESTINO_ESTADO`;
      params.push({ name: 'DESTINO_ESTADO', value: destinoEstado });
    }
    if (destinoCidade) {
      query += ` AND [cd].[NMCIDADE] LIKE @DESTINO_CIDADE`;
      params.push({ name: 'DESTINO_CIDADE', value: `%${destinoCidade}%` });
    }

    query += ` ORDER BY [r].[IDROTEIRO]`;
    const request = pool.request();
    request.input('TID', sql.NVarChar(64), tenantIdForRequest(req));
    params.forEach(p => request.input(p.name, p.value));
    
    const result = await request.query(query);
    const roteiros = result.recordset.map(r => {
      const roteiro = {
        IDROTEIRO: getRow(r, 'IDROTEIRO'),
        DSROTEIRO: getRow(r, 'DSROTEIRO'),
        DISTANCIAKM: getRow(r, 'DISTANCIAKM'),
        CDCIDADEORIGEM: getRow(r, 'CDCIDADEORIGEM'),
        ORIGEM_CDPAIS: getRow(r, 'ORIGEM_CDPAIS'),
        ORIGEM_ESTADO: getRow(r, 'ORIGEM_ESTADO') || '',
        ORIGEM_CIDADE: getRow(r, 'ORIGEM_CIDADE') || '',
        CDCIDADEDESTINO: getRow(r, 'CDCIDADEDESTINO'),
        DESTINO_CDPAIS: getRow(r, 'DESTINO_CDPAIS'),
        DESTINO_ESTADO: getRow(r, 'DESTINO_ESTADO') || '',
        DESTINO_CIDADE: getRow(r, 'DESTINO_CIDADE') || '',
        RESUMOROTA: getRow(r, 'RESUMOROTA') || null
      };
      
      if (temFGACTIVE && (r.FGACTIVE !== undefined || r.fgactive !== undefined)) {
        roteiro.FGACTIVE = r.FGACTIVE ?? r.fgactive;
      } else {
        roteiro.FGACTIVE = 'S';
      }
      
      return roteiro;
    });
    
    res.json(roteiros);
  } catch (err) {
    console.error('Erro ao listar roteiros:', err);
    res.status(500).json({ error: 'Erro ao carregar roteiros.' });
  }
});

// Buscar roteiro por ID
router.get('/roteiros/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;
    
    // Verificar se a tabela tem campo FGACTIVE
    const checkColumn = await pool
      .request()
      .query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'ROTEIRO' AND COLUMN_NAME = 'FGACTIVE'
      `);
    
    const temFGACTIVE = checkColumn.recordset.length > 0;
    
    let     query = `
      SELECT 
        [r].[IDROTEIRO],
        [r].[DSROTEIRO],
        [r].[DISTANCIAKM],
        [r].[CDCIDADEORIGEM],
        [co].[CDPAIS] AS ORIGEM_CDPAIS,
        [co].[ESTADO] AS ORIGEM_ESTADO,
        [co].[NMCIDADE] AS ORIGEM_CIDADE,
        [r].[CDCIDADEDESTINO],
        [cd].[CDPAIS] AS DESTINO_CDPAIS,
        [cd].[ESTADO] AS DESTINO_ESTADO,
        [cd].[NMCIDADE] AS DESTINO_CIDADE,
        [r].[RESUMOROTA]
    `;
    
    if (temFGACTIVE) {
      query += `, COALESCE([r].[FGACTIVE], 'S') AS FGACTIVE`;
    }
    
    query += `
      FROM [dbo].[ROTEIRO] r
      LEFT JOIN [dbo].[CIDADE] co ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
      LEFT JOIN [dbo].[CIDADE] cd ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
      WHERE [r].[IDROTEIRO] = @IDROTEIRO
        AND ([r].[TENANT_ID] = @TID OR [r].[TENANT_ID] = 'default')
    `;
    
    const result = await pool
      .request()
      .input('IDROTEIRO', sql.Decimal(15, 0), parseFloat(id))
      .input('TID', sql.NVarChar(64), tenantIdForRequest(req))
      .query(query);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Roteiro não encontrado.' });
    }
    
    const r = result.recordset[0];
    const responseData = {
      IDROTEIRO: getRow(r, 'IDROTEIRO'),
      DSROTEIRO: getRow(r, 'DSROTEIRO'),
      DISTANCIAKM: getRow(r, 'DISTANCIAKM'),
      CDCIDADEORIGEM: getRow(r, 'CDCIDADEORIGEM'),
      ORIGEM_CDPAIS: getRow(r, 'ORIGEM_CDPAIS'),
      ORIGEM_ESTADO: getRow(r, 'ORIGEM_ESTADO') || '',
      ORIGEM_CIDADE: getRow(r, 'ORIGEM_CIDADE') || '',
      CDCIDADEDESTINO: getRow(r, 'CDCIDADEDESTINO'),
      DESTINO_CDPAIS: getRow(r, 'DESTINO_CDPAIS'),
      DESTINO_ESTADO: getRow(r, 'DESTINO_ESTADO') || '',
      DESTINO_CIDADE: getRow(r, 'DESTINO_CIDADE') || '',
      RESUMOROTA: getRow(r, 'RESUMOROTA') || null
    };
    
    if (temFGACTIVE && (r.FGACTIVE !== undefined || r.fgactive !== undefined)) {
      responseData.FGACTIVE = r.FGACTIVE ?? r.fgactive;
    } else {
      responseData.FGACTIVE = 'S';
    }
    
    res.json(responseData);
  } catch (err) {
    console.error('Erro ao buscar roteiro:', err);
    res.status(500).json({ error: 'Erro ao carregar roteiro.' });
  }
});

// Inserir novo roteiro
router.post('/roteiros', async (req, res) => {
  try {
    const { 
      DSROTEIRO, 
      CDCIDADEORIGEM, 
      CDCIDADEDESTINO, 
      DISTANCIAKM,
      RESUMOROTA
    } = req.body;
    
    if (!DSROTEIRO?.trim() || !CDCIDADEORIGEM || !CDCIDADEDESTINO) {
      return res.status(400).json({ error: 'Descrição, Origem e Destino são obrigatórios.' });
    }

    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);
    const maxResult = await pool
      .request()
      .query('SELECT COALESCE(MAX([IDROTEIRO]), 0) + 1 AS [maxId] FROM [dbo].[ROTEIRO]');
    const novoId = getFirstNumericValue(maxResult.recordset, 1);

    // Verificar se a tabela tem campo FGACTIVE
    const checkColumn = await pool
      .request()
      .query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'ROTEIRO' AND COLUMN_NAME = 'FGACTIVE'
      `);
    
    const temFGACTIVE = checkColumn.recordset.length > 0;
    
    // Verificar se a tabela tem campo RESUMOROTA
    const checkResumoColumn = await pool
      .request()
      .query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'ROTEIRO' AND COLUMN_NAME = 'RESUMOROTA'
      `);
    
    const temRESUMOROTA = checkResumoColumn.recordset.length > 0;
    
    let query = `
      INSERT INTO [dbo].[ROTEIRO] (
        [IDROTEIRO], [DSROTEIRO], [CDCIDADEORIGEM], [CDCIDADEDESTINO], [DISTANCIAKM],
    `;
    
    if (temRESUMOROTA && RESUMOROTA) {
      query += `[RESUMOROTA],`;
    }
    
    if (temFGACTIVE) {
      query += `[FGACTIVE],`;
    }
    
    query += `
        [TENANT_ID],
        [DHMAINTENANCE], [SGUSER], [SERVERORIG]
      )
      VALUES (@IDROTEIRO, @DSROTEIRO, @CDCIDADEORIGEM, @CDCIDADEDESTINO, @DISTANCIAKM,
    `;
    
    if (temRESUMOROTA && RESUMOROTA) {
      query += `@RESUMOROTA,`;
    }
    
    if (temFGACTIVE) {
      query += `'S',`;
    }
    
    query += `@TID, GETDATE(), 'SYSTEM', 'AppDVcargas')
    `;

    const request = pool.request()
      .input('IDROTEIRO', sql.Decimal(15, 0), novoId)
      .input('DSROTEIRO', DSROTEIRO.trim())
      .input('CDCIDADEORIGEM', sql.Int, CDCIDADEORIGEM)
      .input('CDCIDADEDESTINO', sql.Int, CDCIDADEDESTINO)
      .input('DISTANCIAKM', DISTANCIAKM ? parseFloat(DISTANCIAKM) : null)
      .input('TID', sql.NVarChar(64), tenantId);
    
    if (temRESUMOROTA && RESUMOROTA) {
      request.input('RESUMOROTA', sql.NVarChar(sql.MAX), RESUMOROTA.trim());
    }
    
    await request.query(query);

    let pontosOrigemDestinoGerados = false;
    try {
      const seed = await seedOrigemDestinoSeVazio(pool, novoId, CDCIDADEORIGEM, CDCIDADEDESTINO);
      pontosOrigemDestinoGerados = !!seed.seeded;
      if (!seed.seeded && seed.reason && seed.reason !== 'already_has_points') {
        console.warn('[Roteiros] Seed pontos origem/destino não aplicado:', seed.reason, 'IDROTEIRO=', novoId);
      }
    } catch (seedErr) {
      console.error('[Roteiros] Erro ao criar pontos automáticos do roteiro:', seedErr.message);
    }

    res.status(201).json({
      success: true,
      message: pontosOrigemDestinoGerados
        ? 'Roteiro cadastrado com sucesso. Pontos de origem e destino foram criados automaticamente.'
        : 'Roteiro cadastrado com sucesso!',
      IDROTEIRO: novoId,
      pontosOrigemDestinoGerados
    });
  } catch (err) {
    console.error('Erro ao inserir roteiro:', err);
    res.status(500).json({ error: 'Erro ao cadastrar roteiro.' });
  }
});

// Atualizar roteiro
router.put('/roteiros/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      DSROTEIRO, 
      CDCIDADEORIGEM, 
      CDCIDADEDESTINO, 
      DISTANCIAKM,
      RESUMOROTA,
      FGACTIVE
    } = req.body;

    if (!DSROTEIRO?.trim() || !CDCIDADEORIGEM || !CDCIDADEDESTINO) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    const pool = await poolPromise;
    const idNumerico = parseFloat(id);
    const tenantId = tenantIdForRequest(req);

    // Verificar se a tabela tem campo FGACTIVE e RESUMOROTA
    const checkColumn = await pool
      .request()
      .query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'ROTEIRO' AND COLUMN_NAME IN ('FGACTIVE', 'RESUMOROTA')
      `);
    
    const temFGACTIVE = checkColumn.recordset.some(r => r.COLUMN_NAME === 'FGACTIVE');
    const temRESUMOROTA = checkColumn.recordset.some(r => r.COLUMN_NAME === 'RESUMOROTA');
    
    let query = `
      UPDATE [dbo].[ROTEIRO]
      SET 
        [DSROTEIRO] = @DSROTEIRO,
        [CDCIDADEORIGEM] = @CDCIDADEORIGEM,
        [CDCIDADEDESTINO] = @CDCIDADEDESTINO,
        [DISTANCIAKM] = @DISTANCIAKM,
    `;
    
    if (temRESUMOROTA && RESUMOROTA !== undefined) {
      query += `[RESUMOROTA] = @RESUMOROTA,`;
    }
    
    if (temFGACTIVE && FGACTIVE) {
      query += `[FGACTIVE] = @FGACTIVE,`;
    }
    
    query += `
        [DHMAINTENANCE] = GETDATE(),
        [SGUSER] = 'SYSTEM',
        [SERVERORIG] = 'AppDVcargas'
      WHERE [IDROTEIRO] = @IDROTEIRO AND [TENANT_ID] = @TID
    `;

    const request = pool.request()
      .input('IDROTEIRO', sql.Decimal(15, 0), idNumerico)
      .input('TID', sql.NVarChar(64), tenantId)
      .input('DSROTEIRO', DSROTEIRO.trim())
      .input('CDCIDADEORIGEM', sql.Int, CDCIDADEORIGEM)
      .input('CDCIDADEDESTINO', sql.Int, CDCIDADEDESTINO)
      .input('DISTANCIAKM', DISTANCIAKM ? parseFloat(DISTANCIAKM) : null);
    
    if (temRESUMOROTA && RESUMOROTA !== undefined) {
      request.input('RESUMOROTA', sql.NVarChar(sql.MAX), RESUMOROTA ? RESUMOROTA.trim() : null);
    }
    
    if (temFGACTIVE && FGACTIVE) {
      request.input('FGACTIVE', sql.Char(1), FGACTIVE);
    }
    
    const updResult = await request.query(query);
    const affected = updResult.rowsAffected && updResult.rowsAffected[0];
    if (!affected) {
      return res.status(404).json({ error: 'Roteiro não encontrado ou catálogo compartilhado não pode ser alterado por este tenant.' });
    }

    let pontosOrigemDestinoGerados = false;
    try {
      const seed = await seedOrigemDestinoSeVazio(pool, idNumerico, CDCIDADEORIGEM, CDCIDADEDESTINO);
      pontosOrigemDestinoGerados = !!seed.seeded;
      if (pontosOrigemDestinoGerados) {
        console.log('[Roteiros] Pontos origem/destino criados após atualização do roteiro', idNumerico);
      }
    } catch (seedErr) {
      console.error('[Roteiros] Erro ao seed pontos após PUT:', seedErr.message);
    }

    res.json({
      success: true,
      message: pontosOrigemDestinoGerados
        ? 'Roteiro atualizado com sucesso. Pontos de origem e destino foram criados automaticamente.'
        : 'Roteiro atualizado com sucesso!',
      pontosOrigemDestinoGerados
    });
  } catch (err) {
    console.error('Erro ao atualizar roteiro:', err);
    res.status(500).json({ error: 'Erro ao atualizar roteiro.' });
  }
});

// Excluir/Desativar roteiro (soft delete)
router.delete('/roteiros/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.query; // 'activate' ou 'deactivate'
    const idNumerico = parseFloat(id);
    
    if (isNaN(idNumerico)) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);
    
    // Verificar se a tabela tem campo FGACTIVE
    const checkColumn = await pool
      .request()
      .query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_NAME = 'ROTEIRO' AND COLUMN_NAME = 'FGACTIVE'
      `);
    
    const temFGACTIVE = checkColumn.recordset.length > 0;
    
    if (temFGACTIVE) {
      // Soft delete: atualizar FGACTIVE
      const novoStatus = action === 'activate' ? 'S' : 'N';
      const mensagem = action === 'activate' 
        ? 'Roteiro reativado com sucesso.' 
        : 'Roteiro desativado com sucesso.';
      
      const delUpd = await pool
        .request()
        .input('IDROTEIRO', sql.Decimal(15, 0), idNumerico)
        .input('TID', sql.NVarChar(64), tenantId)
        .input('FGACTIVE', sql.Char(1), novoStatus)
        .query(`
          UPDATE [dbo].[ROTEIRO]
          SET [FGACTIVE] = @FGACTIVE,
              [DHMAINTENANCE] = GETDATE(),
              [SGUSER] = 'SYSTEM',
              [SERVERORIG] = 'AppDVcargas'
          WHERE [IDROTEIRO] = @IDROTEIRO AND [TENANT_ID] = @TID
        `);

      const affected = delUpd.rowsAffected && delUpd.rowsAffected[0];
      if (!affected) {
        return res.status(404).json({ error: 'Roteiro não encontrado ou catálogo compartilhado não pode ser alterado por este tenant.' });
      }
      res.json({ success: true, message: mensagem });
    } else {
      // Se não tiver FGACTIVE, fazer DELETE físico (comportamento antigo)
      const delR = await pool
        .request()
        .input('IDROTEIRO', sql.Decimal(15, 0), idNumerico)
        .input('TID', sql.NVarChar(64), tenantId)
        .query(`
          DELETE FROM [dbo].[ROTEIRO]
          WHERE [IDROTEIRO] = @IDROTEIRO AND [TENANT_ID] = @TID
        `);

      const affected = delR.rowsAffected && delR.rowsAffected[0];
      if (!affected) {
        return res.status(404).json({ error: 'Roteiro não encontrado ou catálogo compartilhado não pode ser alterado por este tenant.' });
      }
      res.json({ success: true, message: 'Roteiro excluído com sucesso.' });
    }
  } catch (err) {
    console.error('Erro ao excluir roteiro:', err);
    res.status(500).json({ error: 'Erro ao excluir roteiro.' });
  }
});

// ============================================================================
// ROTAS PARA PONTOS DE ROTEIRO
// ============================================================================

// Listar pontos de um roteiro
router.get('/roteiros/:id/pontos', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;
    const acc = await assertRoteiroAcesso(pool, id, req, { exigeMutacao: false });
    if (acc.error) {
      return res.status(404).json({ error: 'Roteiro não encontrado.' });
    }
    const result = await pool
      .request()
      .input('IDROTEIRO', sql.Decimal(15, 0), parseFloat(id))
      .query(`
        SELECT 
          [IDROTEIRO],
          [SEQUENCIA],
          [ORDEM],
          [DSLOCAL],
          [DSPOSICAO],
          [LATITUDE],
          [LONGITUDE],
          [TPLOCAL],
          [KMENTREPONTOS],
          [CDPAISPASSAGEM],
          [ESTADOPASSAGEM],
          [DHMAINTENANCE],
          [SGUSER],
          [SERVERORIG]
        FROM [dbo].[ROTEIROPONTOS]
        WHERE [IDROTEIRO] = @IDROTEIRO
        ORDER BY [ORDEM] ASC, [SEQUENCIA] ASC
      `);
    
    res.json(result.recordset);
  } catch (err) {
    console.error('Erro ao listar pontos:', err);
    res.status(500).json({ error: 'Erro ao carregar pontos do roteiro.' });
  }
});

// Buscar um ponto específico
router.get('/roteiros/:id/pontos/:sequencia', async (req, res) => {
  try {
    const { id, sequencia } = req.params;
    const pool = await poolPromise;
    const acc = await assertRoteiroAcesso(pool, id, req, { exigeMutacao: false });
    if (acc.error) {
      return res.status(404).json({ error: 'Roteiro não encontrado.' });
    }
    const result = await pool
      .request()
      .input('IDROTEIRO', sql.Decimal(15, 0), parseFloat(id))
      .input('SEQUENCIA', sql.SmallInt, parseInt(sequencia))
      .query(`
        SELECT 
          [IDROTEIRO],
          [SEQUENCIA],
          [ORDEM],
          [DSLOCAL],
          [DSPOSICAO],
          [LATITUDE],
          [LONGITUDE],
          [TPLOCAL],
          [KMENTREPONTOS],
          [CDPAISPASSAGEM],
          [ESTADOPASSAGEM],
          [DHMAINTENANCE],
          [SGUSER],
          [SERVERORIG]
        FROM [dbo].[ROTEIROPONTOS]
        WHERE [IDROTEIRO] = @IDROTEIRO AND [SEQUENCIA] = @SEQUENCIA
      `);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Ponto não encontrado.' });
    }
    
    res.json(result.recordset[0]);
  } catch (err) {
    console.error('Erro ao buscar ponto:', err);
    res.status(500).json({ error: 'Erro ao carregar ponto.' });
  }
});

// Criar novo ponto
router.post('/roteiros/:id/pontos', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;
    const acc = await assertRoteiroAcesso(pool, id, req, { exigeMutacao: true });
    if (acc.error === 'not_found') {
      return res.status(404).json({ error: 'Roteiro não encontrado.' });
    }
    if (acc.error === 'forbidden_catalog') {
      return res.status(404).json({ error: 'Roteiro não encontrado ou catálogo compartilhado não pode ser alterado por este tenant.' });
    }
    const {
      SEQUENCIA,
      ORDEM,
      DSLOCAL,
      DSPOSICAO,
      LATITUDE,
      LONGITUDE,
      TPLOCAL,
      KMENTREPONTOS,
      CDPAISPASSAGEM,
      ESTADOPASSAGEM
    } = req.body;
    
    if (!DSLOCAL?.trim() || !DSPOSICAO?.trim() || !ORDEM) {
      return res.status(400).json({ error: 'Local, Posição e Ordem são obrigatórios.' });
    }
    
    const idRoteiro = parseFloat(id);
    
    // Se SEQUENCIA não foi informada, gerar automaticamente
    let sequenciaFinal = SEQUENCIA;
    if (!sequenciaFinal) {
      const maxSeqResult = await pool
        .request()
        .input('IDROTEIRO', sql.Decimal(15, 0), idRoteiro)
        .query('SELECT COALESCE(MAX([SEQUENCIA]), 0) + 1 AS [maxSeq] FROM [dbo].[ROTEIROPONTOS] WHERE [IDROTEIRO] = @IDROTEIRO');
      sequenciaFinal = getFirstNumericValue(maxSeqResult.recordset, 1);
    }
    
    // Truncar valores para não exceder tamanhos das colunas
    const dslocalTruncado = DSLOCAL ? DSLOCAL.trim().substring(0, 100) : '';
    const dsposicaoTruncado = DSPOSICAO ? DSPOSICAO.trim().substring(0, 100) : '';
    const tplocalTruncado = TPLOCAL ? TPLOCAL.trim().toUpperCase().substring(0, 2) : null;
    const estadopassagemTruncado = ESTADOPASSAGEM ? ESTADOPASSAGEM.trim().toUpperCase().substring(0, 3) : null;
    
    await pool
      .request()
      .input('IDROTEIRO', sql.Decimal(15, 0), idRoteiro)
      .input('SEQUENCIA', sql.SmallInt, sequenciaFinal)
      .input('ORDEM', sql.SmallInt, parseInt(ORDEM))
      .input('DSLOCAL', dslocalTruncado)
      .input('DSPOSICAO', dsposicaoTruncado)
      .input('LATITUDE', toNullableNumber(LATITUDE))
      .input('LONGITUDE', toNullableNumber(LONGITUDE))
      .input('TPLOCAL', tplocalTruncado)
      .input('KMENTREPONTOS', toNullableNumber(KMENTREPONTOS))
      .input('CDPAISPASSAGEM', CDPAISPASSAGEM ? parseInt(CDPAISPASSAGEM) : null)
      .input('ESTADOPASSAGEM', estadopassagemTruncado)
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
    
    res.status(201).json({ success: true, message: 'Ponto cadastrado com sucesso!' });
  } catch (err) {
    console.error('Erro ao inserir ponto:', err);
    if (err.number === 2627) { // Violation of PRIMARY KEY constraint
      return res.status(400).json({ error: 'Já existe um ponto com esta sequência para este roteiro.' });
    }
    res.status(500).json({ error: 'Erro ao cadastrar ponto.' });
  }
});

// Atualizar ponto
/**
 * Reordena pontos em lote. Body: { sequencias: number[] } — ordem visual completa (inclui O e D).
 * Renumeração ORDEM: 1, 10, 20, …, 10*(n-1). Origem (O) deve ser o 1º e Destino (D) o último, se existirem.
 */
router.put('/roteiros/:id/pontos/reordenar', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;
    const acc = await assertRoteiroAcesso(pool, id, req, { exigeMutacao: true });
    if (acc.error === 'not_found') {
      return res.status(404).json({ error: 'Roteiro não encontrado.' });
    }
    if (acc.error === 'forbidden_catalog') {
      return res.status(404).json({ error: 'Roteiro não encontrado ou catálogo compartilhado não pode ser alterado por este tenant.' });
    }

    const rawSeq = req.body && Array.isArray(req.body.sequencias) ? req.body.sequencias : null;
    if (!rawSeq || !rawSeq.length) {
      return res.status(400).json({ error: 'Informe sequencias[] na nova ordem.' });
    }

    const sequencias = rawSeq.map((s) => parseInt(s, 10)).filter((n) => Number.isFinite(n));
    if (sequencias.length !== rawSeq.length) {
      return res.status(400).json({ error: 'Sequências inválidas.' });
    }
    if (new Set(sequencias).size !== sequencias.length) {
      return res.status(400).json({ error: 'Sequências duplicadas na ordem.' });
    }

    const idRoteiro = parseFloat(id);
    const atuais = await pool
      .request()
      .input('IDROTEIRO', sql.Decimal(15, 0), idRoteiro)
      .query(`
        SELECT [SEQUENCIA], [TPLOCAL], [ORDEM]
          FROM [dbo].[ROTEIROPONTOS]
         WHERE [IDROTEIRO] = @IDROTEIRO
         ORDER BY [ORDEM] ASC, [SEQUENCIA] ASC
      `);

    const rows = Array.from(atuais.recordset || []);
    if (!rows.length) {
      return res.status(404).json({ error: 'Roteiro sem pontos.' });
    }
    if (sequencias.length !== rows.length) {
      return res.status(400).json({
        error: `Quantidade de sequências (${sequencias.length}) difere dos pontos do roteiro (${rows.length}).`,
      });
    }

    const bySeq = new Map(rows.map((r) => [parseInt(r.SEQUENCIA, 10), r]));
    for (const seq of sequencias) {
      if (!bySeq.has(seq)) {
        return res.status(400).json({ error: `Sequência ${seq} não pertence a este roteiro.` });
      }
    }

    const normTp = (v) => String(v == null ? '' : v).trim().toUpperCase();
    const primeiro = bySeq.get(sequencias[0]);
    const ultimo = bySeq.get(sequencias[sequencias.length - 1]);
    const temOrigem = rows.some((r) => normTp(r.TPLOCAL) === 'O');
    const temDestino = rows.some((r) => normTp(r.TPLOCAL) === 'D');
    if (temOrigem && normTp(primeiro.TPLOCAL) !== 'O') {
      return res.status(400).json({ error: 'A Origem deve permanecer na primeira posição.' });
    }
    if (temDestino && normTp(ultimo.TPLOCAL) !== 'D') {
      return res.status(400).json({ error: 'O Destino deve permanecer na última posição.' });
    }
    for (let i = 1; i < sequencias.length - 1; i++) {
      const tp = normTp(bySeq.get(sequencias[i]).TPLOCAL);
      if (tp === 'O' || tp === 'D') {
        return res.status(400).json({ error: 'Origem e Destino não podem ficar no meio da rota.' });
      }
    }

    const transaction = await createTransaction(pool);
    await transaction.begin();
    try {
      for (let i = 0; i < sequencias.length; i++) {
        const novaOrdem = i === 0 ? 1 : 10 * i;
        await transaction
          .request()
          .input('IDROTEIRO', sql.Decimal(15, 0), idRoteiro)
          .input('SEQUENCIA', sql.SmallInt, sequencias[i])
          .input('ORDEM', sql.SmallInt, novaOrdem)
          .query(`
            UPDATE [dbo].[ROTEIROPONTOS]
               SET [ORDEM] = @ORDEM,
                   [DHMAINTENANCE] = GETDATE(),
                   [SGUSER] = 'SYSTEM',
                   [SERVERORIG] = 'AppDVcargas'
             WHERE [IDROTEIRO] = @IDROTEIRO AND [SEQUENCIA] = @SEQUENCIA
          `);
      }
      await transaction.commit();
    } catch (txErr) {
      try {
        await transaction.rollback();
      } catch (_) {}
      throw txErr;
    }

    const atualizados = await pool
      .request()
      .input('IDROTEIRO', sql.Decimal(15, 0), idRoteiro)
      .query(`
        SELECT 
          [IDROTEIRO], [SEQUENCIA], [ORDEM], [DSLOCAL], [DSPOSICAO],
          [LATITUDE], [LONGITUDE], [TPLOCAL], [KMENTREPONTOS],
          [CDPAISPASSAGEM], [ESTADOPASSAGEM], [DHMAINTENANCE], [SGUSER], [SERVERORIG]
        FROM [dbo].[ROTEIROPONTOS]
        WHERE [IDROTEIRO] = @IDROTEIRO
        ORDER BY [ORDEM] ASC, [SEQUENCIA] ASC
      `);

    res.json({ success: true, message: 'Ordem dos pontos atualizada.', pontos: atualizados.recordset });
  } catch (err) {
    console.error('Erro ao reordenar pontos:', err);
    res.status(500).json({ error: 'Erro ao reordenar pontos do roteiro.' });
  }
});

router.put('/roteiros/:id/pontos/:sequencia', async (req, res) => {
  try {
    const { id, sequencia } = req.params;
    const pool = await poolPromise;
    const acc = await assertRoteiroAcesso(pool, id, req, { exigeMutacao: true });
    if (acc.error === 'not_found') {
      return res.status(404).json({ error: 'Roteiro não encontrado.' });
    }
    if (acc.error === 'forbidden_catalog') {
      return res.status(404).json({ error: 'Roteiro não encontrado ou catálogo compartilhado não pode ser alterado por este tenant.' });
    }
    const {
      ORDEM,
      DSLOCAL,
      DSPOSICAO,
      LATITUDE,
      LONGITUDE,
      TPLOCAL,
      KMENTREPONTOS,
      CDPAISPASSAGEM,
      ESTADOPASSAGEM
    } = req.body;
    
    if (!DSLOCAL?.trim() || !DSPOSICAO?.trim() || !ORDEM) {
      return res.status(400).json({ error: 'Local, Posição e Ordem são obrigatórios.' });
    }
    
    const idRoteiro = parseFloat(id);
    const seqNum = parseInt(sequencia);
    
    // Truncar valores para não exceder tamanhos das colunas
    const dslocalTruncado = DSLOCAL ? DSLOCAL.trim().substring(0, 100) : '';
    const dsposicaoTruncado = DSPOSICAO ? DSPOSICAO.trim().substring(0, 100) : '';
    const tplocalTruncado = TPLOCAL ? TPLOCAL.trim().toUpperCase().substring(0, 2) : null;
    const estadopassagemTruncado = ESTADOPASSAGEM ? ESTADOPASSAGEM.trim().toUpperCase().substring(0, 3) : null;
    
    await pool
      .request()
      .input('IDROTEIRO', sql.Decimal(15, 0), idRoteiro)
      .input('SEQUENCIA', sql.SmallInt, seqNum)
      .input('ORDEM', sql.SmallInt, parseInt(ORDEM))
      .input('DSLOCAL', dslocalTruncado)
      .input('DSPOSICAO', dsposicaoTruncado)
      .input('LATITUDE', LATITUDE ? parseFloat(LATITUDE) : null)
      .input('LONGITUDE', LONGITUDE ? parseFloat(LONGITUDE) : null)
      .input('TPLOCAL', tplocalTruncado)
      .input('KMENTREPONTOS', KMENTREPONTOS ? parseFloat(KMENTREPONTOS) : null)
      .input('CDPAISPASSAGEM', CDPAISPASSAGEM ? parseInt(CDPAISPASSAGEM) : null)
      .input('ESTADOPASSAGEM', estadopassagemTruncado)
      .query(`
        UPDATE [dbo].[ROTEIROPONTOS]
        SET 
          [ORDEM] = @ORDEM,
          [DSLOCAL] = @DSLOCAL,
          [DSPOSICAO] = @DSPOSICAO,
          [LATITUDE] = @LATITUDE,
          [LONGITUDE] = @LONGITUDE,
          [TPLOCAL] = @TPLOCAL,
          [KMENTREPONTOS] = @KMENTREPONTOS,
          [CDPAISPASSAGEM] = @CDPAISPASSAGEM,
          [ESTADOPASSAGEM] = @ESTADOPASSAGEM,
          [DHMAINTENANCE] = GETDATE(),
          [SGUSER] = 'SYSTEM',
          [SERVERORIG] = 'AppDVcargas'
        WHERE [IDROTEIRO] = @IDROTEIRO AND [SEQUENCIA] = @SEQUENCIA
      `);
    
    res.json({ success: true, message: 'Ponto atualizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar ponto:', err);
    res.status(500).json({ error: 'Erro ao atualizar ponto.' });
  }
});

// Excluir ponto
router.delete('/roteiros/:id/pontos/:sequencia', async (req, res) => {
  try {
    const { id, sequencia } = req.params;
    const pool = await poolPromise;
    const acc = await assertRoteiroAcesso(pool, id, req, { exigeMutacao: true });
    if (acc.error === 'not_found') {
      return res.status(404).json({ error: 'Roteiro não encontrado.' });
    }
    if (acc.error === 'forbidden_catalog') {
      return res.status(404).json({ error: 'Roteiro não encontrado ou catálogo compartilhado não pode ser alterado por este tenant.' });
    }
    const idRoteiro = parseFloat(id);
    const seqNum = parseInt(sequencia);
    
    await pool
      .request()
      .input('IDROTEIRO', sql.Decimal(15, 0), idRoteiro)
      .input('SEQUENCIA', sql.SmallInt, seqNum)
      .query(`
        DELETE FROM [dbo].[ROTEIROPONTOS]
        WHERE [IDROTEIRO] = @IDROTEIRO AND [SEQUENCIA] = @SEQUENCIA
      `);
    
    res.json({ success: true, message: 'Ponto excluído com sucesso.' });
  } catch (err) {
    console.error('Erro ao excluir ponto:', err);
    res.status(500).json({ error: 'Erro ao excluir ponto.' });
  }
});

// Executar init.sql do módulo Gerenciar Roteiros
router.post('/roteiros/executar-init-sql', async (req, res) => {
  try {
    const { sql } = req.body;

    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ error: 'SQL é obrigatório.' });
    }

    // Remover espaços em branco e converter para maiúsculas para verificação
    const sqlUpper = sql.trim().toUpperCase();

    // Bloquear apenas comandos extremamente perigosos
    // Permite: SELECT, EXEC, EXECUTE, UPDATE, INSERT, DELETE (com cuidado)
    const comandosBloqueados = [
      'DROP DATABASE', 'DROP TABLE', 'TRUNCATE TABLE', 
      'ALTER DATABASE', 'CREATE DATABASE', 'BACKUP DATABASE',
      'RESTORE DATABASE', 'SHUTDOWN', 'KILL'
    ];

    // Verificar comandos bloqueados
    for (const cmd of comandosBloqueados) {
      if (sqlUpper.includes(cmd)) {
        return res.status(400).json({ 
          error: `Comando não permitido: ${cmd}.` 
        });
      }
    }

    const { poolPromise } = require('../config/db');
    const pool = await poolPromise;
    
    // Dividir por GO se houver múltiplos comandos
    const comandos = sql.split(/\bGO\b/gi).filter(cmd => cmd.trim().length > 0);
    
    const resultados = [];
    
    for (const comando of comandos) {
      const cmdLimpo = comando.trim();
      if (!cmdLimpo) continue;
      
      try {
        // Aumentar timeout para comandos grandes (MERGE, UPDATE em massa, etc)
        const request = pool.request();
        // mssql usa requestTimeout (em milissegundos)
        request.timeout = 120000; // 120 segundos (2 minutos) para comandos grandes
        const result = await request.query(cmdLimpo);
        
        // Se retornou dados (SELECT), incluir no resultado
        if (result.recordset && result.recordset.length > 0) {
          const rows = result.recordset.map(row => {
            const obj = {};
            for (const key in row) {
              obj[key] = row[key];
            }
            return obj;
          });
          resultados.push({
            tipo: 'SELECT',
            rows: rows,
            rowCount: rows.length
          });
        } else {
          // Comando executado sem retorno (EXEC, UPDATE, etc)
          resultados.push({
            tipo: 'EXEC',
            message: 'Comando executado com sucesso.',
            rowsAffected: result.rowsAffected || [0]
          });
        }
      } catch (cmdErr) {
        // Se um comando falhar, continuar com os próximos mas registrar o erro
        let mensagemErro = cmdErr.message;
        
        // Melhorar mensagem de timeout
        if (mensagemErro.includes('timeout') || mensagemErro.includes('Timeout')) {
          mensagemErro = `Timeout: Comando demorou mais de 2 minutos para executar. Este comando pode ser muito grande ou o banco está sobrecarregado.`;
        }
        
        resultados.push({
          tipo: 'ERRO',
          error: mensagemErro,
          comando: cmdLimpo.substring(0, 200), // Primeiros 200 caracteres para melhor debug
          detalhes: {
            nome: cmdErr.name,
            codigo: cmdErr.code,
            numero: cmdErr.number
          }
        });
      }
    }

    res.json({
      success: true,
      resultados: resultados,
      totalComandos: comandos.length
    });
  } catch (err) {
    console.error('Erro ao executar init SQL:', err);
    // Garantir que a resposta seja enviada antes de encerrar
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false,
        error: 'Erro ao executar SQL de inicialização.',
        detalhes: err.message 
      });
    }
  }
});

// Gerar resumo da rota automaticamente
router.post('/roteiros/:id/gerar-resumo', async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;
    const accG = await assertRoteiroAcesso(pool, id, req, { exigeMutacao: true });
    if (accG.error === 'not_found') {
      return res.status(404).json({ error: 'Roteiro não encontrado.' });
    }
    if (accG.error === 'forbidden_catalog') {
      return res.status(404).json({ error: 'Roteiro não encontrado ou catálogo compartilhado não pode ser alterado por este tenant.' });
    }
    const tenantId = tenantIdForRequest(req);
    
    // 1. Buscar roteiro para obter cidades de origem e destino
    const roteiroResult = await pool
      .request()
      .input('IDROTEIRO', sql.Decimal(15, 0), parseFloat(id))
      .input('TID', sql.NVarChar(64), tenantId)
      .query(`
        SELECT 
          [r].[CDCIDADEORIGEM],
          [co].[NMCIDADE] AS ORIGEM_CIDADE,
          [co].[ESTADO] AS ORIGEM_ESTADO,
          [r].[CDCIDADEDESTINO],
          [cd].[NMCIDADE] AS DESTINO_CIDADE,
          [cd].[ESTADO] AS DESTINO_ESTADO
        FROM [dbo].[ROTEIRO] r
        LEFT JOIN [dbo].[CIDADE] co ON [r].[CDCIDADEORIGEM] = [co].[CDCIDADE]
        LEFT JOIN [dbo].[CIDADE] cd ON [r].[CDCIDADEDESTINO] = [cd].[CDCIDADE]
        WHERE [r].[IDROTEIRO] = @IDROTEIRO AND [r].[TENANT_ID] = @TID
      `);
    
    const roteiro = roteiroResult.recordset[0];
    const cidadeOrigemReal = roteiro?.ORIGEM_CIDADE || null;
    const estadoOrigemReal = roteiro?.ORIGEM_ESTADO || null;
    const cidadeDestinoReal = roteiro?.DESTINO_CIDADE || null;
    const estadoDestinoReal = roteiro?.DESTINO_ESTADO || null;
    
    // 2. Buscar pontos do roteiro
    const pontosResult = await pool
      .request()
      .input('IDROTEIRO', sql.Decimal(15, 0), parseFloat(id))
      .query(`
        SELECT 
          [SEQUENCIA],
          [ORDEM],
          [DSLOCAL],
          [DSPOSICAO],
          [LATITUDE],
          [LONGITUDE],
          [TPLOCAL],
          [KMENTREPONTOS],
          [ESTADOPASSAGEM]
        FROM [dbo].[ROTEIROPONTOS]
        WHERE [IDROTEIRO] = @IDROTEIRO
          AND [LATITUDE] IS NOT NULL
          AND [LONGITUDE] IS NOT NULL
        ORDER BY [ORDEM] ASC, [SEQUENCIA] ASC
      `);
    
    // Converter recordset para array JavaScript padrão
    const pontos = Array.from(pontosResult.recordset);
    
    if (pontos.length < 2) {
      return res.status(400).json({ 
        error: 'É necessário ter pelo menos 2 pontos com coordenadas para gerar o resumo.' 
      });
    }
    
    // 3. Obter nomes reais das cidades dos pontos
    // Identificar origem e destino pela ordem (primeiro = origem, último = destino)
    const primeiroPonto = pontos[0];
    const ultimoPonto = pontos[pontos.length - 1];
    
    for (let i = 0; i < pontos.length; i++) {
      const ponto = pontos[i];
      const isPrimeiro = i === 0;
      const isUltimo = i === pontos.length - 1;
      
      // Se for o primeiro ponto (origem), usar nome real da cidade da tabela
      if (isPrimeiro && cidadeOrigemReal) {
        ponto.NMCIDADE_REAL = cidadeOrigemReal;
        ponto.ESTADO_REAL = estadoOrigemReal;
        console.log(`[Resumo] Ponto origem: ${cidadeOrigemReal}/${estadoOrigemReal}`);
      }
      // Se for o último ponto (destino), usar nome real da cidade da tabela
      else if (isUltimo && cidadeDestinoReal) {
        ponto.NMCIDADE_REAL = cidadeDestinoReal;
        ponto.ESTADO_REAL = estadoDestinoReal;
        console.log(`[Resumo] Ponto destino: ${cidadeDestinoReal}/${estadoDestinoReal}`);
      }
      // Intermediários: se já há rótulo útil (DSPOSICAO/DSLOCAL), evita Nominatim (muito mais rápido)
      else {
        const labelBruto = String(ponto.DSPOSICAO || ponto.DSLOCAL || '').trim();
        const labelOk =
          labelBruto.length >= 3 &&
          !/^[\d.,\s-]+$/.test(labelBruto) &&
          !/^coord/i.test(labelBruto);
        if (labelOk) {
          ponto.NMCIDADE_REAL = labelBruto.split(/[,/]/)[0].trim();
          ponto.ESTADO_REAL = ponto.ESTADOPASSAGEM || '';
        } else {
        try {
          if (i > 0) {
            await new Promise((resolve) => setTimeout(resolve, 150));
          }

          const nominatimUrl = getReverseGeocodingUrl(ponto.LATITUDE, ponto.LONGITUDE);
          const nomResponse = await axios.get(nominatimUrl, {
            headers: { 
              'User-Agent': 'AtlasCargo/2.0' 
            },
                    timeout: 5000
          });
          
          const info = nomResponse.data;
          const cidade = info.address?.city || 
                        info.address?.town || 
                        info.address?.village || 
                        info.address?.municipality ||
                        info.address?.county || 
                        null;
          const estado = info.address?.state || 
                       info.address?.state_code || 
                       ponto.ESTADOPASSAGEM || 
                       '';
          
          if (cidade && cidade.trim() && cidade !== '') {
            // Limpar cidade: remover vírgulas, pontos e estados que possam estar no nome
            let cidadeLimpa = cidade.trim()
              .replace(/,\s*[A-Z]{2}$/i, '') // Remove ",SP", ",MG", etc do final
              .replace(/\.\s*[A-Z]{2}$/i, '') // Remove ".SP", ".MG", etc do final
              .replace(/\s+[A-Z]{2}$/i, '') // Remove " SP", " MG", etc do final
              .replace(/,\s*[A-Za-z\s]+$/i, '') // Remove vírgulas e texto após
              .trim();
            
            ponto.NMCIDADE_REAL = cidadeLimpa;
            ponto.ESTADO_REAL = estado || ponto.ESTADOPASSAGEM || '';
          } else {
            // Se Nominatim não retornou cidade, usar DSPOSICAO se disponível, senão DSLOCAL
            ponto.NMCIDADE_REAL = ponto.DSPOSICAO || ponto.DSLOCAL;
            ponto.ESTADO_REAL = ponto.ESTADOPASSAGEM || '';
          }
        } catch (nomErr) {
          // Se falhar, usar DSPOSICAO se disponível, senão DSLOCAL
          console.warn(`[Resumo Rota] Erro ao buscar cidade real para ponto ${i} (${ponto.DSLOCAL}):`, nomErr.message);
          ponto.NMCIDADE_REAL = ponto.DSPOSICAO || ponto.DSLOCAL;
          ponto.ESTADO_REAL = ponto.ESTADOPASSAGEM || '';
        }
        }
      }
      
      // Garantir que sempre tenha um nome (fallback final)
      if (!ponto.NMCIDADE_REAL || ponto.NMCIDADE_REAL.trim() === '') {
        ponto.NMCIDADE_REAL = ponto.DSPOSICAO || ponto.DSLOCAL || 'Cidade não identificada';
      }
      if (!ponto.ESTADO_REAL || ponto.ESTADO_REAL.trim() === '') {
        ponto.ESTADO_REAL = ponto.ESTADOPASSAGEM || '';
      }
    }
    
    // 4. Montar coordenadas para OSRM (usar LONGITUDE, LATITUDE na ordem correta)
    // Validar coordenadas antes de montar
    const pontosValidos = pontos.filter(p => {
      const lat = parseFloat(p.LATITUDE);
      const lon = parseFloat(p.LONGITUDE);
      return !isNaN(lat) && !isNaN(lon) && 
             lat >= -90 && lat <= 90 && 
             lon >= -180 && lon <= 180;
    });
    
    if (pontosValidos.length < 2) {
      return res.status(400).json({ 
        error: 'É necessário ter pelo menos 2 pontos com coordenadas válidas para gerar o resumo.' 
      });
    }
    
    // Ordenar pontos por ORDEM para garantir ordem correta na rota
    const pontosOrdenados = [...pontosValidos].sort((a, b) => {
      const ordemA = parseFloat(a.ORDEM) || 0;
      const ordemB = parseFloat(b.ORDEM) || 0;
      return ordemA - ordemB;
    });
    
    // 5. Buscar rota (trechos curtos + espelhos — mais robusto que uma única URL longa no OSRM público)
    const rotaData = await obterRotaMontadaTrechos(pontosOrdenados, tenantId);
    if (!rotaData) {
      return res.status(502).json({
        error:
          'Não foi possível calcular a rota nos servidores de roteamento. Verifique Configurações » Mapa ou tente novamente em instantes.',
      });
    }
    
    if (rotaData.code !== 'Ok' || !rotaData.routes || rotaData.routes.length === 0) {
      console.error('[Resumo Rota] OSRM retornou erro:', rotaData.code, rotaData.message);
      return res.status(400).json({ 
        error: 'Não foi possível calcular a rota. Verifique as coordenadas dos pontos.' 
      });
    }
    
    const route = rotaData.routes[0];
    const distanciaTotal = (route.distance / 1000).toFixed(2);
    const tempoEstimado = Math.round(route.duration / 3600); // em horas
    
    // 6. Identificar pontos principais (usando nomes reais)
    // Usar pontos ordenados para identificar origem e destino
    // Identificar origem e destino: primeiro por TPLOCAL, depois por ORDEM
    let pontoOrigem = pontosOrdenados.find(p => p.TPLOCAL === 'O' || p.TPLOCAL === 'Origem');
    let pontoDestino = pontosOrdenados.find(p => p.TPLOCAL === 'D' || p.TPLOCAL === 'Destino');
    
    // Se não encontrou por TPLOCAL, usar primeiro e último ponto por ORDEM
    if (!pontoOrigem) {
      // Primeiro ponto por ORDEM (menor ORDEM)
      pontoOrigem = pontosOrdenados[0];
    }
    if (!pontoDestino) {
      // Último ponto por ORDEM (maior ORDEM)
      pontoDestino = pontosOrdenados[pontosOrdenados.length - 1];
    }
    
    // Usar pontosOrdenados daqui em diante
    // O recordset do SQL Server pode não ser um array padrão, então vamos usar pontosOrdenados diretamente
    // Criar uma nova referência para os pontos ordenados
    const pontosParaProcessar = pontosOrdenados;
    
    // Filtrar pontos intermediários: excluir origem e destino identificados
    const pontosIntermediarios = pontosParaProcessar.filter(p => {
      const isOrigem = (p.SEQUENCIA === pontoOrigem.SEQUENCIA) || 
                       (p.ORDEM === pontoOrigem.ORDEM && pontoOrigem.ORDEM !== null && p.ORDEM === pontoOrigem.ORDEM);
      const isDestino = (p.SEQUENCIA === pontoDestino.SEQUENCIA) || 
                        (p.ORDEM === pontoDestino.ORDEM && pontoDestino.ORDEM !== null && p.ORDEM === pontoDestino.ORDEM);
      return !isOrigem && !isDestino;
    });
    
    // 7. Processar legs para obter informações de rodovias e cidades por trecho
    const trechosDetalhados = [];
    const todasRodovias = new Set();
    const todasCidades = new Set();
    
    // Adicionar cidades reais dos pontos à lista de cidades de referência
    pontos.forEach(p => {
      if (p.NMCIDADE_REAL && p.NMCIDADE_REAL.trim()) {
        todasCidades.add(p.NMCIDADE_REAL.trim());
      }
    });
    
    if (route.legs && route.legs.length > 0) {
      // Garantir que temos legs suficientes para os pontos
      const numLegs = Math.min(route.legs.length, pontosOrdenados.length - 1);
      
      for (let legIndex = 0; legIndex < numLegs; legIndex++) {
        const leg = route.legs[legIndex];
        const pontoOrigemTrecho = pontosOrdenados[legIndex];
        const pontoDestinoTrecho = pontosOrdenados[legIndex + 1];
        
        // Validar que os pontos existem
        if (!pontoOrigemTrecho || !pontoDestinoTrecho) {
          console.warn(`[Resumo Rota] Ponto origem ou destino não encontrado para leg ${legIndex}`);
          continue;
        }
        
        const rodoviasTrecho = new Set();
        /** Cidades do trecho na ordem dos steps (Nominatim), para "Passa por …". */
        const cidadesTrechoLista = [];
        const instrucoesTrecho = [];
        
        // Processar steps do leg para extrair rodovias (na ordem da rota)
        const rodoviasTrechoOrdenadas = [];
        if (leg.steps && leg.steps.length > 0) {
          for (const step of leg.steps) {
            // Extrair rodovias do step - OSRM pode retornar em vários campos
            const refs = [];
            
            // Tentar step.ref (string ou array) - mais confiável
            if (step.ref) {
              if (Array.isArray(step.ref)) {
                refs.push(...step.ref);
              } else {
                refs.push(step.ref);
              }
            }
            
            // Tentar step.name (pode conter rodovia)
            if (step.name) {
              if (Array.isArray(step.name)) {
                refs.push(...step.name);
              } else {
                refs.push(step.name);
              }
            }
            
            // Tentar step.maneuver.ref
            if (step.maneuver && step.maneuver.ref) {
              if (Array.isArray(step.maneuver.ref)) {
                refs.push(...step.maneuver.ref);
              } else {
                refs.push(step.maneuver.ref);
              }
            }
            
            // Processar todas as referências encontradas
            for (const ref of refs) {
              if (!ref || typeof ref !== 'string') continue;
              
              // Padrões: "BR-101", "BR 101", "101" (assumindo BR se não especificado), "SC-280", etc.
              let rodoviaMatch = ref.match(/^(BR|SC|PR|RS|SP|RJ|MG|ES|BA|SE|AL|PE|PB|RN|CE|PI|MA|PA|AP|AM|RR|AC|RO|MT|MS|GO|DF|TO)[-\s]?(\d+)/i);
              
              // Se não encontrou prefixo, tentar apenas número (assumir BR)
              if (!rodoviaMatch && /^\d+$/.test(ref.trim())) {
                rodoviaMatch = ['', 'BR', ref.trim()];
              }
              
              if (rodoviaMatch) {
                const rodoviaFormatada = `${rodoviaMatch[1].toUpperCase()}-${rodoviaMatch[2]}`;
                // Adicionar na ordem (evitar duplicatas consecutivas)
                if (rodoviasTrechoOrdenadas.length === 0 || 
                    rodoviasTrechoOrdenadas[rodoviasTrechoOrdenadas.length - 1] !== rodoviaFormatada) {
                  rodoviasTrechoOrdenadas.push(rodoviaFormatada);
                }
                rodoviasTrecho.add(rodoviaFormatada);
                todasRodovias.add(rodoviaFormatada);
              }
            }
          }
        }
        
        // Extrair cidades dos steps usando Nominatim (buscar mais cidades para rotas longas)
        if (leg.steps && leg.steps.length > 0) {
          const stepsParaProcessar = [];
          const totalSteps = leg.steps.length;
          const distanciaTrecho = leg.distance / 1000;
          
          // Para rotas longas (>500km), buscar mais cidades (até 8)
          // Para rotas médias (200-500km), buscar 6-8 cidades
          // Para rotas curtas (<200km), buscar 4-5 cidades
          const numCidadesDesejadas = distanciaTrecho > 500 ? 8 : (distanciaTrecho > 200 ? 6 : 5);
          
          // Selecionar steps estratégicos distribuídos uniformemente ao longo da rota
          // Não incluir primeiro e último step (já são origem e destino)
          const stepsIntermediarios = totalSteps - 2; // Excluir primeiro e último
          
          if (stepsIntermediarios > 0) {
            // Distribuir steps uniformemente ao longo da rota
            // Processar apenas o número necessário de steps (não exagerar)
            const numStepsParaProcessar = Math.min(numCidadesDesejadas, stepsIntermediarios);
            
            // Distribuição uniforme simples
            for (let i = 0; i < numStepsParaProcessar; i++) {
              // Calcular posição distribuída uniformemente
              const posicao = Math.floor(1 + (i / Math.max(1, numStepsParaProcessar - 1)) * stepsIntermediarios);
              if (posicao >= 1 && posicao < totalSteps - 1) {
                // Evitar duplicatas
                const jaExiste = stepsParaProcessar.some(s => s.index === posicao);
                if (!jaExiste) {
                  stepsParaProcessar.push({ step: leg.steps[posicao], index: posicao });
                }
              }
            }
            
            // Adicionar apenas alguns steps extras em pontos estratégicos (quartis)
            if (totalSteps > 8) {
              const quartil1 = Math.floor(totalSteps * 0.25);
              const quartil2 = Math.floor(totalSteps * 0.5);
              const quartil3 = Math.floor(totalSteps * 0.75);
              
              [quartil1, quartil2, quartil3].forEach(q => {
                if (q > 0 && q < totalSteps - 1) {
                  const jaExiste = stepsParaProcessar.some(s => s.index === q);
                  if (!jaExiste && stepsParaProcessar.length < numCidadesDesejadas + 3) {
                    stepsParaProcessar.push({ step: leg.steps[q], index: q });
                  }
                }
              });
            }
          }
          
          // Se ainda não conseguiu steps suficientes, adicionar o meio
          if (stepsParaProcessar.length < 3 && totalSteps > 3) {
            const meio = Math.floor(totalSteps / 2);
            if (meio > 0 && meio < totalSteps - 1) {
              const jaExiste = stepsParaProcessar.some(s => s.index === meio);
              if (!jaExiste) {
                stepsParaProcessar.push({ step: leg.steps[meio], index: meio });
              }
            }
          }
          
          // Processar steps selecionados em paralelo (sem delays artificiais; Nominatim já tem timeout curto)
          const promisesNominatim = [];
          
          // Processar todos os steps selecionados (não limitar pelo numCidadesDesejadas aqui)
          // Ordenar por índice para processar na ordem da rota
          stepsParaProcessar.sort((a, b) => a.index - b.index);
          
          for (let idx = 0; idx < stepsParaProcessar.length; idx++) {
            const { step, index: stepIndex } = stepsParaProcessar[idx];

            if (step.maneuver && step.maneuver.location) {
              const [lon, lat] = step.maneuver.location;

              const promise = (async () => {
                try {
                  const nominatimUrl = getReverseGeocodingUrl(lat, lon);
                  const nomResponse = await axios.get(nominatimUrl, {
                    headers: {
                      'User-Agent': 'AtlasCargo/2.0',
                    },
                    timeout: 8000,
                  });

                  const info = nomResponse.data;

                  let cidade =
                    info.address?.city ||
                    info.address?.town ||
                    info.address?.village ||
                    info.address?.municipality ||
                    info.address?.county ||
                    '';

                  if (cidade) {
                    cidade = cidade
                      .trim()
                      .replace(/,\s*[A-Z]{2}$/i, '')
                      .replace(/\.\s*[A-Z]{2}$/i, '')
                      .replace(/\s+[A-Z]{2}$/i, '')
                      .replace(/,\s*[A-Za-z\s]+$/i, '')
                      .trim();
                  }

                  const estadoNome = info.address?.state || info.address?.state_code || '';

                  if (cidade && cidade.trim().length > 2) {
                    const cidadeLower = cidade.toLowerCase().trim();
                    const ignorar = ['brasil', 'brazil', 'unknown', 'desconhecido'];
                    if (ignorar.includes(cidadeLower)) {
                      return { stepIndex, cidadeCompleta: null };
                    }
                    const cidadeCompleta = formatarCidadeComUF(cidade.trim(), estadoNome);
                    return { stepIndex, cidadeCompleta };
                  }

                  return { stepIndex, cidadeCompleta: null };
                } catch (nomErr) {
                  console.warn(`[Resumo Rota] Erro ao buscar cidade do Nominatim:`, nomErr.message);
                  return { stepIndex, cidadeCompleta: null };
                }
              })();

              promisesNominatim.push(promise);
            }
          }

          const resultadosComIndice = await Promise.all(promisesNominatim);
          resultadosComIndice.sort((a, b) => a.stepIndex - b.stepIndex);

          const nomeCidadeBase = (cidade) => {
            if (!cidade) return '';
            return cidade.split('/')[0].trim().toLowerCase();
          };

          let cidadesAdicionadas = 0;
          for (const { cidadeCompleta } of resultadosComIndice) {
            if (cidadeCompleta && cidadeCompleta.trim() && cidadeCompleta.trim().length > 2) {
              const nomeAtual = nomeCidadeBase(cidadeCompleta);
              const jaExiste = cidadesTrechoLista.some((c) => nomeCidadeBase(c) === nomeAtual);
              if (!jaExiste) {
                cidadesTrechoLista.push(cidadeCompleta);
                todasCidades.add(cidadeCompleta);
                cidadesAdicionadas += 1;
              }
            }
          }

          if (cidadesAdicionadas === 0 && promisesNominatim.length > 0) {
            console.warn(
              `[Resumo Rota] ⚠️ Nenhuma cidade adicionada para trecho de ${distanciaTrecho.toFixed(1)}km. Processados: ${promisesNominatim.length} steps, Resultados válidos: ${resultadosComIndice.filter((r) => r && r.cidadeCompleta && String(r.cidadeCompleta).trim()).length}`,
            );
          } else if (cidadesAdicionadas > 0) {
            console.log(
              `[Resumo Rota] ✅ ${cidadesAdicionadas} cidades adicionadas para trecho de ${distanciaTrecho.toFixed(1)}km: ${cidadesTrechoLista.slice(0, 5).join(', ')}${cidadesTrechoLista.length > 5 ? '...' : ''}`,
            );
          }
          
          // Extrair instrução importante (apenas primeira) de qualquer step
          if (leg.steps && leg.steps.length > 0) {
            for (const step of leg.steps) {
              if (step.maneuver && step.maneuver.instruction && instrucoesTrecho.length === 0) {
                instrucoesTrecho.push(step.maneuver.instruction);
                break;
              }
            }
          }
        }
        
        // Usar rodovias ordenadas (primeiras 3 principais do trecho)
        const rodoviasPrincipaisTrecho = rodoviasTrechoOrdenadas
          .filter((r, i, arr) => arr.indexOf(r) === i) // Remover duplicatas
          .slice(0, 3);
        
        trechosDetalhados.push({
          pontoOrigem: pontoOrigemTrecho,
          pontoDestino: pontoDestinoTrecho,
          distancia: leg.distance / 1000,
          rodovias: rodoviasPrincipaisTrecho.length > 0 ? rodoviasPrincipaisTrecho : Array.from(rodoviasTrecho).slice(0, 3),
          cidades: cidadesTrechoLista.slice(),
          instrucoes: instrucoesTrecho,
        });
      }
    }
    
    const coordsRotaGeo = extrairCoordsGeometriaRota(route);
    const distKmRotaNum = route.distance ? route.distance / 1000 : 0;
    const nomeOrigemLinha = pontoOrigem.NMCIDADE_REAL || pontoOrigem.DSLOCAL;
    const estadoOrigemLinha = pontoOrigem.ESTADO_REAL || pontoOrigem.ESTADOPASSAGEM || '';
    const nomeDestinoLinha = pontoDestino.NMCIDADE_REAL || pontoDestino.DSLOCAL;
    const estadoDestinoLinha = pontoDestino.ESTADO_REAL || pontoDestino.ESTADOPASSAGEM || '';
    const origFmtLinha = formatarCidadeComUF(nomeOrigemLinha, estadoOrigemLinha);
    const destFmtLinha = formatarCidadeComUF(nomeDestinoLinha, estadoDestinoLinha);
    const intermediariosFmt = pontosIntermediarios.map((p) =>
      formatarCidadeComUF(p.NMCIDADE_REAL || p.DSLOCAL, p.ESTADO_REAL || p.ESTADOPASSAGEM || ''),
    );
    const intermediariosComCoord = pontosIntermediarios.map((p) => ({
      label: formatarCidadeComUF(p.NMCIDADE_REAL || p.DSLOCAL, p.ESTADO_REAL || p.ESTADOPASSAGEM || ''),
      lat: parseFloat(getRow(p, 'LATITUDE') != null ? getRow(p, 'LATITUDE') : p.LATITUDE),
      lon: parseFloat(getRow(p, 'LONGITUDE') != null ? getRow(p, 'LONGITUDE') : p.LONGITUDE),
      ordem: parseFloat(getRow(p, 'ORDEM') != null ? getRow(p, 'ORDEM') : p.ORDEM) || 0,
    }));
    let cidadesPercursoMotorista = [];
    try {
      if (coordsRotaGeo.length >= 2 && distKmRotaNum > 0) {
        const amostras = await coletarCidadesAmostragemRota(coordsRotaGeo, distKmRotaNum);
        cidadesPercursoMotorista = montarLinhaCidadesMotorista(
          origFmtLinha,
          destFmtLinha,
          intermediariosComCoord,
          amostras,
          coordsRotaGeo,
        );
      }
    } catch (err) {
      console.warn('[Resumo Rota] Cidades por amostragem:', err.message);
    }
    if (!cidadesPercursoMotorista.length) {
      const nb = nomeCidadeBaseFmt;
      const raw = [origFmtLinha, ...intermediariosFmt.filter(Boolean), destFmtLinha].filter(Boolean);
      for (const c of raw) {
        if (!cidadesPercursoMotorista.length || nb(c) !== nb(cidadesPercursoMotorista[cidadesPercursoMotorista.length - 1])) {
          cidadesPercursoMotorista.push(c);
        }
      }
    }

    // 8. Montar resumo formatado seguindo o padrão do exemplo
    // Usar texto simples em vez de emojis para evitar problemas de encoding no banco
    let resumoTexto = `[] Resumo da Rota – Roteiro #${id}\n`;
    
    // Lista de pontos (origem, passagens/paradas, destino) - usando nomes reais
    const nomeOrigem = pontoOrigem.NMCIDADE_REAL || pontoOrigem.DSLOCAL;
    const estadoOrigem = pontoOrigem.ESTADO_REAL || pontoOrigem.ESTADOPASSAGEM || '';
    resumoTexto += `Início (Origem): ${formatarCidadeComUF(nomeOrigem, estadoOrigem)}\n`;
    
    // Filtrar apenas pontos intermediários reais (já filtrado acima, mas garantir)
    const pontosIntermediariosReais = pontosIntermediarios;
    
    if (pontosIntermediariosReais.length > 0) {
      pontosIntermediariosReais.forEach(p => {
        const tipoTexto = p.TPLOCAL === 'P' ? 'Passagem' : 'Parada';
        const nomeCidade = p.NMCIDADE_REAL || p.DSLOCAL;
        const estadoCidade = p.ESTADO_REAL || p.ESTADOPASSAGEM || '';
        resumoTexto += `${tipoTexto}: ${formatarCidadeComUF(nomeCidade, estadoCidade)}\n`;
      });
    }
    
    const nomeDestino = pontoDestino.NMCIDADE_REAL || pontoDestino.DSLOCAL;
    const estadoDestino = pontoDestino.ESTADO_REAL || pontoDestino.ESTADOPASSAGEM || '';
    resumoTexto += `Destino (Final): ${formatarCidadeComUF(nomeDestino, estadoDestino)}\n\n`;

    resumoTexto += `[] Cidades ao longo do percurso (ordem aproximada, pela malha rodoviária)\n`;
    resumoTexto += `${cidadesPercursoMotorista.join(' → ')}\n`;
    resumoTexto +=
      '(Lista gerada por amostragem ao longo da rota + pontos do roteiro; nomes via Nominatim — podem faltar municípios muito pequenos ou variar a grafia.)\n\n';

    // Orientações de percurso
    resumoTexto += `[] Orientações de percurso\n`;
    
    // Processar cada trecho detalhadamente
    for (let i = 0; i < trechosDetalhados.length; i++) {
      const trecho = trechosDetalhados[i];
      const pontoAtual = trecho.pontoOrigem;
      const proximoPonto = trecho.pontoDestino;
      const distanciaTrecho = trecho.distancia || proximoPonto.KMENTREPONTOS || 0;
      
      // Usar nomes reais das cidades com UF
      const nomeAtual = pontoAtual.NMCIDADE_REAL || pontoAtual.DSLOCAL;
      const estadoAtual = pontoAtual.ESTADO_REAL || pontoAtual.ESTADOPASSAGEM || '';
      const nomeProximo = proximoPonto.NMCIDADE_REAL || proximoPonto.DSLOCAL;
      const estadoProximo = proximoPonto.ESTADO_REAL || proximoPonto.ESTADOPASSAGEM || '';
      
      resumoTexto += `Trecho ${formatarCidadeComUF(nomeAtual, estadoAtual)} -> ${formatarCidadeComUF(nomeProximo, estadoProximo)} (~ ${Math.round(distanciaTrecho)} km)\n`;
      
      // Adicionar instruções de rodovias de forma mais detalhada
      if (trecho.rodovias.length > 0) {
        const rodoviasFormatadas = trecho.rodovias.slice(0, 5);
        
        if (i === 0) {
          // Primeiro trecho: instrução de saída detalhada
          if (rodoviasFormatadas.length >= 2) {
            // Se houver múltiplas rodovias, mostrar conexão
            // Pegar primeira cidade intermediária que não seja a origem
            const primeiraCidadeIntermediaria = trecho.cidades && trecho.cidades.length > 0
              ? trecho.cidades.find(c => {
                  if (!c) return false;
                  const cidadeNome = c.split('/')[0].trim().toLowerCase();
                  return cidadeNome !== nomeAtual.split('/')[0].trim().toLowerCase();
                }) || trecho.cidades[0]
              : null;
            
            if (primeiraCidadeIntermediaria) {
              resumoTexto += `Seguir pela ${rodoviasFormatadas[0]} até ${primeiraCidadeIntermediaria}.\n`;
            } else {
              resumoTexto += `Seguir pela ${rodoviasFormatadas[0]}.\n`;
            }
            resumoTexto += `Entrar na ${rodoviasFormatadas[1]} em direção a ${formatarCidadeComUF(nomeProximo, estadoProximo)}.\n`;
          } else {
            resumoTexto += `Pela ${rodoviasFormatadas[0]}, em direção a ${formatarCidadeComUF(nomeProximo, estadoProximo)}.\n`;
          }
        } else {
          // Trechos seguintes
          if (rodoviasFormatadas.length >= 2) {
            resumoTexto += `Continuar pela ${rodoviasFormatadas[0]}, depois pegar a ${rodoviasFormatadas[1]}.\n`;
          } else if (rodoviasFormatadas.length === 1) {
            resumoTexto += `Seguir pela ${rodoviasFormatadas[0]}.\n`;
          }
        }
      } else {
        // Se não encontrou rodovias, usar descrição genérica
        resumoTexto += `Seguir pela rota principal em direção a ${formatarCidadeComUF(nomeProximo, estadoProximo)}.\n`;
      }
      
      // Adicionar cidades de referência (cidades intermediárias encontradas pelo Nominatim)
      // Não incluir origem e destino do trecho, apenas cidades intermediárias
      if (trecho.cidades && Array.isArray(trecho.cidades) && trecho.cidades.length > 0) {
        // Simplificar: só remover se for EXATAMENTE igual (case-insensitive, sem estado)
        const nomeAtualSemEstado = nomeAtual.split('/')[0].trim().toLowerCase();
        const nomeProximoSemEstado = nomeProximo.split('/')[0].trim().toLowerCase();
        
        const cidadesFormatadas = trecho.cidades
          .filter(c => {
            if (!c || !c.trim() || c.trim().length < 3) return false;
            
            const cSemEstado = c.split('/')[0].trim().toLowerCase();
            
            // Remover apenas se for EXATAMENTE igual (case-insensitive)
            return cSemEstado !== nomeAtualSemEstado && 
                   cSemEstado !== nomeProximoSemEstado;
          })
          .slice(0, 20); // Até 20 cidades intermediárias
        
        // SEMPRE mostrar "Passa por..." se houver pelo menos uma cidade válida
        if (cidadesFormatadas.length > 0) {
          resumoTexto += `Passa por ${cidadesFormatadas.join(', ')}.\n`;
        } else {
          // Debug: verificar por que as cidades foram filtradas
          console.log(`[Resumo Rota] ⚠️ Trecho ${nomeAtual} -> ${nomeProximo}: ${trecho.cidades.length} cidades coletadas, mas todas foram filtradas. Cidades:`, trecho.cidades);
        }
      } else {
        // Debug: verificar por que não há cidades
        console.log(`[Resumo Rota] ⚠️ Trecho ${nomeAtual} -> ${nomeProximo}: sem cidades. trecho.cidades =`, trecho.cidades);
      }
      
      resumoTexto += `Chegada em ${formatarCidadeComUF(nomeProximo, estadoProximo)}.\n\n`;
    }
    
    // Pontos importantes
    resumoTexto += `[] Pontos importantes\n`;
    resumoTexto += `Distância total: ${distanciaTotal} km.\n`;
    resumoTexto += `Tempo estimado de viagem: ${tempoEstimado}–${tempoEstimado + 2} horas (dependendo de tráfego e paradas).\n`;
    
    // 7. Salvar resumo no banco (PostgreSQL: information_schema em minúsculas)
    const checkResumoColumn = await pool
      .request()
      .query(`
        SELECT column_name AS "COLUMN_NAME"
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND LOWER(table_name) = 'roteiro'
          AND LOWER(column_name) = 'resumorota'
      `);
    
    const temRESUMOROTA = checkResumoColumn.recordset.length > 0;
    
    if (temRESUMOROTA) {
      await pool
        .request()
        .input('IDROTEIRO', sql.Decimal(15, 0), parseFloat(id))
        .input('TID', sql.NVarChar(64), tenantId)
        .input('RESUMOROTA', sql.NVarChar(sql.MAX), resumoTexto)
        .query(`
          UPDATE [dbo].[ROTEIRO]
          SET [RESUMOROTA] = @RESUMOROTA,
              [DHMAINTENANCE] = GETDATE(),
              [SGUSER] = 'SYSTEM',
              [SERVERORIG] = 'AppDVcargas'
          WHERE [IDROTEIRO] = @IDROTEIRO AND [TENANT_ID] = @TID
        `);
    }
    
    res.json({
      success: true,
      resumo: resumoTexto,
      distanciaTotal: parseFloat(distanciaTotal),
      tempoEstimado: tempoEstimado,
      pontosProcessados: pontosParaProcessar.length
    });
    
  } catch (err) {
    console.error('Erro ao gerar resumo da rota:', err);
    console.error('Stack trace:', err.stack);
    res.status(500).json({ 
      error: 'Erro ao gerar resumo da rota.',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

module.exports = router;