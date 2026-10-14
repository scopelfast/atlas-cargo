/**
 * Roteamento via Configurações » Mapa (router_server).
 * Espelhos públicos só entram quando não há URL de roteador configurada no tenant.
 */
'use strict';

const axios = require('axios');
const { poolPromise } = require('../config/db');
const sqlCfg = require('../config/mssql-compat');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');

const CHAVE_ROUTER = 'router_server';

const UA_MAPA = 'AtlasCargo-SysScopel/1.0 (rota mapa motorista)';
const UA_RESUMO = 'AtlasCargo-SysScopel/1.0 (gerar-resumo-rota)';

function dedupeUrls(urls) {
  const seen = new Set();
  return urls.filter((u) => {
    if (!u || seen.has(u)) return false;
    seen.add(u);
    return true;
  });
}

function pushOsrmUrlsFromRouterBase(base, coords, qs, out) {
  const b = String(base || '').trim().replace(/\/$/, '');
  if (!b || !/^https?:\/\//i.test(b)) return;
  if (b.includes('/ors/')) return;
  out.push(`${b}/${coords}?${qs}`);
  if (b.includes('driving-hgv')) {
    out.push(`${b.replace(/driving-hgv/g, 'driving')}/${coords}?${qs}`);
  }
}

function toCoordsArray(coords) {
  return String(coords || '')
    .split(';')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split(',').map(Number))
    .filter((xy) => xy.length === 2 && Number.isFinite(xy[0]) && Number.isFinite(xy[1]));
}

function buildOrsGeojsonUrl(base) {
  const b = String(base || '').trim().replace(/\/$/, '');
  if (!b) return '';
  if (b.endsWith('/geojson')) return b;
  return b + '/geojson';
}

function osrmRouteHasUsableGeometry(route) {
  const g = route && route.geometry;
  if (!g || !g.coordinates) return false;
  if (g.type === 'LineString') {
    return Array.isArray(g.coordinates) && g.coordinates.length >= 2;
  }
  if (g.type === 'MultiLineString') {
    return (
      Array.isArray(g.coordinates) &&
      g.coordinates.some((ring) => Array.isArray(ring) && ring.length >= 2)
    );
  }
  return false;
}

async function loadRouterBaseFromDb(tenantId) {
  const tid =
    tenantId != null && String(tenantId).trim() !== '' ? String(tenantId).trim() : getDefaultTenantId();
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('tenantId', sqlCfg.NVarChar(64), tid)
      .input('k', CHAVE_ROUTER)
      .query(`SELECT "VALOR" FROM "CONFIGURACAO" WHERE "TENANT_ID" = @tenantId AND "CHAVE" = @k`);
    const row = result.recordset && result.recordset[0];
    if (!row) return '';
    return row.VALOR != null ? String(row.VALOR).trim() : '';
  } catch (e) {
    return '';
  }
}

async function buildUniqCandidatos(coordsStr, tenantId, qs) {
  const baseFromDb = await loadRouterBaseFromDb(tenantId);
  const coordsArray = toCoordsArray(coordsStr);
  const candidatos = [];
  const baseNorm = String(baseFromDb || '').trim().replace(/\/$/, '');
  if (baseNorm && baseNorm.includes('/ors/')) {
    candidatos.push({ type: 'ors', url: buildOrsGeojsonUrl(baseNorm) });
  } else {
    const osrmUrls = [];
    pushOsrmUrlsFromRouterBase(baseFromDb, coordsStr, qs, osrmUrls);
    dedupeUrls(osrmUrls).forEach((u) => candidatos.push({ type: 'osrm', url: u }));
  }
  // Sem router_server no banco: mantém espelhos públicos como fallback (instalação sem config).
  if (!baseNorm) {
    candidatos.push(
      { type: 'osrm', url: `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordsStr}?${qs}` },
      { type: 'osrm', url: `https://router.project-osrm.org/route/v1/driving/${coordsStr}?${qs}` },
      { type: 'osrm', url: `https://router.project-osrm.org/route/v1/driving-hgv/${coordsStr}?${qs}` }
    );
  }
  const uniq = [];
  const seen = new Set();
  candidatos.forEach((c) => {
    const k = `${c.type}:${c.url}`;
    if (!c || !c.url || seen.has(k)) return;
    seen.add(k);
    uniq.push(c);
  });
  return { uniq, coordsArray };
}

