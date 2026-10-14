// backend/controllers/auth.controller.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { findByEmail, findByLogin } = require('../models/user.model');
const { registrarLogin, registrarLogout, registrarLogoutPorUsuario } = require('../models/usuariologacesso.model');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const { poolPromise } = require('../config/db');
const {
  resolveTowerSessionSlotForLogin,
  getTowerSessionTtlHours,
} = require('../services/tenant-concurrent-sessions.service');
require('dotenv').config();

const login = async (req, res) => {
  const { email, password, kickOldestSession } = req.body || {};
  const kick =
    kickOldestSession === true ||
    kickOldestSession === 'true' ||
    kickOldestSession === 1 ||
    kickOldestSession === '1';

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

    // Garantir id numérico (PostgreSQL pode retornar CDCADASTRO em maiúsculas ou minúsculas)
    let userId = user.CDCADASTRO ?? user.cdcadastro ?? user.id;
    let userIdNum = userId != null ? parseFloat(userId) : NaN;
    if (Number.isNaN(userIdNum)) {
      // CDCADASTRO null no banco (ex.: admin sem vínculo em CADASTROGERAL): usar id derivado do login para o token
      const loginStr = String(user.SGUSUARIO ?? user.sgusuario ?? '');
      let hash = 0;
      for (let i = 0; i < loginStr.length; i++) {
        hash = ((hash << 5) - hash) + loginStr.charCodeAt(i);
        hash = hash & 0x7FFFFFFF;
      }
      userIdNum = hash % 100000000; // número positivo único por login
      console.warn('[AUTH] CDCADASTRO null para usuário', loginStr, '- usando id derivado do login:', userIdNum);
    }
    const loginName = user.SGUSUARIO ?? user.sgusuario;
    const nomeUser = user.NMUSUARIO ?? user.nmusuario;
    const emailUser = user.ENDEMAIL ?? user.endemail;

    const rawTid = user.TENANT_ID ?? user.tenant_id;
    const tenantId =
      rawTid != null && String(rawTid).trim() !== '' ? String(rawTid).trim() : getDefaultTenantId();

    const pool = await poolPromise;
    const sessGate = await resolveTowerSessionSlotForLogin(pool, tenantId, kick, loginName);
    if (!sessGate.ok) {
      const status = sessGate.code === 'CONCURRENT_SESSION_LIMIT' ? 409 : 503;
      return res.status(status).json({
        success: false,
        code: sessGate.code,
        message: sessGate.message,
        maxConcurrentSessions: sessGate.maxConcurrentSessions,
        openSessions: sessGate.openSessions,
      });
    }

    console.log('[AUTH] Login bem-sucedido (sessão autorizada) para usuário:', user.SGUSUARIO);

    // Registrar login na tabela USUARIOLOGACESSO (antes do JWT: token leva logAcessoId para revogar ao encerrar sessão)
    let idLogAcesso = null;
    try {
      idLogAcesso = await registrarLogin(loginName, tenantId);
    } catch (logErr) {
      console.error('Erro ao registrar log de acesso:', logErr);
    }

    const ttlH = getTowerSessionTtlHours();
    const payload = {
      id: userIdNum,
      cdcadastro: userIdNum,
      login: loginName,
      nome: nomeUser,
      email: emailUser,
      tenantId,
    };
    if (idLogAcesso != null && idLogAcesso !== '') {
      const lid = typeof idLogAcesso === 'number' ? idLogAcesso : parseInt(String(idLogAcesso), 10);
      if (Number.isFinite(lid) && lid > 0) {
        payload.logAcessoId = lid;
        payload.idLogAcesso = lid;
      }
    }
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: `${ttlH}h` });

    return res.json({
      success: true,
      token,
      idLogAcesso, // Retornar ID do log para o frontend
      user: {
        id: userIdNum,
        cdcadastro: userIdNum,
        login: loginName,
        nome: nomeUser,
        email: emailUser,
        tenantId,
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

    // Atualizar senha no banco (PostgreSQL)
    const { poolPromise } = require('../config/db');
    const pool = await poolPromise;
    await pool.query(
      `UPDATE "USUARIO" SET "SENHA" = $1, "DHMAINTENANCE" = CURRENT_TIMESTAMP WHERE "SGUSUARIO" = $2`,
      [senhaNovaHash, usuario]
    );

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