// backend/routes/tipoequipamento.routes.js
const express = require('express');
const sql = require('../config/mssql-compat');
const router = express.Router();
const { poolPromise, getFirstNumericValue } = require('../config/db');

// Função para obter descrição do tipo de veículo
const getTipoVeiculoDescricao = (codigo) => {
  const descricoes = {
    '01': '01 - Truck',
    '02': '02 - Toco',
    '03': '03 - Cavalo Mecânico',
    '04': '04 - Van',
    '05': '05 - Utilitário',
    '06': '06 - Carreta',
    '07': '07 - Outros (passeio)',
    '08': '08 - Não se aplica'
  };
  return descricoes[codigo] || codigo || 'Não informado';
};

// Listar tipos de equipamento com filtros
router.get('/tipos-equipamento', async (req, res) => {
  try {
    const { codigo, descricao, situacao } = req.query;
    let query = `
      SELECT 
        [CDTIPOEQUIPAMENTO],
        [DSTIPOEQUIPAMENTO],
        [MASCARAIDENTIF],
        [FGTIPOVEICULO],
        [FGACTIVE]
      FROM [dbo].[TIPOEQUIPAMENTO]
      WHERE 1=1
    `;

    const params = [];
    if (codigo) {
      query += ` AND [CDTIPOEQUIPAMENTO] = @CODIGO`;
      params.push({ name: 'CODIGO', value: parseInt(codigo) });
    }
    if (descricao) {
      query += ` AND [DSTIPOEQUIPAMENTO] LIKE @DESCRICAO`;
      params.push({ name: 'DESCRICAO', value: `%${descricao}%` });
    }
    if (situacao) {
      query += ` AND [FGACTIVE] = @SITUACAO`;
      params.push({ name: 'SITUACAO', value: situacao === 'S' ? 'A' : 'I' });
    }

    query += ` ORDER BY [DSTIPOEQUIPAMENTO]`;

    const pool = await poolPromise;
    const request = pool.request();
    params.forEach(p => request.input(p.name, p.value));
    
    const result = await request.query(query);
    const tipos = result.recordset.map(t => ({
      CDTIPOEQUIPAMENTO: t.CDTIPOEQUIPAMENTO,
      DSTIPOEQUIPAMENTO: t.DSTIPOEQUIPAMENTO,
      MASCARAIDENTIF: t.MASCARAIDENTIF || 'Não informada',
      FGTIPOVEICULO: t.FGTIPOVEICULO || 'Não informado',
      FGTIPOVEICULO_DESC: getTipoVeiculoDescricao(t.FGTIPOVEICULO),
      FGACTIVE: t.FGACTIVE === 'A' ? 'S' : 'N'
    }));
    
    res.json(tipos);
  } catch (err) {
    console.error('Erro ao listar tipos de equipamento:', err);
    res.status(500).json({ error: 'Erro ao carregar tipos.' });
  }
});

