// backend/routes/tipoviagem.routes.js
const express = require('express');
const sql = require('../config/mssql-compat');
const router = express.Router();
const { poolPromise, getFirstNumericValue } = require('../config/db');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');
const { tenantIdForRequest } = require('../utils/tenant-context');

router.use(towerAuthAndTenant);

function rowGet(row, key) {
  if (!row) return undefined;
  if (row[key] !== undefined && row[key] !== null) return row[key];
  const lower = key.toLowerCase();
  if (row[lower] !== undefined && row[lower] !== null) return row[lower];
  return undefined;
}

function mapFgActiveDbToSn(fg) {
  const v = fg != null ? String(fg).trim().toUpperCase() : '';
  return v === 'A' || v === 'S' || v === 'T' ? 'S' : 'N';
}

// Listar tipos de viagem com filtros
router.get('/tipos-viagem', async (req, res) => {
  try {
    const tenantId = tenantIdForRequest(req);
    const { codigo, descricao, situacao } = req.query;
    const params = [tenantId];
    let next = 2;
    let where = `("TENANT_ID" = $1 OR "TENANT_ID" = 'default')`;
    if (codigo) {
      const n = parseInt(codigo, 10);
      if (!isNaN(n) && n > 0) {
        where += ` AND "CDTIPOVIAGEM" = $${next}`;
        params.push(n);
        next++;
      }
    }
    if (descricao && String(descricao).trim()) {
      where += ` AND "DSTIPOVIAGEM" ILIKE $${next}`;
      params.push(`%${String(descricao).trim()}%`);
      next++;
    }
    if (situacao === 'S') {
      where += ` AND ("FGACTIVE" = 'A' OR "FGACTIVE" = 'S' OR "FGACTIVE" = 'T')`;
    } else if (situacao === 'N') {
      where += ` AND ("FGACTIVE" = 'I' OR "FGACTIVE" = 'N')`;
    }

    const pool = await poolPromise;
    const result = await pool.query(
      `SELECT "CDTIPOVIAGEM", "DSTIPOVIAGEM", "FGACTIVE" FROM "TIPOVIAGEM" WHERE ${where} ORDER BY "DSTIPOVIAGEM"`,
      params
    );
    const rows = result.rows || [];
    const tipos = rows.map((t) => ({
      CDTIPOVIAGEM: rowGet(t, 'CDTIPOVIAGEM'),
      DSTIPOVIAGEM: rowGet(t, 'DSTIPOVIAGEM'),
      FGACTIVE: mapFgActiveDbToSn(rowGet(t, 'FGACTIVE'))
    }));
    res.json(tipos);
  } catch (err) {
    console.error('Erro ao listar tipos de viagem:', err);
    res.status(500).json({ error: 'Erro ao carregar tipos.' });
  }
});

router.get('/tipos-viagem/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);
    const result = await pool.query(
      `SELECT "CDTIPOVIAGEM", "DSTIPOVIAGEM", "FGACTIVE" FROM "TIPOVIAGEM"
       WHERE "CDTIPOVIAGEM" = $1 AND ("TENANT_ID" = $2 OR "TENANT_ID" = 'default')`,
      [idNum, tenantId]
    );
    const rows = result.rows || [];
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Tipo de viagem não encontrado.' });
    }
    const tipo = rows[0];
    res.json({
      CDTIPOVIAGEM: rowGet(tipo, 'CDTIPOVIAGEM'),
      DSTIPOVIAGEM: rowGet(tipo, 'DSTIPOVIAGEM'),
      FGACTIVE: mapFgActiveDbToSn(rowGet(tipo, 'FGACTIVE'))
    });
  } catch (err) {
    console.error('Erro ao buscar tipo de viagem:', err);
    res.status(500).json({ error: 'Erro ao buscar tipo de viagem.' });
  }
});

router.post('/tipos-viagem', async (req, res) => {
  try {
    const { DSTIPOVIAGEM } = req.body;
    if (!DSTIPOVIAGEM?.trim()) {
      return res.status(400).json({ error: 'Descrição é obrigatória.' });
    }
    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);
    const descricao = DSTIPOVIAGEM.trim();
    const existente = await pool.query(
      `SELECT 1 FROM "TIPOVIAGEM" WHERE UPPER(TRIM("DSTIPOVIAGEM")) = UPPER(TRIM($1)) AND "TENANT_ID" = $2 LIMIT 1`,
      [descricao, tenantId]
    );
    if (existente.rows && existente.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe um tipo de viagem com esta descrição. Não é permitido cadastrar duplicados.' });
    }

    const getProximoId = async () => {
      const maxResult = await pool.request().query('SELECT COALESCE(MAX([CDTIPOVIAGEM]), 0) + 1 AS [maxId] FROM [dbo].[TIPOVIAGEM]');
      return getFirstNumericValue(maxResult.recordset, 1);
    };
    let novoId = await getProximoId();
    const doInsert = async (nid) => {
      await pool
        .request()
        .input('CDTIPOVIAGEM', sql.Int, nid)
        .input('DSTIPOVIAGEM', descricao)
        .input('TENANT_ID', sql.VarChar(64), tenantId)
        .query(
          `INSERT INTO [dbo].[TIPOVIAGEM] ([CDTIPOVIAGEM], [DSTIPOVIAGEM], [FGACTIVE], [DHMAINTENANCE], [SGUSER], [SERVERORIG], [TENANT_ID]) VALUES (@CDTIPOVIAGEM, @DSTIPOVIAGEM, 'A', GETDATE(), 'SYSTEM', 'AppDVcargas', @TENANT_ID)`
        );
    };
    try {
      await doInsert(novoId);
    } catch (insertErr) {
      if (String(insertErr.code) === '23505') {
        novoId = await getProximoId();
        await doInsert(novoId);
      } else throw insertErr;
    }
    res.status(201).json({ success: true, message: 'Tipo de viagem cadastrado com sucesso!' });
  } catch (err) {
    console.error('Erro ao inserir tipo de viagem:', err);
    res.status(500).json({ error: 'Erro ao cadastrar tipo.' });
  }
});

