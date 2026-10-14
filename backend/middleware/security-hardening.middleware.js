// Fase 5 SaaS: endurecimento — bloqueio de init SQL em produção e rate limit de login (sem dependência extra).

const buckets = new Map();

/**
 * Em NODE_ENV=production, bloqueia endpoints perigosos de dev/SQL ad-hoc (403).
 * - POST …/executar-init-sql
 * - POST …/executar-query (SELECT arbitrário com JWT ainda é vazamento cross-tenant)
 * - GET …/debug-rotas (enumera rotas)
 */
function blockDangerousEndpointsInProduction(req, res, next) {
  if (process.env.NODE_ENV !== 'production') return next();
  const path = (req.originalUrl || req.url || '').split('?')[0];
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'POST' && path.includes('/executar-init-sql')) {
    return res.status(403).json({
      error: 'Operação não permitida em produção',
      code: 'INIT_SQL_DISABLED'
    });
  }
  if (method === 'POST' && path.includes('/executar-query')) {
    return res.status(403).json({
      error: 'Operação não permitida em produção',
      code: 'EXECUTE_QUERY_DISABLED'
    });
  }
  if (method === 'GET' && path.includes('/debug-rotas')) {
    return res.status(403).json({
      error: 'Operação não permitida em produção',
      code: 'DEBUG_ROUTES_DISABLED'
    });
  }
  return next();
}

/** @deprecated use blockDangerousEndpointsInProduction — mantido para compatibilidade com app.js */
const blockExecutarInitSqlInProduction = blockDangerousEndpointsInProduction;

/**
 * Rate limit simples em memória (por IP). Não substitui Redis em cluster.
 * @param {{ windowMs?: number, max?: number, keyPrefix?: string }} opts
 */
function createLoginRateLimiter(opts = {}) {
  const windowMs = Math.max(10_000, parseInt(String(opts.windowMs || process.env.LOGIN_RATE_LIMIT_WINDOW_MS || '900000'), 10) || 900000);
  const max = Math.max(5, parseInt(String(opts.max || process.env.LOGIN_RATE_LIMIT_MAX || '40'), 10) || 40);
  const keyPrefix = opts.keyPrefix || 'login';

  return function loginRateLimiter(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now > b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((b.resetAt - now) / 1000)));
      return res.status(429).json({
        error: 'Muitas tentativas. Aguarde e tente novamente.',
        code: 'RATE_LIMIT'
      });
    }
    return next();
  };
}

module.exports = {
  blockDangerousEndpointsInProduction,
  blockExecutarInitSqlInProduction,
  createLoginRateLimiter
};
