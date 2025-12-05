// ====================================
// CONFIGURAÇÕES DE MAPA E ROTEAMENTO
// ====================================
// Arquivo centralizado para facilitar manutenção
// Versão: 1.0
// Data: 2025-12-04

window.MAP_CONFIG = {
  // ====================================
  // SERVIDOR DE TILES DO MAPA
  // ====================================
  // IMPORTANTE: Para mudar o servidor de mapas, edite a linha abaixo:
  
  tileServer: 'http://186.250.92.131:8081/styles/osm-bright/{z}/{x}/{y}.png',
  // SERVIDOR PRÓPRIO (Integra Brasil) - RECOMENDADO
  // Mais rápido e confiável que servidores públicos
  
  // Servidores públicos (usar apenas se o servidor próprio estiver fora):
  // tileServer: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  // tileServer: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
  
  // ====================================
  // SERVIDOR DE ROTEAMENTO (OSRM)
  // ====================================
  // IMPORTANTE: Para mudar o servidor de roteamento, edite a linha abaixo:
  
  osrmServer: 'http://186.250.92.131:8081/ors/v2/directions/driving-hgv',
  // SERVIDOR PRÓPRIO (Integra Brasil) - RECOMENDADO
  
  // Servidores públicos (usar apenas se o servidor próprio estiver fora):
  // osrmServer: 'https://router.project-osrm.org/route/v1/driving',
  // osrmServer: 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  
  // ====================================
  // SERVIDOR DE GEOCODING (Nominatim)
  // ====================================
  // IMPORTANTE: Para mudar o servidor de geocoding, edite a linha abaixo:
  
  nominatimServer: 'http://186.250.92.131:8082',
  // SERVIDOR PRÓPRIO (Integra Brasil) - RECOMENDADO
  
  // Servidor público (usar apenas se o servidor próprio estiver fora):
  // nominatimServer: 'https://nominatim.openstreetmap.org',
  
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
  return {
    url: config.tileServer,
    attribution: config.attribution,
    maxZoom: config.maxZoom
  };
};

// Log de configuração (debug)
console.log('📍 [MAP CONFIG] Configurações de mapa carregadas:', {
  tileServer: window.MAP_CONFIG.tileServer.substring(0, 50) + '...',
  osrmServer: window.MAP_CONFIG.osrmServer,
  timeout: window.MAP_CONFIG.routeTimeout + 'ms'
});

