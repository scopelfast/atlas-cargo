// backend/routes/classesfrota.routes.js
const express = require('express');
const sql = require('mssql');
const router = express.Router();
const { poolPromise } = require('../config/db');

// Listar classes de frota com filtros
router.get('/classes-frota', async (req, res) => {
  try {
    const { codigo, descricao, situacao } = req.query;
    let query = `
      SELECT 
        CDCLASSEFROTA,
        DSCLASSEFROTA,
        NREIXOS,
        CAPACIDCARGA,
        FGACTIVE
      FROM [dbo].[CLASSEFROTA]
      WHERE 1=1
    `;

    const params = [];
    if (codigo) {
      query += ` AND CDCLASSEFROTA = @CODIGO`;
      params.push({ name: 'CODIGO', value: parseInt(codigo) });
    }
    if (descricao) {
      query += ` AND DSCLASSEFROTA LIKE @DESCRICAO`;
      params.push({ name: 'DESCRICAO', value: `%${descricao}%` });
    }
    if (situacao) {
      query += ` AND FGACTIVE = @SITUACAO`;
      params.push({ name: 'SITUACAO', value: situacao === 'S' ? 'A' : 'I' });
    }

    query += ` ORDER BY DSCLASSEFROTA`;

    const pool = await poolPromise;
    const request = pool.request();
    params.forEach(p => request.input(p.name, p.value));
    
    const result = await request.query(query);
    const classes = result.recordset.map(c => ({
      CDCLASSEFROTA: c.CDCLASSEFROTA,
      DSCLASSEFROTA: c.DSCLASSEFROTA,
      NREIXOS: c.NREIXOS,
      CAPACIDCARGA: c.CAPACIDCARGA,
      FGACTIVE: c.FGACTIVE === 'A' ? 'S' : 'N'
    }));
    
    res.json(classes);
  } catch (err) {
    console.error('Erro ao listar classes de frota:', err);
    res.status(500).json({ error: 'Erro ao carregar classes.' });
  }
});

