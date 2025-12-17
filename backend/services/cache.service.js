// Cache Service - Cache em memória para consultas frequentes
// Versão: 1.0
// Data: 2025-01-16

/**
 * Serviço de cache simples em memória para reduzir carga no banco de dados
 */
class CacheService {
  constructor() {
    this.cache = new Map();
    this.defaultTTL = 5 * 60 * 1000; // 5 minutos por padrão
    this.cleanupInterval = null;
    this.startCleanup();
  }

  /**
   * Obter valor do cache
   * @param {string} key - Chave do cache
   * @returns {any|null} Valor do cache ou null se não existir/expirado
   */
  get(key) {
    const item = this.cache.get(key);
    
    if (!item) {
      return null;
    }

    // Verificar se expirou
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  /**
   * Definir valor no cache
   * @param {string} key - Chave do cache
   * @param {any} value - Valor a cachear
   * @param {number} ttl - Tempo de vida em milissegundos (opcional)
   */
  set(key, value, ttl = null) {
    const expiresAt = Date.now() + (ttl || this.defaultTTL);
    
    this.cache.set(key, {
      value,
      expiresAt,
      createdAt: Date.now()
    });
  }

  /**
   * Remover item do cache
   * @param {string} key - Chave do cache
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Limpar todo o cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Verificar se chave existe e está válida
   * @param {string} key - Chave do cache
   * @returns {boolean}
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Obter todas as chaves do cache
   * @returns {Array<string>}
   */
  keys() {
    return Array.from(this.cache.keys());
  }

  /**
   * Obter estatísticas do cache
   * @returns {object}
   */
  getStats() {
    const now = Date.now();
    let valid = 0;
    let expired = 0;

    this.cache.forEach((item) => {
      if (now <= item.expiresAt) {
        valid++;
      } else {
        expired++;
      }
    });

    return {
      total: this.cache.size,
      valid,
      expired,
      memoryUsage: process.memoryUsage().heapUsed
    };
  }

  /**
   * Limpar itens expirados do cache
   */
  cleanup() {
    const now = Date.now();
    const keysToDelete = [];

    this.cache.forEach((item, key) => {
      if (now > item.expiresAt) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach(key => this.cache.delete(key));

    if (keysToDelete.length > 0) {
      console.log(`🧹 Cache: Removidos ${keysToDelete.length} item(s) expirado(s)`);
    }
  }

  /**
   * Iniciar limpeza automática (a cada 10 minutos)
   */
  startCleanup() {
    if (this.cleanupInterval) {
      return; // Já está rodando
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 10 * 60 * 1000); // A cada 10 minutos

    console.log('✅ Cache Service: Limpeza automática iniciada (a cada 10 minutos)');
  }

  /**
   * Parar limpeza automática
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Singleton
let instance = null;

/**
 * Obter instância do Cache Service
 * @returns {CacheService}
 */
function getCacheService() {
  if (!instance) {
    instance = new CacheService();
  }
  return instance;
}

module.exports = {
  CacheService,
  getCacheService
};
