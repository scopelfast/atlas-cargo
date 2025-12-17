// Cache Middleware - Middleware para cachear respostas de APIs
// Versão: 1.0
// Data: 2025-01-16

const { getCacheService } = require('../services/cache.service');

/**
 * Middleware para cachear respostas de endpoints
 * @param {number} ttl - Tempo de vida do cache em milissegundos (padrão: 5 minutos)
 * @param {function} keyGenerator - Função para gerar chave de cache baseada no request (opcional)
 */
function cacheMiddleware(ttl = 5 * 60 * 1000, keyGenerator = null) {
  const cacheService = getCacheService();

  return (req, res, next) => {
    // Gerar chave de cache
    const cacheKey = keyGenerator 
      ? keyGenerator(req)
      : `${req.method}:${req.originalUrl}:${JSON.stringify(req.query)}:${JSON.stringify(req.body)}`;

    // Verificar se existe no cache
    const cached = cacheService.get(cacheKey);
    
    if (cached) {
      // Retornar do cache
      return res.json(cached);
    }

    // Interceptar resposta para cachear
    const originalJson = res.json.bind(res);
    res.json = function(data) {
      // Cachear apenas respostas de sucesso (2xx)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cacheService.set(cacheKey, data, ttl);
      }
      
      return originalJson(data);
    };

    next();
  };
}

/**
 * Middleware específico para endpoints de combo/dropdown (TTL maior)
 */
function cacheComboMiddleware() {
  return cacheMiddleware(10 * 60 * 1000, (req) => {
    // Chave baseada na URL (ignora query params para combos)
    return `COMBO:${req.path}`;
  });
}

/**
 * Invalidar cache por padrão
 * @param {string} pattern - Padrão para invalidar (ex: 'tipos-viagem', 'cidades')
 */
function invalidateCache(pattern) {
  const cacheService = getCacheService();
  const keys = cacheService.keys();
  
  keys.forEach(key => {
    if (key.includes(pattern)) {
      cacheService.delete(key);
    }
  });
}

module.exports = {
  cacheMiddleware,
  cacheComboMiddleware,
  invalidateCache
};
