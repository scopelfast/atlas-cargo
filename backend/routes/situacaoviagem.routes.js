// backend/routes/situacaoviagem.routes.js
const express = require('express');
const router = express.Router();
const sql = require('mssql');
const { poolPromise } = require('../config/db');

// Listar situações de viagem
router.get('/situacoes-viagem', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .query(`
        SELECT 
          CDSITUACAOVIAGEM,
          DSSITUACAOVIAGEM,
          FGACTIVE
        FROM [dbo].[SITUACAOVIAGEM]
        ORDER BY DSSITUACAOVIAGEM
      `);
    const situacoes = result.recordset.map(s => ({
      CDSITUACAOVIAGEM: s.CDSITUACAOVIAGEM,
      DSSITUACAOVIAGEM: s.DSSITUACAOVIAGEM,
      FGACTIVE: s.FGACTIVE === 'A' ? 'S' : 'N'
    }));
    res.json(situacoes);
  } catch (err) {
    console.error('Erro ao listar situações de viagem:', err);
    res.status(500).json({ error: 'Erro ao carregar situações.' });
  }
});

// Buscar situação de viagem por ID
router.get('/situacoes-viagem/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input('CDSITUACAOVIAGEM', idNum)
      .query(`
        SELECT 
          CDSITUACAOVIAGEM,
          DSSITUACAOVIAGEM,
          FGACTIVE
        FROM [dbo].[SITUACAOVIAGEM]
        WHERE CDSITUACAOVIAGEM = @CDSITUACAOVIAGEM
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Situação de viagem não encontrada.' });
    }

    const situacao = result.recordset[0];
    res.json({
      CDSITUACAOVIAGEM: situacao.CDSITUACAOVIAGEM,
      DSSITUACAOVIAGEM: situacao.DSSITUACAOVIAGEM,
      FGACTIVE: situacao.FGACTIVE === 'A' ? 'S' : 'N'
    });
  } catch (err) {
    console.error('Erro ao buscar situação de viagem:', err);
    res.status(500).json({ error: 'Erro ao buscar situação de viagem.' });
  }
});

// Inserir nova situação
router.post('/situacoes-viagem', async (req, res) => {
  try {
    const { DSSITUACAOVIAGEM } = req.body;
    if (!DSSITUACAOVIAGEM?.trim()) {
      return res.status(400).json({ error: 'Nome da situação é obrigatório.' });
    }

    const pool = await poolPromise;
    const maxResult = await pool
      .request()
      .query('SELECT ISNULL(MAX(CDSITUACAOVIAGEM), 0) AS maxId FROM [dbo].[SITUACAOVIAGEM]');
    const novoId = maxResult.recordset[0].maxId + 1;

    await pool
      .request()
      .input('CDSITUACAOVIAGEM', novoId)
      .input('DSSITUACAOVIAGEM', DSSITUACAOVIAGEM.trim())
      .query(`
        INSERT INTO [dbo].[SITUACAOVIAGEM] (CDSITUACAOVIAGEM, DSSITUACAOVIAGEM, FGACTIVE, DHMAINTENANCE, SGUSER, SERVERORIG)
        VALUES (@CDSITUACAOVIAGEM, @DSSITUACAOVIAGEM, 'A', GETDATE(), 'SYSTEM', 'AppDVcargas')
      `);

    res.status(201).json({ success: true, message: 'Situação de viagem cadastrada com sucesso!' });
  } catch (err) {
    console.error('Erro ao inserir situação:', err);
    res.status(500).json({ error: 'Erro ao cadastrar situação.' });
  }
});

// Atualizar situação
router.put('/situacoes-viagem/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { DSSITUACAOVIAGEM, FGACTIVE } = req.body;

    if (!DSSITUACAOVIAGEM?.trim() || !['S', 'N'].includes(FGACTIVE)) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    const pool = await poolPromise;
    const fgactiveDB = FGACTIVE === 'S' ? 'A' : 'I';

    await pool
      .request()
      .input('CDSITUACAOVIAGEM', id)
      .input('DSSITUACAOVIAGEM', DSSITUACAOVIAGEM.trim())
      .input('FGACTIVE', fgactiveDB)
      .query(`
        UPDATE [dbo].[SITUACAOVIAGEM] 
        SET 
          DSSITUACAOVIAGEM = @DSSITUACAOVIAGEM,
          FGACTIVE = @FGACTIVE,
          DHMAINTENANCE = GETDATE(),
          SGUSER = 'SYSTEM',
          SERVERORIG = 'AppDVcargas'
        WHERE CDSITUACAOVIAGEM = @CDSITUACAOVIAGEM
      `);

    res.json({ success: true, message: 'Situação atualizada com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar situação:', err);
    res.status(500).json({ error: 'Erro ao atualizar situação.' });
  }
});

// Inativar/Reativar situação (desativação, não exclusão física)
router.delete('/situacoes-viagem/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.query;
    
    // Validar e converter ID para número
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    
    const pool = await poolPromise;

    // Verificar status atual
    const checkResult = await pool
      .request()
      .input('CDSITUACAOVIAGEM', idNum)
      .query(`SELECT FGACTIVE FROM [dbo].[SITUACAOVIAGEM] WHERE CDSITUACAOVIAGEM = @CDSITUACAOVIAGEM`);

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Situação não encontrada.' });
    }

    const statusAtual = checkResult.recordset[0].FGACTIVE;
    const estaAtivo = statusAtual === 'A';
    
    // Determinar nova situação
    let novaSituacao, mensagem;
    if (action === 'activate') {
      novaSituacao = 'A';
      mensagem = 'Situação de viagem reativada com sucesso!';
    } else if (action === 'deactivate') {
      novaSituacao = 'I';
      mensagem = 'Situação de viagem desativada com sucesso!';
    } else {
      novaSituacao = estaAtivo ? 'I' : 'A';
      mensagem = estaAtivo ? 'Situação de viagem desativada com sucesso!' : 'Situação de viagem reativada com sucesso!';
    }

    const result = await pool
      .request()
      .input('CDSITUACAOVIAGEM', idNum)
      .input('FGACTIVE', sql.Char(1), novaSituacao)
      .query(`
        UPDATE [dbo].[SITUACAOVIAGEM] 
        SET 
          FGACTIVE = @FGACTIVE,
          DHMAINTENANCE = GETDATE(),
          SGUSER = 'SYSTEM',
          SERVERORIG = 'AppDVcargas'
        WHERE CDSITUACAOVIAGEM = @CDSITUACAOVIAGEM
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Situação não encontrada.' });
    }

    res.json({ success: true, message: mensagem, newStatus: novaSituacao === 'A' ? 'S' : 'N' });
  } catch (err) {
    console.error('Erro ao alterar status da situação:', err);
    res.status(500).json({ error: 'Erro ao alterar status da situação.' });
  }
});

// Executar init.sql
router.post('/situacoes-viagem/executar-init-sql', async (req, res) => {
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