async function runMapTryOne(cand, coordsArray, axiosOptsOsrm) {
  const ti = Date.now();
  if (cand.type === 'ors') {
    const payload = { coordinates: coordsArray, instructions: false };
    const { data, status } = await axios.post(cand.url, payload, {
      timeout: 25000,
      validateStatus: () => true,
      headers: { 'User-Agent': UA_MAPA },
    });
    const okGeo =
      status >= 200 &&
      status < 300 &&
      data &&
      data.features &&
      data.features[0] &&
      data.features[0].geometry;
    if (okGeo) return { data, url: cand.url, elapsedMs: Date.now() - ti };
  } else {
    const { data, status } = await axios.get(cand.url, axiosOptsOsrm);
    const r0 = data && data.routes && data.routes[0];
    if (
      status >= 200 &&
      status < 300 &&
      data &&
      data.code === 'Ok' &&
      r0 &&
      osrmRouteHasUsableGeometry(r0)
    ) {
      return { data, url: cand.url, elapsedMs: Date.now() - ti };
    }
    if (data && data.code && data.code !== 'Ok') {
      console.warn(`[ROTA-OSRM] code=${data.code} status=${status}`);
    }
  }
  const err = new Error('invalid-route');
  err.code = 'INVALID_ROUTE';
  throw err;
}

/**
 * Mesmo contrato do GET /api/mapa/rota-osrm: GeoJSON ORS ou JSON OSRM bruto.
 * @returns {{ data: object, url: string, elapsedMs: number } | null}
 */
async function fetchRouteMapRaw(coordsStr, tenantId) {
  const qs = 'overview=full&geometries=geojson&alternatives=false&steps=false';
  const { uniq, coordsArray } = await buildUniqCandidatos(coordsStr, tenantId, qs);
  const axiosOptsOsrm = {
    timeout: 52000,
    validateStatus: () => true,
    headers: { 'User-Agent': UA_MAPA },
  };
  let winner = null;
  if (typeof Promise.any === 'function') {
    try {
      winner = await Promise.any(uniq.map((cand) => runMapTryOne(cand, coordsArray, axiosOptsOsrm)));
    } catch (agg) {
      if (agg && agg.errors) {
        agg.errors.forEach((e) => console.warn('[ROTA-OSRM] mirror:', e.code || e.message));
      }
    }
  } else {
    for (let i = 0; i < uniq.length; i++) {
      try {
        winner = await runMapTryOne(uniq[i], coordsArray, axiosOptsOsrm);
        break;
      } catch (e) {
        console.warn(`[ROTA-OSRM] mirror ${i + 1}/${uniq.length} erro:`, e.code || e.message);
      }
    }
  }
  if (winner) {
    winner.mirrorCount = uniq.length;
  }
  return winner;
}

