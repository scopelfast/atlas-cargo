// backend/routes/classefrota.routes.js
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

// Listar classes de frota com filtros
router.get('/classes-frota', async (req, res) => {
  try {
    const tenantId = tenantIdForRequest(req);
    const { codigo, descricao, situacao } = req.query;
    const params = [tenantId];
    let next = 2;
    let where = `("TENANT_ID" = $1 OR "TENANT_ID" = 'default')`;
    if (codigo) {
      const n = parseInt(codigo, 10);
      if (!isNaN(n) && n > 0) {
        where += ` AND "CDCLASSEFROTA" = $${next}`;
        params.push(n);
        next++;
      }
    }
    if (descricao && String(descricao).trim()) {
      where += ` AND "DSCLASSEFROTA" ILIKE $${next}`;
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
        "CDCLASSEFROTA",
        "DSCLASSEFROTA",
        "NREIXOS",
        "CAPACIDCARGA",
        "FGACTIVE"
      FROM "CLASSEFROTA"
      WHERE ${where}
      ORDER BY "DSCLASSEFROTA"
    `,
      params
    );

    const rows = result.rows || [];
    const classes = rows.map((c) => {
      const fg = rowGet(c, 'FGACTIVE');
      const ativo = fg === 'A' || fg === 'S';
      return {
        CDCLASSEFROTA: rowGet(c, 'CDCLASSEFROTA'),
        DSCLASSEFROTA: rowGet(c, 'DSCLASSEFROTA'),
        NREIXOS: rowGet(c, 'NREIXOS'),
        CAPACIDCARGA: rowGet(c, 'CAPACIDCARGA'),
        FGACTIVE: ativo ? 'S' : 'N'
      };
    });

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
    const tenantId = tenantIdForRequest(req);
    const result = await pool.query(
      `SELECT "CDCLASSEFROTA", "DSCLASSEFROTA", "NREIXOS", "CAPACIDCARGA", "FGACTIVE"
       FROM "CLASSEFROTA"
       WHERE "CDCLASSEFROTA" = $1
         AND ("TENANT_ID" = $2 OR "TENANT_ID" = 'default')`,
      [idNum, tenantId]
    );

    const rows = result.rows || [];
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Classe de frota não encontrada.' });
    }

    const classe = rows[0];
    const fg = rowGet(classe, 'FGACTIVE');
    const ativo = fg === 'A' || fg === 'S';
    res.json({
      CDCLASSEFROTA: rowGet(classe, 'CDCLASSEFROTA'),
      DSCLASSEFROTA: rowGet(classe, 'DSCLASSEFROTA'),
      NREIXOS: rowGet(classe, 'NREIXOS'),
      CAPACIDCARGA: rowGet(classe, 'CAPACIDCARGA'),
      FGACTIVE: ativo ? 'S' : 'N'
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
    const tenantId = tenantIdForRequest(req);
    const descricao = DSCLASSEFROTA.trim();
    const existente = await pool.query(
      `SELECT 1 FROM "CLASSEFROTA"
       WHERE UPPER(TRIM("DSCLASSEFROTA")) = UPPER(TRIM($1)) AND "TENANT_ID" = $2
       LIMIT 1`,
      [descricao, tenantId]
    );
    if (existente.rows && existente.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe uma classe de frota com esta descrição. Não é permitido cadastrar duplicados.' });
    }

    const getProximoId = async () =>
      getFirstNumericValue(
        (await pool.request().query('SELECT COALESCE(MAX([CDCLASSEFROTA]), 0) + 1 AS [maxId] FROM [dbo].[CLASSEFROTA]')).recordset,
        1
      );
    let novoId = await getProximoId();

    const doInsert = async (id) => {
      await pool
        .request()
        .input('CDCLASSEFROTA', sql.SmallInt, id)
        .input('DSCLASSEFROTA', DSCLASSEFROTA.trim())
        .input('NREIXOS', sql.SmallInt, NREIXOS)
        .input('CAPACIDCARGA', CAPACIDCARGA ? parseFloat(CAPACIDCARGA) : null)
        .input('TENANT_ID', sql.VarChar(64), tenantId)
        .query(
          `INSERT INTO [dbo].[CLASSEFROTA] ([CDCLASSEFROTA], [DSCLASSEFROTA], [NREIXOS], [CAPACIDCARGA], [FGACTIVE], [DHMAINTENANCE], [SGUSER], [SERVERORIG], [TENANT_ID]) VALUES (@CDCLASSEFROTA, @DSCLASSEFROTA, @NREIXOS, @CAPACIDCARGA, 'A', GETDATE(), 'SYSTEM', 'AppDVcargas', @TENANT_ID)`
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
    const tenantId = tenantIdForRequest(req);
    const idNumerico = parseInt(id, 10);
    if (isNaN(idNumerico) || idNumerico <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    const existente = await pool.query(
      `SELECT 1 FROM "CLASSEFROTA"
       WHERE UPPER(TRIM("DSCLASSEFROTA")) = UPPER(TRIM($1))
         AND "CDCLASSEFROTA" != $2
         AND "TENANT_ID" = $3
       LIMIT 1`,
      [DSCLASSEFROTA.trim(), idNumerico, tenantId]
    );
    if (existente.rows && existente.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe outra classe de frota com esta descrição. Não é permitido duplicar.' });
    }
    const fgactiveDB = FGACTIVE === 'S' ? 'A' : 'I';
    const nEixos = parseInt(NREIXOS, 10);

    const upd = await pool.query(
      `UPDATE "CLASSEFROTA"
       SET "DSCLASSEFROTA" = $1, "NREIXOS" = $2, "CAPACIDCARGA" = $3, "FGACTIVE" = $4,
           "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM', "SERVERORIG" = 'AppDVcargas'
       WHERE "CDCLASSEFROTA" = $5 AND "TENANT_ID" = $6`,
      [DSCLASSEFROTA.trim(), nEixos, CAPACIDCARGA ? parseFloat(CAPACIDCARGA) : null, fgactiveDB, idNumerico, tenantId]
    );

    if (!upd.rowCount) {
      return res.status(404).json({ error: 'Classe de frota não encontrada ou não pode ser alterada (catálogo compartilhado).' });
    }

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

    const idNumerico = parseInt(id, 10);
    if (isNaN(idNumerico) || idNumerico <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }

    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);

    const checkResult = await pool.query(
      `SELECT "FGACTIVE" FROM "CLASSEFROTA" WHERE "CDCLASSEFROTA" = $1 AND "TENANT_ID" = $2`,
      [idNumerico, tenantId]
    );

    if (!checkResult.rows || checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Classe não encontrada.' });
    }

    const statusAtual = rowGet(checkResult.rows[0], 'FGACTIVE');
    const estaAtivo = statusAtual === 'A' || statusAtual === 'S';

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

    const updateResult = await pool.query(
      `UPDATE "CLASSEFROTA"
       SET "FGACTIVE" = $1, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM', "SERVERORIG" = 'AppDVcargas'
       WHERE "CDCLASSEFROTA" = $2 AND "TENANT_ID" = $3`,
      [novaSituacao, idNumerico, tenantId]
    );

    if (updateResult.rowCount === 0) {
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
