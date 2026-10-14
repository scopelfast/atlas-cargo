// ====================================
// CONFIGURAÇÕES DE MAPA E ROTEAMENTO
// ====================================
// ⚠️ ATENÇÃO: Este arquivo está sendo substituído por map-helper.js
// ⚠️ Use window.MapHelper para novas funcionalidades
// ⚠️ Este arquivo mantido apenas para compatibilidade
// Versão: 1.0 (Legacy)
// Data: 2026-12-04

window.MAP_CONFIG = {
  // ====================================
  // SERVIDOR DE TILES DO MAPA
  // ====================================
  // IMPORTANTE: Para mudar o servidor de mapas, edite a linha abaixo:
  
  // ====================================
  // CONFIGURAÇÃO DO SERVIDOR DE TILES
  // ====================================
  // OPÇÃO 1: Servidor próprio (HTTP) - Mais rápido, mas pode ter problemas com HTTPS
  // tileServer: 'http://186.250.92.131:8081/styles/osm-bright/{z}/{x}/{y}.png',
  
  // OPÇÃO 2: Servidor público OpenStreetMap.org (HTTPS) - Exige Referer; em muitos hosts dá 403
  // tileServer: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  
  // OPÇÃO 3: OSM Alemanha (HTTPS) — sem API key, sem Referer (padrão atual)
  // Carto (cartocdn) passou a exigir API key e mostra watermark "API KEY REQUIRED".
  tileServer: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
  
  // OPÇÃO 4: Carto Basemaps (só com chave gratuita em carto.com/basemaps/apikey)
  // tileServer: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png?key=SUA_CHAVE',
  
  // NOTA: servidor próprio (OPÇÃO 1) em HTTP não funciona se o dashboard estiver em HTTPS (mixed content).
  
  // ====================================
  // SERVIDOR DE ROTEAMENTO (OSRM - padrão oficial)
  // ====================================
  // Altere na tela Configurações do Sistema ou aqui como fallback.
  osrmServer: 'https://router.project-osrm.org/route/v1/driving-hgv',
  
  // ====================================
  // SERVIDOR DE GEOCODING (Nominatim - padrão oficial)
  // ====================================
  nominatimServer: 'https://nominatim.openstreetmap.org',
  
  // ====================================
  // CONFIGURAÇÕES GERAIS
  // ====================================
  
  // Mapa de Viagem: fallback se /api/configuracoes/mapa não responder (alinhado ao padrão de Alertas)
  posicaoStaleMinutos: 90,

  // Timeout para requisições de rota (milissegundos)
  routeTimeout: 15000, // 15 segundos
  
  // Timeout para tiles do mapa (milissegundos)
  tileTimeout: 10000, // 10 segundos
  
  // Máximo zoom do mapa
  maxZoom: 19,
  
  // Zoom inicial padrão
  defaultZoom: 4,
  
  // Centro padrão do mapa (Brasil)
  defaultCenter: [-14.2350, -51.9253],
  
  // Atribuição (créditos)
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  
  // ====================================
  // RETRY E FALLBACK
  // ====================================
  
  // Número de tentativas em caso de falha
  maxRetries: 2,
  
  // Tempo entre tentativas (milissegundos)
  retryDelay: 1000,
  
  // Preferir não desenhar linha reta no mapa quando a rota por estradas falhar (modal motorista ignora isto)
  useStraightLineOnError: false,
  
  // Mostrar mensagem de erro no console
  showErrorMessages: true,

  // Gateway backend do Atlas para roteamento (evita CORS do navegador e usa a configuração salva no sistema).
  useBackendRouteProxy: true
};

// ====================================
// FUNÇÕES AUXILIARES
// ====================================

