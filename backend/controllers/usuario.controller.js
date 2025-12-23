// backend/controllers/usuario.controller.js
const sql = require('mssql');
const bcrypt = require('bcrypt');
const { poolPromise } = require('../config/db');

// Listar usuários com filtros
const listar = async (req, res) => {
  try {
    const { login, nome, email, cadastro, situacao, empresa } = req.query;

    let query = `
      SELECT 
        U.SGUSUARIO,
        U.NMUSUARIO,
        U.ENDEMAIL,
        U.CDCADASTRO,
        U.SENHA,
        U.FGACTIVE,
        U.DHMAINTENANCE,
        U.SGUSER,
        U.SERVERORIG,
        CG.RZSOCIAL AS CADASTRO_NOME,
        CG.NMFANTASIA AS CADASTRO_FANTASIA,
        CG.CGCCPF AS CADASTRO_CGCCPF
      FROM [dbo].[USUARIO] U
      LEFT JOIN [dbo].[CADASTROGERAL] CG ON U.CDCADASTRO = CG.CDCADASTRO
      WHERE 1=1
    `;

    const pool = await poolPromise;
    const request = pool.request();

    if (login) {
      query += ` AND U.SGUSUARIO LIKE @login`;
      request.input('login', sql.VarChar(50), `%${login}%`);
    }

    if (nome) {
      query += ` AND U.NMUSUARIO LIKE @nome`;
      request.input('nome', sql.VarChar(40), `%${nome}%`);
    }

    if (email) {
      query += ` AND U.ENDEMAIL LIKE @email`;
      request.input('email', sql.VarChar(200), `%${email}%`);
    }

    if (cadastro) {
      query += ` AND U.CDCADASTRO = @cadastro`;
      request.input('cadastro', sql.Decimal(15, 0), parseInt(cadastro));
    }

    if (situacao) {
      query += ` AND U.FGACTIVE = @situacao`;
      request.input('situacao', sql.Char(1), situacao);
    }

    if (empresa) {
      query += ` AND EXISTS (
        SELECT 1 FROM [dbo].[USUARIOEMPRESA] UE 
        WHERE UE.SGUSUARIO = U.SGUSUARIO 
        AND UE.CDEMPRESA = @empresa
        AND UE.FGACTIVE = 'S'
      )`;
      request.input('empresa', sql.SmallInt, parseInt(empresa));
    }

    query += ` ORDER BY U.NMUSUARIO`;

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
          U.SGUSUARIO,
          U.NMUSUARIO,
          U.ENDEMAIL,
          U.CDCADASTRO,
          U.FGACTIVE,
          U.DHMAINTENANCE,
          CG.RZSOCIAL AS CADASTRO_NOME,
          CG.NMFANTASIA AS CADASTRO_FANTASIA
        FROM [dbo].[USUARIO] U
        LEFT JOIN [dbo].[CADASTROGERAL] CG ON U.CDCADASTRO = CG.CDCADASTRO
        WHERE U.SGUSUARIO = @login
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    const usuario = result.recordset[0];
    res.json({
      SGUSUARIO: usuario.SGUSUARIO,
      NMUSUARIO: usuario.NMUSUARIO,
      ENDEMAIL: usuario.ENDEMAIL,
      CDCADASTRO: usuario.CDCADASTRO,
      FGACTIVE: usuario.FGACTIVE,
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
    const { SGUSUARIO, NMUSUARIO, ENDEMAIL, SENHA, CDCADASTRO, FGACTIVE } = req.body;

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

    // Verificar se login já existe
    const checkLogin = await pool
      .request()
      .input('login', sql.VarChar(50), SGUSUARIO)
      .query('SELECT SGUSUARIO FROM [dbo].[USUARIO] WHERE SGUSUARIO = @login');

    if (checkLogin.recordset.length > 0) {
      return res.status(400).json({ error: 'Login já existe. Escolha outro.' });
    }

    // Verificar se e-mail já existe
    const checkEmail = await pool
      .request()
      .input('email', sql.VarChar(200), ENDEMAIL)
      .query('SELECT SGUSUARIO FROM [dbo].[USUARIO] WHERE ENDEMAIL = @email');

    if (checkEmail.recordset.length > 0) {
      return res.status(400).json({ error: 'E-mail já cadastrado para outro usuário.' });
    }

    // Verificar se CDCADASTRO existe (se fornecido)
    if (CDCADASTRO) {
      const checkCadastro = await pool
        .request()
        .input('cadastro', sql.Decimal(15, 0), parseInt(CDCADASTRO))
        .query('SELECT CDCADASTRO FROM [dbo].[CADASTROGERAL] WHERE CDCADASTRO = @cadastro');

      if (checkCadastro.recordset.length === 0) {
        return res.status(400).json({ error: 'Cadastro geral não encontrado.' });
      }
    }

    // Inserir usuário (manter senha como está - não forçar hash para compatibilidade)
    await pool
      .request()
      .input('SGUSUARIO', sql.VarChar(50), SGUSUARIO)
      .input('NMUSUARIO', sql.VarChar(40), NMUSUARIO)
      .input('ENDEMAIL', sql.VarChar(200), ENDEMAIL)
      .input('SENHA', sql.VarChar(100), SENHA)
      .input('CDCADASTRO', sql.Decimal(15, 0), CDCADASTRO || null)
      .input('FGACTIVE', sql.Char(1), FGACTIVE || 'S')
      .query(`
        INSERT INTO [dbo].[USUARIO] (
          SGUSUARIO, NMUSUARIO, ENDEMAIL, SENHA, CDCADASTRO, 
          FGACTIVE, DHMAINTENANCE, SGUSER, SERVERORIG
        )
        VALUES (
          @SGUSUARIO, @NMUSUARIO, @ENDEMAIL, @SENHA, @CDCADASTRO,
          @FGACTIVE, GETDATE(), 'SYSTEM', 'AppDVcargas'
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
    const { NMUSUARIO, ENDEMAIL, SENHA, CDCADASTRO, FGACTIVE } = req.body;

    if (!NMUSUARIO || !ENDEMAIL) {
      return res.status(400).json({ error: 'Nome e e-mail são obrigatórios.' });
    }

    // Validar e-mail
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(ENDEMAIL)) {
      return res.status(400).json({ error: 'E-mail inválido.' });
    }

    const pool = await poolPromise;

    // Verificar se usuário existe
    const checkUser = await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .query('SELECT SGUSUARIO FROM [dbo].[USUARIO] WHERE SGUSUARIO = @login');

    if (checkUser.recordset.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    // Verificar se e-mail já existe em outro usuário
    const checkEmail = await pool
      .request()
      .input('email', sql.VarChar(200), ENDEMAIL)
      .input('login', sql.VarChar(50), login)
      .query('SELECT SGUSUARIO FROM [dbo].[USUARIO] WHERE ENDEMAIL = @email AND SGUSUARIO <> @login');

    if (checkEmail.recordset.length > 0) {
      return res.status(400).json({ error: 'E-mail já cadastrado para outro usuário.' });
    }

    // Verificar se CDCADASTRO existe (se fornecido)
    if (CDCADASTRO) {
      const checkCadastro = await pool
        .request()
        .input('cadastro', sql.Decimal(15, 0), parseInt(CDCADASTRO))
        .query('SELECT CDCADASTRO FROM [dbo].[CADASTROGERAL] WHERE CDCADASTRO = @cadastro');

      if (checkCadastro.recordset.length === 0) {
        return res.status(400).json({ error: 'Cadastro geral não encontrado.' });
      }
    }

    // Montar query de atualização
    let updateQuery = `
      UPDATE [dbo].[USUARIO]
      SET 
        NMUSUARIO = @NMUSUARIO,
        ENDEMAIL = @ENDEMAIL,
        CDCADASTRO = @CDCADASTRO,
        FGACTIVE = @FGACTIVE,
        DHMAINTENANCE = GETDATE(),
        SGUSER = 'SYSTEM',
        SERVERORIG = 'AppDVcargas'
    `;

    const request = pool.request()
      .input('login', sql.VarChar(50), login)
      .input('NMUSUARIO', sql.VarChar(40), NMUSUARIO)
      .input('ENDEMAIL', sql.VarChar(200), ENDEMAIL)
      .input('CDCADASTRO', sql.Decimal(15, 0), CDCADASTRO || null)
      .input('FGACTIVE', sql.Char(1), FGACTIVE || 'S');

    // Se senha foi fornecida, atualizar (manter formato original - não forçar hash)
    if (SENHA) {
      updateQuery += `, SENHA = @SENHA`;
      request.input('SENHA', sql.VarChar(100), SENHA);
    }

    updateQuery += ` WHERE SGUSUARIO = @login`;

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

    const pool = await poolPromise;

    // Verificar status atual
    const checkResult = await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .query('SELECT FGACTIVE FROM [dbo].[USUARIO] WHERE SGUSUARIO = @login');

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
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
      .query(`
        UPDATE [dbo].[USUARIO]
        SET 
          FGACTIVE = @FGACTIVE,
          DHMAINTENANCE = GETDATE(),
          SGUSER = 'SYSTEM',
          SERVERORIG = 'AppDVcargas'
        WHERE SGUSUARIO = @login
      `);

    res.json({ success: true, message: mensagem, newStatus: novaSituacao });
  } catch (err) {
    console.error('Erro ao alterar status do usuário:', err);
    res.status(500).json({ error: 'Erro ao alterar status do usuário.' });
  }
};

// Listar atividades do usuário
const listarAtividades = async (req, res) => {
  try {
    const { login } = req.params;

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .query(`
        SELECT 
          TA.CDTIPOATIVIDADE,
          TA.DSTIPOATIVIDADE,
          TA.DSPROGRAMA,
          CASE WHEN UA.SGUSUARIO IS NOT NULL THEN 1 ELSE 0 END AS TEM_ACESSO
        FROM [dbo].[TIPOATIVIDADE] TA
        LEFT JOIN [dbo].[USUARIOATIVIDADE] UA 
          ON TA.CDTIPOATIVIDADE = UA.CDTIPOATIVIDADE 
          AND UA.SGUSUARIO = @login
        WHERE TA.FGACTIVE = 'S'
        ORDER BY TA.DSTIPOATIVIDADE
      `);

    res.json(result.recordset);
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
      .query('SELECT SGUSUARIO FROM [dbo].[USUARIO] WHERE SGUSUARIO = @login');

    if (checkUser.recordset.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    // Iniciar transação
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // Remover todas as atividades atuais
      const deleteRequest = new sql.Request(transaction);
      await deleteRequest
        .input('login', sql.VarChar(50), login)
        .query('DELETE FROM [dbo].[USUARIOATIVIDADE] WHERE SGUSUARIO = @login');

      // Inserir novas atividades (filtrar valores válidos)
      const atividadesValidas = atividades
        .map(id => parseInt(id))
        .filter(id => !isNaN(id) && id > 0);

      for (const atividadeId of atividadesValidas) {
        // Criar um novo request para cada inserção para evitar conflito de parâmetros
        const insertRequest = new sql.Request(transaction);
        await insertRequest
          .input('login', sql.VarChar(50), login)
          .input('atividade', sql.SmallInt, atividadeId)
          .query(`
            INSERT INTO [dbo].[USUARIOATIVIDADE] (
              SGUSUARIO, CDTIPOATIVIDADE, DHMAINTENANCE, SGUSER, SERVERORIG
            )
            VALUES (
              @login, @atividade, GETDATE(), 'SYSTEM', 'AppDVcargas'
            )
          `);
      }

      await transaction.commit();
      res.json({ success: true, message: 'Atividades salvas com sucesso!' });
    } catch (err) {
      await transaction.rollback();
      console.error('Erro na transação ao salvar atividades:', err);
      throw err;
    }
  } catch (err) {
    console.error('Erro ao salvar atividades:', err);
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

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .query(`
        SELECT 
          UE.CDEMPRESA,
          E.RZSOCIAL,
          E.NMREDUZIDO,
          UE.FGACTIVE
        FROM [dbo].[USUARIOEMPRESA] UE
        INNER JOIN [dbo].[EMPRESA] E ON UE.CDEMPRESA = E.CDEMPRESA
        WHERE UE.SGUSUARIO = @login
        ORDER BY E.RZSOCIAL
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

    const pool = await poolPromise;

    // Verificar se já existe
    const check = await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .input('empresa', sql.SmallInt, parseInt(empresa))
      .query('SELECT SGUSUARIO FROM [dbo].[USUARIOEMPRESA] WHERE SGUSUARIO = @login AND CDEMPRESA = @empresa');

    if (check.recordset.length > 0) {
      return res.status(400).json({ error: 'Usuário já possui acesso a esta empresa.' });
    }

    // Inserir
    await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .input('empresa', sql.SmallInt, parseInt(empresa))
      .query(`
        INSERT INTO [dbo].[USUARIOEMPRESA] (
          SGUSUARIO, CDEMPRESA, FGACTIVE, DHMAINTENANCE, SGUSER, SERVERORIG
        )
        VALUES (
          @login, @empresa, 'S', GETDATE(), 'SYSTEM', 'AppDVcargas'
        )
      `);

    res.json({ success: true, message: 'Empresa adicionada com sucesso!' });
  } catch (err) {
    console.error('Erro ao adicionar empresa:', err);
    res.status(500).json({ error: 'Erro ao adicionar empresa.' });
  }
};

// Remover empresa do usuário
const removerEmpresa = async (req, res) => {
  try {
    const { login, empresa } = req.params;

    const pool = await poolPromise;

    // Remover empresa e todas as filiais relacionadas
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const request = new sql.Request(transaction);

      // Remover filiais primeiro
      await request
        .input('login', sql.VarChar(50), login)
        .input('empresa', sql.SmallInt, parseInt(empresa))
        .query('DELETE FROM [dbo].[USUARIOFILIAL] WHERE SGUSUARIO = @login AND CDEMPRESA = @empresa');

      // Remover empresa
      await request
        .input('login', sql.VarChar(50), login)
        .input('empresa', sql.SmallInt, parseInt(empresa))
        .query('DELETE FROM [dbo].[USUARIOEMPRESA] WHERE SGUSUARIO = @login AND CDEMPRESA = @empresa');

      await transaction.commit();
      res.json({ success: true, message: 'Empresa removida com sucesso!' });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    console.error('Erro ao remover empresa:', err);
    res.status(500).json({ error: 'Erro ao remover empresa.' });
  }
};

// Listar filiais do usuário
const listarFiliais = async (req, res) => {
  try {
    const { login } = req.params;

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .query(`
        SELECT 
          UF.CDEMPRESA,
          UF.CDFILIAL,
          F.NMFANTASIA,
          F.SGFILIAL,
          E.RZSOCIAL AS EMPRESA_NOME,
          UF.FGACTIVE
        FROM [dbo].[USUARIOFILIAL] UF
        INNER JOIN [dbo].[FILIAL] F ON UF.CDEMPRESA = F.CDEMPRESA AND UF.CDFILIAL = F.CDFILIAL
        INNER JOIN [dbo].[EMPRESA] E ON UF.CDEMPRESA = E.CDEMPRESA
        WHERE UF.SGUSUARIO = @login
        ORDER BY E.RZSOCIAL, F.NMFANTASIA
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

    const pool = await poolPromise;

    // Verificar se usuário tem acesso à empresa
    const checkEmpresa = await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .input('empresa', sql.SmallInt, parseInt(empresa))
      .query('SELECT SGUSUARIO FROM [dbo].[USUARIOEMPRESA] WHERE SGUSUARIO = @login AND CDEMPRESA = @empresa');

    if (checkEmpresa.recordset.length === 0) {
      return res.status(400).json({ error: 'Usuário não possui acesso a esta empresa. Adicione a empresa primeiro.' });
    }

    // Verificar se já existe
    const check = await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .input('empresa', sql.SmallInt, parseInt(empresa))
      .input('filial', sql.SmallInt, parseInt(filial))
      .query('SELECT SGUSUARIO FROM [dbo].[USUARIOFILIAL] WHERE SGUSUARIO = @login AND CDEMPRESA = @empresa AND CDFILIAL = @filial');

    if (check.recordset.length > 0) {
      return res.status(400).json({ error: 'Usuário já possui acesso a esta filial.' });
    }

    // Inserir
    await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .input('empresa', sql.SmallInt, parseInt(empresa))
      .input('filial', sql.SmallInt, parseInt(filial))
      .query(`
        INSERT INTO [dbo].[USUARIOFILIAL] (
          SGUSUARIO, CDEMPRESA, CDFILIAL, FGACTIVE, DHMAINTENANCE, SGUSER, SERVERORIG
        )
        VALUES (
          @login, @empresa, @filial, 'S', GETDATE(), 'SYSTEM', 'AppDVcargas'
        )
      `);

    res.json({ success: true, message: 'Filial adicionada com sucesso!' });
  } catch (err) {
    console.error('Erro ao adicionar filial:', err);
    res.status(500).json({ error: 'Erro ao adicionar filial.' });
  }
};

// Remover filial do usuário
const removerFilial = async (req, res) => {
  try {
    const { login, empresa, filial } = req.params;

    const pool = await poolPromise;

    await pool
      .request()
      .input('login', sql.VarChar(50), login)
      .input('empresa', sql.SmallInt, parseInt(empresa))
      .input('filial', sql.SmallInt, parseInt(filial))
      .query('DELETE FROM [dbo].[USUARIOFILIAL] WHERE SGUSUARIO = @login AND CDEMPRESA = @empresa AND CDFILIAL = @filial');

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
    const result = await pool
      .request()
      .query(`
        SELECT 
          CDTIPOATIVIDADE,
          DSTIPOATIVIDADE,
          DSPROGRAMA,
          FGACTIVE,
          ISNULL(FGGRUPO, 'OUTROS') AS FGGRUPO
        FROM [dbo].[TIPOATIVIDADE]
        WHERE FGACTIVE = 'S'
        ORDER BY ISNULL(FGGRUPO, 'OUTROS'), DSTIPOATIVIDADE
      `);

    res.json(result.recordset);
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

