// ====================================
// MAP HELPER - Sistema Simplificado de Mapas
// ====================================
// Uma única classe que gerencia TUDO relacionado a mapas
// Versão: 2.0 - Simplificada
// Data: 2026-01-13

(function() {
  'use strict';

  // ====================================
  // CONFIGURAÇÃO ÚNICA
  // ====================================
  const CONFIG = {
    // Servidor de tiles: NÃO usar tile.openstreetmap.org (403 Referer) nem Carto sem API key
    // (cartocdn mostra watermark "API KEY REQUIRED"). OSM.de = HTTPS sem chave.
    tileServer: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
    
    // Servidor de roteamento (ORS - OpenRouteService)
    // Servidor próprio IntegraBrasil:
    osrmServer: 'https://router.project-osrm.org/route/v1/driving',
    
    // Servidores públicos (fallback):
    osrmServerAlt: 'https://routing.openstreetmap.de/routed-car/route/v1/driving-hgv',
    // osrmServerAlt: 'https://router.project-osrm.org/route/v1/driving-hgv',
    
    // Servidor de geocoding (endereços ↔ coordenadas)
    // Servidor próprio IntegraBrasil:
    nominatimServer: 'https://nominatim.openstreetmap.org',
    
    // Servidor público (fallback):
    nominatimServerAlt: 'https://nominatim.openstreetmap.org',
    
    // Configurações gerais
    timeout: 15000,
    maxZoom: 19,
    defaultCenter: [-14.2350, -51.9253],
    defaultZoom: 4
  };

  // ====================================
  // CLASSE PRINCIPAL
  // ====================================
  class MapHelper {
    isHttpsPage() {
      try {
        return typeof window !== 'undefined' && window.location && window.location.protocol === 'https:';
      } catch (e) {
        return false;
      }
    }

    isPrivateMapHost(url) {
      if (!url || typeof url !== 'string') return false;
      const low = url.toLowerCase();
      return low.includes('186.250.92.131');
    }

    constructor() {
      this.config = CONFIG;
    }

    // ====================================
    // INICIALIZAR MAPA
    // ====================================
    initMap(containerId, options = {}) {
      if (typeof L === 'undefined') {
        console.error('❌ [MapHelper] Leaflet não está carregado!');
        return null;
      }

      const container = document.getElementById(containerId);
      if (!container) {
        console.error(`❌ [MapHelper] Container "${containerId}" não encontrado!`);
        return null;
      }

      // Limpar mapa existente se houver
      if (container._leaflet_id) {
        container.innerHTML = '';
        delete container._leaflet_id;
      }

      // Criar mapa
      const center = options.center || this.config.defaultCenter;
      const zoom = options.zoom || this.config.defaultZoom;
      const map = L.map(containerId, {
        preferCanvas: false,
        zoomControl: true
      }).setView(center, zoom);

      // Adicionar tiles
      this.addTileLayer(map);

      return map;
    }

    // ====================================
    // ADICIONAR TILES AO MAPA
    // ====================================
    addTileLayer(map) {
      const tileUrl = this.getTileUrl();
      const isOsmOrgTiles = /tile\.openstreetmap\.org/i.test(tileUrl);
      const isCarto = tileUrl.includes('cartocdn.com');

      const options = {
        attribution: isCarto
          ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: this.config.maxZoom
      };

      if (tileUrl.includes('{s}')) {
        options.subdomains = isCarto ? ['a', 'b', 'c', 'd'] : ['a', 'b', 'c'];
      }

      L.tileLayer(tileUrl, options).addTo(map);
      return map;
    }

    // ====================================
    // OBTER URL DO TILE SERVER
    // ====================================
    getTileUrl() {
      // Não chamar window.getTileServerUrl() aqui: map-helper redefine essa função
      // para MapHelper.getTileUrl() → recursão infinita (Maximum call stack size exceeded).
      const fallback =
        (typeof window.MAP_TILE_FALLBACK_HTTPS === 'string' && window.MAP_TILE_FALLBACK_HTTPS) ||
        'https://tile.openstreetmap.de/{z}/{x}/{y}.png';
      let url =
        typeof window.MAP_CONFIG !== 'undefined' && window.MAP_CONFIG && window.MAP_CONFIG.tileServer
          ? window.MAP_CONFIG.tileServer
          : this.config.tileServer;

      if (!url || typeof url !== 'string') {
        url = fallback;
      }

      if (this.isPrivateMapHost(url)) {
        if (this.isHttpsPage()) {
          url = fallback;
        } else {
          url = url.replace(/^https:/i, 'http:');
        }
      }

      return url;
    }

    // ====================================
    // CALCULAR ROTA ENTRE PONTOS
    // ====================================
    async calculateRoute(points, options = {}) {
      if (!points || points.length < 2) {
        throw new Error('Precisa de pelo menos 2 pontos para calcular rota');
      }

      // Converter pontos para formato OSRM: "lon,lat;lon,lat"
      const coordsStr = points.map(p => {
        const lat = Array.isArray(p) ? p[0] : p.lat;
        const lon = Array.isArray(p) ? p[1] : p.lon;
        return `${lon},${lat}`;
      }).join(';');

      const overview = options.overview || 'full';
      const geometries = options.geometries || 'geojson';

      if (typeof window.fetchOsrmRouteJsonViaBackend === 'function') {
        try {
          const raw = await window.fetchOsrmRouteJsonViaBackend(
            coordsStr,
            Math.min((this.config.timeout || 15000) + 10000, 45000)
          );
          let data = raw;
          if (typeof window.normalizarRespostaGatewayOsrm === 'function') {
            const n = window.normalizarRespostaGatewayOsrm(raw);
            if (n) data = n;
          }
          if (data && data.code === 'Ok' && data.routes && data.routes[0]) {
            return this.parseRoute(data);
          }
        } catch (e) {
          /* servidor direto abaixo */
        }
      }

      const srv = (typeof window.MAP_CONFIG !== 'undefined' && window.MAP_CONFIG && window.MAP_CONFIG.osrmServer) || this.config.osrmServer || '';
      if (String(srv).includes('/ors/v2')) {
        if (options.useStraightLine !== false) {
          return this.createStraightLine(points);
        }
        throw new Error('ORS requer gateway de rota');
      }

      // Tentar servidor principal primeiro
      try {
        const url = this.getOSRMUrl(coordsStr, overview, geometries);
        const route = await this.fetchRoute(url);
        return this.parseRoute(route);
      } catch (err) {
        console.warn('⚠️ [MapHelper] Servidor principal falhou, tentando alternativo...', err);
        
        // Tentar servidor alternativo
        try {
          const url = this.getOSRMUrl(coordsStr, overview, geometries, true);
          const route = await this.fetchRoute(url);
          return this.parseRoute(route);
        } catch (err2) {
          console.warn('⚠️ [MapHelper] Ambos servidores falharam, usando linha reta');
          
          // Fallback: linha reta
          if (options.useStraightLine !== false) {
            return this.createStraightLine(points);
          }
          throw err2;
        }
      }
    }

    // ====================================
    // OBTER URL DO OSRM
    // ====================================
    getOSRMUrl(coordsStr, overview = 'full', geometries = 'geojson', useAlt = false) {
      let server = useAlt ? this.config.osrmServerAlt : this.config.osrmServer;
      if (!useAlt && typeof window.MAP_CONFIG !== 'undefined' && window.MAP_CONFIG && window.MAP_CONFIG.osrmServer) {
        server = window.MAP_CONFIG.osrmServer;
      }
      if (useAlt && typeof window.MAP_CONFIG !== 'undefined' && window.MAP_CONFIG && window.MAP_CONFIG.osrmServerAlt) {
        server = window.MAP_CONFIG.osrmServerAlt;
      }
      const s = (server || '').trim();
      const sLower = s.toLowerCase();
      if (this.isPrivateMapHost(sLower)) {
        if (this.isHttpsPage()) {
          const fallback = 'https://router.project-osrm.org/route/v1/driving';
          return `${fallback}/${coordsStr}?overview=${overview}&geometries=${geometries}`;
        }
        return `${s.replace(/^https:/i, 'http:')}/${coordsStr}?overview=${overview}&geometries=${geometries}`;
      }
      return `${s}/${coordsStr}?overview=${overview}&geometries=${geometries}`;
    }

    // ====================================
    // BUSCAR ROTA DO OSRM
    // ====================================
    async fetchRoute(url) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        if (data.code !== 'Ok' || !data.routes || !data.routes[0]) {
          throw new Error('Rota não encontrada');
        }

        return data;
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }
    }

    // ====================================
    // PARSEAR RESPOSTA DO OSRM
    // ====================================
    parseRoute(osrmData) {
      const route = osrmData.routes[0];
      const geometry = route.geometry.coordinates;
      
      // Converter de [lon, lat] para [lat, lon] para Leaflet
      const latLngs = geometry.map(coord => [coord[1], coord[0]]);
      
      return {
        coordinates: latLngs,
        distance: route.distance / 1000, // Converter metros para km
        duration: route.duration / 60, // Converter segundos para minutos
        geometry: geometry
      };
    }

    // ====================================
    // CRIAR LINHA RETA (FALLBACK)
    // ====================================
    createStraightLine(points) {
      const latLngs = points.map(p => {
        if (Array.isArray(p)) {
          return [p[0], p[1]];
        }
        return [p.lat, p.lon];
      });

      // Calcular distância aproximada (Haversine)
      let totalDistance = 0;
      for (let i = 0; i < latLngs.length - 1; i++) {
        totalDistance += this.haversineDistance(latLngs[i], latLngs[i + 1]);
      }

      return {
        coordinates: latLngs,
        distance: totalDistance,
        duration: totalDistance / 60, // Estimativa: 60 km/h
        geometry: latLngs.map(ll => [ll[1], ll[0]]) // [lon, lat]
      };
    }

    // ====================================
    // DISTÂNCIA HAVERSINE
    // ====================================
    haversineDistance([lat1, lon1], [lat2, lon2]) {
      const R = 6371; // Raio da Terra em km
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    // ====================================
    // GEOCODING REVERSO (coordenadas → endereço)
    // ====================================
    async reverseGeocode(lat, lon) {
      let url = `${this.config.nominatimServer}/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`;
      
      try {
        const response = await fetch(url, { 
          signal: AbortSignal.timeout(this.config.timeout) 
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        return data.address || {};
      } catch (err) {
        // Tentar servidor alternativo
        if (this.config.nominatimServerAlt) {
          url = `${this.config.nominatimServerAlt}/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`;
          const response = await fetch(url, { 
            signal: AbortSignal.timeout(this.config.timeout) 
          });
          const data = await response.json();
          return data.address || {};
        }
        throw err;
      }
    }
  }

  // ====================================
  // CRIAR INSTÂNCIA GLOBAL
  // ====================================
  window.MapHelper = new MapHelper();

  // ====================================
  // COMPATIBILIDADE COM CÓDIGO ANTIGO
  // ====================================
  // map-config.js carrega antes: mesclar para não perder flags (ex.: useBackendRouteProxy) nem Nominatim/OSRM.
  const prevCfg = (typeof window.MAP_CONFIG === 'object' && window.MAP_CONFIG !== null) ? window.MAP_CONFIG : {};
  window.MAP_CONFIG = {
    ...prevCfg,
    tileServer: prevCfg.tileServer || CONFIG.tileServer,
    attribution: prevCfg.attribution,
    osrmServer: prevCfg.osrmServer || CONFIG.osrmServer,
    nominatimServer: prevCfg.nominatimServer || CONFIG.nominatimServer,
    routeTimeout: prevCfg.routeTimeout != null ? prevCfg.routeTimeout : CONFIG.timeout,
    maxZoom: prevCfg.maxZoom != null ? prevCfg.maxZoom : CONFIG.maxZoom,
    defaultCenter: prevCfg.defaultCenter || CONFIG.defaultCenter,
    defaultZoom: prevCfg.defaultZoom != null ? prevCfg.defaultZoom : CONFIG.defaultZoom,
    useBackendRouteProxy: prevCfg.useBackendRouteProxy !== false
  };

  window.getTileServerUrl = function() {
    return window.MapHelper.getTileUrl();
  };

  window.getOSRMUrl = function(coordinates, options = {}) {
    const coordsStr = coordinates.map(c => `${c.lon},${c.lat}`).join(';');
    return window.MapHelper.getOSRMUrl(coordsStr, options.overview, options.geometries);
  };

  /**
   * Marcadores + popups unificados (Gerenciar Roteiros e Gerenciar Viagens).
   * Número grande no marcador; 1|13 circular; 2|3 no mesmo GPS; X do popup estilizado.
   */
  window.AtlasRoteiroMapMarkers = (function () {
    const CORES = { O: '#2ecc71', D: '#e74c3c', P: '#3498db', R: '#f39c12' };
    const TIPOS = { O: 'Origem', D: 'Destino', P: 'Passagem', R: 'Parada' };
    // closeButton: false — o × nativo do Leaflet fica torto; usamos botão próprio no header
    const POPUP_OPTS = { className: 'atlas-map-popup-wrap', maxWidth: 340, minWidth: 220, closeButton: false };

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function ensureStyles() {
      let s = document.getElementById('atlas-roteiro-mapa-styles');
      if (!s) {
        s = document.createElement('style');
        s.id = 'atlas-roteiro-mapa-styles';
        document.head.appendChild(s);
      }
      // Sempre atualiza (evita CSS antigo grudado no DOM após hot-reload)
      s.textContent = `
        #mapaRota .leaflet-div-icon.roteiro-marker-seq,
        #mapaRota .leaflet-div-icon.custom-marker,
        #mapaVeiculos .leaflet-div-icon.roteiro-marker-seq,
        #mapaVeiculos .leaflet-div-icon.custom-marker {
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
        }
        /* Blindagem: max-width em img quebra o encaixe dos tiles */
        #mapaRota .leaflet-tile,
        #mapaRota img.leaflet-tile,
        #mapaVeiculos .leaflet-tile,
        #mapaVeiculos img.leaflet-tile {
          max-width: none !important;
          max-height: none !important;
        }
        #mapaRota .leaflet-tile-container img,
        #mapaVeiculos .leaflet-tile-container img {
          max-width: none !important;
        }
        #mapaRota .leaflet-popup.atlas-map-popup-wrap .leaflet-popup-content-wrapper,
        #mapaVeiculos .leaflet-popup.atlas-map-popup-wrap .leaflet-popup-content-wrapper {
          padding: 0;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 8px 28px rgba(15, 23, 42, 0.28);
        }
        #mapaRota .leaflet-popup.atlas-map-popup-wrap .leaflet-popup-content,
        #mapaVeiculos .leaflet-popup.atlas-map-popup-wrap .leaflet-popup-content {
          margin: 0 !important;
          min-width: 220px;
        }
        #mapaRota .leaflet-popup.atlas-map-popup-wrap .leaflet-popup-tip,
        #mapaVeiculos .leaflet-popup.atlas-map-popup-wrap .leaflet-popup-tip {
          background: #fff;
          box-shadow: none;
        }
        .atlas-map-popup-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 12px 12px 12px 14px;
          color: #fff;
          font: 700 0.95rem/1.25 system-ui, Segoe UI, sans-serif;
        }
        .atlas-map-popup-title {
          flex: 1;
          min-width: 0;
        }
        .atlas-map-popup-close {
          flex: 0 0 28px;
          width: 28px;
          height: 28px;
          margin: 0;
          padding: 0;
          border: 0;
          border-radius: 50%;
          background: rgba(15, 23, 42, 0.35);
          color: #fff;
          cursor: pointer;
          display: inline-flex !important;
          align-items: center;
          justify-content: center;
          line-height: 0;
          box-shadow: none;
          appearance: none;
          -webkit-appearance: none;
        }
        .atlas-map-popup-close:hover {
          background: rgba(15, 23, 42, 0.55);
        }
        .atlas-map-popup-close svg {
          display: block;
          width: 12px;
          height: 12px;
          pointer-events: none;
        }
        .atlas-map-popup-body {
          padding: 12px 14px 14px;
          color: #1e293b;
          font: 400 0.88rem/1.45 system-ui, Segoe UI, sans-serif;
          background: #fff;
        }
        .atlas-map-popup-body small { color: #64748b; }
        .atlas-map-popup-body hr {
          border: 0;
          border-top: 1px solid #e2e8f0;
          margin: 10px 0;
        }
        [data-theme="dark"] .atlas-map-popup-body {
          background: #1e293b;
          color: #e2e8f0;
        }
        [data-theme="dark"] .atlas-map-popup-body small { color: #94a3b8; }
        [data-theme="dark"] .atlas-map-popup-body hr { border-top-color: #334155; }
        [data-theme="dark"] #mapaRota .leaflet-popup.atlas-map-popup-wrap .leaflet-popup-content-wrapper,
        [data-theme="dark"] #mapaRota .leaflet-popup.atlas-map-popup-wrap .leaflet-popup-tip,
        [data-theme="dark"] #mapaVeiculos .leaflet-popup.atlas-map-popup-wrap .leaflet-popup-content-wrapper,
        [data-theme="dark"] #mapaVeiculos .leaflet-popup.atlas-map-popup-wrap .leaflet-popup-tip {
          background: #1e293b;
        }
      `;
    }

    function popupHtml(headBg, headTitle, bodyHtml) {
      return `<div class="atlas-map-popup">
        <div class="atlas-map-popup-head" style="background:${headBg};">
          <span class="atlas-map-popup-title">${esc(headTitle)}</span>
          <button type="button" class="atlas-map-popup-close" aria-label="Fechar" title="Fechar">
            <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="atlas-map-popup-body">${bodyHtml}</div>
      </div>`;
    }

    function bindPopupAtlas(marker, html) {
      marker.bindPopup(html, POPUP_OPTS);
      marker.on('popupopen', function (e) {
        const root = e.popup && e.popup.getElement && e.popup.getElement();
        const btn = root && root.querySelector('.atlas-map-popup-close');
        if (!btn) return;
        btn.onclick = function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          marker.closePopup();
        };
      });
    }

    function chaveCoord(lat, lon) {
      return `${Number(lat).toFixed(5)},${Number(lon).toFixed(5)}`;
    }

    function htmlSimples(nSeq, cor, tamanho, borda, titleText) {
      const fs = nSeq >= 10 ? 13 : 15;
      const t = esc(titleText || `#${nSeq}`);
      return `<div title="${t}" style="
        background:${cor};width:${tamanho}px;height:${tamanho}px;border-radius:50%;
        border:${borda};box-shadow:0 2px 10px rgba(0,0,0,.45);display:flex;align-items:center;
        justify-content:center;font-size:${fs}px;font-weight:800;color:#fff;
        font-family:system-ui,Segoe UI,sans-serif;line-height:1;letter-spacing:-0.5px;
        text-shadow:0 1px 2px rgba(0,0,0,.35);">${nSeq}</div>`;
    }

    function htmlCircular(nOrig, nDest) {
      return `<div title="Origem #${nOrig} ↔ Destino #${nDest} (mesmo local)" style="
        display:flex;width:52px;height:34px;border-radius:17px;overflow:hidden;
        border:3px solid #0f172a;box-shadow:0 2px 12px rgba(0,0,0,.5);
        font-family:system-ui,Segoe UI,sans-serif;font-weight:800;color:#fff;line-height:1;
        text-shadow:0 1px 2px rgba(0,0,0,.35);">
        <div style="flex:1;background:#2ecc71;display:flex;align-items:center;justify-content:center;font-size:14px;">${nOrig}</div>
        <div style="width:1px;background:#0f172a;"></div>
        <div style="flex:1;background:#e74c3c;display:flex;align-items:center;justify-content:center;font-size:14px;">${nDest}</div>
      </div>`;
    }

    function htmlGrupo(nums, cor) {
      const label = nums.join('|');
      const w = Math.max(36, 14 + nums.length * 16);
      const fs = label.length > 4 ? 11 : 13;
      return `<div title="Paradas #${nums.join(', #')} no mesmo local" style="
        background:${cor};min-width:${w}px;height:32px;padding:0 8px;border-radius:16px;
        border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.45);display:flex;align-items:center;
        justify-content:center;font-size:${fs}px;font-weight:800;color:#fff;
        font-family:system-ui,Segoe UI,sans-serif;line-height:1;letter-spacing:.5px;
        text-shadow:0 1px 2px rgba(0,0,0,.35);white-space:nowrap;">${label}</div>`;
    }

    /**
     * @param {object} mapaOuGrupo Leaflet map ou LayerGroup
     * @param {object[]} pontosComCoordenadas já ordenados por ORDEM
     * @returns {{ markers: object[], latlngs: number[][] }}
     */
    function addPontosMarkers(mapaOuGrupo, pontosComCoordenadas) {
      ensureStyles();
      const markers = [];
      const latlngs = [];
      if (!mapaOuGrupo || typeof L === 'undefined' || !Array.isArray(pontosComCoordenadas)) {
        return { markers, latlngs };
      }

      const specs = pontosComCoordenadas.map((ponto, index) => {
        let tipoLocal = '';
        if (ponto.TPLOCAL != null) tipoLocal = String(ponto.TPLOCAL).trim().toUpperCase();
        const isPrimeiro = index === 0;
        const isUltimo = index === pontosComCoordenadas.length - 1;
        if (isPrimeiro) tipoLocal = 'O';
        else if (isUltimo) tipoLocal = 'D';
        else if (tipoLocal === 'O' || tipoLocal === 'D' || !tipoLocal) tipoLocal = 'P';
        const lat = Number(ponto.LATITUDE != null ? ponto.LATITUDE : ponto.latitude);
        const lon = Number(ponto.LONGITUDE != null ? ponto.LONGITUDE : ponto.longitude);
        return {
          ponto,
          index,
          nSeq: index + 1,
          tipoLocal,
          isPrimeiro,
          isUltimo,
          lat,
          lon,
        };
      });

      const gruposPorCoord = new Map();
      specs.forEach((sp) => {
        const k = chaveCoord(sp.lat, sp.lon);
        if (!gruposPorCoord.has(k)) gruposPorCoord.set(k, []);
        gruposPorCoord.get(k).push(sp);
      });

      const chaveCircular = (() => {
        if (specs.length < 2) return null;
        const a = specs[0];
        const b = specs[specs.length - 1];
        const k = chaveCoord(a.lat, a.lon);
        if (k !== chaveCoord(b.lat, b.lon)) return null;
        const g = gruposPorCoord.get(k) || [];
        const ok = g.length === 2 && g.some((x) => x.isPrimeiro) && g.some((x) => x.isUltimo);
        return ok ? k : null;
      })();

      const indicesFeitos = new Set();
      let distAcum = 0;
      specs.forEach((sp) => {
        if (sp.index > 0 && sp.ponto.KMENTREPONTOS) {
          distAcum += parseFloat(sp.ponto.KMENTREPONTOS) || 0;
        }
        sp.distAcum = distAcum;
        latlngs.push([sp.lat, sp.lon]);
      });

      if (chaveCircular) {
        const g = gruposPorCoord.get(chaveCircular);
        const orig = g.find((x) => x.isPrimeiro);
        const dest = g.find((x) => x.isUltimo);
        indicesFeitos.add(orig.index);
        indicesFeitos.add(dest.index);
        const m = L.marker([orig.lat, orig.lon], {
          icon: L.divIcon({
            className: 'custom-marker roteiro-marker-seq roteiro-marker-circular',
            html: htmlCircular(orig.nSeq, dest.nSeq),
            iconSize: [52, 34],
            iconAnchor: [26, 17],
          }),
          zIndexOffset: 900,
        }).addTo(mapaOuGrupo);
        const body = `
          <strong>#${orig.nSeq} Origem:</strong> ${esc(orig.ponto.DSLOCAL || '—')}<br>
          <small>${esc(orig.ponto.DSPOSICAO || '')}</small>
          <hr>
          <strong>#${dest.nSeq} Destino:</strong> ${esc(dest.ponto.DSLOCAL || '—')}<br>
          <small>${esc(dest.ponto.DSPOSICAO || '')}</small>
          ${dest.ponto.KMENTREPONTOS ? `<hr><strong>Último trecho:</strong> ${parseFloat(dest.ponto.KMENTREPONTOS).toFixed(2)} km` : ''}
          ${dest.distAcum ? `<br><strong>Distância total:</strong> ${dest.distAcum.toFixed(2)} km` : ''}
        `;
        bindPopupAtlas(m, popupHtml('#0f172a', `Ida e volta · #${orig.nSeq} ↔ #${dest.nSeq}`, body));
        markers.push(m);
      }

      gruposPorCoord.forEach((grupo) => {
        const filtrados = grupo.filter((sp) => !indicesFeitos.has(sp.index)).sort((a, b) => a.nSeq - b.nSeq);
        if (!filtrados.length) return;

        if (filtrados.length > 1) {
          const nums = filtrados.map((sp) => sp.nSeq);
          const cor = CORES[filtrados[0].tipoLocal] || '#3498db';
          const w = Math.max(36, 14 + nums.length * 16);
          const m = L.marker([filtrados[0].lat, filtrados[0].lon], {
            icon: L.divIcon({
              className: 'custom-marker roteiro-marker-seq roteiro-marker-grupo',
              html: htmlGrupo(nums, cor),
              iconSize: [w, 32],
              iconAnchor: [w / 2, 16],
            }),
            zIndexOffset: 500 + nums[0],
          }).addTo(mapaOuGrupo);
          const linhas = filtrados
            .map((sp) => {
              const t = TIPOS[sp.tipoLocal] || sp.tipoLocal;
              return `<strong>#${sp.nSeq}</strong> (${esc(t)}): ${esc(sp.ponto.DSLOCAL || '—')}<br><small>${esc(sp.ponto.DSPOSICAO || '')}</small>`;
            })
            .join('<hr>');
          const body = `<small>Marcador único — sequência ${esc(nums.join(' → '))}</small><hr>${linhas}`;
          bindPopupAtlas(m, popupHtml(cor, `${filtrados.length} paradas no mesmo GPS`, body));
          markers.push(m);
          return;
        }

        const sp = filtrados[0];
        const cor = CORES[sp.tipoLocal] || '#95a5a6';
        const desc = TIPOS[sp.tipoLocal] || sp.tipoLocal || 'Não definido';
        const tam = sp.tipoLocal === 'O' || sp.tipoLocal === 'D' ? 36 : 32;
        const borda = sp.tipoLocal === 'O' || sp.tipoLocal === 'D' ? '3px solid #0f172a' : '3px solid #fff';
        const m = L.marker([sp.lat, sp.lon], {
          icon: L.divIcon({
            className: 'custom-marker roteiro-marker-seq',
            html: htmlSimples(sp.nSeq, cor, tam, borda, `#${sp.nSeq} · ${desc}`),
            iconSize: [tam, tam],
            iconAnchor: [tam / 2, tam / 2],
          }),
          zIndexOffset: sp.tipoLocal === 'O' || sp.tipoLocal === 'D' ? 600 : 400 + sp.nSeq,
        }).addTo(mapaOuGrupo);
        const body = `
          <strong>${esc(sp.ponto.DSLOCAL || 'Sem descrição')}</strong><br>
          <small>${esc(sp.ponto.DSPOSICAO || 'Sem posição')}</small>
          <hr>
          <strong>Ordem no roteiro:</strong> ${esc(sp.ponto.ORDEM || 'N/A')}<br>
          <strong>Sequência no mapa:</strong> ${sp.nSeq}<br>
          ${sp.ponto.KMENTREPONTOS ? `<strong>Distância do ponto anterior:</strong> ${parseFloat(sp.ponto.KMENTREPONTOS).toFixed(2)} km<br>` : ''}
          ${sp.index > 0 ? `<strong>Distância acumulada da origem:</strong> ${sp.distAcum.toFixed(2)} km<br>` : ''}
          <strong>Coordenadas:</strong><br>
          <small style="font-family:ui-monospace,monospace;">${sp.lat.toFixed(6)}, ${sp.lon.toFixed(6)}</small>
        `;
        bindPopupAtlas(m, popupHtml(cor, `Ponto ${sp.nSeq} — ${desc}`, body));
        markers.push(m);
      });

      return { markers, latlngs };
    }

    return { ensureStyles, addPontosMarkers };
  })();

  console.log('✅ [MapHelper] Sistema de mapas simplificado carregado!');
  console.log('📖 [MapHelper] Use: window.MapHelper.initMap("containerId")');
  console.log('📖 [MapHelper] Use: window.MapHelper.calculateRoute([{lat, lon}, ...])');

})();
