// backend/routes/situacaoviagem.routes.js
const express = require('express');
const router = express.Router();
const sql = require('../config/mssql-compat');
const { poolPromise, getFirstNumericValue } = require('../config/db');

// Listar situações de viagem (com filtros: codigo, descricao, situacao, fg)
router.get('/situacoes-viagem', async (req, res) => {
  try {
    const { codigo, descricao, situacao, fg } = req.query;
    const pool = await poolPromise;
    const params = [];
    let n = 0;
    const $ = () => { n++; return `$${n}`; };
    let where = '';
    if (codigo != null && String(codigo).trim() !== '') { params.push(parseInt(codigo, 10)); where += ` AND "CDSITUACAOVIAGEM" = ${$()}`; }
    if (descricao != null && String(descricao).trim() !== '') { params.push('%' + String(descricao).trim() + '%'); where += ` AND "DSSITUACAOVIAGEM" ILIKE ${$()}`; }
    if (situacao === 'S' || situacao === 'N') { params.push(situacao === 'S' ? 'A' : 'I'); where += ` AND (COALESCE("FGACTIVE", 'I') = ${$()})`; }
    if (fg != null && String(fg).trim() !== '') { params.push(String(fg).trim().toUpperCase().substring(0, 1)); where += ` AND UPPER(TRIM(COALESCE("FGSITVIAGEM", ''))) = UPPER(TRIM(${$()}))`; }

    const getFgsit = (s) => { const v = s.FGSITVIAGEM ?? s.fgsitviagem; return (v != null && String(v).trim() !== '') ? String(v).trim().toUpperCase().substring(0, 1) : null; };
    const mapRow = (s) => ({
      CDSITUACAOVIAGEM: s.CDSITUACAOVIAGEM ?? s.cdsituacaoviagem,
      DSSITUACAOVIAGEM: s.DSSITUACAOVIAGEM ?? s.dssituacaoviagem,
      FGSITVIAGEM: getFgsit(s),
      FGACTIVE: (s.FGACTIVE ?? s.fgactive) === 'A' ? 'S' : 'N'
    });

    let sql = `SELECT "CDSITUACAOVIAGEM", "DSSITUACAOVIAGEM", "FGSITVIAGEM", "FGACTIVE" FROM "SITUACAOVIAGEM" WHERE 1=1${where} ORDER BY "DSSITUACAOVIAGEM"`;
    let result = await pool.query(sql, params);
    const rows = result.rows || [];
    return res.json(rows.map(mapRow));
  } catch (err) {
    if (err.code === '42703') {
      try {
        const { codigo, descricao, situacao, fg } = req.query;
        const pool = await poolPromise;
        const params = [];
        let n = 0;
        const $ = () => { n++; return `$${n}`; };
        let where = '';
        if (codigo != null && String(codigo).trim() !== '') { params.push(parseInt(codigo, 10)); where += ` AND "CDSITUACAOVIAGEM" = ${$()}`; }
        if (descricao != null && String(descricao).trim() !== '') { params.push('%' + String(descricao).trim() + '%'); where += ` AND "DSSITUACAOVIAGEM" ILIKE ${$()}`; }
        if (situacao === 'S' || situacao === 'N') { params.push(situacao === 'S' ? 'A' : 'I'); where += ` AND (COALESCE("FGACTIVE", 'I') = ${$()})`; }
        const sqlFallback = `SELECT "CDSITUACAOVIAGEM", "DSSITUACAOVIAGEM", "FGACTIVE" FROM "SITUACAOVIAGEM" WHERE 1=1${where} ORDER BY "DSSITUACAOVIAGEM"`;
        const result2 = await pool.query(sqlFallback, params);
        const rows2 = result2.rows || [];
        const mapRow2 = (s) => ({
          CDSITUACAOVIAGEM: s.CDSITUACAOVIAGEM ?? s.cdsituacaoviagem,
          DSSITUACAOVIAGEM: s.DSSITUACAOVIAGEM ?? s.dssituacaoviagem,
          FGSITVIAGEM: null,
          FGACTIVE: (s.FGACTIVE ?? s.fgactive) === 'A' ? 'S' : 'N'
        });
        return res.json(rows2.map(mapRow2));
      } catch (e2) {
        console.error('Erro ao listar situações (fallback):', e2);
      }
    }
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
          [CDSITUACAOVIAGEM],
          [DSSITUACAOVIAGEM],
          [FGSITVIAGEM],
          [FGACTIVE]
        FROM [dbo].[SITUACAOVIAGEM]
        WHERE [CDSITUACAOVIAGEM] = @CDSITUACAOVIAGEM
      `);

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Situação de viagem não encontrada.' });
    }

    const situacao = result.recordset[0];
    const fgsit = situacao.FGSITVIAGEM ?? situacao.fgsitviagem;
    res.json({
      CDSITUACAOVIAGEM: situacao.CDSITUACAOVIAGEM ?? situacao.cdsituacaoviagem,
      DSSITUACAOVIAGEM: situacao.DSSITUACAOVIAGEM ?? situacao.dssituacaoviagem,
      FGSITVIAGEM: (fgsit != null && String(fgsit).trim() !== '') ? String(fgsit).trim().toUpperCase().substring(0, 1) : null,
      FGACTIVE: (situacao.FGACTIVE ?? situacao.fgactive) === 'A' ? 'S' : 'N'
    });
  } catch (err) {
    console.error('Erro ao buscar situação de viagem:', err);
    res.status(500).json({ error: 'Erro ao buscar situação de viagem.' });
  }
});

// Inserir nova situação
router.post('/situacoes-viagem', async (req, res) => {
  try {
    const { DSSITUACAOVIAGEM, FGSITVIAGEM } = req.body;
    if (!DSSITUACAOVIAGEM?.trim()) {
      return res.status(400).json({ error: 'Nome da situação é obrigatório.' });
    }

    const pool = await poolPromise;
    const descricao = DSSITUACAOVIAGEM.trim();
    const fgsit = (FGSITVIAGEM != null && String(FGSITVIAGEM).trim() !== '') ? String(FGSITVIAGEM).trim().toUpperCase().substring(0, 1) : null;
    const existente = await pool.query(
      `SELECT 1 FROM "SITUACAOVIAGEM" WHERE UPPER(TRIM("DSSITUACAOVIAGEM")) = UPPER(TRIM($1)) LIMIT 1`,
      [descricao]
    );
    if (existente.rows && existente.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe uma situação com esta descrição. Não é permitido cadastrar duplicados.' });
    }

    const getProximoId = async () => {
      const r = await pool.query('SELECT COALESCE(MAX("CDSITUACAOVIAGEM"), 0) + 1 AS "maxId" FROM "SITUACAOVIAGEM"');
      return getFirstNumericValue(r.rows && r.rows[0] ? [r.rows[0]] : [], 1);
    };
    let novoId = await getProximoId();
    try {
      await pool.query(
        `INSERT INTO "SITUACAOVIAGEM" ("CDSITUACAOVIAGEM", "DSSITUACAOVIAGEM", "FGSITVIAGEM", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG") VALUES ($1, $2, $3, 'A', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas')`,
        [novoId, DSSITUACAOVIAGEM.trim(), fgsit]
      );
    } catch (e) {
      if (String(e.code) === '23505') {
        novoId = await getProximoId();
        await pool.query(
          `INSERT INTO "SITUACAOVIAGEM" ("CDSITUACAOVIAGEM", "DSSITUACAOVIAGEM", "FGSITVIAGEM", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG") VALUES ($1, $2, $3, 'A', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas')`,
          [novoId, DSSITUACAOVIAGEM.trim(), fgsit]
        );
      } else throw e;
    }
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
    const { DSSITUACAOVIAGEM, FGACTIVE, FGSITVIAGEM } = req.body;

    if (!DSSITUACAOVIAGEM?.trim() || !['S', 'N'].includes(FGACTIVE)) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    const pool = await poolPromise;
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    const existente = await pool.query(
      `SELECT 1 FROM "SITUACAOVIAGEM" WHERE UPPER(TRIM("DSSITUACAOVIAGEM")) = UPPER(TRIM($1)) AND "CDSITUACAOVIAGEM" != $2 LIMIT 1`,
      [DSSITUACAOVIAGEM.trim(), idNum]
    );
    if (existente.rows && existente.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe outra situação com esta descrição. Não é permitido duplicar.' });
    }
    const fgactiveDB = FGACTIVE === 'S' ? 'A' : 'I';
    const fgsit = (FGSITVIAGEM != null && String(FGSITVIAGEM).trim() !== '') ? String(FGSITVIAGEM).trim().toUpperCase().substring(0, 1) : null;

    await pool.query(
      `UPDATE "SITUACAOVIAGEM" SET "DSSITUACAOVIAGEM" = $1, "FGSITVIAGEM" = $2, "FGACTIVE" = $3, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM', "SERVERORIG" = 'AppDVcargas' WHERE "CDSITUACAOVIAGEM" = $4`,
      [DSSITUACAOVIAGEM.trim(), fgsit, fgactiveDB, idNum]
    );

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
      .query(`SELECT [FGACTIVE] FROM [dbo].[SITUACAOVIAGEM] WHERE [CDSITUACAOVIAGEM] = @CDSITUACAOVIAGEM`);

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
          [FGACTIVE] = @FGACTIVE,
          [DHMAINTENANCE] = GETDATE(),
          [SGUSER] = 'SYSTEM',
          [SERVERORIG] = 'AppDVcargas'
        WHERE [CDSITUACAOVIAGEM] = @CDSITUACAOVIAGEM
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