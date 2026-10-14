// backend/controllers/usuario.controller.js
const sql = require('../config/mssql-compat');
const bcrypt = require('bcrypt');
const { poolPromise } = require('../config/db');
const { getSgUser } = require('../utils/audit');
const { getDefaultTenantId } = require('../middleware/tenant.middleware');
const { isSaaSAdminLogin } = require('../middleware/saas-admin.middleware');
const { isMissingColumnError } = require('../utils/db-errors');
const { enrichTipoAtividadeRow } = require('../utils/tipo-atividade-grupo');
const { filterRowsByTenantLicense } = require('../utils/tipo-atividade-licenca');
const { getEntitlementsForTenant } = require('../services/tenant-entitlements.service');
const { tenantIdForRequest } = require('../utils/tenant-context');
const {
  tipoRowVisibleForUserClause,
  tipoCatalogVisibleForTenantClause,
  tipoatividadeHasTenantIdColumn,
} = require('../utils/tipoatividade-catalog-scope.sql.js');
/** @param {unknown} raw */
function normalizeTenantId(raw) {
  const s = raw != null ? String(raw).trim() : '';
  if (!s) return null;
  if (s.length > 64) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(s)) return null;
  return s;
}

/**
 * @param {import('express').Request} req
 * @param {string} targetLogin
 * @returns {Promise<{ ok: true, saasAdmin: boolean } | { err: { status: number, body: object } }>}
 */
async function assertAcessoUsuario(req, targetLogin) {
  const pool = await poolPromise;
  const actor = getSgUser(req);
  if (!actor) {
    return { err: { status: 401, body: { error: 'Não autorizado. Faça login.' } } };
  }
  const saasAdmin = await isSaaSAdminLogin(actor);
  if (saasAdmin) return { ok: true, saasAdmin: true };
  const myTid =
    req.tenantId != null && String(req.tenantId).trim() !== ''
      ? String(req.tenantId).trim()
      : getDefaultTenantId();
  const r = await pool
    .request()
    .input('login', sql.VarChar(50), targetLogin)
    .query(`SELECT [TENANT_ID] FROM [dbo].[USUARIO] WHERE [SGUSUARIO] = @login`);
  if (!r.recordset.length) {
    return { err: { status: 404, body: { error: 'Usuário não encontrado.' } } };
  }
  const row = r.recordset[0];
  const rawTid = row.TENANT_ID ?? row.tenant_id;
  const uTid =
    rawTid == null || String(rawTid).trim() === '' ? getDefaultTenantId() : String(rawTid).trim();
  if (uTid !== myTid) {
    return { err: { status: 404, body: { error: 'Usuário não encontrado.' } } };
  }
  return { ok: true, saasAdmin: false };
}

const contexto = async (req, res) => {
  try {
    const actor = getSgUser(req);
    if (!actor) return res.status(401).json({ error: 'Não autorizado.' });
    const pool = await poolPromise;
    const saasAdmin = await isSaaSAdminLogin(actor);
    const tenantId =
      req.tenantId != null && String(req.tenantId).trim() !== ''
        ? String(req.tenantId).trim()
        : getDefaultTenantId();
    res.json({ saasAdmin, tenantId });
  } catch (err) {
    console.error('Erro contexto usuários:', err);
    res.status(500).json({ error: 'Erro ao carregar contexto.' });
  }
};

// Listar usuários com filtros
const listar = async (req, res) => {
  try {
    const { login, nome, email, cadastro, situacao, empresa } = req.query;

    const actor = getSgUser(req);
    if (!actor) return res.status(401).json({ error: 'Não autorizado. Faça login.' });
    const pool = await poolPromise;
    const saasAdmin = await isSaaSAdminLogin(actor);
    const myTenantFilter =
      req.tenantId != null && String(req.tenantId).trim() !== ''
        ? String(req.tenantId).trim()
        : getDefaultTenantId();

    let query = `
      SELECT 
        [USUARIO].[SGUSUARIO],
        [USUARIO].[NMUSUARIO],
        [USUARIO].[ENDEMAIL],
        [USUARIO].[CDCADASTRO],
        [USUARIO].[SENHA],
        [USUARIO].[FGACTIVE],
        [USUARIO].[DHMAINTENANCE],
        [USUARIO].[SGUSER],
        [USUARIO].[SERVERORIG],
        [USUARIO].[TENANT_ID],
        [CADASTROGERAL].[RZSOCIAL] AS [CADASTRO_NOME],
        [CADASTROGERAL].[NMFANTASIA] AS [CADASTRO_FANTASIA],
        [CADASTROGERAL].[CGCCPF] AS [CADASTRO_CGCCPF]
      FROM [dbo].[USUARIO] [USUARIO]
      LEFT JOIN [dbo].[CADASTROGERAL] [CADASTROGERAL] ON [USUARIO].[CDCADASTRO] = [CADASTROGERAL].[CDCADASTRO]
      WHERE 1=1
    `;

    const request = pool.request();
    if (!saasAdmin) {
      query += ` AND COALESCE(NULLIF(TRIM([USUARIO].[TENANT_ID]), ''), @tenantDefault) = @meuTenant`;
      request.input('meuTenant', sql.VarChar(64), myTenantFilter);
      request.input('tenantDefault', sql.VarChar(64), getDefaultTenantId());
    }

    if (login) {
      query += ` AND [USUARIO].[SGUSUARIO] LIKE @login`;
      request.input('login', sql.VarChar(50), `%${login}%`);
    }

    if (nome) {
      query += ` AND [USUARIO].[NMUSUARIO] LIKE @nome`;
      request.input('nome', sql.VarChar(40), `%${nome}%`);
    }

    if (email) {
      query += ` AND [USUARIO].[ENDEMAIL] LIKE @email`;
      request.input('email', sql.VarChar(200), `%${email}%`);
    }

    if (cadastro) {
      query += ` AND [USUARIO].[CDCADASTRO] = @cadastro`;
      request.input('cadastro', sql.Decimal(15, 0), parseInt(cadastro));
    }

    if (situacao) {
      query += ` AND [USUARIO].[FGACTIVE] = @situacao`;
      request.input('situacao', sql.Char(1), situacao);
    }

    if (empresa) {
      query += ` AND EXISTS (
        SELECT 1 FROM [dbo].[USUARIOEMPRESA] [UE]
        WHERE [UE].[SGUSUARIO] = [USUARIO].[SGUSUARIO]
        AND [UE].[CDEMPRESA] = @empresa
        AND [UE].[FGACTIVE] = 'S'
      )`;
      request.input('empresa', sql.SmallInt, parseInt(empresa));
    }

    query += ` ORDER BY [USUARIO].[NMUSUARIO]`;

    const result = await request.query(query);

    const usuarios = result.recordset.map(u => ({
      SGUSUARIO: u.SGUSUARIO,
      NMUSUARIO: u.NMUSUARIO,
      ENDEMAIL: u.ENDEMAIL,
      CDCADASTRO: u.CDCADASTRO,
      FGACTIVE: u.FGACTIVE,
      DHMAINTENANCE: u.DHMAINTENANCE,
      SGUSER: u.SGUSER,
      SERVERORIG: u.SERVERORIG,
      TENANT_ID: u.TENANT_ID ?? u.tenant_id ?? getDefaultTenantId(),
      CADASTRO_NOME: u.CADASTRO_NOME,
      CADASTRO_FANTASIA: u.CADASTRO_FANTASIA,
      CADASTRO_CGCCPF: u.CADASTRO_CGCCPF
    }));

    res.json(usuarios);
  } catch (err) {
    console.error('Erro ao listar usuários:', err);
    res.status(500).json({ error: 'Erro ao carregar usuários.' });
  }
};

