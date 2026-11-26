// backend/controllers/auth.controller.js
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { findByEmail, findByLogin } = require('../models/user.model');
const { registrarLogin, registrarLogout, registrarLogoutPorUsuario } = require('../models/usuariologacesso.model');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const { poolPromise } = require('../config/db');
const { enviarUmaMensagemSwitchDigital } = require('../services/whatsapp-switch-digital.service');
const recuperacaoLog = require('../services/recuperacao-senha-log.service');
const codigosRecuperacaoTorre = new Map();
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

async function buscarUsuarioPainel(pool, texto) {
  const q = String(texto || '').trim();
  if (!q) return [];
  const sqlUser = `SELECT u."SGUSUARIO" AS login, u."NMUSUARIO" AS nome, u."ENDEMAIL" AS email,
            TRIM(u."FGACTIVE") AS fg, u."CDCADASTRO" AS cd, COALESCE(u."TENANT_ID", 'default') AS tid,
            cg."NRCELULAR"::text AS cel
       FROM "USUARIO" u
       LEFT JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = u."CDCADASTRO"`;
  const exato = await pool.query(
    `${sqlUser}
      WHERE UPPER(u."SGUSUARIO") = UPPER($1) OR lower(COALESCE(u."ENDEMAIL", '')) = lower($1)`,
    [q]
  );
  if (exato.rows.length) return exato.rows;
  const porNome = await pool.query(
    `${sqlUser}
      WHERE lower(u."NMUSUARIO") = lower($1)
         OR lower(u."NMUSUARIO") LIKE lower($2)
         OR lower(u."NMUSUARIO") LIKE lower($3)
         OR lower(u."NMUSUARIO") LIKE lower($4)`,
    [q, `${q} %`, `% ${q}`, `% ${q} %`]
  );
  return porNome.rows;
}

function digitos(valor) {
  return String(valor || '').replace(/\D/g, '');
}

