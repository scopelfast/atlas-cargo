// backend/routes/grupo.routes.js
const express = require('express');
const router = express.Router();
const sql = require('../config/mssql-compat');
const { poolPromise, getFirstNumericValue } = require('../config/db');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');
const { tenantIdForRequest } = require('../utils/tenant-context');

router.use(towerAuthAndTenant);

// Listar grupos
router.get('/grupos', async (req, res) => {
  try {
    const tenantId = tenantIdForRequest(req);
    const { codigo, descricao, situacao } = req.query;
    const params = [tenantId];
    let next = 2;
    let where = `("TENANT_ID" = $1 OR "TENANT_ID" = 'default')`;
    if (codigo) {
      const n = parseInt(codigo, 10);
      if (!isNaN(n) && n > 0) {
        where += ` AND "CDGRUPOEQUIPAMENTO" = $${next}`;
        params.push(n);
        next++;
      }
    }
    if (descricao && String(descricao).trim()) {
      where += ` AND "DSGRUPOEQUIPAMENTO" ILIKE $${next}`;
      params.push(`%${String(descricao).trim()}%`);
      next++;
    }
    if (situacao === 'S') {
      where += ` AND ("FGACTIVE" = 'A' OR "FGACTIVE" = 'S')`;
    } else if (situacao === 'N') {
      where += ` AND ("FGACTIVE" = 'I' OR "FGACTIVE" = 'N')`;
    }

    const pool = await poolPromise;
    const result = await pool.query(
      `
      SELECT 
        "CDGRUPOEQUIPAMENTO" AS id,
        "DSGRUPOEQUIPAMENTO" AS nome,
        "FGACTIVE" AS ativo
      FROM "GRUPOEQUIPAMENTO"
      WHERE ${where}
      ORDER BY "DSGRUPOEQUIPAMENTO"
    `,
      params
    );

    const rows = result.rows || [];
    const grupos = rows.map((g) => {
      const ativo = g.ativo === 'A' || g.ativo === 'S';
      return {
        CDGRUPOEQUIPAMENTO: g.id,
        DSGRUPOEQUIPAMENTO: g.nome,
        FGACTIVE: ativo ? 'S' : 'N'
      };
    });
    res.json(grupos);
  } catch (err) {
    console.error('Erro ao listar grupos de equipamento:', err);
    res.status(500).json({ error: 'Erro ao carregar grupos de equipamento.' });
  }
});

// Buscar grupo por ID
router.get('/grupos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);
    const result = await pool.query(
      `SELECT "CDGRUPOEQUIPAMENTO", "DSGRUPOEQUIPAMENTO", "FGACTIVE"
       FROM "GRUPOEQUIPAMENTO"
       WHERE "CDGRUPOEQUIPAMENTO" = $1
         AND ("TENANT_ID" = $2 OR "TENANT_ID" = 'default')`,
      [idNum, tenantId]
    );

    const rows = result.rows || [];
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Grupo não encontrado.' });
    }

    const grupo = rows[0];
    const get = (r, k) => (r[k] != null ? r[k] : r[k && k.toLowerCase()]);
    const fg = get(grupo, 'FGACTIVE');
    const ativo = fg === 'A' || fg === 'S';
    res.json({
      CDGRUPOEQUIPAMENTO: get(grupo, 'CDGRUPOEQUIPAMENTO'),
      DSGRUPOEQUIPAMENTO: get(grupo, 'DSGRUPOEQUIPAMENTO'),
      FGACTIVE: ativo ? 'S' : 'N'
    });
  } catch (err) {
    console.error('Erro ao buscar grupo:', err);
    res.status(500).json({ error: 'Erro ao buscar grupo.' });
  }
});

// Inserir novo grupo
router.post('/grupos', async (req, res) => {
  try {
    const { DSGRUPOEQUIPAMENTO } = req.body;
    if (!DSGRUPOEQUIPAMENTO?.trim()) {
      return res.status(400).json({ error: 'Nome do grupo de equipamento é obrigatório.' });
    }

    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);
    const descricao = DSGRUPOEQUIPAMENTO.trim();
    const existente = await pool.query(
      `SELECT 1 FROM "GRUPOEQUIPAMENTO"
       WHERE UPPER(TRIM("DSGRUPOEQUIPAMENTO")) = UPPER(TRIM($1)) AND "TENANT_ID" = $2
       LIMIT 1`,
      [descricao, tenantId]
    );
    if (existente.rows && existente.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe um grupo com esta descrição. Não é permitido cadastrar duplicados.' });
    }

    const getProximoId = async () =>
      getFirstNumericValue(
        (await pool.request().query('SELECT COALESCE(MAX([CDGRUPOEQUIPAMENTO]), 0) + 1 AS [maxId] FROM [dbo].[GRUPOEQUIPAMENTO]')).recordset,
        1
      );
    let novoId = await getProximoId();

    const doInsert = async (nid) => {
      await pool
        .request()
        .input('CDGRUPOEQUIPAMENTO', sql.SmallInt, nid)
        .input('DSGRUPOEQUIPAMENTO', DSGRUPOEQUIPAMENTO.trim())
        .input('TENANT_ID', sql.VarChar(64), tenantId)
        .query(
          `INSERT INTO [dbo].[GRUPOEQUIPAMENTO] ([CDGRUPOEQUIPAMENTO], [DSGRUPOEQUIPAMENTO], [FGACTIVE], [DHMAINTENANCE], [SGUSER], [SERVERORIG], [TENANT_ID]) VALUES (@CDGRUPOEQUIPAMENTO, @DSGRUPOEQUIPAMENTO, 'A', GETDATE(), 'SYSTEM', 'AppDVcargas', @TENANT_ID)`
        );
    };

    try {
      await doInsert(novoId);
    } catch (e) {
      if (String(e.code) === '23505') {
        novoId = await getProximoId();
        await doInsert(novoId);
      } else throw e;
    }
    res.status(201).json({ success: true, message: 'Grupo de equipamento cadastrado com sucesso!' });
  } catch (err) {
    console.error('Erro ao inserir grupo:', err);
    res.status(500).json({ error: 'Erro ao cadastrar grupo.' });
  }
});

