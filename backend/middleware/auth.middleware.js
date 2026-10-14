// backend/middleware/auth.middleware.js
const jwt = require('jsonwebtoken');
const { isCurrentToken } = require('../motorista-session');
const { tenantIdFromDecoded } = require('./tenant.middleware');
const { isLogAcessoTorreAberto } = require('../models/usuariologacesso.model');

// Middleware para extrair usuário do token JWT (opcional - não bloqueia)
const getUsuarioLogado = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const id = decoded.id ?? decoded.cdcadastro;
        const tid = tenantIdFromDecoded(decoded);
        req.user = {
          login: decoded.login,
          id,
          cdcadastro: id,
          nome: decoded.nome,
          email: decoded.email,
          tenantId: tid != null ? tid : undefined,
        };
      } catch (err) {
        // Token inválido ou expirado - não bloqueia, mas não define req.user
        req.user = null;
      }
    } else {
      // Tentar obter do header customizado ou query string (para compatibilidade)
      const token = req.headers['x-token'] || req.query.token;
      if (token) {
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          const id = decoded.id ?? decoded.cdcadastro;
          const tid = tenantIdFromDecoded(decoded);
          req.user = {
            login: decoded.login,
            id,
            cdcadastro: id,
            nome: decoded.nome,
            email: decoded.email,
            tenantId: tid != null ? tid : undefined,
          };
        } catch (err) {
          req.user = null;
        }
      } else {
        req.user = null;
      }
    }
  } catch (err) {
    req.user = null;
  }
  
  next();
};

// Middleware para REQUERER autenticação (bloqueia se não autenticado)
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = req.headers['x-token'] || req.query.token;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token de autenticação não fornecido. Faça login novamente.',
      });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const logOk = await isLogAcessoTorreAberto(decoded.logAcessoId ?? decoded.idLogAcesso);
      if (!logOk) {
        return res.status(401).json({
          success: false,
          message:
            'Sessão encerrada (limite de acessos simultâneos ou logout). Faça login novamente.',
          code: 'SESSION_REVOKED',
        });
      }
      const id = decoded.id ?? decoded.cdcadastro;
      const tid = tenantIdFromDecoded(decoded);
      req.user = {
        login: decoded.login,
        id,
        cdcadastro: id,
        nome: decoded.nome,
        email: decoded.email,
        tenantId: tid != null ? tid : undefined,
        logAcessoId: decoded.logAcessoId ?? decoded.idLogAcesso,
      };
      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expirado. Faça login novamente.',
        });
      }
      if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Token inválido. Faça login novamente.',
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Erro ao verificar token. Faça login novamente.',
      });
    }
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Erro interno ao verificar autenticação.',
    });
  }
};

// Middleware para rotas do app motorista: exige JWT e que o token seja o da sessão ativa (um login por motorista).
const requireMotoristaAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = req.headers['x-token'] || req.query.token;
    }
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token de autenticação não fornecido. Faça login novamente.',
        errorKey: 'login.tokenObrigatorio'
      });
    }
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expirado. Faça login novamente.',
          errorKey: 'login.tokenExpirado'
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Token inválido. Faça login novamente.',
        errorKey: 'login.tokenInvalido'
      });
    }
    // JWT da torre/web inclui `login` (SGUSUARIO) e não define tipo motorista.
    // Sem esta checagem, isCurrentToken aceita o token quando não há sessão em memória
    // (ex.: após restart) e assertSameMotorista quebra (id do usuário web ≠ CDCADASTRO na URL).
    const loginStr = decoded.login != null ? String(decoded.login).trim() : '';
    if (loginStr !== '' && decoded.tipo !== 'motorista') {
      console.log('[AUTH MOTORISTA] 401 rota exclusiva do app: JWT web/torre (login=%s tipo=%s)', loginStr, decoded.tipo);
      return res.status(401).json({
        success: false,
        message: 'Faça login pelo aplicativo do motorista. O token do painel web não pode ser usado aqui.',
        errorKey: 'login.tokenMotoristaObrigatorio'
      });
    }

    const id = decoded.id ?? decoded.cdcadastro;
    const idStr = id != null ? String(id) : '(null)';
    if (!isCurrentToken(id, token)) {
      console.log('[AUTH MOTORISTA] 401 sessão inválida decoded.id=%s decoded.cdcadastro=%s idUsado=%s', decoded.id, decoded.cdcadastro, idStr);
      return res.status(401).json({
        success: false,
        message: 'Sessão encerrada em outro dispositivo. Faça login novamente.',
        errorKey: 'login.sessaoEncerradaOutroDispositivo'
      });
    }
    const tid = tenantIdFromDecoded(decoded);
    req.user = {
      login: decoded.login,
      id,
      cdcadastro: id,
      nome: decoded.nome,
      email: decoded.email,
      tenantId: tid != null ? tid : undefined,
      tipo: decoded.tipo,
    };
    next();
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao verificar autenticação.'
    });
  }
};

/**
 * JWT da torre (dashboard web) OU do app motorista.
 * Motoristas (`tipo: 'motorista'`) passam por isCurrentToken; usuários da torre só precisam de JWT válido.
 * Usado em leituras que a torre precisa (POD, posições GPS, macros, etc.).
 */
const requireMotoristaOrTowerAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      token = req.headers['x-token'] || req.query.token;
    }
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token de autenticação não fornecido. Faça login novamente.',
        errorKey: 'login.tokenObrigatorio'
      });
    }
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expirado. Faça login novamente.',
          errorKey: 'login.tokenExpirado'
        });
      }
      return res.status(401).json({
        success: false,
        message: 'Token inválido. Faça login novamente.',
        errorKey: 'login.tokenInvalido'
      });
    }
    const id = decoded.id ?? decoded.cdcadastro;
    if (decoded.tipo === 'motorista') {
      if (!isCurrentToken(id, token)) {
        return res.status(401).json({
          success: false,
          message: 'Sessão encerrada em outro dispositivo. Faça login novamente.',
          errorKey: 'login.sessaoEncerradaOutroDispositivo'
        });
      }
    } else {
      const logOk = await isLogAcessoTorreAberto(decoded.logAcessoId ?? decoded.idLogAcesso);
      if (!logOk) {
        return res.status(401).json({
          success: false,
          message:
            'Sessão encerrada (limite de acessos simultâneos ou logout). Faça login novamente.',
          code: 'SESSION_REVOKED',
          errorKey: 'login.sessaoRevogadaTorre',
        });
      }
    }
    const tid = tenantIdFromDecoded(decoded);
    req.user = {
      login: decoded.login,
      id,
      cdcadastro: id,
      nome: decoded.nome,
      email: decoded.email,
      tenantId: tid != null ? tid : undefined,
      tipo: decoded.tipo,
      logAcessoId: decoded.logAcessoId ?? decoded.idLogAcesso,
    };
    next();
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Erro ao verificar autenticação.'
    });
  }
};

/** @deprecated use requireMotoristaOrTowerAuth */
const requireMotoristaOrTowerReadPod = requireMotoristaOrTowerAuth;

function pathSemQuery(req) {
  const u = req.originalUrl || req.url || '';
  const q = u.indexOf('?');
  return q === -1 ? u : u.slice(0, q);
}

/** Path normalizado para comparações de rota pública (barra final, duplicadas; fallback baseUrl+path no mount /api). */
function pathForTowerSkip(req) {
  let u = pathSemQuery(req);
  u = String(u).replace(/\/+/g, '/');
  if (u.length > 1) u = u.replace(/\/+$/, '');
  u = u.toLowerCase();
  if (u.startsWith('/api') || u.startsWith('/cargas/api')) return u;
  const base = String(req.baseUrl || '').toLowerCase().replace(/\/+$/, '');
  const sub = String(req.path || '').split('?')[0].replace(/^\/+/, '');
  if (base && sub) {
    const merged = (base + '/' + sub).replace(/\/+/g, '/');
    return merged.length > 1 ? merged.replace(/\/+$/, '').toLowerCase() : merged.toLowerCase();
  }
  return u || '/';
}

/**
 * Em toda requisição /api com Bearer: se o JWT da torre tiver logAcessoId, a linha em USUARIOLOGACESSO
 * deve seguir aberta (senão 401). Assim kick/logout derruba o painel mesmo em rotas sem requireAuth.
 */
const verifyTowerSessionNotRevoked = async (req, res, next) => {
  try {
    const p = pathForTowerSkip(req);

    const prefixSkip = [
      '/api/auth/',
      '/cargas/api/auth/',
      '/api/configuracoes/identidade',
      '/cargas/api/configuracoes/identidade',
      '/api/motorista/login',
      '/cargas/api/motorista/login',
      '/api/motorista/config',
      '/cargas/api/motorista/config',
      '/api/motorista/classes-frota-combo',
      '/cargas/api/motorista/classes-frota-combo',
      '/api/motorista/recuperar-senha',
      '/cargas/api/motorista/recuperar-senha',
      '/api/motorista/redefinir-senha',
      '/cargas/api/motorista/redefinir-senha',
      '/api/motorista/cadastro',
      '/cargas/api/motorista/cadastro',
      '/api/motorista/sos',
      '/cargas/api/motorista/sos',
      '/api/motivos-recusa-combo',
      '/cargas/api/motivos-recusa-combo',
    ];
    if (prefixSkip.some((s) => p.startsWith(s))) return next();
    if (p.includes('/public/convocacao')) return next();

    // Catálogos só leitura (cadastro motorista): GET sem validar sessão da torre (evita 401 com Bearer revogado no mesmo host)
    if (req.method === 'GET') {
      if (
        p === '/api/paises' ||
        p === '/cargas/api/paises' ||
        p === '/api/estados-brasil' ||
        p === '/cargas/api/estados-brasil' ||
        p === '/api/estados' ||
        p === '/cargas/api/estados'
      ) {
        return next();
      }
      // GET /api/estados/:cdpais/:cduf (público no router de estado, antes do towerAuth)
      if (/^\/api\/estados\/\d+\/\d+$/.test(p) || /^\/cargas\/api\/estados\/\d+\/\d+$/.test(p)) return next();
      if (p.startsWith('/api/estado-cduf/') || p.startsWith('/cargas/api/estado-cduf/')) return next();
      if (p.startsWith('/api/mesorregioes/') || p.startsWith('/cargas/api/mesorregioes/')) return next();
    }

    let token = null;
    const ah = req.headers.authorization;
    if (ah && ah.startsWith('Bearer ')) token = ah.substring(7);
    else token = req.headers['x-token'] || (req.query && req.query.token) || null;
    if (!token || String(token).trim() === '') return next();

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      return next();
    }

    if (decoded.tipo === 'motorista') return next();

    const logId = decoded.logAcessoId ?? decoded.idLogAcesso;
    if (logId == null || logId === '') return next();

    const open = await isLogAcessoTorreAberto(logId);
    if (open) return next();

    return res.status(401).json({
      success: false,
      message: 'Sessão encerrada (limite de acessos ou logout). Faça login novamente.',
      code: 'SESSION_REVOKED',
    });
  } catch (err) {
    return next(err);
  }
};

module.exports = {
  getUsuarioLogado,
  verifyTowerSessionNotRevoked,
  requireAuth,
  requireMotoristaAuth,
  requireMotoristaOrTowerAuth,
  requireMotoristaOrTowerReadPod
};

