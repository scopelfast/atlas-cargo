// backend/middleware/auth.middleware.js
const jwt = require('jsonwebtoken');

// Middleware para extrair usuário do token JWT (opcional - não bloqueia)
const getUsuarioLogado = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const id = decoded.id ?? decoded.cdcadastro;
        req.user = {
          login: decoded.login,
          id,
          cdcadastro: id,
          nome: decoded.nome,
          email: decoded.email
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
          req.user = {
            login: decoded.login,
            id,
            cdcadastro: id,
            nome: decoded.nome,
            email: decoded.email
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
const requireAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    let token = null;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else {
      // Tentar obter do header customizado ou query string (para compatibilidade)
      token = req.headers['x-token'] || req.query.token;
    }
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token de autenticação não fornecido. Faça login novamente.'
      });
    }
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const id = decoded.id ?? decoded.cdcadastro;
      req.user = {
        login: decoded.login,
        id,
        cdcadastro: id,
        nome: decoded.nome,
        email: decoded.email
      };
      next();
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Token expirado. Faça login novamente.'
        });
      } else if (err.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Token inválido. Faça login novamente.'
        });
      } else {
        return res.status(401).json({
          success: false,
          message: 'Erro ao verificar token. Faça login novamente.'
        });
      }
    }
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Erro interno ao verificar autenticação.'
    });
  }
};

module.exports = { getUsuarioLogado, requireAuth };

