// backend/config/nominatim.js
// Configuração centralizada do servidor Nominatim
// Versão: 1.0
// Data: 2026-01-16
// Última atualização: 2026-01-16 - Implementação do servidor próprio

// Log inicial ao carregar o módulo
// Prioridade: .env NOMINATIM_SERVER; senão o mesmo padrão da tela "Configurações do Sistema" (nominatim.openstreetmap.org)
const SERVIDOR_PADRAO_UI = 'https://nominatim.openstreetmap.org';
const servidorUsado = (process.env.NOMINATIM_SERVER && process.env.NOMINATIM_SERVER.trim()) || SERVIDOR_PADRAO_UI;
console.log(`📍 [Nominatim Config] Servidor Nominatim configurado: ${servidorUsado}`);

/**
 * Obtém a URL base do servidor Nominatim
 * Prioridade:
 * 1. Variável de ambiente NOMINATIM_SERVER (igual ao que você define em Configurações do Sistema)
 * 2. Padrão alinhado à tela "Mapa e Roteamento": https://nominatim.openstreetmap.org
 */
function getNominatimServer() {
  if (process.env.NOMINATIM_SERVER && process.env.NOMINATIM_SERVER.trim()) {
    return process.env.NOMINATIM_SERVER.trim();
  }
  return SERVIDOR_PADRAO_UI;
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
