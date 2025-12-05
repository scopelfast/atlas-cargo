// backend/controllers/tipovalidade.controller.js
// Controller para Gerenciar Tipos de Validade
// Versão: 1.0

const sql = require('mssql');
const { poolPromise } = require('../config/db');

// Listar tipos de validade com filtros
const listar = async (req, res) => {
  try {
    const { codigo, descricao, tipoCadastro } = req.query;

    let query = `
      SELECT 
        CDTIPOVALIDADE,
        DSTIPOVALIDADE,
        FGVEICULO,
        FGMOTORISTA,
        FGTRANSPORTADOR,
        FGCLIENTE,
        FGFORNECEDOR,
        FGEXIGECERTIFICADORA,
        DHMAINTENANCE,
        SGUSER,
        SERVERORIG
      FROM [dbo].[TIPOVALIDADE]
      WHERE 1=1
    `;

    const pool = await poolPromise;
    const request = pool.request();

    if (codigo) {
      query += ` AND CDTIPOVALIDADE = @codigo`;
      request.input('codigo', sql.SmallInt, parseInt(codigo));
    }

    if (descricao) {
      query += ` AND DSTIPOVALIDADE LIKE @descricao`;
      request.input('descricao', sql.VarChar(40), `%${descricao}%`);
    }

    if (tipoCadastro) {
      if (tipoCadastro === 'MOT') query += ` AND FGMOTORISTA = 'S'`;
      if (tipoCadastro === 'CLI') query += ` AND FGCLIENTE = 'S'`;
      if (tipoCadastro === 'EQP') query += ` AND FGVEICULO = 'S'`;
      if (tipoCadastro === 'TRA') query += ` AND FGTRANSPORTADOR = 'S'`;
    }

    query += ` ORDER BY CDTIPOVALIDADE`;

    const result = await request.query(query);
    res.json(result.recordset);
  } catch (err) {
    console.error('Erro ao listar tipos de validade:', err);
    res.status(500).json({ 
      error: 'Erro ao carregar tipos de validade.',
      detalhes: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// Buscar tipo de validade por código
const buscarPorId = async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;
    
    const result = await pool
      .request()
      .input('codigo', sql.SmallInt, parseInt(id))
      .query('SELECT * FROM [dbo].[TIPOVALIDADE] WHERE CDTIPOVALIDADE = @codigo');

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Tipo de validade não encontrado.' });
    }

    res.json(result.recordset[0]);
  } catch (err) {
    console.error('Erro ao buscar tipo de validade:', err);
    res.status(500).json({ error: 'Erro ao buscar tipo de validade.' });
  }
};

// Criar tipo de validade
const criar = async (req, res) => {
  try {
    const { DSTIPOVALIDADE, FGVEICULO, FGMOTORISTA, FGTRANSPORTADOR, FGCLIENTE, FGFORNECEDOR, FGEXIGECERTIFICADORA } = req.body;

    if (!DSTIPOVALIDADE) {
      return res.status(400).json({ error: 'Descrição é obrigatória.' });
    }

    const pool = await poolPromise;

    // Gerar próximo código
    const maxCodigo = await pool
      .request()
      .query('SELECT ISNULL(MAX(CDTIPOVALIDADE), 0) + 1 AS NOVOCODIGO FROM [dbo].[TIPOVALIDADE]');
    
    const novoCodigo = maxCodigo.recordset[0].NOVOCODIGO;

    await pool
      .request()
      .input('codigo', sql.SmallInt, novoCodigo)
      .input('descricao', sql.VarChar(40), DSTIPOVALIDADE)
      .input('veiculo', sql.Char(1), FGVEICULO || 'N')
      .input('motorista', sql.Char(1), FGMOTORISTA || 'N')
      .input('transportador', sql.Char(1), FGTRANSPORTADOR || 'N')
      .input('cliente', sql.Char(1), FGCLIENTE || 'N')
      .input('fornecedor', sql.Char(1), FGFORNECEDOR || 'N')
      .input('certificadora', sql.Char(1), FGEXIGECERTIFICADORA || 'N')
      .query(`
        INSERT INTO [dbo].[TIPOVALIDADE] (
          CDTIPOVALIDADE, DSTIPOVALIDADE, FGVEICULO, FGMOTORISTA, FGTRANSPORTADOR,
          FGCLIENTE, FGFORNECEDOR, FGEXIGECERTIFICADORA,
          DHMAINTENANCE, SGUSER, SERVERORIG
        )
        VALUES (
          @codigo, @descricao, @veiculo, @motorista, @transportador,
          @cliente, @fornecedor, @certificadora,
          GETDATE(), 'SYSTEM', 'AppDVcargas'
        )
      `);

    res.status(201).json({ success: true, message: 'Tipo de validade cadastrado com sucesso!', codigo: novoCodigo });
  } catch (err) {
    console.error('Erro ao criar tipo de validade:', err);
    res.status(500).json({ error: 'Erro ao cadastrar tipo de validade.' });
  }
};

// Atualizar tipo de validade
const atualizar = async (req, res) => {
  try {
    const { id } = req.params;
    const { DSTIPOVALIDADE, FGVEICULO, FGMOTORISTA, FGTRANSPORTADOR, FGCLIENTE, FGFORNECEDOR, FGEXIGECERTIFICADORA } = req.body;

    if (!DSTIPOVALIDADE) {
      return res.status(400).json({ error: 'Descrição é obrigatória.' });
    }

    const pool = await poolPromise;

    // Verificar se existe
    const checkExist = await pool
      .request()
      .input('codigo', sql.SmallInt, parseInt(id))
      .query('SELECT CDTIPOVALIDADE FROM [dbo].[TIPOVALIDADE] WHERE CDTIPOVALIDADE = @codigo');

    if (checkExist.recordset.length === 0) {
      return res.status(404).json({ error: 'Tipo de validade não encontrado.' });
    }

    await pool
      .request()
      .input('codigo', sql.SmallInt, parseInt(id))
      .input('descricao', sql.VarChar(40), DSTIPOVALIDADE)
      .input('veiculo', sql.Char(1), FGVEICULO || 'N')
      .input('motorista', sql.Char(1), FGMOTORISTA || 'N')
      .input('transportador', sql.Char(1), FGTRANSPORTADOR || 'N')
      .input('cliente', sql.Char(1), FGCLIENTE || 'N')
      .input('fornecedor', sql.Char(1), FGFORNECEDOR || 'N')
      .input('certificadora', sql.Char(1), FGEXIGECERTIFICADORA || 'N')
      .query(`
        UPDATE [dbo].[TIPOVALIDADE]
        SET 
          DSTIPOVALIDADE = @descricao,
          FGVEICULO = @veiculo,
          FGMOTORISTA = @motorista,
          FGTRANSPORTADOR = @transportador,
          FGCLIENTE = @cliente,
          FGFORNECEDOR = @fornecedor,
          FGEXIGECERTIFICADORA = @certificadora,
          DHMAINTENANCE = GETDATE(),
          SGUSER = 'SYSTEM',
          SERVERORIG = 'AppDVcargas'
        WHERE CDTIPOVALIDADE = @codigo
      `);

    res.json({ success: true, message: 'Tipo de validade atualizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar tipo de validade:', err);
    res.status(500).json({ error: 'Erro ao atualizar tipo de validade.' });
  }
};

// Excluir tipo de validade
const excluir = async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;

    // Verificar se existem validades associadas
    const checkValidades = await pool
      .request()
      .input('codigo', sql.SmallInt, parseInt(id))
      .query('SELECT COUNT(*) AS QTD FROM [dbo].[CONTROLEVALIDADE] WHERE CDTIPOVALIDADE = @codigo');

    if (checkValidades.recordset[0].QTD > 0) {
      return res.status(400).json({ 
        error: 'Não é possível excluir. Existem validades associadas a este tipo.' 
      });
    }

    // Verificar se existe
    const checkExist = await pool
      .request()
      .input('codigo', sql.SmallInt, parseInt(id))
      .query('SELECT CDTIPOVALIDADE FROM [dbo].[TIPOVALIDADE] WHERE CDTIPOVALIDADE = @codigo');

    if (checkExist.recordset.length === 0) {
      return res.status(404).json({ error: 'Tipo de validade não encontrado.' });
    }

    // Excluir
    await pool
      .request()
      .input('codigo', sql.SmallInt, parseInt(id))
      .query('DELETE FROM [dbo].[TIPOVALIDADE] WHERE CDTIPOVALIDADE = @codigo');

    res.json({ success: true, message: 'Tipo de validade excluído com sucesso!' });
  } catch (err) {
    console.error('Erro ao excluir tipo de validade:', err);
    res.status(500).json({ error: 'Erro ao excluir tipo de validade.' });
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
  buscarPorId,
  criar,
  atualizar,
  excluir,
  executarInitSQL
};