router.put('/tipos-viagem/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { DSTIPOVIAGEM, FGACTIVE } = req.body;
    if (!DSTIPOVIAGEM?.trim() || !['S', 'N'].includes(FGACTIVE)) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }
    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);
    const idNumerico = parseInt(id, 10);
    if (isNaN(idNumerico) || idNumerico <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    const existente = await pool.query(
      `SELECT 1 FROM "TIPOVIAGEM"
       WHERE UPPER(TRIM("DSTIPOVIAGEM")) = UPPER(TRIM($1)) AND "CDTIPOVIAGEM" != $2 AND "TENANT_ID" = $3 LIMIT 1`,
      [DSTIPOVIAGEM.trim(), idNumerico, tenantId]
    );
    if (existente.rows && existente.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe outro tipo de viagem com esta descrição. Não é permitido duplicar.' });
    }
    const fgactiveDB = FGACTIVE === 'S' ? 'A' : 'I';
    const upd = await pool.query(
      `UPDATE "TIPOVIAGEM"
       SET "DSTIPOVIAGEM" = $1, "FGACTIVE" = $2, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM', "SERVERORIG" = 'AppDVcargas'
       WHERE "CDTIPOVIAGEM" = $3 AND "TENANT_ID" = $4`,
      [DSTIPOVIAGEM.trim(), fgactiveDB, idNumerico, tenantId]
    );
    if (!upd.rowCount) {
      return res.status(404).json({ error: 'Tipo de viagem não encontrado ou não pode ser alterado (catálogo compartilhado).' });
    }
    res.json({ success: true, message: 'Tipo de viagem atualizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar tipo de viagem:', err);
    res.status(500).json({ error: 'Erro ao atualizar tipo.' });
  }
});

router.delete('/tipos-viagem/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.query;
    const idNumerico = parseInt(id, 10);
    if (isNaN(idNumerico) || idNumerico <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);
    const checkResult = await pool.query(
      `SELECT "FGACTIVE" FROM "TIPOVIAGEM" WHERE "CDTIPOVIAGEM" = $1 AND "TENANT_ID" = $2`,
      [idNumerico, tenantId]
    );
    if (!checkResult.rows || checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tipo não encontrado.' });
    }
    const statusAtual = rowGet(checkResult.rows[0], 'FGACTIVE');
    const estaAtivo = statusAtual === 'A' || statusAtual === 'S' || statusAtual === 'T';
    let novaSituacao, mensagem;
    if (action === 'activate') {
      novaSituacao = 'A';
      mensagem = 'Tipo de viagem reativado com sucesso!';
    } else if (action === 'deactivate') {
      novaSituacao = 'I';
      mensagem = 'Tipo de viagem desativado com sucesso!';
    } else {
      novaSituacao = estaAtivo ? 'I' : 'A';
      mensagem = estaAtivo ? 'Tipo de viagem desativado com sucesso!' : 'Tipo de viagem reativado com sucesso!';
    }
    const updateResult = await pool.query(
      `UPDATE "TIPOVIAGEM" SET "FGACTIVE" = $1, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM', "SERVERORIG" = 'AppDVcargas'
       WHERE "CDTIPOVIAGEM" = $2 AND "TENANT_ID" = $3`,
      [novaSituacao, idNumerico, tenantId]
    );
    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Tipo não encontrado.' });
    }
    res.json({ success: true, message: mensagem, newStatus: novaSituacao === 'A' ? 'S' : 'N' });
  } catch (err) {
    console.error('Erro ao alterar status do tipo de viagem:', err);
    res.status(500).json({ error: 'Erro ao alterar status do tipo.' });
  }
});

router.post('/tipos-viagem/executar-init-sql', async (req, res) => {
  try {
    const { sql: sqlBody } = req.body;
    if (!sqlBody || typeof sqlBody !== 'string') {
      return res.status(400).json({ error: 'SQL é obrigatório.' });
    }
    const sqlUpper = sqlBody.trim().toUpperCase();
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
    const comandos = sqlBody.split(/\bGO\b/gi).filter((c) => c.trim().length > 0);
    const resultados = [];
    for (const comando of comandos) {
      const cmdLimpo = comando.trim();
      if (!cmdLimpo) continue;
      try {
        const request = pool.request();
        request.timeout = 120000;
        const result = await request.query(cmdLimpo);
        if (result.recordset && result.recordset.length > 0) {
          const rows = result.recordset.map((row) => {
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
