// backend/routes/empresa.routes.js
const express = require('express');
const sql = require('../config/mssql-compat');
const router = express.Router();
const { poolPromise, getFirstNumericValue } = require('../config/db');

// Função para validar CNPJ
function validarCNPJ(cnpj) {
  cnpj = cnpj.toString().replace(/[^\d]+/g, '');
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1+$/.test(cnpj)) return false;
  
  let tamanho = cnpj.length - 2;
  let numeros = cnpj.substring(0, tamanho);
  let digitos = cnpj.substring(tamanho);
  let soma = 0;
  let pos = tamanho - 7;
  
  for (let i = tamanho; i >= 1; i--) {
    soma += parseInt(numeros.charAt(tamanho - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  
  let resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
  if (resultado !== parseInt(digitos.charAt(0))) return false;
  
  tamanho = tamanho + 1;
  numeros = cnpj.substring(0, tamanho);
  soma = 0;
  pos = tamanho - 7;
  
  for (let i = tamanho; i >= 1; i--) {
    soma += parseInt(numeros.charAt(tamanho - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  
  resultado = soma % 11 < 2 ? 0 : 11 - soma % 11;
  if (resultado !== parseInt(digitos.charAt(1))) return false;
  
  return true;
}

// Listar empresas com filtros
router.get('/empresas', async (req, res) => {
  try {
    const { codigo, razaosocial, nomereduzido, cgcmatriz, situacao } = req.query;

    let query = `
      SELECT 
        [CDEMPRESA],
        [RZSOCIAL],
        [NMREDUZIDO],
        [CGCMATRIZ],
        [FGACTIVE],
        [DHMAINTENANCE],
        [SGUSER],
        [SERVERORIG]
      FROM [dbo].[EMPRESA]
      WHERE 1=1
    `;

    const params = [];

    if (codigo) {
      query += ` AND [CDEMPRESA] = @CODIGO`;
      params.push({ name: 'CODIGO', value: parseInt(codigo) });
    }
    if (razaosocial) {
      query += ` AND [RZSOCIAL] LIKE @RAZAOSOCIAL`;
      params.push({ name: 'RAZAOSOCIAL', value: `%${razaosocial}%` });
    }
    if (nomereduzido) {
      query += ` AND [NMREDUZIDO] LIKE @NOMEREDUZIDO`;
      params.push({ name: 'NOMEREDUZIDO', value: `%${nomereduzido}%` });
    }
    if (cgcmatriz) {
      query += ` AND [CGCMATRIZ] = @CGCMATRIZ`;
      params.push({ name: 'CGCMATRIZ', value: cgcmatriz });
    }
    if (situacao) {
      query += ` AND [FGACTIVE] = @SITUACAO`;
      params.push({ name: 'SITUACAO', value: situacao === 'S' ? 'A' : 'I' });
    }

    query += ` ORDER BY [RZSOCIAL]`;

    const pool = await poolPromise;
    const request = pool.request();
    params.forEach(p => request.input(p.name, p.value));

    const result = await request.query(query);
    const empresas = result.recordset.map(e => ({
      CDEMPRESA: e.CDEMPRESA,
      RZSOCIAL: e.RZSOCIAL,
      NMREDUZIDO: e.NMREDUZIDO,
      CGCMATRIZ: e.CGCMATRIZ,
      FGACTIVE: e.FGACTIVE === 'A' ? 'S' : 'N',
      DHMAINTENANCE: e.DHMAINTENANCE,
      SGUSER: e.SGUSER,
      SERVERORIG: e.SERVERORIG
    }));

    res.json(empresas);
  } catch (err) {
    console.error('Erro ao listar empresas:', err);
    res.status(500).json({ error: 'Erro ao carregar empresas.' });
  }
});

// Buscar empresa por ID
router.get('/empresas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const idNumerico = parseInt(id);

    if (isNaN(idNumerico)) {
      return res.status(400).json({ error: 'ID da empresa inválido.' });
    }

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('CDEMPRESA', sql.SmallInt, idNumerico)
      .query(`
        SELECT 
          [CDEMPRESA],
          [RZSOCIAL],
          [NMREDUZIDO],
          [CGCMATRIZ],
          [FGACTIVE],
          [DHMAINTENANCE],
          [SGUSER],
          [SERVERORIG]
        FROM [dbo].[EMPRESA]
        WHERE [CDEMPRESA] = @CDEMPRESA
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }

    const empresa = result.recordset[0];
    res.json({
      CDEMPRESA: empresa.CDEMPRESA,
      RZSOCIAL: empresa.RZSOCIAL,
      NMREDUZIDO: empresa.NMREDUZIDO,
      CGCMATRIZ: empresa.CGCMATRIZ,
      FGACTIVE: empresa.FGACTIVE === 'A' ? 'S' : 'N',
      DHMAINTENANCE: empresa.DHMAINTENANCE,
      SGUSER: empresa.SGUSER,
      SERVERORIG: empresa.SERVERORIG
    });
  } catch (err) {
    console.error('Erro ao buscar empresa:', err);
    res.status(500).json({ error: 'Erro ao carregar empresa.' });
  }
});

// Inserir nova empresa
router.post('/empresas', async (req, res) => {
  try {
    const { RZSOCIAL, NMREDUZIDO, CGCMATRIZ, FGACTIVE } = req.body;

    if (!RZSOCIAL?.trim() || !NMREDUZIDO?.trim() || !CGCMATRIZ) {
      return res.status(400).json({ error: 'Razão Social, Nome Reduzido e CNPJ Matriz são obrigatórios.' });
    }

    // Validar CNPJ
    const cnpjStr = CGCMATRIZ.toString().replace(/[^\d]+/g, '');
    if (!validarCNPJ(cnpjStr)) {
      return res.status(400).json({ error: 'CNPJ Matriz inválido.' });
    }

    const pool = await poolPromise;

    // Verificar duplicidade de CNPJ
    const checkDuplicate = await pool
      .request()
      .input('CGCMATRIZ', sql.Decimal(15, 0), CGCMATRIZ)
      .query('SELECT [CDEMPRESA] FROM [dbo].[EMPRESA] WHERE [CGCMATRIZ] = @CGCMATRIZ');

    if (checkDuplicate.recordset.length > 0) {
      return res.status(400).json({ error: 'Já existe uma empresa com este CNPJ Matriz.' });
    }

    // Gerar novo ID (auto-incremento)
    const maxResult = await pool
      .request()
      .query('SELECT COALESCE(MAX([CDEMPRESA]), 0) + 1 AS [maxId] FROM [dbo].[EMPRESA]');
    const novoId = getFirstNumericValue(maxResult.recordset, 1);

    const fgactiveDB = (FGACTIVE === 'S' || FGACTIVE === 'A') ? 'A' : 'I';

    await pool
      .request()
      .input('CDEMPRESA', sql.SmallInt, novoId)
      .input('RZSOCIAL', RZSOCIAL.trim())
      .input('NMREDUZIDO', NMREDUZIDO.trim())
      .input('CGCMATRIZ', sql.Decimal(15, 0), CGCMATRIZ)
      .input('FGACTIVE', fgactiveDB)
      .query(`
        INSERT INTO [dbo].[EMPRESA] (
          [CDEMPRESA], [RZSOCIAL], [NMREDUZIDO], [CGCMATRIZ], [FGACTIVE],
          [DHMAINTENANCE], [SGUSER], [SERVERORIG]
        )
        VALUES (
          @CDEMPRESA, @RZSOCIAL, @NMREDUZIDO, @CGCMATRIZ, @FGACTIVE,
          GETDATE(), 'SYSTEM', 'AppDVcargas'
        )
      `);

    res.status(201).json({ success: true, message: 'Empresa cadastrada com sucesso!', id: novoId });
  } catch (err) {
    console.error('Erro ao inserir empresa:', err);
    res.status(500).json({ error: 'Erro ao cadastrar empresa.' });
  }
});

// Atualizar empresa
router.put('/empresas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { RZSOCIAL, NMREDUZIDO, CGCMATRIZ, FGACTIVE } = req.body;

    const idNumerico = parseInt(id);
    if (isNaN(idNumerico)) {
      return res.status(400).json({ error: 'ID da empresa inválido.' });
    }

    if (!RZSOCIAL?.trim() || !NMREDUZIDO?.trim() || !CGCMATRIZ || !['S', 'N'].includes(FGACTIVE)) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    // Validar CNPJ
    const cnpjStr = CGCMATRIZ.toString().replace(/[^\d]+/g, '');
    if (!validarCNPJ(cnpjStr)) {
      return res.status(400).json({ error: 'CNPJ Matriz inválido.' });
    }

    const pool = await poolPromise;

    // Verificar duplicidade de CNPJ (excluindo o próprio registro)
    const checkDuplicate = await pool
      .request()
      .input('CGCMATRIZ', sql.Decimal(15, 0), CGCMATRIZ)
      .input('CDEMPRESA', sql.SmallInt, idNumerico)
      .query('SELECT [CDEMPRESA] FROM [dbo].[EMPRESA] WHERE [CGCMATRIZ] = @CGCMATRIZ AND [CDEMPRESA] != @CDEMPRESA');

    if (checkDuplicate.recordset.length > 0) {
      return res.status(400).json({ error: 'Já existe outra empresa com este CNPJ Matriz.' });
    }

    const fgactiveDB = FGACTIVE === 'S' ? 'A' : 'I';

    const result = await pool
      .request()
      .input('CDEMPRESA', sql.SmallInt, idNumerico)
      .input('RZSOCIAL', RZSOCIAL.trim())
      .input('NMREDUZIDO', NMREDUZIDO.trim())
      .input('CGCMATRIZ', sql.Decimal(15, 0), CGCMATRIZ)
      .input('FGACTIVE', fgactiveDB)
      .query(`
        UPDATE [dbo].[EMPRESA]
        SET 
          [RZSOCIAL] = @RZSOCIAL,
          [NMREDUZIDO] = @NMREDUZIDO,
          [CGCMATRIZ] = @CGCMATRIZ,
          [FGACTIVE] = @FGACTIVE,
          [DHMAINTENANCE] = GETDATE(),
          [SGUSER] = 'SYSTEM',
          [SERVERORIG] = 'AppDVcargas'
        WHERE [CDEMPRESA] = @CDEMPRESA
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }

    res.json({ success: true, message: 'Empresa atualizada com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar empresa:', err);
    res.status(500).json({ error: 'Erro ao atualizar empresa.' });
  }
});

// Desativar/Reativar empresa (soft delete)
router.delete('/empresas/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.query;
    const idNumerico = parseInt(id);

    if (isNaN(idNumerico)) {
      return res.status(400).json({ error: 'ID da empresa inválido.' });
    }

    const pool = await poolPromise;
    
    // Verificar status atual
    const checkResult = await pool
      .request()
      .input('CDEMPRESA', sql.SmallInt, idNumerico)
      .query(`SELECT [FGACTIVE] FROM [dbo].[EMPRESA] WHERE [CDEMPRESA] = @CDEMPRESA`);

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }

    const statusAtual = checkResult.recordset[0].FGACTIVE;
    const estaAtivo = statusAtual === 'A';
    
    // Determinar nova situação
    let novaSituacao, mensagem;
    if (action === 'activate') {
      novaSituacao = 'A';
      mensagem = 'Empresa reativada com sucesso!';
    } else if (action === 'deactivate') {
      novaSituacao = 'I';
      mensagem = 'Empresa desativada com sucesso!';
    } else {
      novaSituacao = estaAtivo ? 'I' : 'A';
      mensagem = estaAtivo ? 'Empresa desativada com sucesso!' : 'Empresa reativada com sucesso!';
    }

    const result = await pool
      .request()
      .input('CDEMPRESA', sql.SmallInt, idNumerico)
      .input('FGACTIVE', sql.Char(1), novaSituacao)
      .query(`
        UPDATE [dbo].[EMPRESA]
        SET 
          [FGACTIVE] = @FGACTIVE,
          [DHMAINTENANCE] = GETDATE(),
          [SGUSER] = 'SYSTEM',
          [SERVERORIG] = 'AppDVcargas'
        WHERE [CDEMPRESA] = @CDEMPRESA
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }

    res.json({ success: true, message: mensagem, newStatus: novaSituacao === 'A' ? 'S' : 'N' });
  } catch (err) {
    console.error('Erro ao desativar empresa:', err);
    res.status(500).json({ error: 'Erro ao desativar empresa.' });
  }
});

// Executar init.sql
router.post('/empresas/executar-init-sql', async (req, res) => {
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