// Atualizar grupo
router.put('/grupos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { DSGRUPOEQUIPAMENTO, FGACTIVE } = req.body;

    if (!DSGRUPOEQUIPAMENTO?.trim() || !['S', 'N'].includes(FGACTIVE)) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    const existente = await pool.query(
      `SELECT 1 FROM "GRUPOEQUIPAMENTO"
       WHERE UPPER(TRIM("DSGRUPOEQUIPAMENTO")) = UPPER(TRIM($1))
         AND "CDGRUPOEQUIPAMENTO" != $2
         AND "TENANT_ID" = $3
       LIMIT 1`,
      [DSGRUPOEQUIPAMENTO.trim(), idNum, tenantId]
    );
    if (existente.rows && existente.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe outro grupo com esta descrição. Não é permitido duplicar.' });
    }
    const fgactiveDB = FGACTIVE === 'S' ? 'A' : 'I';

    const upd = await pool.query(
      `UPDATE "GRUPOEQUIPAMENTO"
       SET "DSGRUPOEQUIPAMENTO" = $1, "FGACTIVE" = $2, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM', "SERVERORIG" = 'AppDVcargas'
       WHERE "CDGRUPOEQUIPAMENTO" = $3 AND "TENANT_ID" = $4`,
      [DSGRUPOEQUIPAMENTO.trim(), fgactiveDB, idNum, tenantId]
    );

    if (!upd.rowCount) {
      return res.status(404).json({ error: 'Grupo não encontrado ou não pode ser alterado (catálogo compartilhado).' });
    }

    res.json({ success: true, message: 'Grupo de equipamento atualizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar grupo:', err);
    res.status(500).json({ error: 'Erro ao atualizar grupo.' });
  }
});

// Inativar/Reativar grupo (desativação, não exclusão física)
router.delete('/grupos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.query;

    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);

    const checkResult = await pool.query(
      `SELECT "FGACTIVE" FROM "GRUPOEQUIPAMENTO" WHERE "CDGRUPOEQUIPAMENTO" = $1 AND "TENANT_ID" = $2`,
      [idNum, tenantId]
    );

    if (!checkResult.rows || checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Grupo de equipamento não encontrado.' });
    }

    const statusAtual = checkResult.rows[0].FGACTIVE ?? checkResult.rows[0].fgactive;
    const estaAtivo = statusAtual === 'A' || statusAtual === 'S';

    let novaSituacao, mensagem;
    if (action === 'activate') {
      novaSituacao = 'A';
      mensagem = 'Grupo de equipamento reativado com sucesso!';
    } else if (action === 'deactivate') {
      novaSituacao = 'I';
      mensagem = 'Grupo de equipamento desativado com sucesso!';
    } else {
      novaSituacao = estaAtivo ? 'I' : 'A';
      mensagem = estaAtivo ? 'Grupo de equipamento desativado com sucesso!' : 'Grupo de equipamento reativado com sucesso!';
    }

    const updateResult = await pool.query(
      `UPDATE "GRUPOEQUIPAMENTO"
       SET "FGACTIVE" = $1, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM', "SERVERORIG" = 'AppDVcargas'
       WHERE "CDGRUPOEQUIPAMENTO" = $2 AND "TENANT_ID" = $3`,
      [novaSituacao, idNum, tenantId]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Grupo de equipamento não encontrado.' });
    }

    res.json({ success: true, message: mensagem, newStatus: novaSituacao === 'A' ? 'S' : 'N' });
  } catch (err) {
    console.error('Erro ao alterar status do grupo:', err);
    res.status(500).json({ error: 'Erro ao alterar status do grupo de equipamento.' });
  }
});

// Executar init.sql
router.post('/grupos/executar-init-sql', async (req, res) => {
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
    const comandos = sql.split(/\bGO\b/gi).filter((cmd) => cmd.trim().length > 0);
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
