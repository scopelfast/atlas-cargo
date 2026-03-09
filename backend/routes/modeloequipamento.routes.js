// backend/routes/modeloequipamento.routes.js
const express = require('express');
const sql = require('../config/mssql-compat');
const router = express.Router();
const { poolPromise, getFirstNumericValue } = require('../config/db');

// Listar modelos de equipamento com filtros
router.get('/modelos-equipamento', async (req, res) => {
  try {
    const { codigo, descricao, tipo, marca, situacao } = req.query;
    let query = `
      SELECT 
        [m].[CDMODELOEQUIPAMENTO],
        [m].[DSMODELOEQUIPAMENTO],
        [m].[CDTIPOEQUIPAMENTO],
        [t].[DSTIPOEQUIPAMENTO] AS TIPO_NOME,
        [m].[CDMARCAEQUIPAMENTO],
        [ma].[DSMARCAEQUIPAMENTO] AS MARCA_NOME,
        [m].[FGACTIVE]
      FROM [dbo].[MODELOEQUIPAMENTO] m
      LEFT JOIN [dbo].[TIPOEQUIPAMENTO] t ON [m].[CDTIPOEQUIPAMENTO] = [t].[CDTIPOEQUIPAMENTO]
      LEFT JOIN [dbo].[MARCAEQUIPAMENTO] ma ON [m].[CDMARCAEQUIPAMENTO] = [ma].[CDMARCAEQUIPAMENTO]
      WHERE 1=1
    `;

    const params = [];
    if (codigo) {
      query += ` AND [m].[CDMODELOEQUIPAMENTO] = @CODIGO`;
      params.push({ name: 'CODIGO', value: parseInt(codigo) });
    }
    if (descricao) {
      query += ` AND [m].[DSMODELOEQUIPAMENTO] LIKE @DESCRICAO`;
      params.push({ name: 'DESCRICAO', value: `%${descricao}%` });
    }
    if (tipo) {
      query += ` AND [m].[CDTIPOEQUIPAMENTO] = @TIPO`;
      params.push({ name: 'TIPO', value: parseInt(tipo) });
    }
    if (marca) {
      query += ` AND [m].[CDMARCAEQUIPAMENTO] = @MARCA`;
      params.push({ name: 'MARCA', value: parseInt(marca) });
    }
    if (situacao) {
      query += ` AND [m].[FGACTIVE] = @SITUACAO`;
      params.push({ name: 'SITUACAO', value: situacao === 'S' ? 'A' : 'I' });
    }

    query += ` ORDER BY [m].[DSMODELOEQUIPAMENTO]`;

    const pool = await poolPromise;
    const request = pool.request();
    params.forEach(p => request.input(p.name, p.value));
    
    const result = await request.query(query);
    const get = (row, key) => row[key] != null ? row[key] : row[key.toLowerCase()];
    const modelos = result.recordset.map(m => ({
      CDMODELOEQUIPAMENTO: get(m, 'CDMODELOEQUIPAMENTO'),
      DSMODELOEQUIPAMENTO: get(m, 'DSMODELOEQUIPAMENTO'),
      CDTIPOEQUIPAMENTO: get(m, 'CDTIPOEQUIPAMENTO'),
      TIPO_NOME: get(m, 'TIPO_NOME') || 'Não informado',
      CDMARCAEQUIPAMENTO: get(m, 'CDMARCAEQUIPAMENTO'),
      MARCA_NOME: get(m, 'MARCA_NOME') || 'Não informada',
      FGACTIVE: get(m, 'FGACTIVE') === 'A' ? 'S' : 'N'
    }));
    
    res.json(modelos);
  } catch (err) {
    console.error('Erro ao listar modelos de equipamento:', err);
    res.status(500).json({ error: 'Erro ao carregar modelos.' });
  }
});