function nomeEhContato(nomeUsuario, nomeContato) {
  const palavras = String(nomeUsuario || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const contato = String(nomeContato || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!palavras.length || !contato.length) return false;
  const menor = palavras.length <= contato.length ? palavras : contato;
  const maior = menor === palavras ? contato : palavras;
  return menor.every((p) => maior.includes(p));
}

async function celularDoUsuarioPainel(pool, user) {
  const direto = digitos(user.cel);
  if (direto) return direto;
  const tid = String(user.tid || 'default');
  const emailUser = String(user.email || '').trim().toLowerCase();
  if (emailUser) {
    const porEmail = await pool.query(
      `SELECT "NRCELULAR"::text AS cel
         FROM "CADASTROGERAL"
        WHERE "TENANT_ID" = $1 AND lower(COALESCE("ENDEMAIL", '')) = $2
          AND COALESCE("NRCELULAR"::text, '') <> ''
        ORDER BY "CDCADASTRO"
        LIMIT 1`,
      [tid, emailUser]
    );
    const doEmail = digitos(porEmail.rows[0] && porEmail.rows[0].cel);
    if (doEmail) return doEmail;
  }
  const cli = await pool.query(
    `SELECT "NM_CONTATO" AS contato, "EMAIL" AS email, "DDI" AS ddi, "TELEFONE" AS tel
       FROM "SAAS_CLIENTE_CONTRATANTE"
      WHERE "TENANT_ID" = $1
      LIMIT 1`,
    [tid]
  );
  const cliente = cli.rows[0];
  if (!cliente) return '';
  const emailCli = String(cliente.email || '').trim().toLowerCase();
  const ehContato = nomeEhContato(user.nome, cliente.contato) || (emailCli && emailUser && emailCli === emailUser);
  if (!ehContato) return '';
  if (emailCli) {
    const porCli = await pool.query(
      `SELECT "NRCELULAR"::text AS cel
         FROM "CADASTROGERAL"
        WHERE "TENANT_ID" = $1 AND lower(COALESCE("ENDEMAIL", '')) = $2
          AND COALESCE("NRCELULAR"::text, '') <> ''
        ORDER BY "CDCADASTRO"
        LIMIT 1`,
      [tid, emailCli]
    );
    const doCli = digitos(porCli.rows[0] && porCli.rows[0].cel);
    if (doCli) return doCli;
  }
  const ddi = digitos(cliente.ddi);
  const tel = digitos(cliente.tel);
  if (!tel) return '';
  if (ddi && tel.startsWith(ddi) && tel.length >= ddi.length + 8) return tel;
  return ddi ? ddi + tel : tel;
}

const recuperarSenhaTorre = async (req, res) => {
  const usuario = String((req.body && req.body.usuario) || '').trim();
  const pool = await poolPromise;
  const quem = recuperacaoLog.identificador('painel', 'usuario', usuario);
  const ip = recuperacaoLog.ipDe(req);
  const anotar = (evento, resultado, extra) => recuperacaoLog.registrar(pool, {
    canal: 'painel', evento, resultado, identificador: quem, ip, ...extra,
  });
  if (!usuario) {
    await anotar('identificacao_invalida', 'N', { detalhe: 'Usuário não informado. WhatsApp não enviado.' });
    return res.status(400).json({ success: false, message: 'Informe o usuário.' });
  }
  try {
    const rows = await buscarUsuarioPainel(pool, usuario);
    const aviso = 'Se o usuário existir e tiver celular, o código foi para o WhatsApp.';
    if (!rows.length) {
      await anotar('nao_encontrado', 'N', { detalhe: 'Login do painel não encontrado. WhatsApp não enviado.' });
      return res.json({ success: true, message: aviso });
    }
    if (rows.length > 1) {
      await anotar('ambiguo', 'N', { detalhe: 'Mais de um usuário do painel com esse nome. WhatsApp não enviado.' });
      return res.status(409).json({ success: false, message: 'Há mais de um usuário com esse nome. Informe o login.' });
    }
    const user = rows[0];
    const fg = String(user.fg || '').trim();
    if (fg !== 'S' && fg !== 'A') {
      await anotar('inativo', 'N', { identificador: user.login, cdCadastro: user.cd, detalhe: 'Usuário inativo. WhatsApp não enviado.' });
      return res.status(403).json({ success: false, message: 'Usuário inativo. Contate o administrador.' });
    }
    const celular = await celularDoUsuarioPainel(pool, user);
    if (!celular) {
      await anotar('sem_celular', 'N', { identificador: user.login, cdCadastro: user.cd, detalhe: 'Usuário sem celular ligado ao cadastro. WhatsApp não enviado.' });
      return res.status(400).json({ success: false, message: 'Este usuário não tem celular para receber o código no WhatsApp.' });
    }
    const codigo = String(Math.floor(100000 + Math.random() * 900000));
    const chave = String(user.login).toUpperCase();
    codigosRecuperacaoTorre.set(chave, { codigo, expires: Date.now() + 15 * 60 * 1000 });
    const envio = await enviarUmaMensagemSwitchDigital(pool, null, {
      idConvocacao: null,
      numeroCelular: celular,
      corpoMensagem: `Atlas Cargo\nSeu código para redefinir a senha do painel é ${codigo}.\nEle vale por 15 minutos.`,
      tenantId: getDefaultTenantId(),
      jaTemDdi: celular.startsWith('55') && celular.length >= 12,
    });
    if (!envio.ok) {
      codigosRecuperacaoTorre.delete(chave);
      const semCanal = /não configurado|nao configurado/i.test(envio.error || '');
      await anotar('whatsapp_falhou', 'N', {
        identificador: user.login,
        cdCadastro: user.cd,
        destino: celular,
        detalhe: semCanal ? 'Canal do tenant padrão sem token.' : (envio.error || 'A API recusou o envio.'),
      });
      return res.status(semCanal ? 503 : 502).json({
        success: false,
        message: semCanal
          ? 'O WhatsApp da Atlas não está configurado. Tente mais tarde.'
          : 'Não foi possível enviar o código no WhatsApp. Tente de novo.',
      });
    }
    await anotar('whatsapp_enviado', 'S', {
      identificador: user.login,
      cdCadastro: user.cd,
      destino: celular,
      detalhe: 'Código do painel enviado no WhatsApp. Vale 15 minutos.',
    });
    return res.json({ success: true, message: aviso });
  } catch (err) {
    console.error('Erro ao recuperar senha da torre:', err);
    await anotar('senha_falhou', 'N', { detalhe: 'Falha ao processar o pedido de código do painel.' });
    return res.status(500).json({ success: false, message: 'Erro ao recuperar a senha.' });
  }
};

const redefinirSenhaTorre = async (req, res) => {
  const usuario = String((req.body && req.body.usuario) || '').trim();
  const codigo = String((req.body && req.body.codigo) || '').trim();
  const novaSenha = String((req.body && (req.body.senhaNova || req.body.novaSenha)) || '');
  const pool = await poolPromise;
  const quem = recuperacaoLog.identificador('painel', 'usuario', usuario);
  const ip = recuperacaoLog.ipDe(req);
  const anotar = (evento, resultado, extra) => recuperacaoLog.registrar(pool, {
    canal: 'painel', evento, resultado, identificador: quem, ip, ...extra,
  });
  if (!usuario || !codigo || !novaSenha) {
    await anotar('senha_falhou', 'N', { detalhe: 'Pedido incompleto. Senha do painel não alterada.' });
    return res.status(400).json({ success: false, message: 'Usuário, código e nova senha são obrigatórios.' });
  }
  if (novaSenha.length < 6) {
    await anotar('senha_falhou', 'N', { detalhe: 'Senha com menos de 6 caracteres. Não alterada.' });
    return res.status(400).json({ success: false, message: 'A nova senha deve ter no mínimo 6 caracteres.' });
  }
  const rows = await buscarUsuarioPainel(pool, usuario);
  if (rows.length !== 1) {
    await anotar('codigo_invalido', 'N', { detalhe: 'Usuário não localizado para este código. Senha do painel não alterada.' });
    return res.status(400).json({ success: false, message: 'Código inválido ou expirado.' });
  }
  const loginReal = rows[0].login;
  const chave = String(loginReal).toUpperCase();
  const stored = codigosRecuperacaoTorre.get(chave);
  if (!stored || stored.expires < Date.now() || stored.codigo !== codigo) {
    await anotar('codigo_invalido', 'N', { identificador: loginReal, detalhe: 'Código inválido ou expirado. Senha do painel não alterada.' });
    return res.status(400).json({ success: false, message: 'Código inválido ou expirado.' });
  }
  try {
    const senhaNovaHash = await bcrypt.hash(novaSenha, 10);
    const upd = await pool.query(
      `UPDATE "USUARIO" SET "SENHA" = $1, "DHMAINTENANCE" = CURRENT_TIMESTAMP WHERE UPPER("SGUSUARIO") = UPPER($2)`,
      [senhaNovaHash, loginReal]
    );
    if (!upd.rowCount) {
      await anotar('nao_encontrado', 'N', { detalhe: 'Usuário sumiu antes da gravação. Senha não alterada.' });
      return res.status(404).json({ success: false, message: 'Usuário não encontrado.' });
    }
    codigosRecuperacaoTorre.delete(chave);
    await anotar('senha_alterada', 'S', { identificador: loginReal, detalhe: 'Senha do painel alterada.' });
    return res.json({ success: true, message: 'Senha redefinida. Entre com a nova senha.' });
  } catch (err) {
    console.error('Erro ao redefinir senha da torre:', err);
    await anotar('senha_falhou', 'N', { detalhe: 'Falha ao gravar a senha do painel. Não alterada.' });
    return res.status(500).json({ success: false, message: 'Erro ao redefinir a senha.' });
  }
};

module.exports = {
  login,
  alterarSenha,
  logout,
  recuperarSenhaTorre,
  redefinirSenhaTorre,
  buscarUsuarioPainel,
  celularDoUsuarioPainel,
};