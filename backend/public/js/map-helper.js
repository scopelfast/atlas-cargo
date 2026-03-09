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
    // Servidor de tiles (mapa visual)
    tileServer: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    
    // Servidor de roteamento (ORS - OpenRouteService)
    // Servidor próprio IntegraBrasil:
    osrmServer: 'http://app.integrabrasil.com:8080/ors/ors/v2/directions/driving-hgv',
    
    // Servidores públicos (fallback):
    osrmServerAlt: 'https://routing.openstreetmap.de/routed-car/route/v1/driving-hgv',
    // osrmServerAlt: 'https://router.project-osrm.org/route/v1/driving-hgv',
    
    // Servidor de geocoding (endereços ↔ coordenadas)
    // Servidor próprio IntegraBrasil:
    nominatimServer: 'http://app.integrabrasil.com:8080/nominatim',
    
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
      const isOSM = tileUrl.includes('openstreetmap.org');
      
      const options = {
        attribution: '© OpenStreetMap contributors',
        maxZoom: this.config.maxZoom
      };

      // Adicionar subdomínios para OSM
      if (isOSM) {
        options.subdomains = ['a', 'b', 'c'];
      }

      L.tileLayer(tileUrl, options).addTo(map);
      return map;
    }

    // ====================================
    // OBTER URL DO TILE SERVER
    // ====================================
    getTileUrl() {
      let url = this.config.tileServer;
      
      // Se for servidor próprio, garantir HTTP
      if (url.includes('186.250.92.131') || url.includes('app.integrabrasil.com')) {
        url = url.replace(/^https:/, 'http:');
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
      
      // Se for servidor próprio, garantir HTTP
      if (server.includes('186.250.92.131') || server.includes('app.integrabrasil.com')) {
        server = server.replace(/^https:/, 'http:');
      }
      
      return `${server}/${coordsStr}?overview=${overview}&geometries=${geometries}`;
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
  // Manter MAP_CONFIG para não quebrar código existente
  window.MAP_CONFIG = {
    tileServer: CONFIG.tileServer,
    osrmServer: CONFIG.osrmServer,
    nominatimServer: CONFIG.nominatimServer,
    routeTimeout: CONFIG.timeout,
    maxZoom: CONFIG.maxZoom,
    defaultCenter: CONFIG.defaultCenter,
    defaultZoom: CONFIG.defaultZoom
  };

  // Funções helper antigas (compatibilidade)
  window.getTileServerUrl = function() {
    return window.MapHelper.getTileUrl();
  };

  window.getOSRMUrl = function(coordinates, options = {}) {
    const coordsStr = coordinates.map(c => `${c.lon},${c.lat}`).join(';');
    return window.MapHelper.getOSRMUrl(coordsStr, options.overview, options.geometries);
  };

  console.log('✅ [MapHelper] Sistema de mapas simplificado carregado!');
  console.log('📖 [MapHelper] Use: window.MapHelper.initMap("containerId")');
  console.log('📖 [MapHelper] Use: window.MapHelper.calculateRoute([{lat, lon}, ...])');

})();
