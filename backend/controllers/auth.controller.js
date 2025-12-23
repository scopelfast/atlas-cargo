// backend/controllers/auth.controller.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { findByEmail, findByLogin } = require('../models/user.model');
const { registrarLogin, registrarLogout, registrarLogoutPorUsuario } = require('../models/usuariologacesso.model');
require('dotenv').config();

const login = async (req, res) => {
  const { email, password } = req.body;

  console.log('[AUTH] Tentativa de login recebida:', {
    email: email ? email.substring(0, 10) + '...' : 'undefined',
    hasPassword: !!password,
    path: req.path,
    originalUrl: req.originalUrl
  });

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
      console.log('[AUTH] Buscando usuário por email:', email);
      user = await findByEmail(email);
    } else {
      console.log('[AUTH] Buscando usuário por login:', email);
      user = await findByLogin(email);
    }

    console.log('[AUTH] Usuário encontrado:', user ? { login: user.SGUSUARIO, ativo: user.FGACTIVE } : 'NÃO ENCONTRADO');

    if (!user) {
      console.log('[AUTH] Usuário não encontrado para:', email);
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
      console.log('[AUTH] Senha inválida para usuário:', user.SGUSUARIO);
      return res.status(401).json({
        success: false,
        message: 'Credenciais inválidas.'
      });
    }

    console.log('[AUTH] Login bem-sucedido para usuário:', user.SGUSUARIO);

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

    // Registrar login na tabela USUARIOLOGACESSO
    let idLogAcesso = null;
    try {
      idLogAcesso = await registrarLogin(user.SGUSUARIO);
    } catch (logErr) {
      // Não falhar o login se houver erro ao registrar log
      console.error('Erro ao registrar log de acesso:', logErr);
    }

    return res.json({
      success: true,
      token,
      idLogAcesso, // Retornar ID do log para o frontend
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

const alterarSenha = async (req, res) => {
  const { usuario, senhaAtual, senhaNova } = req.body;

  if (!usuario || !senhaAtual || !senhaNova) {
    return res.status(400).json({
      success: false,
      message: 'Usuário, senha atual e nova senha são obrigatórios.'
    });
  }

  if (senhaNova.length < 6) {
    return res.status(400).json({
      success: false,
      message: 'A nova senha deve ter no mínimo 6 caracteres.'
    });
  }

  try {
    // Buscar usuário
    let user = await findByLogin(usuario);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuário não encontrado.'
      });
    }

    if (user.FGACTIVE !== 'S') {
      return res.status(403).json({
        success: false,
        message: 'Usuário inativo. Contate o administrador.'
      });
    }

    // Verificar senha atual
    let senhaValida = false;
    
    if (user.SENHA && (user.SENHA.startsWith('$2a$') || user.SENHA.startsWith('$2b$') || user.SENHA.startsWith('$2y$'))) {
      senhaValida = await bcrypt.compare(senhaAtual, user.SENHA);
    } else {
      senhaValida = user.SENHA === senhaAtual;
    }

    if (!senhaValida) {
      return res.status(401).json({
        success: false,
        message: 'Senha atual incorreta.'
      });
    }

    // Hash da nova senha
    const saltRounds = 10;
    const senhaNovaHash = await bcrypt.hash(senhaNova, saltRounds);

    // Atualizar senha no banco
    const { poolPromise } = require('../config/db');
    const pool = await poolPromise;
    
    await pool.request()
      .input('login', usuario)
      .input('senha', senhaNovaHash)
      .query(`
        UPDATE USUARIO 
        SET SENHA = @senha,
            DHMAINTENANCE = GETDATE()
        WHERE SGUSUARIO = @login
      `);

    return res.json({
      success: true,
      message: 'Senha alterada com sucesso!'
    });

  } catch (err) {
    console.error('Erro ao alterar senha:', err);
    return res.status(500).json({
      success: false,
      message: 'Erro ao alterar senha. Tente novamente.'
    });
  }
};

const logout = async (req, res) => {
  try {
    const { idLogAcesso, sgUsuario } = req.body;

    // Se tiver ID do log, usar ele (mais preciso)
    if (idLogAcesso) {
      await registrarLogout(idLogAcesso);
    } else if (sgUsuario) {
      // Senão, usar o login do usuário
      await registrarLogoutPorUsuario(sgUsuario);
    }

    return res.json({
      success: true,
      message: 'Logout registrado com sucesso.'
    });
  } catch (err) {
    console.error('Erro no logout:', err);
    // Não falhar se houver erro ao registrar logout
    return res.json({
      success: true,
      message: 'Logout realizado.'
    });
  }
};

module.exports = { login, alterarSenha, logout };