// Buscar usuário por login
const buscarPorLogin = async (req, res) => {
  try {
    const { login } = req.params;

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .query(`
        SELECT 
          [USUARIO].[SGUSUARIO],
          [USUARIO].[NMUSUARIO],
          [USUARIO].[ENDEMAIL],
          [USUARIO].[CDCADASTRO],
          [USUARIO].[FGACTIVE],
          [USUARIO].[DHMAINTENANCE],
          [USUARIO].[TENANT_ID],
          [CADASTROGERAL].[RZSOCIAL] AS [CADASTRO_NOME],
          [CADASTROGERAL].[NMFANTASIA] AS [CADASTRO_FANTASIA]
        FROM [dbo].[USUARIO] [USUARIO]
        LEFT JOIN [dbo].[CADASTROGERAL] [CADASTROGERAL] ON [USUARIO].[CDCADASTRO] = [CADASTROGERAL].[CDCADASTRO]
        WHERE [USUARIO].[SGUSUARIO] = @login
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const gate = await assertAcessoUsuario(req, login);
    if (gate.err) {
      return res.status(gate.err.status).json(gate.err.body);
    }

    const usuario = result.recordset[0];
    res.json({
      SGUSUARIO: usuario.SGUSUARIO,
      NMUSUARIO: usuario.NMUSUARIO,
      ENDEMAIL: usuario.ENDEMAIL,
      CDCADASTRO: usuario.CDCADASTRO,
      FGACTIVE: usuario.FGACTIVE,
      TENANT_ID: usuario.TENANT_ID ?? usuario.tenant_id ?? getDefaultTenantId(),
      CADASTRO_NOME: usuario.CADASTRO_NOME,
      CADASTRO_FANTASIA: usuario.CADASTRO_FANTASIA
    });
  } catch (err) {
    console.error('Erro ao buscar usuário:', err);
    res.status(500).json({ error: 'Erro ao buscar usuário.' });
  }
};

// Criar usuário
const criar = async (req, res) => {
  try {
    const { SGUSUARIO, NMUSUARIO, ENDEMAIL, SENHA, CDCADASTRO, FGACTIVE, TENANT_ID: bodyTenant } = req.body;

    if (!SGUSUARIO || !NMUSUARIO || !ENDEMAIL || !SENHA) {
      return res.status(400).json({ error: 'Campos obrigatórios não preenchidos.' });
    }

    // Validar formato do login (sem espaços, caracteres especiais)
    if (!/^[a-zA-Z0-9._-]+$/.test(SGUSUARIO)) {
      return res.status(400).json({ error: 'Login inválido. Use apenas letras, números, ponto, hífen ou underscore.' });
    }

    // Validar e-mail
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(ENDEMAIL)) {
      return res.status(400).json({ error: 'E-mail inválido.' });
    }

    const pool = await poolPromise;
    const sgUser = getSgUser(req);
    if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });
    const saasAdmin = await isSaaSAdminLogin(sgUser);

    let tenantIdInsert;
    if (saasAdmin) {
      const rawT = bodyTenant !== undefined ? bodyTenant : req.body.tenant_id;
      if (rawT === undefined || rawT === null || String(rawT).trim() === '') {
        tenantIdInsert = getDefaultTenantId();
      } else {
        const n = normalizeTenantId(rawT);
        if (n === null) {
          return res.status(400).json({
            error:
              'TENANT_ID inválido. Use até 64 caracteres (letras, números, ponto, underscore ou hífen) ou deixe em branco para o tenant padrão.',
          });
        }
        tenantIdInsert = n;
      }
    } else {
      tenantIdInsert =
        req.tenantId != null && String(req.tenantId).trim() !== ''
          ? String(req.tenantId).trim()
          : getDefaultTenantId();
    }

    // Verificar se login já existe
    const checkLogin = await pool
      .request()
      .input('login', sql.VarChar(50), SGUSUARIO)
      .query('SELECT [SGUSUARIO] FROM [dbo].[USUARIO] WHERE [SGUSUARIO] = @login');

    if (checkLogin.recordset.length > 0) {
      return res.status(400).json({ error: 'Login já existe. Escolha outro.' });
    }

    // Verificar se e-mail já existe
    const checkEmail = await pool
      .request()
      .input('email', sql.VarChar(200), ENDEMAIL)
      .query('SELECT [SGUSUARIO] FROM [dbo].[USUARIO] WHERE [ENDEMAIL] = @email');

    if (checkEmail.recordset.length > 0) {
      return res.status(400).json({ error: 'E-mail já cadastrado para outro usuário.' });
    }

    // Verificar se CDCADASTRO existe (se fornecido): tenant do usuário ou catálogo compartilhado default
    if (CDCADASTRO) {
      const checkCadastro = await pool
        .request()
        .input('cadastro', sql.Decimal(15, 0), parseInt(CDCADASTRO))
        .input('tidCad', sql.VarChar(64), tenantIdInsert)
        .query(
          `SELECT TOP 1 [CDCADASTRO] FROM [dbo].[CADASTROGERAL]
           WHERE [CDCADASTRO] = @cadastro
             AND ([TENANT_ID] = @tidCad OR [TENANT_ID] = 'default')
           ORDER BY CASE WHEN [TENANT_ID] = @tidCad THEN 0 ELSE 1 END`
        );

      if (checkCadastro.recordset.length === 0) {
        return res.status(400).json({ error: 'Cadastro geral não encontrado.' });
      }
    }

    const fgNovo = FGACTIVE === 'N' || FGACTIVE === 'n' ? 'N' : 'S';

    // Inserir usuário (manter senha como está - não forçar hash para compatibilidade)
    await pool
      .request()
      .input('SGUSUARIO', sql.VarChar(50), SGUSUARIO)
      .input('NMUSUARIO', sql.VarChar(40), NMUSUARIO)
      .input('ENDEMAIL', sql.VarChar(200), ENDEMAIL)
      .input('SENHA', sql.VarChar(100), SENHA)
      .input('CDCADASTRO', sql.Decimal(15, 0), CDCADASTRO || null)
      .input('FGACTIVE', sql.Char(1), FGACTIVE || 'S')
      .input('tenantId', sql.VarChar(64), tenantIdInsert)
      .input('sgUser', sql.VarChar(50), sgUser)
      .query(`
        INSERT INTO [dbo].[USUARIO] (
          [SGUSUARIO], [NMUSUARIO], [ENDEMAIL], [SENHA], [CDCADASTRO],
          [FGACTIVE], [TENANT_ID], [DHMAINTENANCE], [SGUSER], [SERVERORIG]
        )
        VALUES (
          @SGUSUARIO, @NMUSUARIO, @ENDEMAIL, @SENHA, @CDCADASTRO,
          @FGACTIVE, @tenantId, CURRENT_TIMESTAMP, @sgUser, 'AppDVcargas'
        )
      `);

    res.status(201).json({ success: true, message: 'Usuário cadastrado com sucesso!' });
  } catch (err) {
    console.error('Erro ao criar usuário:', err);
    res.status(500).json({ error: 'Erro ao cadastrar usuário.' });
  }
};

// Atualizar usuário
const atualizar = async (req, res) => {
  try {
    const { login } = req.params;
    const { NMUSUARIO, ENDEMAIL, SENHA, CDCADASTRO, FGACTIVE, TENANT_ID: bodyTenant } = req.body;

    if (!NMUSUARIO || !ENDEMAIL) {
      return res.status(400).json({ error: 'Nome e e-mail são obrigatórios.' });
    }

    // Validar e-mail
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(ENDEMAIL)) {
      return res.status(400).json({ error: 'E-mail inválido.' });
    }

    const sgUser = getSgUser(req);
    if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

    const pool = await poolPromise;

    // Verificar se usuário existe
    const checkUser = await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .query('SELECT [SGUSUARIO], [TENANT_ID], [FGACTIVE] FROM [dbo].[USUARIO] WHERE [SGUSUARIO] = @login');

    if (checkUser.recordset.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const gate = await assertAcessoUsuario(req, login);
    if (gate.err) {
      return res.status(gate.err.status).json(gate.err.body);
    }

    // Verificar se e-mail já existe em outro usuário
    const checkEmail = await pool
      .request()
      .input('email', sql.VarChar(200), ENDEMAIL)
      .input('login', sql.VarChar(50), login)
      .query('SELECT [SGUSUARIO] FROM [dbo].[USUARIO] WHERE [ENDEMAIL] = @email AND [SGUSUARIO] <> @login');

    if (checkEmail.recordset.length > 0) {
      return res.status(400).json({ error: 'E-mail já cadastrado para outro usuário.' });
    }

    let tenantUpdateSql = '';
    const request = pool
      .request()
      .input('login', sql.VarChar(50), login)
      .input('NMUSUARIO', sql.VarChar(40), NMUSUARIO)
      .input('ENDEMAIL', sql.VarChar(200), ENDEMAIL)
      .input('CDCADASTRO', sql.Decimal(15, 0), CDCADASTRO || null)
      .input('FGACTIVE', sql.Char(1), FGACTIVE || 'S')
      .input('sgUser', sql.VarChar(50), sgUser);

    const uRow = checkUser.recordset[0];
    const uTid = uRow.TENANT_ID ?? uRow.tenant_id;
    let effectiveTenantForCad =
      uTid != null && String(uTid).trim() !== '' ? String(uTid).trim() : getDefaultTenantId();

    if (gate.saasAdmin && (bodyTenant !== undefined || req.body.tenant_id !== undefined)) {
      const rawT = bodyTenant !== undefined ? bodyTenant : req.body.tenant_id;
      let tidVal;
      if (rawT === undefined || rawT === null || String(rawT).trim() === '') {
        tidVal = getDefaultTenantId();
      } else {
        const n = normalizeTenantId(rawT);
        if (n === null) {
          return res.status(400).json({
            error:
              'TENANT_ID inválido. Use até 64 caracteres (letras, números, ponto, underscore ou hífen) ou vazio para o tenant padrão.',
          });
        }
        tidVal = n;
      }
      tenantUpdateSql = ', [TENANT_ID] = @tenantIdUpd';
      request.input('tenantIdUpd', sql.VarChar(64), tidVal);
      effectiveTenantForCad = tidVal;
    }

    // Verificar se CDCADASTRO existe no tenant efetivo ou em default (catálogo compartilhado)
    if (CDCADASTRO) {
      const checkCadastro = await pool
        .request()
        .input('cadastro', sql.Decimal(15, 0), parseInt(CDCADASTRO))
        .input('tidCad', sql.VarChar(64), effectiveTenantForCad)
        .query(
          `SELECT TOP 1 [CDCADASTRO] FROM [dbo].[CADASTROGERAL]
           WHERE [CDCADASTRO] = @cadastro
             AND ([TENANT_ID] = @tidCad OR [TENANT_ID] = 'default')
           ORDER BY CASE WHEN [TENANT_ID] = @tidCad THEN 0 ELSE 1 END`
        );

      if (checkCadastro.recordset.length === 0) {
        return res.status(400).json({ error: 'Cadastro geral não encontrado.' });
      }
    }

    // Montar query de atualização
    let updateQuery = `
      UPDATE [dbo].[USUARIO]
      SET
        [NMUSUARIO] = @NMUSUARIO,
        [ENDEMAIL] = @ENDEMAIL,
        [CDCADASTRO] = @CDCADASTRO,
        [FGACTIVE] = @FGACTIVE,
        [DHMAINTENANCE] = CURRENT_TIMESTAMP,
        [SGUSER] = @sgUser,
        [SERVERORIG] = 'AppDVcargas'
        ${tenantUpdateSql}
    `;

    // Se senha foi fornecida, atualizar (manter formato original - não forçar hash)
    if (SENHA) {
      updateQuery += `, [SENHA] = @SENHA`;
      request.input('SENHA', sql.VarChar(100), SENHA);
    }

    updateQuery += ` WHERE [SGUSUARIO] = @login`;

    await request.query(updateQuery);

    res.json({ success: true, message: 'Usuário atualizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar usuário:', err);
    res.status(500).json({ error: 'Erro ao atualizar usuário.' });
  }
};

// Alterar status (ativar/desativar)
const alterarStatus = async (req, res) => {
  try {
    const { login } = req.params;
    const { action } = req.query;

    const sgUser = getSgUser(req);
    if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

    const pool = await poolPromise;

    // Verificar status atual
    const checkResult = await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .query('SELECT [FGACTIVE], [TENANT_ID] FROM [dbo].[USUARIO] WHERE [SGUSUARIO] = @login');

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const gate = await assertAcessoUsuario(req, login);
    if (gate.err) {
      return res.status(gate.err.status).json(gate.err.body);
    }

    const statusAtual = checkResult.recordset[0].FGACTIVE;
    const estaAtivo = statusAtual === 'S';

    let novaSituacao, mensagem;
    if (action === 'activate') {
      novaSituacao = 'S';
      mensagem = 'Usuário reativado com sucesso!';
    } else if (action === 'deactivate') {
      novaSituacao = 'N';
      mensagem = 'Usuário desativado com sucesso!';
    } else {
      novaSituacao = estaAtivo ? 'N' : 'S';
      mensagem = estaAtivo ? 'Usuário desativado com sucesso!' : 'Usuário reativado com sucesso!';
    }

    await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .input('FGACTIVE', sql.Char(1), novaSituacao)
      .input('sgUser', sql.VarChar(50), sgUser)
      .query(`
        UPDATE [dbo].[USUARIO]
        SET
          [FGACTIVE] = @FGACTIVE,
          [DHMAINTENANCE] = CURRENT_TIMESTAMP,
          [SGUSER] = @sgUser,
          [SERVERORIG] = 'AppDVcargas'
        WHERE [SGUSUARIO] = @login
      `);

    res.json({ success: true, message: mensagem, newStatus: novaSituacao });
  } catch (err) {
    console.error('Erro ao alterar status do usuário:', err);
    res.status(500).json({ error: 'Erro ao alterar status do usuário.' });
  }
};

/** CDTIPOATIVIDADE vinculados ao login em USUARIOATIVIDADE. */
async function obterSetCdtiposDoUsuario(pool, sgUsuario) {
  const login = sgUsuario != null ? String(sgUsuario).trim() : '';
  if (!login) return new Set();
  const r = await pool
    .request()
    .input('login', sql.VarChar(50), login)
    .query('SELECT [CDTIPOATIVIDADE] FROM [dbo].[USUARIOATIVIDADE] WHERE [SGUSUARIO] = @login');
  const set = new Set();
  for (const row of r.recordset || []) {
    const n = Number(row.CDTIPOATIVIDADE ?? row.cdtipoatividade);
    if (!Number.isNaN(n) && n > 0) set.add(n);
  }
  return set;
}

// Listar atividades do usuário
const listarAtividades = async (req, res) => {
  try {
    const { login } = req.params;

    const gate = await assertAcessoUsuario(req, login);
    if (gate.err) {
      return res.status(gate.err.status).json(gate.err.body);
    }

    const pool = await poolPromise;
    const defTenantLa = getDefaultTenantId();
    const tipoVisTa = await tipoRowVisibleForUserClause(pool, '[TA]', '[U_TARGET]', '@defTenant');
    const reqQ = pool
      .request()
      .input('login', sql.VarChar(50), login)
      .input('defTenant', sql.VarChar(64), defTenantLa);
    let result;
    try {
      result = await reqQ.query(`
        SELECT
          [TA].[CDTIPOATIVIDADE],
          [TA].[DSTIPOATIVIDADE],
          [TA].[DSPROGRAMA],
          [TA].[CODIGO_MODULO_LICENCA],
          [TA].[CD_MODULO_PRODUTO],
          COALESCE(NULLIF(TRIM([S].[NM_EXIBICAO]), ''), [MP].[NOME]) AS [NM_MODULO_PRODUTO],
          [MP].[CODIGO] AS [COD_MODULO_PRODUTO],
          CASE WHEN [UA].[SGUSUARIO] IS NOT NULL THEN 1 ELSE 0 END AS [TEM_ACESSO]
        FROM [dbo].[TIPOATIVIDADE] [TA]
        INNER JOIN [dbo].[USUARIO] [U_TARGET] ON [U_TARGET].[SGUSUARIO] = @login
        LEFT JOIN [dbo].[MODULO_PRODUTO] [MP] ON [MP].[CD_MODULO] = [TA].[CD_MODULO_PRODUTO]
        LEFT JOIN [dbo].[SAAS_MODULO] [S] ON [S].[CODIGO] = [MP].[CODIGO]
        LEFT JOIN [dbo].[USUARIOATIVIDADE] [UA]
          ON [TA].[CDTIPOATIVIDADE] = [UA].[CDTIPOATIVIDADE]
          AND [UA].[SGUSUARIO] = @login
        WHERE [TA].[FGACTIVE] = 'S'
          AND ${tipoVisTa}
        ORDER BY [TA].[DSTIPOATIVIDADE]
      `);
    } catch (qErrSaas) {
      if (!isMissingColumnError(qErrSaas)) throw qErrSaas;
      try {
        result = await reqQ.query(`
          SELECT
            [TA].[CDTIPOATIVIDADE],
            [TA].[DSTIPOATIVIDADE],
            [TA].[DSPROGRAMA],
            [TA].[CODIGO_MODULO_LICENCA],
            [TA].[CD_MODULO_PRODUTO],
            [MP].[NOME] AS [NM_MODULO_PRODUTO],
            [MP].[CODIGO] AS [COD_MODULO_PRODUTO],
            CASE WHEN [UA].[SGUSUARIO] IS NOT NULL THEN 1 ELSE 0 END AS [TEM_ACESSO]
          FROM [dbo].[TIPOATIVIDADE] [TA]
          INNER JOIN [dbo].[USUARIO] [U_TARGET] ON [U_TARGET].[SGUSUARIO] = @login
          LEFT JOIN [dbo].[MODULO_PRODUTO] [MP] ON [MP].[CD_MODULO] = [TA].[CD_MODULO_PRODUTO]
          LEFT JOIN [dbo].[USUARIOATIVIDADE] [UA]
            ON [TA].[CDTIPOATIVIDADE] = [UA].[CDTIPOATIVIDADE]
            AND [UA].[SGUSUARIO] = @login
          WHERE [TA].[FGACTIVE] = 'S'
            AND ${tipoVisTa}
          ORDER BY [TA].[DSTIPOATIVIDADE]
        `);
      } catch (qErr) {
        if (!isMissingColumnError(qErr)) throw qErr;
        try {
          result = await pool
            .request()
            .input('login', sql.VarChar(50), login)
            .input('defTenant', sql.VarChar(64), defTenantLa)
            .query(`
            SELECT
              [TA].[CDTIPOATIVIDADE],
              [TA].[DSTIPOATIVIDADE],
              [TA].[DSPROGRAMA],
              [TA].[CODIGO_MODULO_LICENCA],
              CASE WHEN [UA].[SGUSUARIO] IS NOT NULL THEN 1 ELSE 0 END AS [TEM_ACESSO]
            FROM [dbo].[TIPOATIVIDADE] [TA]
            INNER JOIN [dbo].[USUARIO] [U_TARGET] ON [U_TARGET].[SGUSUARIO] = @login
            LEFT JOIN [dbo].[USUARIOATIVIDADE] [UA]
              ON [TA].[CDTIPOATIVIDADE] = [UA].[CDTIPOATIVIDADE]
              AND [UA].[SGUSUARIO] = @login
            WHERE [TA].[FGACTIVE] = 'S'
              AND ${tipoVisTa}
            ORDER BY [TA].[DSTIPOATIVIDADE]
          `);
        } catch (qErr2) {
          if (!isMissingColumnError(qErr2)) throw qErr2;
          result = await pool
            .request()
            .input('login', sql.VarChar(50), login)
            .input('defTenant', sql.VarChar(64), defTenantLa)
            .query(`
            SELECT
              [TA].[CDTIPOATIVIDADE],
              [TA].[DSTIPOATIVIDADE],
              [TA].[DSPROGRAMA],
              CASE WHEN [UA].[SGUSUARIO] IS NOT NULL THEN 1 ELSE 0 END AS [TEM_ACESSO]
            FROM [dbo].[TIPOATIVIDADE] [TA]
            INNER JOIN [dbo].[USUARIO] [U_TARGET] ON [U_TARGET].[SGUSUARIO] = @login
            LEFT JOIN [dbo].[USUARIOATIVIDADE] [UA]
              ON [TA].[CDTIPOATIVIDADE] = [UA].[CDTIPOATIVIDADE]
              AND [UA].[SGUSUARIO] = @login
            WHERE [TA].[FGACTIVE] = 'S'
              AND ${tipoVisTa}
            ORDER BY [TA].[DSTIPOATIVIDADE]
          `);
        }
      }
    }

    let rows = result.recordset || [];
    const actorLa = getSgUser(req);
    let bypassLa = false;
    if (actorLa) {
      try {
        bypassLa = await isSaaSAdminLogin(actorLa);
      } catch (e) {
        bypassLa = false;
      }
    }
    if (!bypassLa) {
      try {
        const ent = await getEntitlementsForTenant(tenantIdForRequest(req));
        rows = filterRowsByTenantLicense(rows, ent, false);
      } catch (e) {
        /* coluna ou entitlements: mantém lista completa */
      }
    }
    res.json(rows);
  } catch (err) {
    console.error('Erro ao listar atividades do usuário:', err);
    res.status(500).json({ error: 'Erro ao carregar atividades.' });
  }
};

// Salvar atividades do usuário
const salvarAtividades = async (req, res) => {
  try {
    const { login } = req.params;
    const { atividades } = req.body; // Array de CDTIPOATIVIDADE

    if (!login) {
      return res.status(400).json({ error: 'Login do usuário é obrigatório.' });
    }

    if (!Array.isArray(atividades)) {
      return res.status(400).json({ error: 'Atividades deve ser um array.' });
    }

    const pool = await poolPromise;

    // Verificar se usuário existe
    const checkUser = await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .query('SELECT [SGUSUARIO] FROM [dbo].[USUARIO] WHERE [SGUSUARIO] = @login');

    if (checkUser.recordset.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const gate = await assertAcessoUsuario(req, login);
    if (gate.err) {
      return res.status(gate.err.status).json(gate.err.body);
    }

    const sgUser = getSgUser(req);
    if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

    const solicitadas = [...new Set(
      atividades
        .map(id => parseInt(id, 10))
        .filter(id => !isNaN(id) && id > 0)
    )];

    let atividadesValidas = solicitadas;
    const saasActor = await isSaaSAdminLogin(sgUser);
    if (!saasActor) {
      const assignable = await obterSetCdtiposDoUsuario(pool, sgUser);
      const currentTarget = await obterSetCdtiposDoUsuario(pool, login);
      const requested = new Set(solicitadas);
      const preserved = [...currentTarget].filter((cd) => !assignable.has(cd));
      const granted = [...requested].filter((cd) => assignable.has(cd));
      atividadesValidas = [...new Set([...preserved, ...granted])];
    }

    const uTidRow = await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .query('SELECT [TENANT_ID] FROM [dbo].[USUARIO] WHERE [SGUSUARIO] = @login');
    const rawUt = uTidRow.recordset?.[0]?.TENANT_ID ?? uTidRow.recordset?.[0]?.tenant_id;
    const tenantTipos =
      rawUt == null || String(rawUt).trim() === '' ? getDefaultTenantId() : String(rawUt).trim();
    const defCat = getDefaultTenantId();
    const tiposTemTenantCol = await tipoatividadeHasTenantIdColumn(pool);
    const tiposPermitidos = tiposTemTenantCol
      ? await pool
          .request()
          .input('tenantTipos', sql.VarChar(64), tenantTipos)
          .input('defCatalog', sql.VarChar(64), defCat)
          .query(
            `SELECT DISTINCT [CDTIPOATIVIDADE] FROM [dbo].[TIPOATIVIDADE]
             WHERE [TENANT_ID] = @tenantTipos OR [TENANT_ID] = @defCatalog`
          )
      : await pool
          .request()
          .query(`SELECT DISTINCT [CDTIPOATIVIDADE] FROM [dbo].[TIPOATIVIDADE]`);
    const setPerm = new Set(
      (tiposPermitidos.recordset || []).map((row) => Number(row.CDTIPOATIVIDADE ?? row.cdtipoatividade))
    );
    atividadesValidas = atividadesValidas.filter((id) => setPerm.has(id));

    // Remover todas as atividades atuais
    await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .query('DELETE FROM [dbo].[USUARIOATIVIDADE] WHERE [SGUSUARIO] = @login');

    // Inserir novas atividades (filtrar e deduplicar para evitar violação de chave única)
    for (const atividadeId of atividadesValidas) {
      await pool
        .request()
        .input('login', sql.VarChar(50), login)
        .input('atividade', sql.SmallInt, atividadeId)
        .input('sgUser', sql.VarChar(50), sgUser)
        .query(`
          INSERT INTO [dbo].[USUARIOATIVIDADE] (
            [SGUSUARIO], [CDTIPOATIVIDADE], [DHMAINTENANCE], [SGUSER], [SERVERORIG]
          )
          VALUES (
            @login, @atividade, CURRENT_TIMESTAMP, @sgUser, 'AppDVcargas'
          )
          ON CONFLICT ON CONSTRAINT "USUARIOATIVIDADE_pkey" DO NOTHING
        `);
    }

    res.json({ success: true, message: 'Atividades salvas com sucesso!' });
  } catch (err) {
    console.error('Erro ao salvar atividades:', err);
    const isDuplicateKey = err.code === '23505' || (err.message && err.message.includes('duplicar valor da chave'));
    if (isDuplicateKey) {
      return res.status(400).json({
        error: 'Atividade duplicada na lista. Remova duplicatas e tente novamente.',
        detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
    res.status(500).json({
      error: 'Erro ao salvar atividades.',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Listar empresas do usuário
const listarEmpresas = async (req, res) => {
  try {
    const { login } = req.params;

    const gate = await assertAcessoUsuario(req, login);
    if (gate.err) {
      return res.status(gate.err.status).json(gate.err.body);
    }

    const pool = await poolPromise;
    const defTenantUe = getDefaultTenantId();
    const result = await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .input('defTenant', sql.VarChar(64), defTenantUe)
      .query(`
        SELECT
          [UE].[CDEMPRESA],
          [E].[RZSOCIAL],
          [E].[NMREDUZIDO],
          [UE].[FGACTIVE]
        FROM [dbo].[USUARIOEMPRESA] [UE]
        INNER JOIN [dbo].[EMPRESA] [E] ON [UE].[CDEMPRESA] = [E].[CDEMPRESA]
        INNER JOIN [dbo].[USUARIO] [U] ON [U].[SGUSUARIO] = @login
        WHERE [UE].[SGUSUARIO] = @login
          AND [E].[TENANT_ID] = COALESCE(NULLIF(TRIM([U].[TENANT_ID]), ''), @defTenant)
        ORDER BY [E].[RZSOCIAL]
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('Erro ao listar empresas do usuário:', err);
    res.status(500).json({ error: 'Erro ao carregar empresas.' });
  }
};

// Adicionar empresa ao usuário
const adicionarEmpresa = async (req, res) => {
  try {
    const { login } = req.params;
    const { empresa } = req.body;

    if (!empresa) {
      return res.status(400).json({ error: 'Empresa é obrigatória.' });
    }

    const gate = await assertAcessoUsuario(req, login);
    if (gate.err) {
      return res.status(gate.err.status).json(gate.err.body);
    }

    const pool = await poolPromise;

    // Verificar se já existe
    const check = await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .input('empresa', sql.SmallInt, parseInt(empresa))
      .query('SELECT [SGUSUARIO] FROM [dbo].[USUARIOEMPRESA] WHERE [SGUSUARIO] = @login AND [CDEMPRESA] = @empresa');

    if (check.recordset.length > 0) {
      return res.status(400).json({ error: 'Usuário já possui acesso a esta empresa.' });
    }

    const sgUser = getSgUser(req);
    if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

    const defTenantAe = getDefaultTenantId();
    const okEmp = await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .input('empresa', sql.SmallInt, parseInt(empresa))
      .input('defTenant', sql.VarChar(64), defTenantAe)
      .query(`
        SELECT 1 AS ok
        FROM [dbo].[EMPRESA] [E]
        INNER JOIN [dbo].[USUARIO] [U] ON [U].[SGUSUARIO] = @login
        WHERE [E].[CDEMPRESA] = @empresa
          AND [E].[TENANT_ID] = COALESCE(NULLIF(TRIM([U].[TENANT_ID]), ''), @defTenant)
      `);
    if (!okEmp.recordset || okEmp.recordset.length === 0) {
      return res.status(400).json({ error: 'Empresa não encontrada ou não pertence ao tenant do usuário.' });
    }

    // Inserir
    await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .input('empresa', sql.SmallInt, parseInt(empresa))
      .input('sgUser', sql.VarChar(50), sgUser)
      .query(`
        INSERT INTO [dbo].[USUARIOEMPRESA] (
          [SGUSUARIO], [CDEMPRESA], [FGACTIVE], [DHMAINTENANCE], [SGUSER], [SERVERORIG]
        )
        VALUES (
          @login, @empresa, 'S', CURRENT_TIMESTAMP, @sgUser, 'AppDVcargas'
        )
      `);

    res.json({ success: true, message: 'Empresa adicionada com sucesso!' });
  } catch (err) {
    console.error('Erro ao adicionar empresa:', err);
    const isDuplicateKey = err.code === '23505' || (err.message && err.message.includes('duplicar valor da chave'));
    if (isDuplicateKey) {
      return res.status(400).json({ error: 'Usuário já possui acesso a esta empresa.' });
    }
    res.status(500).json({
      error: 'Erro ao adicionar empresa.',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Remover empresa do usuário
const removerEmpresa = async (req, res) => {
  try {
    const { login, empresa } = req.params;

    const gate = await assertAcessoUsuario(req, login);
    if (gate.err) {
      return res.status(gate.err.status).json(gate.err.body);
    }

    const pool = await poolPromise;

    // Remover filiais primeiro, depois a empresa
    await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .input('empresa', sql.SmallInt, parseInt(empresa))
      .query('DELETE FROM [dbo].[USUARIOFILIAL] WHERE [SGUSUARIO] = @login AND [CDEMPRESA] = @empresa');

    await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .input('empresa', sql.SmallInt, parseInt(empresa))
      .query('DELETE FROM [dbo].[USUARIOEMPRESA] WHERE [SGUSUARIO] = @login AND [CDEMPRESA] = @empresa');

    res.json({ success: true, message: 'Empresa removida com sucesso!' });
  } catch (err) {
    console.error('Erro ao remover empresa:', err);
    res.status(500).json({ error: 'Erro ao remover empresa.' });
  }
};

// Listar filiais do usuário
const listarFiliais = async (req, res) => {
  try {
    const { login } = req.params;

    const gate = await assertAcessoUsuario(req, login);
    if (gate.err) {
      return res.status(gate.err.status).json(gate.err.body);
    }

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .query(`
        SELECT
          [UF].[CDEMPRESA],
          [UF].[CDFILIAL],
          [F].[NMFANTASIA],
          [F].[SGFILIAL],
          [E].[RZSOCIAL] AS [EMPRESA_NOME],
          [UF].[FGACTIVE]
        FROM [dbo].[USUARIOFILIAL] [UF]
        INNER JOIN [dbo].[FILIAL] [F] ON [UF].[CDEMPRESA] = [F].[CDEMPRESA] AND [UF].[CDFILIAL] = [F].[CDFILIAL]
        INNER JOIN [dbo].[EMPRESA] [E] ON [UF].[CDEMPRESA] = [E].[CDEMPRESA]
        WHERE [UF].[SGUSUARIO] = @login
        ORDER BY [E].[RZSOCIAL], [F].[NMFANTASIA]
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('Erro ao listar filiais do usuário:', err);
    res.status(500).json({ error: 'Erro ao carregar filiais.' });
  }
};

// Adicionar filial ao usuário
const adicionarFilial = async (req, res) => {
  try {
    const { login } = req.params;
    const { empresa, filial } = req.body;

    if (!empresa || !filial) {
      return res.status(400).json({ error: 'Empresa e filial são obrigatórias.' });
    }

    const gate = await assertAcessoUsuario(req, login);
    if (gate.err) {
      return res.status(gate.err.status).json(gate.err.body);
    }

    const pool = await poolPromise;

    // Verificar se usuário tem acesso à empresa
    const checkEmpresa = await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .input('empresa', sql.SmallInt, parseInt(empresa))
      .query('SELECT [SGUSUARIO] FROM [dbo].[USUARIOEMPRESA] WHERE [SGUSUARIO] = @login AND [CDEMPRESA] = @empresa');

    if (checkEmpresa.recordset.length === 0) {
      return res.status(400).json({ error: 'Usuário não possui acesso a esta empresa. Adicione a empresa primeiro.' });
    }

    // Verificar se já existe
    const check = await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .input('empresa', sql.SmallInt, parseInt(empresa))
      .input('filial', sql.SmallInt, parseInt(filial))
      .query('SELECT [SGUSUARIO] FROM [dbo].[USUARIOFILIAL] WHERE [SGUSUARIO] = @login AND [CDEMPRESA] = @empresa AND [CDFILIAL] = @filial');

    if (check.recordset.length > 0) {
      return res.status(400).json({ error: 'Usuário já possui acesso a esta filial.' });
    }

    const sgUser = getSgUser(req);
    if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

    // Inserir
    await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .input('empresa', sql.SmallInt, parseInt(empresa))
      .input('filial', sql.SmallInt, parseInt(filial))
      .input('sgUser', sql.VarChar(50), sgUser)
      .query(`
        INSERT INTO [dbo].[USUARIOFILIAL] (
          [SGUSUARIO], [CDEMPRESA], [CDFILIAL], [FGACTIVE], [DHMAINTENANCE], [SGUSER], [SERVERORIG]
        )
        VALUES (
          @login, @empresa, @filial, 'S', CURRENT_TIMESTAMP, @sgUser, 'AppDVcargas'
        )
      `);

    res.json({ success: true, message: 'Filial adicionada com sucesso!' });
  } catch (err) {
    console.error('Erro ao adicionar filial:', err);
    const isDuplicateKey = err.code === '23505' || (err.message && err.message.includes('duplicar valor da chave'));
    if (isDuplicateKey) {
      return res.status(400).json({ error: 'Usuário já possui acesso a esta filial.' });
    }
    res.status(500).json({
      error: 'Erro ao adicionar filial.',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Remover filial do usuário
const removerFilial = async (req, res) => {
  try {
    const { login, empresa, filial } = req.params;

    const gate = await assertAcessoUsuario(req, login);
    if (gate.err) {
      return res.status(gate.err.status).json(gate.err.body);
    }

    const pool = await poolPromise;

    await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .input('empresa', sql.SmallInt, parseInt(empresa))
      .input('filial', sql.SmallInt, parseInt(filial))
      .query('DELETE FROM [dbo].[USUARIOFILIAL] WHERE [SGUSUARIO] = @login AND [CDEMPRESA] = @empresa AND [CDFILIAL] = @filial');

    res.json({ success: true, message: 'Filial removida com sucesso!' });
  } catch (err) {
    console.error('Erro ao remover filial:', err);
    res.status(500).json({ error: 'Erro ao remover filial.' });
  }
};

// Listar todas as atividades disponíveis
const listarTodasAtividades = async (req, res) => {
  try {
    const pool = await poolPromise;
    const tidLta = tenantIdForRequest(req);
    const defLta = getDefaultTenantId();
    const catWhere = await tipoCatalogVisibleForTenantClause(pool, 't', '@tid', '@defCatalog');
    let result;
    try {
      result = await pool
        .request()
        .input('tid', sql.VarChar(64), tidLta)
        .input('defCatalog', sql.VarChar(64), defLta)
        .query(`
        SELECT
          t.[CDTIPOATIVIDADE],
          t.[DSTIPOATIVIDADE],
          t.[DSPROGRAMA],
          t.[FGACTIVE],
          COALESCE(t.[FGGRUPO], 'OUTROS') AS [FGGRUPO],
          t.[CODIGO_MODULO_LICENCA],
          t.[CD_MODULO_PRODUTO],
          COALESCE(NULLIF(TRIM(s.[NM_EXIBICAO]), ''), m.[NOME]) AS [NM_MODULO_PRODUTO],
          m.[CODIGO] AS [COD_MODULO_PRODUTO]
        FROM [dbo].[TIPOATIVIDADE] t
        LEFT JOIN [dbo].[MODULO_PRODUTO] m ON m.[CD_MODULO] = t.[CD_MODULO_PRODUTO]
        LEFT JOIN [dbo].[SAAS_MODULO] s ON s.[CODIGO] = m.[CODIGO]
        WHERE t.[FGACTIVE] = 'S' AND ${catWhere}
        ORDER BY COALESCE(t.[FGGRUPO], 'OUTROS'), t.[DSTIPOATIVIDADE]
      `);
    } catch (qErrSaas) {
      if (!isMissingColumnError(qErrSaas)) throw qErrSaas;
      try {
        result = await pool
          .request()
          .input('tid', sql.VarChar(64), tidLta)
          .input('defCatalog', sql.VarChar(64), defLta)
          .query(`
          SELECT
            t.[CDTIPOATIVIDADE],
            t.[DSTIPOATIVIDADE],
            t.[DSPROGRAMA],
            t.[FGACTIVE],
            COALESCE(t.[FGGRUPO], 'OUTROS') AS [FGGRUPO],
            t.[CODIGO_MODULO_LICENCA],
            t.[CD_MODULO_PRODUTO],
            m.[NOME] AS [NM_MODULO_PRODUTO],
            m.[CODIGO] AS [COD_MODULO_PRODUTO]
          FROM [dbo].[TIPOATIVIDADE] t
          LEFT JOIN [dbo].[MODULO_PRODUTO] m ON m.[CD_MODULO] = t.[CD_MODULO_PRODUTO]
          WHERE t.[FGACTIVE] = 'S' AND ${catWhere}
          ORDER BY COALESCE(t.[FGGRUPO], 'OUTROS'), t.[DSTIPOATIVIDADE]
        `);
      } catch (qErr) {
        if (!isMissingColumnError(qErr)) throw qErr;
        try {
          result = await pool
            .request()
            .input('tid', sql.VarChar(64), tidLta)
            .input('defCatalog', sql.VarChar(64), defLta)
            .query(`
            SELECT
              [CDTIPOATIVIDADE],
              [DSTIPOATIVIDADE],
              [DSPROGRAMA],
              [FGACTIVE],
              COALESCE([FGGRUPO], 'OUTROS') AS [FGGRUPO],
              [CODIGO_MODULO_LICENCA]
            FROM [dbo].[TIPOATIVIDADE] t
            WHERE t.[FGACTIVE] = 'S' AND ${catWhere}
            ORDER BY COALESCE(t.[FGGRUPO], 'OUTROS'), t.[DSTIPOATIVIDADE]
          `);
        } catch (qErr2) {
          if (!isMissingColumnError(qErr2)) throw qErr2;
          result = await pool
            .request()
            .input('tid', sql.VarChar(64), tidLta)
            .input('defCatalog', sql.VarChar(64), defLta)
            .query(`
            SELECT
              t.[CDTIPOATIVIDADE],
              t.[DSTIPOATIVIDADE],
              t.[DSPROGRAMA],
              t.[FGACTIVE],
              COALESCE(t.[FGGRUPO], 'OUTROS') AS [FGGRUPO]
            FROM [dbo].[TIPOATIVIDADE] t
            WHERE t.[FGACTIVE] = 'S' AND ${catWhere}
            ORDER BY COALESCE(t.[FGGRUPO], 'OUTROS'), t.[DSTIPOATIVIDADE]
          `);
        }
      }
    }

    let rows = (result.recordset || []).map((row) => enrichTipoAtividadeRow(row));
    const actorLta = getSgUser(req);
    let bypassLta = false;
    if (actorLta) {
      try {
        bypassLta = await isSaaSAdminLogin(actorLta);
      } catch (e) {
        bypassLta = false;
      }
    }
    if (!bypassLta) {
      try {
        const ent = await getEntitlementsForTenant(tenantIdForRequest(req));
        rows = filterRowsByTenantLicense(rows, ent, false);
      } catch (e) {
        /* mantém lista */
      }
    }
    res.json(rows);
  } catch (err) {
    console.error('Erro ao listar atividades:', err);
    res.status(500).json({ error: 'Erro ao carregar atividades.' });
  }
};

// Executar init.sql
const executarInitSQL = async (req, res) => {
  try {
    const { sql } = req.body;

    if (!sql || typeof sql !== 'string') {
      return res.status(400).json({ error: 'SQL é obrigatório.' });
    }

    const sqlUpper = sql.trim().toUpperCase();
    const comandosBloqueados = [
      'DROP DATABASE', 'DROP TABLE', 'TRUNCATE TABLE', 
      'ALTER DATABASE', 'CREATE DATABASE', 'BACKUP DATABASE',
      'RESTORE DATABASE', 'SHUTDOWN', 'KILL'
    ];

    for (const cmd of comandosBloqueados) {
      if (sqlUpper.includes(cmd)) {
        return res.status(400).json({ error: `Comando não permitido: ${cmd}.` });
      }
    }

    const pool = await poolPromise;
    const comandos = sql.split(/\bGO\b/gi).filter(cmd => cmd.trim().length > 0);
    const resultados = [];

    for (const comando of comandos) {
      const cmdLimpo = comando.trim();
      if (!cmdLimpo) continue;

      try {
        const request = pool.request();
        request.timeout = 120000;
        const result = await request.query(cmdLimpo);

        if (result.recordset && result.recordset.length > 0) {
          const rows = result.recordset.map(row => {
            const obj = {};
            for (const key in row) {
              obj[key] = row[key];
            }
            return obj;
          });
          resultados.push({ tipo: 'SELECT', rows: rows, rowCount: rows.length });
        } else {
          resultados.push({ tipo: 'EXEC', message: 'Comando executado com sucesso.', rowsAffected: result.rowsAffected || [0] });
        }
      } catch (cmdErr) {
        let mensagemErro = cmdErr.message;
        if (mensagemErro.includes('timeout') || mensagemErro.includes('Timeout')) {
          mensagemErro = `Timeout: Comando demorou mais de 2 minutos para executar.`;
        }
        resultados.push({
          tipo: 'ERRO',
          error: mensagemErro,
          comando: cmdLimpo.substring(0, 200),
          detalhes: { nome: cmdErr.name, codigo: cmdErr.code, numero: cmdErr.number }
        });
      }
    }

    res.json({ success: true, resultados: resultados, totalComandos: comandos.length });
  } catch (err) {
    console.error('Erro ao executar init SQL:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Erro ao executar SQL de inicialização.' });
    }
  }
};

module.exports = {
  contexto,
  listar,
  buscarPorLogin,
  criar,
  atualizar,
  alterarStatus,
  listarAtividades,
  salvarAtividades,
  listarEmpresas,
  adicionarEmpresa,
  removerEmpresa,
  listarFiliais,
  adicionarFilial,
  removerFilial,
  listarTodasAtividades,
  executarInitSQL
};

