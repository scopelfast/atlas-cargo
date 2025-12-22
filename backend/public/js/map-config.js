// ====================================
// CONFIGURAÇÕES DE MAPA E ROTEAMENTO
// ====================================
// ⚠️ ATENÇÃO: Este arquivo está sendo substituído por map-helper.js
// ⚠️ Use window.MapHelper para novas funcionalidades
// ⚠️ Este arquivo mantido apenas para compatibilidade
// Versão: 1.0 (Legacy)
// Data: 2025-12-04

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
  
  // OPÇÃO 2: Servidor público OpenStreetMap (HTTPS) - Funciona sempre, mas pode ser mais lento
  tileServer: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  
  // OPÇÃO 3: Servidor alternativo (HTTPS)
  // tileServer: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
  
  // NOTA: Se quiser usar o servidor próprio, descomente a linha OPÇÃO 1 e comente a OPÇÃO 2
  // Mas lembre-se: servidor próprio só funciona com HTTP, não HTTPS!
  
  // ====================================
  // SERVIDOR DE ROTEAMENTO (OSRM)
  // ====================================
  // IMPORTANTE: Para mudar o servidor de roteamento, edite a linha abaixo:
  
  // TEMPORÁRIO: Usando servidor público até configurar HTTPS no servidor próprio
  osrmServer: 'https://routing.openstreetmap.de/routed-car/route/v1/driving-hgv',
  // SERVIDOR PÚBLICO (temporário)
  
  // Servidor próprio (desabilitado temporariamente - aguardando HTTPS):
  // osrmServer: 'http://186.250.92.131:8081/ors/v2/directions/driving-hgv',
  
  // Outros servidores públicos:
  // osrmServer: 'https://router.project-osrm.org/route/v1/driving-hgv',
  
  // ====================================
  // SERVIDOR DE GEOCODING (Nominatim)
  // ====================================
  // IMPORTANTE: Para mudar o servidor de geocoding, edite a linha abaixo:
  
  // TEMPORÁRIO: Usando servidor público até configurar HTTPS no servidor próprio
  nominatimServer: 'https://nominatim.openstreetmap.org',
  // SERVIDOR PÚBLICO (temporário)
  
  // Servidor próprio (desabilitado temporariamente - aguardando HTTPS):
  // nominatimServer: 'http://186.250.92.131:8082',
  
  // ====================================
  // CONFIGURAÇÕES GERAIS
  // ====================================
  
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
  
  // Usar linha reta se roteamento falhar
  useStraightLineOnError: true,
  
  // Mostrar mensagem de erro no console
  showErrorMessages: true
};

// ====================================
// FUNÇÕES AUXILIARES
// ====================================

// Obter URL completa do OSRM com pontos
window.getOSRMUrl = function(coordinates, options = {}) {
  const config = window.MAP_CONFIG;
  const { overview = 'full', geometries = 'geojson' } = options;
  const coordsStr = coordinates.map(c => `${c.lon},${c.lat}`).join(';');
  return `${config.osrmServer}/${coordsStr}?overview=${overview}&geometries=${geometries}`;
};

// Obter configuração do tile layer
window.getTileLayerConfig = function() {
  const config = window.MAP_CONFIG;
  // IMPORTANTE: Usar getTileServerUrl() que já trata HTTP/HTTPS corretamente
  let tileServer = window.getTileServerUrl ? window.getTileServerUrl() : (config.tileServer || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png');
  
  return {
    url: tileServer,
    attribution: config.attribution || '© OpenStreetMap contributors',
    maxZoom: config.maxZoom || 19
  };
};

// Obter URL do tile server
window.getTileServerUrl = function() {
  const config = window.MAP_CONFIG;
  let tileServer = config.tileServer || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
  
  // Se for servidor próprio (HTTP), garantir que use HTTP
  // Se for servidor público (HTTPS), manter HTTPS
  if (tileServer.includes('186.250.92.131')) {
    tileServer = tileServer.replace(/^https:/, 'http:');
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

// Log de configuração (debug) - mais detalhado
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
  getNominatimReverseUrl: typeof window.getNominatimReverseUrl === 'function'
});
console.log('📍 [MAP CONFIG] ========================================');