function pushOsrmTripUrlsFromRouterBase(base, coordsStr, qs, out) {
  const b = String(base || '').trim().replace(/\/$/, '');
  if (!b || !/^https?:\/\//i.test(b)) return;
  if (b.includes('/ors/')) return;
  /** Base OSRM tipicamente termina em /route/v1/driving — converte para /trip/v1/driving. */
  const tripBase = b.replace('/route/v1/', '/trip/v1/');
  if (!/\/trip\/v1\//.test(tripBase)) return;
  out.push(`${tripBase}/${coordsStr}?${qs}`);
  if (tripBase.includes('driving-hgv')) {
    out.push(`${tripBase.replace(/driving-hgv/g, 'driving')}/${coordsStr}?${qs}`);
  }
}

/**
 * Trip API do OSRM (TSP): reordena waypoints intermediários para minimizar distância/tempo.
 * @param {string} coordsStr "lon,lat;lon,lat;..." — primeiro ponto = origem fixa.
 * @param {string} tenantId
 * @param {{ roundtrip?: boolean }} opts roundtrip=true volta ao primeiro; false termina em qualquer ponto.
 * @returns {Promise<{ data: object, url: string, elapsedMs: number, optimizedOrder: number[] }|null>}
 */
async function fetchTripRawByCoords(coordsStr, tenantId, opts) {
  const roundtrip = opts && opts.roundtrip === false ? false : true;
  /** source=first fixa o ponto inicial (depósito); roundtrip controla retorno. */
  const qs = `source=first&roundtrip=${roundtrip ? 'true' : 'false'}&overview=full&geometries=geojson&steps=false`;
  const baseFromDb = await loadRouterBaseFromDb(tenantId);
  const baseNorm = String(baseFromDb || '').trim().replace(/\/$/, '');
  const tripUrls = [];
  /**
   * ORS (/ors/v2) não tem Trip API (TSP). Nesses casos usamos espelhos OSRM públicos
   * só para reordenar paradas; a geometria/distância da rota operacional pode vir do ORS
   * (Route) na sequência já otimizada — ver calcularSalvarRotaOperacionalCarga.
   */
  if (baseNorm && !baseNorm.includes('/ors/')) {
    pushOsrmTripUrlsFromRouterBase(baseNorm, coordsStr, qs, tripUrls);
  }
  if (!tripUrls.length) {
    tripUrls.push(`https://routing.openstreetmap.de/routed-car/trip/v1/driving/${coordsStr}?${qs}`);
    tripUrls.push(`https://router.project-osrm.org/trip/v1/driving/${coordsStr}?${qs}`);
    tripUrls.push(`https://router.project-osrm.org/trip/v1/driving-hgv/${coordsStr}?${qs}`);
  }
  const uniq = dedupeUrls(tripUrls);
  if (!uniq.length) return null;
  const axiosOpts = { timeout: 52000, validateStatus: () => true, headers: { 'User-Agent': UA_MAPA } };
  const tryOne = async (url) => {
    const ti = Date.now();
    const { data, status } = await axios.get(url, axiosOpts);
    const t0 = data && Array.isArray(data.trips) ? data.trips[0] : null;
    if (status >= 200 && status < 300 && data && data.code === 'Ok' && t0 && osrmRouteHasUsableGeometry(t0)) {
      const wps = Array.isArray(data.waypoints) ? data.waypoints : [];
      /** waypoint_index = posição na ordem otimizada. Indices originais ordenados por waypoint_index. */
      const optimizedOrder = wps
        .map((w, idx) => ({ idx, wi: Number(w && w.waypoint_index) }))
        .filter((x) => Number.isFinite(x.wi))
        .sort((a, b) => a.wi - b.wi)
        .map((x) => x.idx);
      return { data, url, elapsedMs: Date.now() - ti, optimizedOrder };
    }
    if (data && data.code && data.code !== 'Ok') {
      console.warn(`[ROTA-TRIP] code=${data.code} status=${status} url=${url}`);
    }
    const err = new Error('invalid-trip');
    err.code = 'INVALID_TRIP';
    throw err;
  };
  let winner = null;
  if (typeof Promise.any === 'function') {
    try {
      winner = await Promise.any(uniq.map(tryOne));
    } catch (agg) {
      if (agg && agg.errors) agg.errors.forEach((e) => console.warn('[ROTA-TRIP] mirror:', e.code || e.message));
    }
  } else {
    for (const u of uniq) {
      try {
        winner = await tryOne(u);
        break;
      } catch (e) {
        console.warn('[ROTA-TRIP] mirror erro:', e.code || e.message);
      }
    }
  }
  return winner;
}

/** Converte resposta Trip API ({trips:[...]}) para shape de Route ({routes:[...]}). */
function tripToRouteShape(tripData) {
  if (!tripData || !Array.isArray(tripData.trips) || !tripData.trips.length) return null;
  const t0 = tripData.trips[0];
  const r0 = {
    distance: Number(t0.distance) || 0,
    duration: Number(t0.duration) || 0,
    geometry: t0.geometry || null,
    legs: Array.isArray(t0.legs) ? t0.legs : [],
    weight: t0.weight,
    weight_name: t0.weight_name,
  };
  return { code: 'Ok', routes: [r0], waypoints: tripData.waypoints || [] };
}

function osrmResumoTrechoOk(data, withSteps) {
  if (!data || data.code !== 'Ok' || !data.routes || !data.routes[0]) return false;
  const r0 = data.routes[0];
  if (!osrmRouteHasUsableGeometry(r0)) return false;
  if (withSteps && (!r0.legs || r0.legs.length === 0)) return false;
  return true;
}

function haversineMetersLonLat(lon1, lat1, lon2, lat2) {
  const R = 6371000;
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Comprimento aproximado (m) da LineString GeoJSON [lon,lat][] — fallback quando ORS não manda summary. */
function lineStringLengthMetersApprox(coords) {
  if (!coords || coords.length < 2) return 0;
  let t = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    if (Array.isArray(a) && Array.isArray(b) && a.length >= 2 && b.length >= 2) {
      t += haversineMetersLonLat(Number(a[0]), Number(a[1]), Number(b[0]), Number(b[1]));
    }
  }
  return t;
}

function normalizeOrsFeatureToOsrmResumo(data) {
  const f = data && data.features && data.features[0];
  if (!f || !f.geometry) return null;
  const g = f.geometry;
  const props = f.properties || {};
  const summary = props.summary || {};
  let dist =
    typeof summary.distance === 'number'
      ? summary.distance
      : Number(summary && summary.distance != null ? summary.distance : NaN);
  let dur =
    typeof summary.duration === 'number'
      ? summary.duration
      : Number(summary && summary.duration != null ? summary.duration : NaN);
  if (!Number.isFinite(dist) || dist < 0) dist = 0;
  if (!Number.isFinite(dur) || dur < 0) dur = 0;
  if ((!dist || !dur) && Array.isArray(props.segments) && props.segments.length) {
    let sd = 0;
    let st = 0;
    for (const seg of props.segments) {
      sd += Number(seg && seg.distance) || 0;
      st += Number(seg && seg.duration) || 0;
    }
    if (sd > 0) dist = sd;
    if (st > 0) dur = st;
  }
  let coordinates;
  if (g.type === 'LineString' && g.coordinates && g.coordinates.length >= 2) {
    coordinates = g.coordinates;
  } else if (g.type === 'MultiLineString' && g.coordinates && g.coordinates.length) {
    coordinates = [];
    for (const ring of g.coordinates) {
      if (Array.isArray(ring)) coordinates = coordinates.concat(ring);
    }
    if (coordinates.length < 2) return null;
  } else {
    return null;
  }
  if (!dist || dist <= 0) {
    const approx = lineStringLengthMetersApprox(coordinates);
    if (approx > 0) {
      dist = approx;
      if (!dur || dur <= 0) dur = Math.max(60, Math.round(approx / 12));
    }
  }
  return {
    code: 'Ok',
    routes: [
      {
        distance: dist,
        duration: dur,
        geometry: { type: 'LineString', coordinates },
        legs: [{ distance: dist, duration: dur, steps: [] }],
      },
    ],
  };
}

function normalizeOsrmFallbackLegs(data) {
  if (!data || data.code !== 'Ok' || !data.routes || !data.routes[0]) return null;
  const r0 = data.routes[0];
  if (!osrmRouteHasUsableGeometry(r0)) return null;
  const legs =
    r0.legs && r0.legs.length
      ? r0.legs
      : [{ distance: r0.distance || 0, duration: r0.duration || 0, steps: [] }];
  return {
    code: 'Ok',
    routes: [{ ...r0, legs }],
  };
}

function normalizeRawToResumoShape(raw) {
  if (!raw) return null;
  if (raw.features && raw.features[0]) return normalizeOrsFeatureToOsrmResumo(raw);
  return normalizeOsrmFallbackLegs(raw);
}

async function runResumoPrimaryTryOne(cand, coordsArray, axiosOptsOsrm) {
  if (cand.type === 'ors') {
    const payload = { coordinates: coordsArray, instructions: false };
    const { data, status } = await axios.post(cand.url, payload, {
      timeout: 25000,
      validateStatus: () => true,
      headers: { 'User-Agent': UA_RESUMO },
    });
    const okGeo =
      status >= 200 &&
      status < 300 &&
      data &&
      data.features &&
      data.features[0] &&
      data.features[0].geometry;
    if (okGeo) {
      const normalized = normalizeOrsFeatureToOsrmResumo(data);
      if (normalized) return normalized;
    }
  } else {
    const { data, status } = await axios.get(cand.url, axiosOptsOsrm);
    if (status >= 200 && status < 300 && osrmResumoTrechoOk(data, true)) {
      return data;
    }
  }
  const err = new Error('invalid-route');
  err.code = 'INVALID_ROUTE';
  throw err;
}

/**
 * Um trecho da rota no formato OSRM (code + routes[0].legs) para o gerar-resumo.
 * Prioriza steps=true nos espelhos OSRM; se falhar, usa o mesmo fluxo do mapa (ORS + OSRM sem steps) e normaliza.
 */
async function fetchRouteResumoSegment(coordsStr, tenantId) {
  const qsTrue = 'overview=full&geometries=geojson&steps=true&alternatives=false';
  const { uniq, coordsArray } = await buildUniqCandidatos(coordsStr, tenantId, qsTrue);
  const axiosOptsOsrm = {
    timeout: 52000,
    validateStatus: () => true,
    headers: { 'User-Agent': UA_RESUMO },
  };

  let resolved = null;
  if (typeof Promise.any === 'function') {
    try {
      resolved = await Promise.any(uniq.map((cand) => runResumoPrimaryTryOne(cand, coordsArray, axiosOptsOsrm)));
    } catch (_) {
      /* fallback abaixo */
    }
  } else {
    for (const cand of uniq) {
      try {
        resolved = await runResumoPrimaryTryOne(cand, coordsArray, axiosOptsOsrm);
        break;
      } catch (_) {
        /* próximo */
      }
    }
  }
  if (resolved) return resolved;

  const winner = await fetchRouteMapRaw(coordsStr, tenantId);
  return normalizeRawToResumoShape(winner && winner.data);
}

module.exports = {
  fetchRouteMapRaw,
  fetchRouteResumoSegment,
  fetchTripRawByCoords,
  tripToRouteShape,
  loadRouterBaseFromDb,
  normalizeRawToResumoShape,
};