// Buscar classe de frota por ID
router.get('/classes-frota/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('CDCLASSEFROTA', idNum)
      .query(`
        SELECT 
          CDCLASSEFROTA,
          DSCLASSEFROTA,
          NREIXOS,
          CAPACIDCARGA,
          FGACTIVE
        FROM [dbo].[CLASSEFROTA]
        WHERE CDCLASSEFROTA = @CDCLASSEFROTA
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Classe de frota não encontrada.' });
    }

    const classe = result.recordset[0];
    res.json({
      CDCLASSEFROTA: classe.CDCLASSEFROTA,
      DSCLASSEFROTA: classe.DSCLASSEFROTA,
      NREIXOS: classe.NREIXOS,
      CAPACIDCARGA: classe.CAPACIDCARGA,
      FGACTIVE: classe.FGACTIVE === 'A' ? 'S' : 'N'
    });
  } catch (err) {
    console.error('Erro ao buscar classe de frota:', err);
    res.status(500).json({ error: 'Erro ao buscar classe de frota.' });
  }
});

// Inserir nova classe
router.post('/classes-frota', async (req, res) => {
  try {
    const { DSCLASSEFROTA, NREIXOS, CAPACIDCARGA } = req.body;
    if (!DSCLASSEFROTA?.trim()) {
      return res.status(400).json({ error: 'Descrição é obrigatória.' });
    }
    if (!NREIXOS || NREIXOS < 2 || NREIXOS > 9) {
      return res.status(400).json({ error: 'Número de eixos deve ser entre 2 e 9.' });
    }

    const pool = await poolPromise;
    const maxResult = await pool
      .request()
      .query('SELECT ISNULL(MAX(CDCLASSEFROTA), 0) AS maxId FROM [dbo].[CLASSEFROTA]');
    const novoId = maxResult.recordset[0].maxId + 1;

    await pool
      .request()
      .input('CDCLASSEFROTA', sql.SmallInt, novoId)
      .input('DSCLASSEFROTA', DSCLASSEFROTA.trim())
      .input('NREIXOS', sql.SmallInt, NREIXOS)
      .input('CAPACIDCARGA', CAPACIDCARGA ? parseFloat(CAPACIDCARGA) : null)
      .query(`
        INSERT INTO [dbo].[CLASSEFROTA] (
          CDCLASSEFROTA, DSCLASSEFROTA, NREIXOS, CAPACIDCARGA, 
          FGACTIVE, DHMAINTENANCE, SGUSER, SERVERORIG
        )
        VALUES (@CDCLASSEFROTA, @DSCLASSEFROTA, @NREIXOS, @CAPACIDCARGA, 'A', GETDATE(), 'SYSTEM', 'AppDVcargas')
      `);

    res.status(201).json({ success: true, message: 'Classe de frota cadastrada com sucesso!' });
  } catch (err) {
    console.error('Erro ao inserir classe:', err);
    res.status(500).json({ error: 'Erro ao cadastrar classe.' });
  }
});

// Atualizar classe
router.put('/classes-frota/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { DSCLASSEFROTA, NREIXOS, CAPACIDCARGA, FGACTIVE } = req.body;

    if (!DSCLASSEFROTA?.trim() || !['S', 'N'].includes(FGACTIVE) || !NREIXOS || NREIXOS < 2 || NREIXOS > 9) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    const pool = await poolPromise;
    const fgactiveDB = FGACTIVE === 'S' ? 'A' : 'I';
    const idNumerico = parseInt(id);

    await pool
      .request()
      .input('CDCLASSEFROTA', sql.SmallInt, idNumerico)
      .input('DSCLASSEFROTA', DSCLASSEFROTA.trim())
      .input('NREIXOS', sql.SmallInt, NREIXOS)
      .input('CAPACIDCARGA', CAPACIDCARGA ? parseFloat(CAPACIDCARGA) : null)
      .input('FGACTIVE', fgactiveDB)
      .query(`
        UPDATE [dbo].[CLASSEFROTA] 
        SET 
          DSCLASSEFROTA = @DSCLASSEFROTA,
          NREIXOS = @NREIXOS,
          CAPACIDCARGA = @CAPACIDCARGA,
          FGACTIVE = @FGACTIVE,
          DHMAINTENANCE = GETDATE(),
          SGUSER = 'SYSTEM',
          SERVERORIG = 'AppDVcargas'
        WHERE CDCLASSEFROTA = @CDCLASSEFROTA
      `);

    res.json({ success: true, message: 'Classe atualizada com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar classe:', err);
    res.status(500).json({ error: 'Erro ao atualizar classe.' });
  }
});

// Inativar/Reativar classe (desativação, não exclusão física)
router.delete('/classes-frota/:id', async (req, res) => {
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
      .input('CDCLASSEFROTA', sql.SmallInt, idNumerico)
      .query(`SELECT FGACTIVE FROM [dbo].[CLASSEFROTA] WHERE CDCLASSEFROTA = @CDCLASSEFROTA`);

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Classe não encontrada.' });
    }

    const statusAtual = checkResult.recordset[0].FGACTIVE;
    const estaAtivo = statusAtual === 'A';
    
    // Determinar nova situação
    let novaSituacao, mensagem;
    if (action === 'activate') {
      novaSituacao = 'A';
      mensagem = 'Classe de frota reativada com sucesso!';
    } else if (action === 'deactivate') {
      novaSituacao = 'I';
      mensagem = 'Classe de frota desativada com sucesso!';
    } else {
      novaSituacao = estaAtivo ? 'I' : 'A';
      mensagem = estaAtivo ? 'Classe de frota desativada com sucesso!' : 'Classe de frota reativada com sucesso!';
    }

    const result = await pool
      .request()
      .input('CDCLASSEFROTA', sql.SmallInt, idNumerico)
      .input('FGACTIVE', sql.Char(1), novaSituacao)
      .query(`
        UPDATE [dbo].[CLASSEFROTA] 
        SET 
          FGACTIVE = @FGACTIVE,
          DHMAINTENANCE = GETDATE(),
          SGUSER = 'SYSTEM',
          SERVERORIG = 'AppDVcargas'
        WHERE CDCLASSEFROTA = @CDCLASSEFROTA
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Classe não encontrada.' });
    }

    res.json({ success: true, message: mensagem, newStatus: novaSituacao === 'A' ? 'S' : 'N' });
  } catch (err) {
    console.error('Erro ao alterar status da classe:', err);
    res.status(500).json({ error: 'Erro ao alterar status da classe.' });
  }
});

// Executar init.sql
router.post('/classes-frota/executar-init-sql', async (req, res) => {
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