// Buscar tipo de equipamento por ID
router.get('/tipos-equipamento/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('CDTIPOEQUIPAMENTO', idNum)
      .query(`
        SELECT 
          [CDTIPOEQUIPAMENTO],
          [DSTIPOEQUIPAMENTO],
          [MASCARAIDENTIF],
          [FGTIPOVEICULO],
          [FGACTIVE]
        FROM [dbo].[TIPOEQUIPAMENTO]
        WHERE [CDTIPOEQUIPAMENTO] = @CDTIPOEQUIPAMENTO
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Tipo de equipamento não encontrado.' });
    }

    const tipo = result.recordset[0];
    res.json({
      CDTIPOEQUIPAMENTO: tipo.CDTIPOEQUIPAMENTO,
      DSTIPOEQUIPAMENTO: tipo.DSTIPOEQUIPAMENTO,
      MASCARAIDENTIF: tipo.MASCARAIDENTIF,
      FGTIPOVEICULO: tipo.FGTIPOVEICULO,
      FGACTIVE: tipo.FGACTIVE === 'A' ? 'S' : 'N'
    });
  } catch (err) {
    console.error('Erro ao buscar tipo de equipamento:', err);
    res.status(500).json({ error: 'Erro ao buscar tipo de equipamento.' });
  }
});

// Inserir novo tipo
router.post('/tipos-equipamento', async (req, res) => {
  try {
    const { DSTIPOEQUIPAMENTO, MASCARAIDENTIF, FGTIPOVEICULO } = req.body;
    if (!DSTIPOEQUIPAMENTO?.trim()) {
      return res.status(400).json({ error: 'Descrição é obrigatória.' });
    }

    const pool = await poolPromise;
    const descricao = DSTIPOEQUIPAMENTO.trim();
    const existente = await pool.query(
      `SELECT 1 FROM "TIPOEQUIPAMENTO" WHERE UPPER(TRIM("DSTIPOEQUIPAMENTO")) = UPPER(TRIM($1)) LIMIT 1`,
      [descricao]
    );
    if (existente.rows && existente.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe um tipo de equipamento com esta descrição. Não é permitido cadastrar duplicados.' });
    }

    const getProximoId = async () => getFirstNumericValue((await pool.request().query('SELECT COALESCE(MAX([CDTIPOEQUIPAMENTO]), 0) + 1 AS [maxId] FROM [dbo].[TIPOEQUIPAMENTO]')).recordset, 1);
    let novoId = await getProximoId();
    const doInsert = async (id) => {
      await pool.request().input('CDTIPOEQUIPAMENTO', sql.SmallInt, id).input('DSTIPOEQUIPAMENTO', DSTIPOEQUIPAMENTO.trim()).input('MASCARAIDENTIF', MASCARAIDENTIF || null).input('FGTIPOVEICULO', FGTIPOVEICULO || null)
        .query(`INSERT INTO [dbo].[TIPOEQUIPAMENTO] ([CDTIPOEQUIPAMENTO], [DSTIPOEQUIPAMENTO], [MASCARAIDENTIF], [FGTIPOVEICULO], [FGACTIVE], [DHMAINTENANCE], [SGUSER], [SERVERORIG]) VALUES (@CDTIPOEQUIPAMENTO, @DSTIPOEQUIPAMENTO, @MASCARAIDENTIF, @FGTIPOVEICULO, 'A', GETDATE(), 'SYSTEM', 'AppDVcargas')`);
    };
    try {
      await doInsert(novoId);
    } catch (e) {
      if (String(e.code) === '23505') {
        if (e.constraint === 'uk_tipoequipamento_ds') {
          return res.status(409).json({ error: 'Já existe um tipo de equipamento com esta descrição. Não é permitido cadastrar duplicados.' });
        }
        novoId = await getProximoId();
        await doInsert(novoId);
      } else throw e;
    }
    res.status(201).json({ success: true, message: 'Tipo de equipamento cadastrado com sucesso!' });
  } catch (err) {
    console.error('Erro ao inserir tipo:', err);
    res.status(500).json({ error: 'Erro ao cadastrar tipo.' });
  }
});

// Atualizar tipo
router.put('/tipos-equipamento/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { DSTIPOEQUIPAMENTO, MASCARAIDENTIF, FGTIPOVEICULO, FGACTIVE } = req.body;

    if (!DSTIPOEQUIPAMENTO?.trim() || !['S', 'N'].includes(FGACTIVE)) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    const pool = await poolPromise;
    const idNumerico = parseInt(id, 10);
    if (isNaN(idNumerico) || idNumerico <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    const existente = await pool.query(
      `SELECT 1 FROM "TIPOEQUIPAMENTO" WHERE UPPER(TRIM("DSTIPOEQUIPAMENTO")) = UPPER(TRIM($1)) AND "CDTIPOEQUIPAMENTO" != $2 LIMIT 1`,
      [DSTIPOEQUIPAMENTO.trim(), idNumerico]
    );
    if (existente.rows && existente.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe outro tipo de equipamento com esta descrição. Não é permitido duplicar.' });
    }
    const fgactiveDB = FGACTIVE === 'S' ? 'A' : 'I';

    await pool
      .request()
      .input('CDTIPOEQUIPAMENTO', sql.SmallInt, idNumerico)
      .input('DSTIPOEQUIPAMENTO', DSTIPOEQUIPAMENTO.trim())
      .input('MASCARAIDENTIF', MASCARAIDENTIF || null)
      .input('FGTIPOVEICULO', FGTIPOVEICULO || null)
      .input('FGACTIVE', fgactiveDB)
      .query(`
        UPDATE [dbo].[TIPOEQUIPAMENTO] 
        SET 
          [DSTIPOEQUIPAMENTO] = @DSTIPOEQUIPAMENTO,
          [MASCARAIDENTIF] = @MASCARAIDENTIF,
          [FGTIPOVEICULO] = @FGTIPOVEICULO,
          [FGACTIVE] = @FGACTIVE,
          [DHMAINTENANCE] = GETDATE(),
          [SGUSER] = 'SYSTEM',
          [SERVERORIG] = 'AppDVcargas'
        WHERE [CDTIPOEQUIPAMENTO] = @CDTIPOEQUIPAMENTO
      `);

    res.json({ success: true, message: 'Tipo atualizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar tipo:', err);
    res.status(500).json({ error: 'Erro ao atualizar tipo.' });
  }
});

// Inativar/Reativar tipo (desativação, não exclusão física)
router.delete('/tipos-equipamento/:id', async (req, res) => {
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
      .input('CDTIPOEQUIPAMENTO', sql.SmallInt, idNumerico)
      .query(`SELECT [FGACTIVE] FROM [dbo].[TIPOEQUIPAMENTO] WHERE [CDTIPOEQUIPAMENTO] = @CDTIPOEQUIPAMENTO`);

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Tipo não encontrado.' });
    }

    const statusAtual = checkResult.recordset[0].FGACTIVE;
    const estaAtivo = statusAtual === 'A';
    
    // Determinar nova situação
    let novaSituacao, mensagem;
    if (action === 'activate') {
      novaSituacao = 'A';
      mensagem = 'Tipo de equipamento reativado com sucesso!';
    } else if (action === 'deactivate') {
      novaSituacao = 'I';
      mensagem = 'Tipo de equipamento desativado com sucesso!';
    } else {
      novaSituacao = estaAtivo ? 'I' : 'A';
      mensagem = estaAtivo ? 'Tipo de equipamento desativado com sucesso!' : 'Tipo de equipamento reativado com sucesso!';
    }

    const result = await pool
      .request()
      .input('CDTIPOEQUIPAMENTO', sql.SmallInt, idNumerico)
      .input('FGACTIVE', sql.Char(1), novaSituacao)
      .query(`
        UPDATE [dbo].[TIPOEQUIPAMENTO] 
        SET 
          [FGACTIVE] = @FGACTIVE,
          [DHMAINTENANCE] = GETDATE(),
          [SGUSER] = 'SYSTEM',
          [SERVERORIG] = 'AppDVcargas'
        WHERE [CDTIPOEQUIPAMENTO] = @CDTIPOEQUIPAMENTO
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Tipo não encontrado.' });
    }

    res.json({ success: true, message: mensagem, newStatus: novaSituacao === 'A' ? 'S' : 'N' });
  } catch (err) {
    console.error('Erro ao alterar status do tipo:', err);
    res.status(500).json({ error: 'Erro ao alterar status do tipo.' });
  }
});

// Executar init.sql
router.post('/tipos-equipamento/executar-init-sql', async (req, res) => {
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