function paginaEmHttps() {
  try {
    return typeof window !== 'undefined' && window.location && window.location.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function hostProprioMapa(url) {
  if (!url || typeof url !== 'string') return false;
  const low = url.trim().toLowerCase();
  return low.includes('186.250.92.131');
}

/** Em HTTPS, evita mixed-content: usa fallback público HTTPS para hosts HTTP-only. */
function normalizarBaseRoteamentoHttp(url) {
  if (!url || typeof url !== 'string') return url;
  const u = url.trim();
  if (hostProprioMapa(u)) {
    if (paginaEmHttps()) {
      return 'https://router.project-osrm.org/route/v1/driving';
    }
    return u.replace(/^https:/i, 'http:');
  }
  return u;
}

// Obter URL completa do OSRM com pontos (formato OSRM Route). ORS (/ors/v2) usa POST /geojson no backend — não chamar GET no navegador.
window.getOSRMUrl = function(coordinates, options = {}) {
  const config = window.MAP_CONFIG;
  const { overview = 'full', geometries = 'geojson' } = options;
  const coordsStr = coordinates.map(c => `${c.lon},${c.lat}`).join(';');
  const base = normalizarBaseRoteamentoHttp(config.osrmServer || '') || '';

  return `${base}/${coordsStr}?overview=${overview}&geometries=${geometries}`;
};

// Obter configuração do tile layer
window.getTileLayerConfig = function() {
  const config = window.MAP_CONFIG;
  // IMPORTANTE: Usar getTileServerUrl() que já trata HTTP/HTTPS corretamente
  let tileServer = window.getTileServerUrl ? window.getTileServerUrl() : (config.tileServer || 'https://tile.openstreetmap.de/{z}/{x}/{y}.png');
  
  return {
    url: tileServer,
    attribution: config.attribution || '© OpenStreetMap contributors',
    maxZoom: config.maxZoom || 19
  };
};

/** Fallback HTTPS sem API key (Carto raster agora exige chave). */
window.MAP_TILE_FALLBACK_HTTPS = 'https://tile.openstreetmap.de/{z}/{x}/{y}.png';

// Obter URL do tile server
window.getTileServerUrl = function() {
  const config = window.MAP_CONFIG;
  const fallback = window.MAP_TILE_FALLBACK_HTTPS || 'https://tile.openstreetmap.de/{z}/{x}/{y}.png';
  let tileServer = config.tileServer || fallback;
  
  // Se for servidor próprio (HTTP), garantir que use HTTP
  // Se for servidor público (HTTPS), manter HTTPS
  if (hostProprioMapa(tileServer)) {
    if (paginaEmHttps()) {
      tileServer = fallback;
    } else {
      tileServer = tileServer.replace(/^https:/i, 'http:');
    }
  }
  
  return tileServer;
};

// Obter URL do Nominatim para reverse geocoding
window.getNominatimReverseUrl = function(lat, lon, options = {}) {
  const config = window.MAP_CONFIG;
  const zoom = options.zoom || 10;
  return `${config.nominatimServer}/reverse?lat=${lat}&lon=${lon}&format=json&zoom=${zoom}&addressdetails=1`;
};

// Obter URL do Nominatim para forward geocoding (busca por endereço)
window.getNominatimSearchUrl = function(query, options = {}) {
  const config = window.MAP_CONFIG;
  const limit = options.limit || 1;
  return `${config.nominatimServer}/search?format=json&q=${encodeURIComponent(query)}&limit=${limit}&addressdetails=1`;
};

/**
 * Extrai geometria (LineString GeoJSON) + distância/duração de respostas OSRM ou ORS/GeoJSON.
 * @returns {{ geometry: object, distance: number, duration: number } | null}
 */
function extrairGeometriaRotaOsrm(r) {
  if (!r || !r.geometry) return null;
  const g = r.geometry;
  if (g.type === 'LineString' && g.coordinates && g.coordinates.length >= 2) {
    return {
      geometry: g,
      distance: typeof r.distance === 'number' ? r.distance : 0,
      duration: typeof r.duration === 'number' ? r.duration : 0
    };
  }
  if (g.type === 'MultiLineString' && g.coordinates && g.coordinates.length) {
    var flat = [];
    for (var mi = 0; mi < g.coordinates.length; mi++) {
      flat = flat.concat(g.coordinates[mi]);
    }
    if (flat.length >= 2) {
      return {
        geometry: { type: 'LineString', coordinates: flat },
        distance: typeof r.distance === 'number' ? r.distance : 0,
        duration: typeof r.duration === 'number' ? r.duration : 0
      };
    }
  }
  return null;
}

function extrairRotaDeRespostaJson(data) {
  if (!data) return null;
  if (data.code === 'Ok' && data.routes && data.routes[0] && data.routes[0].geometry) {
    const ex = extrairGeometriaRotaOsrm(data.routes[0]);
    if (ex) return ex;
  }
  if (data.routes && data.routes[0] && data.routes[0].geometry) {
    const ex = extrairGeometriaRotaOsrm(data.routes[0]);
    if (ex) return ex;
  }
  if (data.features && data.features[0] && data.features[0].geometry) {
    const g = data.features[0].geometry;
    if (g && g.type === 'LineString' && g.coordinates && g.coordinates.length >= 2) {
      const summary = data.features[0].properties && data.features[0].properties.summary;
      const distM = summary && typeof summary.distance === 'number' ? summary.distance : 0;
      const durS = summary && typeof summary.duration === 'number' ? summary.duration : 0;
      return { geometry: g, distance: distM, duration: durS };
    }
    if (g && g.type === 'MultiLineString' && g.coordinates && g.coordinates.length) {
      var flat = [];
      for (var mi = 0; mi < g.coordinates.length; mi++) {
        flat = flat.concat(g.coordinates[mi]);
      }
      if (flat.length >= 2) {
        return {
          geometry: { type: 'LineString', coordinates: flat },
          distance: 0,
          duration: 0
        };
      }
    }
  }
  return null;
}

/**
 * Converte resposta do gateway GET /api/mapa/rota-osrm para o formato OSRM (code + routes[]).
 * Cobre OSRM nativo e GeoJSON (ORS); usado por Gerenciar Roteiros / mapas.
 */
window.normalizarRespostaGatewayOsrm = function(data) {
  const ex = extrairRotaDeRespostaJson(data);
  if (!ex || !ex.geometry || !ex.geometry.coordinates || ex.geometry.coordinates.length < 2) {
    return null;
  }
  return {
    code: 'Ok',
    routes: [
      {
        distance: typeof ex.distance === 'number' ? ex.distance : 0,
        duration: typeof ex.duration === 'number' ? ex.duration : 0,
        geometry: ex.geometry
      }
    ]
  };
};

/**
 * Prefixo só para /cargas (app duplica rotas em /cargas/api).
 * Páginas em /motorista/... usam a API na raiz /api (não existe /motorista/api no servidor — evita HTML no lugar de JSON).
 */
function mapConfigApiUrl(path) {
  if (!path || path.indexOf('http') === 0) return path;
  var pathname =
    typeof window !== 'undefined' && window.location && window.location.pathname ? window.location.pathname : '';
  var prefix = pathname.indexOf('/cargas') !== -1 ? '/cargas' : '';
  var clean = path.indexOf('/') === 0 ? path : '/' + path;
  return prefix + clean;
}

/**
 * Busca rota via backend (Node → OSRM): contorna CORS e timeouts do browser no OSRM público.
 * timeoutMs deve ser >= tempo do Node (vários mirrors × ~35s). Valores ~20s causam net::ERR_CONNECTION_RESET
 * no browser enquanto o servidor ainda processa axios.
 */
function mapConfigFetchRotaComProxy(coordsStr, timeoutMs) {
  // Só desliga com false explícito (map-helper e reloads não podem zerar o flag)
  if (!window.MAP_CONFIG || window.MAP_CONFIG.useBackendRouteProxy === false) {
    return Promise.reject(new Error('route-gateway-disabled'));
  }
  var ms = timeoutMs != null && timeoutMs > 0 ? timeoutMs : 70000;
  var t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  var token = typeof localStorage !== 'undefined' ? localStorage.getItem('token') : null;
  var path =
    mapConfigApiUrl('/api/mapa/rota-osrm') + '?coords=' + encodeURIComponent(coordsStr);
  var controller = new AbortController();
  var tid = setTimeout(function() {
    console.warn('[ROTA-OSRM] Abort no cliente após ' + ms + 'ms — URL muito curta vs. tempo do proxy no servidor?');
    controller.abort();
  }, ms);
  var headers = { Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  console.info('[ROTA-OSRM] GET gateway-backend (timeout cliente ' + ms + 'ms, coords len ' + String(coordsStr).length + ')');
  return fetch(path, { signal: controller.signal, headers: headers, cache: 'no-store' })
    .then(function(r) {
      clearTimeout(tid);
      var dt = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - t0;
      if (r.status === 401 || r.status === 403) throw new Error('auth');
      if (r.status === 502) {
        console.warn('[ROTA-OSRM] Gateway 502 em ' + Math.round(dt) + 'ms (nenhum servidor de rota válido)');
        throw new Error('badgateway');
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      console.info('[ROTA-OSRM] Gateway OK em ' + Math.round(dt) + 'ms');
      return r.json();
    })
    .catch(function(e) {
      clearTimeout(tid);
      var dt = (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) - t0;
      console.warn('[ROTA-OSRM] Gateway falhou em ' + Math.round(dt) + 'ms:', e && e.name, e && e.message);
      throw e;
    });
}

/**
 * JSON OSRM (code/routes) via Node — evita CORS e timeouts do OSRM público no navegador.
 * Usar em Roteiros, Mapa de Viagem, Viagens (mesmo formato: lon,lat;lon,lat).
 */
window.fetchOsrmRouteJsonViaBackend = function(coordsStr, timeoutMs) {
  return mapConfigFetchRotaComProxy(coordsStr, timeoutMs || 70000);
};

function mapConfigFetchJsonUrl(url, timeoutMs) {
  const servidoresProprios = ['186.250.92.131'];
  const precisaHttp = servidoresProprios.some(function(s) { return url.indexOf(s) !== -1; });
  if (precisaHttp && paginaEmHttps()) {
    return Promise.reject(new Error('mixed-content-http-blocked'));
  }
  if (precisaHttp) {
    var httpUrl = url.replace(/^https:/i, 'http:');
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', httpUrl, true);
      xhr.timeout = timeoutMs;
      xhr.onload = function() {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error('HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function() { reject(new Error('network')); };
      xhr.ontimeout = function() { reject(new Error('timeout')); };
      xhr.send();
    });
  }
  var controller = new AbortController();
  var tid = setTimeout(function() { controller.abort(); }, timeoutMs);
  return fetch(url, { signal: controller.signal, mode: 'cors', cache: 'no-store' })
    .then(function(r) {
      clearTimeout(tid);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    })
    .catch(function(e) {
      clearTimeout(tid);
      throw e;
    });
}

/**
 * Rota motorista → origem (carregamento): vários servidores e perfis.
 * O perfil driving-hgv no OSRM público costuma falhar; tenta-se também driving e mirrors.
 * @returns {Promise<{ ok: boolean, route?: { distance: number, duration: number, geometry: object }, serverLabel?: string }>}
 */
window.buscarRotaMotoristaParaOrigem = async function(lonM, latM, lonO, latO) {
  const config = window.MAP_CONFIG || {};
  var timeoutMsProxy = 70000;
  var coordsStr = Number(lonM) + ',' + Number(latM) + ';' + Number(lonO) + ',' + Number(latO);

  try {
    console.info('[ROTA-OSRM] buscarRotaMotoristaParaOrigem → gateway-backend /api/mapa/rota-osrm');
    var dataProxy = await mapConfigFetchRotaComProxy(coordsStr, timeoutMsProxy);
    var extProxy = extrairRotaDeRespostaJson(dataProxy);
    if (extProxy && extProxy.geometry) {
      console.info('[ROTA-OSRM] Rota OK via gateway-backend');
      return {
        ok: true,
        route: {
          distance: extProxy.distance,
          duration: extProxy.duration,
          geometry: extProxy.geometry,
        },
        serverLabel: 'gateway-backend',
      };
    }
  } catch (e) {
    console.warn('[ROTA-OSRM] Gateway indisponível ou sem geometria:', e && e.message);
  }

  console.warn('[ROTA-OSRM] Nenhuma rota válida retornada pelo gateway-backend (motorista → origem)');
  return { ok: false };
};

// Log de configuração (debug) - mais detalhado
// Carregar configurações do servidor (Nominatim e Router) e mesclar em MAP_CONFIG
(function loadConfigFromServer() {
  fetch('/api/configuracoes/mapa')
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (data && window.MAP_CONFIG) {
        if (data.nominatimServer && data.nominatimServer.trim()) {
          const nominatim = data.nominatimServer.trim();
          window.MAP_CONFIG.nominatimServer = (hostProprioMapa(nominatim) && paginaEmHttps())
            ? 'https://nominatim.openstreetmap.org'
            : normalizarBaseRoteamentoHttp(nominatim);
        }
        if (data.osrmServer && data.osrmServer.trim()) {
          window.MAP_CONFIG.osrmServer = normalizarBaseRoteamentoHttp(data.osrmServer.trim());
        }
        if (window.MAP_CONFIG.useBackendRouteProxy === undefined) {
          window.MAP_CONFIG.useBackendRouteProxy = true;
        }
        console.log('📍 [MAP CONFIG] Configurações carregadas do servidor (Nominatim + Router).');
      }
    })
    .catch(function() {});
})();

console.log('📍 [MAP CONFIG] ========================================');
console.log('📍 [MAP CONFIG] Arquivo map-config.js carregado!');
console.log('📍 [MAP CONFIG] Configurações de mapa:', {
  tileServer: window.MAP_CONFIG.tileServer?.substring(0, 60) + '...',
  osrmServer: window.MAP_CONFIG.osrmServer,
  nominatimServer: window.MAP_CONFIG.nominatimServer,
  timeout: window.MAP_CONFIG.routeTimeout + 'ms',
  maxZoom: window.MAP_CONFIG.maxZoom
});
console.log('📍 [MAP CONFIG] Funções disponíveis:', {
  getTileServerUrl: typeof window.getTileServerUrl === 'function',
  getTileLayerConfig: typeof window.getTileLayerConfig === 'function',
  getOSRMUrl: typeof window.getOSRMUrl === 'function',
  getNominatimReverseUrl: typeof window.getNominatimReverseUrl === 'function',
  fetchOsrmRouteJsonViaBackend: typeof window.fetchOsrmRouteJsonViaBackend === 'function'
});
console.log('📍 [MAP CONFIG] ========================================');

