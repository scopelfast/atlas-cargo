// backend/config/nominatim.js
// Configuração centralizada do servidor Nominatim
// Versão: 1.0
// Data: 2025-01-16
// Última atualização: 2025-01-16 - Implementação do servidor próprio

// Log inicial ao carregar o módulo
const SERVIDOR_PROPRIO_PADRAO = 'http://186.250.92.131:8082';
const servidorUsado = process.env.NOMINATIM_SERVER || SERVIDOR_PROPRIO_PADRAO;
console.log(`📍 [Nominatim Config] Servidor Nominatim configurado: ${servidorUsado}`);

/**
 * Obtém a URL base do servidor Nominatim
 * Prioridade:
 * 1. Variável de ambiente NOMINATIM_SERVER
 * 2. Servidor próprio (padrão recomendado)
 * 3. Servidor público (fallback)
 */
function getNominatimServer() {
  // Servidor próprio (Integra Brasil) - RECOMENDADO
  const SERVIDOR_PROPRIO = 'http://186.250.92.131:8082';
  
  // Servidor público (fallback)
  const SERVIDOR_PUBLICO = 'https://nominatim.openstreetmap.org';
  
  // Verificar variável de ambiente primeiro
  if (process.env.NOMINATIM_SERVER) {
    return process.env.NOMINATIM_SERVER;
  }
  
  // Usar servidor próprio por padrão
  return SERVIDOR_PROPRIO;
}

/**
 * Obtém a URL completa para reverse geocoding
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @returns {string} URL completa
 */
function getReverseGeocodingUrl(lat, lon) {
  const baseUrl = getNominatimServer();
  return `${baseUrl}/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;
}

/**
 * Obtém a URL completa para forward geocoding (busca por endereço)
 * @param {string} query - Query de busca (ex: "Curitiba, Paraná, Brasil")
 * @param {object} options - Opções adicionais
 * @returns {string} URL completa
 */
function getForwardGeocodingUrl(query, options = {}) {
  const baseUrl = getNominatimServer();
  const limit = options.limit || 10;
  const countrycodes = options.countrycodes || 'br';
  
  return `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&limit=${limit}&countrycodes=${countrycodes}&addressdetails=1`;
}

module.exports = {
  getNominatimServer,
  getReverseGeocodingUrl,
  getForwardGeocodingUrl
};
