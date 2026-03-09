// backend/controllers/tipoatividade.controller.js
// Controller para Gerenciar Tipos de Atividade
// Versão: 1.0
// Atlas Cargo

const sql = require('../config/mssql-compat');
const { poolPromise } = require('../config/db');
const { getSgUser } = require('../utils/audit');

// Listar tipos de atividade com filtros
const listar = async (req, res) => {
  try {
    const { codigo, descricao, situacao } = req.query;

    let query = `
      SELECT 
        [CDTIPOATIVIDADE],
        [DSTIPOATIVIDADE],
        [DSPROGRAMA],
        [FGACTIVE],
        ISNULL([FGGRUPO], 'OUTROS') AS FGGRUPO,
        [DHMAINTENANCE],
        [SGUSER],
        [SERVERORIG]
      FROM [dbo].[TIPOATIVIDADE]
      WHERE 1=1
    `;

    const pool = await poolPromise;
    const request = pool.request();

    if (codigo) {
      query += ` AND [CDTIPOATIVIDADE] = @codigo`;
      request.input('codigo', sql.SmallInt, parseInt(codigo));
    }

    if (descricao) {
      query += ` AND [DSTIPOATIVIDADE] LIKE @descricao`;
      request.input('descricao', sql.VarChar(40), `%${descricao}%`);
    }

    if (situacao) {
      query += ` AND [FGACTIVE] = @situacao`;
      request.input('situacao', sql.Char(1), situacao);
    }

    query += ` ORDER BY [CDTIPOATIVIDADE]`;

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error('Erro ao listar tipos de atividade:', err);
    res.status(500).json({ 
      error: 'Erro ao carregar tipos de atividade.',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Buscar tipo de atividade por código
const buscarPorCodigo = async (req, res) => {
  try {
    const { codigo } = req.params;
    const pool = await poolPromise;
    
    const result = await pool
      .request()
      .input('codigo', sql.SmallInt, parseInt(codigo))
      .query('SELECT * FROM [dbo].[TIPOATIVIDADE] WHERE [CDTIPOATIVIDADE] = @codigo');

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Tipo de atividade não encontrado.' });
    }

    res.json(result.recordset[0]);
  } catch (err) {
    console.error('Erro ao buscar tipo de atividade:', err);
    res.status(500).json({ error: 'Erro ao buscar tipo de atividade.' });
  }
};

// Criar tipo de atividade
const criar = async (req, res) => {
  try {
    const { CDTIPOATIVIDADE, DSTIPOATIVIDADE, DSPROGRAMA, FGACTIVE, FGGRUPO } = req.body;

    if (!CDTIPOATIVIDADE || !DSTIPOATIVIDADE) {
      return res.status(400).json({ error: 'Código e descrição são obrigatórios.' });
    }

    const sgUser = getSgUser(req);
    if (!sgUser) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

    const pool = await poolPromise;

    // Verificar se código já existe
    const checkCodigo = await pool
      .request()
      .input('codigo', sql.SmallInt, parseInt(CDTIPOATIVIDADE))
      .query('SELECT [CDTIPOATIVIDADE] FROM [dbo].[TIPOATIVIDADE] WHERE [CDTIPOATIVIDADE] = @codigo');

    if (checkCodigo.recordset.length > 0) {
      return res.status(400).json({ error: 'Código já existe.' });
    }

    await pool
      .request()
      .input('codigo', sql.SmallInt, parseInt(CDTIPOATIVIDADE))
      .input('descricao', sql.VarChar(40), DSTIPOATIVIDADE)
      .input('programa', sql.NVarChar(200), DSPROGRAMA || null)
      .input('situacao', sql.Char(1), FGACTIVE || 'S')
      .input('grupo', sql.VarChar(50), FGGRUPO || null)
      .input('sgUser', sql.VarChar(50), sgUser)
      .query(`
        INSERT INTO [dbo].[TIPOATIVIDADE] (
          [CDTIPOATIVIDADE], [DSTIPOATIVIDADE], [DSPROGRAMA], [FGACTIVE], [FGGRUPO],
          [DHMAINTENANCE], [SGUSER], [SERVERORIG]
        )
        VALUES (
          @codigo, @descricao, @programa, @situacao, @grupo,
          GETDATE(), @sgUser, 'AppDVcargas'
        )
      `);

    res.status(201).json({ success: true, message: 'Tipo de atividade cadastrado com sucesso!' });
  } catch (err) {
    console.error('Erro ao criar tipo de atividade:', err);
    res.status(500).json({ error: 'Erro ao cadastrar tipo de atividade.' });
  }
};

// Atualizar tipo de atividade
const atualizar = async (req, res) => {
  try {
    const { codigo } = req.params;
    const { CDTIPOATIVIDADE, DSTIPOATIVIDADE, DSPROGRAMA, FGACTIVE, FGGRUPO } = req.body;

    if (!DSTIPOATIVIDADE) {
      return res.status(400).json({ error: 'Descrição é obrigatória.' });
    }

    const sgUserUpd = getSgUser(req);
    if (!sgUserUpd) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

    const pool = await poolPromise;

    // Verificar se existe
    const checkExist = await pool
      .request()
      .input('codigo', sql.SmallInt, parseInt(codigo))
      .query('SELECT [CDTIPOATIVIDADE] FROM [dbo].[TIPOATIVIDADE] WHERE [CDTIPOATIVIDADE] = @codigo');

    if (checkExist.recordset.length === 0) {
      return res.status(404).json({ error: 'Tipo de atividade não encontrado.' });
    }

    await pool
      .request()
      .input('codigo', sql.SmallInt, parseInt(codigo))
      .input('descricao', sql.VarChar(40), DSTIPOATIVIDADE)
      .input('programa', sql.NVarChar(200), DSPROGRAMA || null)
      .input('situacao', sql.Char(1), FGACTIVE || 'S')
      .input('grupo', sql.VarChar(50), FGGRUPO || null)
      .input('sgUser', sql.VarChar(50), sgUserUpd)
      .query(`
        UPDATE [dbo].[TIPOATIVIDADE]
        SET 
          [DSTIPOATIVIDADE] = @descricao,
          [DSPROGRAMA] = @programa,
          [FGACTIVE] = @situacao,
          [FGGRUPO] = @grupo,
          [DHMAINTENANCE] = GETDATE(),
          [SGUSER] = @sgUser,
          [SERVERORIG] = 'AppDVcargas'
        WHERE [CDTIPOATIVIDADE] = @codigo
      `);

    res.json({ success: true, message: 'Tipo de atividade atualizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar tipo de atividade:', err);
    res.status(500).json({ error: 'Erro ao atualizar tipo de atividade.' });
  }
};

// Excluir/Alterar status tipo de atividade
const alterarStatus = async (req, res) => {
  try {
    const { codigo } = req.params;

    const sgUserStatus = getSgUser(req);
    if (!sgUserStatus) return res.status(401).json({ error: 'Não autorizado. Faça login.' });

    const pool = await poolPromise;

    // Verificar se existe
    const checkExist = await pool
      .request()
      .input('codigo', sql.SmallInt, parseInt(codigo))
      .query('SELECT [FGACTIVE] FROM [dbo].[TIPOATIVIDADE] WHERE [CDTIPOATIVIDADE] = @codigo');

    if (checkExist.recordset.length === 0) {
      return res.status(404).json({ error: 'Tipo de atividade não encontrado.' });
    }

    const estaAtivo = checkExist.recordset[0].FGACTIVE === 'S';
    const novaSituacao = estaAtivo ? 'N' : 'S';
    const mensagem = estaAtivo ? 'Tipo de atividade desativado com sucesso!' : 'Tipo de atividade ativado com sucesso!';

    await pool
      .request()
      .input('codigo', sql.SmallInt, parseInt(codigo))
      .input('situacao', sql.Char(1), novaSituacao)
      .input('sgUser', sql.VarChar(50), sgUserStatus)
      .query(`
        UPDATE [dbo].[TIPOATIVIDADE]
        SET 
          [FGACTIVE] = @situacao,
          [DHMAINTENANCE] = GETDATE(),
          [SGUSER] = @sgUser,
          [SERVERORIG] = 'AppDVcargas'
        WHERE [CDTIPOATIVIDADE] = @codigo
      `);

    res.json({ success: true, message: mensagem, newStatus: novaSituacao });
  } catch (err) {
    console.error('Erro ao alterar status do tipo de atividade:', err);
    res.status(500).json({ error: 'Erro ao alterar status do tipo de atividade.' });
  }
};

// Executar init.sql
const executarInitSQL = async (req, res) => {
  try {
    const { sql: sqlContent } = req.body;

    if (!sqlContent || typeof sqlContent !== 'string') {
      return res.status(400).json({ error: 'SQL é obrigatório.' });
    }

    const sqlUpper = sqlContent.trim().toUpperCase();
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
    const comandos = sqlContent.split(/\bGO\b/gi).filter(cmd => cmd.trim().length > 0);
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
  buscarPorCodigo,
  criar,
  atualizar,
  alterarStatus,
  executarInitSQL
};

