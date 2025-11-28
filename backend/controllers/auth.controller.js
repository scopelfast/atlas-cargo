// backend/controllers/auth.controller.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { findByEmail, findByLogin } = require('../models/user.model');
require('dotenv').config();

const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      success: false,
      message: 'E-mail (ou login) e senha são obrigatórios.'
    });
  }

  try {
    let user = null;

    // Decide se é e-mail ou login (SGUSUARIO)
    if (email.includes('@')) {
      user = await findByEmail(email);
    } else {
      user = await findByLogin(email);
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas.'
      });
    }

    if (user.FGACTIVE !== 'S') {
      return res.status(403).json({
        success: false,
        message: 'Usuário inativo. Contate o administrador.'
      });
    }

    // Verificar senha - suporta tanto hash bcrypt quanto texto puro (para migração)
    let senhaValida = false;
    
    // Verificar se a senha no banco é um hash bcrypt (começa com $2a$, $2b$ ou $2y$)
    if (user.SENHA && (user.SENHA.startsWith('$2a$') || user.SENHA.startsWith('$2b$') || user.SENHA.startsWith('$2y$'))) {
      // Senha está hasheada - usar bcrypt.compare
      senhaValida = await bcrypt.compare(password, user.SENHA);
    } else {
      // Senha em texto puro (legado) - comparar diretamente
      // ⚠️ AVISO: Isso é temporário para permitir migração gradual
      senhaValida = user.SENHA === password;
    }

    if (!senhaValida) {
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas.'
      });
    }

    const token = jwt.sign(
      {
        id: user.CDCADASTRO,
        login: user.SGUSUARIO,
        nome: user.NMUSUARIO,
        email: user.ENDEMAIL
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    return res.json({
      success: true,
      token,
      user: {
        id: user.CDCADASTRO,
        login: user.SGUSUARIO,
        nome: user.NMUSUARIO,
        email: user.ENDEMAIL
      }
    });

  } catch (err) {
    console.error('Erro no login:', err);
    return res.status(500).json({
      success: false,
      message: 'Erro interno no servidor.'
    });
  }
};

module.exports = { login };