// Buscar modelo de equipamento por ID
router.get('/modelos-equipamento/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('CDMODELOEQUIPAMENTO', idNum)
      .query(`
        SELECT 
          [CDMODELOEQUIPAMENTO],
          [DSMODELOEQUIPAMENTO],
          [CDTIPOEQUIPAMENTO],
          [CDMARCAEQUIPAMENTO],
          [FGACTIVE]
        FROM [dbo].[MODELOEQUIPAMENTO]
        WHERE [CDMODELOEQUIPAMENTO] = @CDMODELOEQUIPAMENTO
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Modelo de equipamento não encontrado.' });
    }

    const modelo = result.recordset[0];
    res.json({
      CDMODELOEQUIPAMENTO: modelo.CDMODELOEQUIPAMENTO,
      DSMODELOEQUIPAMENTO: modelo.DSMODELOEQUIPAMENTO,
      CDTIPOEQUIPAMENTO: modelo.CDTIPOEQUIPAMENTO,
      CDMARCAEQUIPAMENTO: modelo.CDMARCAEQUIPAMENTO,
      FGACTIVE: modelo.FGACTIVE === 'A' ? 'S' : 'N'
    });
  } catch (err) {
    console.error('Erro ao buscar modelo de equipamento:', err);
    res.status(500).json({ error: 'Erro ao buscar modelo de equipamento.' });
  }
});

// Inserir novo modelo
router.post('/modelos-equipamento', async (req, res) => {
  try {
    const { DSMODELOEQUIPAMENTO, CDTIPOEQUIPAMENTO, CDMARCAEQUIPAMENTO } = req.body;
    if (!DSMODELOEQUIPAMENTO?.trim()) {
      return res.status(400).json({ error: 'Descrição é obrigatória.' });
    }
    if (!CDTIPOEQUIPAMENTO || !CDMARCAEQUIPAMENTO) {
      return res.status(400).json({ error: 'Tipo e Marca são obrigatórios.' });
    }

    const pool = await poolPromise;
    const descricao = DSMODELOEQUIPAMENTO.trim();
    const existente = await pool.query(
      `SELECT 1 FROM "MODELOEQUIPAMENTO" WHERE UPPER(TRIM("DSMODELOEQUIPAMENTO")) = UPPER(TRIM($1)) LIMIT 1`,
      [descricao]
    );
    if (existente.rows && existente.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe um modelo de equipamento com esta descrição. Não é permitido cadastrar duplicados.' });
    }

    const getProximoId = async () => getFirstNumericValue((await pool.request().query('SELECT COALESCE(MAX([CDMODELOEQUIPAMENTO]), 0) + 1 AS [maxId] FROM [dbo].[MODELOEQUIPAMENTO]')).recordset, 1);
    let novoId = await getProximoId();
    const doInsert = async (id) => {
      await pool.request().input('CDMODELOEQUIPAMENTO', sql.SmallInt, id).input('DSMODELOEQUIPAMENTO', DSMODELOEQUIPAMENTO.trim()).input('CDTIPOEQUIPAMENTO', sql.SmallInt, CDTIPOEQUIPAMENTO).input('CDMARCAEQUIPAMENTO', sql.SmallInt, CDMARCAEQUIPAMENTO)
        .query(`INSERT INTO [dbo].[MODELOEQUIPAMENTO] ([CDMODELOEQUIPAMENTO], [DSMODELOEQUIPAMENTO], [CDTIPOEQUIPAMENTO], [CDMARCAEQUIPAMENTO], [FGACTIVE], [DHMAINTENANCE], [SGUSER], [SERVERORIG]) VALUES (@CDMODELOEQUIPAMENTO, @DSMODELOEQUIPAMENTO, @CDTIPOEQUIPAMENTO, @CDMARCAEQUIPAMENTO, 'A', GETDATE(), 'SYSTEM', 'AppDVcargas')`);
    };
    try { await doInsert(novoId); } catch (e) { if (String(e.code) === '23505') { novoId = await getProximoId(); await doInsert(novoId); } else throw e; }
    res.status(201).json({ success: true, message: 'Modelo de equipamento cadastrado com sucesso!' });
  } catch (err) {
    console.error('Erro ao inserir modelo:', err);
    res.status(500).json({ error: 'Erro ao cadastrar modelo.' });
  }
});

// Atualizar modelo
router.put('/modelos-equipamento/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { DSMODELOEQUIPAMENTO, CDTIPOEQUIPAMENTO, CDMARCAEQUIPAMENTO, FGACTIVE } = req.body;

    if (!DSMODELOEQUIPAMENTO?.trim() || !CDTIPOEQUIPAMENTO || !CDMARCAEQUIPAMENTO || !['S', 'N'].includes(FGACTIVE)) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    const pool = await poolPromise;
    const idNumerico = parseInt(id, 10);
    if (isNaN(idNumerico) || idNumerico <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    const existente = await pool.query(
      `SELECT 1 FROM "MODELOEQUIPAMENTO" WHERE UPPER(TRIM("DSMODELOEQUIPAMENTO")) = UPPER(TRIM($1)) AND "CDMODELOEQUIPAMENTO" != $2 LIMIT 1`,
      [DSMODELOEQUIPAMENTO.trim(), idNumerico]
    );
    if (existente.rows && existente.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe outro modelo de equipamento com esta descrição. Não é permitido duplicar.' });
    }
    const fgactiveDB = FGACTIVE === 'S' ? 'A' : 'I';

    await pool
      .request()
      .input('CDMODELOEQUIPAMENTO', sql.SmallInt, idNumerico)
      .input('DSMODELOEQUIPAMENTO', DSMODELOEQUIPAMENTO.trim())
      .input('CDTIPOEQUIPAMENTO', sql.SmallInt, CDTIPOEQUIPAMENTO)
      .input('CDMARCAEQUIPAMENTO', sql.SmallInt, CDMARCAEQUIPAMENTO)
      .input('FGACTIVE', fgactiveDB)
      .query(`
        UPDATE [dbo].[MODELOEQUIPAMENTO]
        SET 
          [DSMODELOEQUIPAMENTO] = @DSMODELOEQUIPAMENTO,
          [CDTIPOEQUIPAMENTO] = @CDTIPOEQUIPAMENTO,
          [CDMARCAEQUIPAMENTO] = @CDMARCAEQUIPAMENTO,
          [FGACTIVE] = @FGACTIVE,
          [DHMAINTENANCE] = GETDATE(),
          [SGUSER] = 'SYSTEM',
          [SERVERORIG] = 'AppDVcargas'
        WHERE [CDMODELOEQUIPAMENTO] = @CDMODELOEQUIPAMENTO
      `);

    res.json({ success: true, message: 'Modelo atualizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar modelo:', err);
    res.status(500).json({ error: 'Erro ao atualizar modelo.' });
  }
});

// Inativar/Reativar modelo (desativação, não exclusão física)
router.delete('/modelos-equipamento/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.query;
    
    // Validar e converter ID para número
    const idNumerico = parseInt(id, 10);
    if (isNaN(idNumerico) || idNumerico <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const pool = await poolPromise;

    // Verificar status atual
    const checkResult = await pool
      .request()
      .input('CDMODELOEQUIPAMENTO', sql.SmallInt, idNumerico)
      .query(`SELECT [FGACTIVE] FROM [dbo].[MODELOEQUIPAMENTO] WHERE [CDMODELOEQUIPAMENTO] = @CDMODELOEQUIPAMENTO`);

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Modelo não encontrado.' });
    }

    const statusAtual = checkResult.recordset[0].FGACTIVE;
    const estaAtivo = statusAtual === 'A';
    
    // Determinar nova situação
    let novaSituacao, mensagem;
    if (action === 'activate') {
      novaSituacao = 'A';
      mensagem = 'Modelo de equipamento reativado com sucesso!';
    } else if (action === 'deactivate') {
      novaSituacao = 'I';
      mensagem = 'Modelo de equipamento desativado com sucesso!';
    } else {
      novaSituacao = estaAtivo ? 'I' : 'A';
      mensagem = estaAtivo ? 'Modelo de equipamento desativado com sucesso!' : 'Modelo de equipamento reativado com sucesso!';
    }

    const result = await pool
      .request()
      .input('CDMODELOEQUIPAMENTO', sql.SmallInt, idNumerico)
      .input('FGACTIVE', sql.Char(1), novaSituacao)
      .query(`
        UPDATE [dbo].[MODELOEQUIPAMENTO]
        SET 
          [FGACTIVE] = @FGACTIVE,
          [DHMAINTENANCE] = GETDATE(),
          [SGUSER] = 'SYSTEM',
          [SERVERORIG] = 'AppDVcargas'
        WHERE [CDMODELOEQUIPAMENTO] = @CDMODELOEQUIPAMENTO
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Modelo não encontrado.' });
    }

    res.json({ success: true, message: mensagem, newStatus: novaSituacao === 'A' ? 'S' : 'N' });
  } catch (err) {
    console.error('Erro ao alterar status do modelo:', err);
    res.status(500).json({ error: 'Erro ao alterar status do modelo.' });
  }
});

// Listar combos (query nativa PostgreSQL com identificadores entre aspas)
const createComboRoute = (tableName, idField, nameField) => {
  return async (req, res) => {
    try {
      const pool = await poolPromise;
      const pgQuery = `SELECT "${idField}", "${nameField}" FROM "${tableName}" ORDER BY "${nameField}"`;
      const result = await pool.query(pgQuery, []);
      res.json(result.rows || []);
    } catch (err) {
      console.error(`Erro ao carregar ${tableName}:`, err);
      res.status(500).json({ error: `Erro ao carregar ${tableName}.` });
    }
  };
};

router.get('/tipos-combo', createComboRoute('TIPOEQUIPAMENTO', 'CDTIPOEQUIPAMENTO', 'DSTIPOEQUIPAMENTO'));
router.get('/marcas-combo', createComboRoute('MARCAEQUIPAMENTO', 'CDMARCAEQUIPAMENTO', 'DSMARCAEQUIPAMENTO'));

// Executar init.sql
router.post('/modelos-equipamento/executar-init-sql', async (req, res) => {
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
});

module.exports = router;