// backend/routes/situacaoviagem.routes.js
const express = require('express');
const router = express.Router();
const { poolPromise, getFirstNumericValue } = require('../config/db');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');
const { tenantIdForRequest } = require('../utils/tenant-context');

router.use(towerAuthAndTenant);

function getFgsit(s) {
  const v = s.FGSITVIAGEM ?? s.fgsitviagem;
  return v != null && String(v).trim() !== '' ? String(v).trim().toUpperCase().substring(0, 1) : null;
}

function mapRow(s) {
  const fg = s.FGACTIVE ?? s.fgactive;
  const ativo = fg === 'A' || fg === 'S' || fg === 'T';
  return {
    CDSITUACAOVIAGEM: s.CDSITUACAOVIAGEM ?? s.cdsituacaoviagem,
    DSSITUACAOVIAGEM: s.DSSITUACAOVIAGEM ?? s.dssituacaoviagem,
    FGSITVIAGEM: getFgsit(s),
    FGACTIVE: ativo ? 'S' : 'N'
  };
}

function mapRowSemFg(s) {
  const fg = s.FGACTIVE ?? s.fgactive;
  const ativo = fg === 'A' || fg === 'S' || fg === 'T';
  return {
    CDSITUACAOVIAGEM: s.CDSITUACAOVIAGEM ?? s.cdsituacaoviagem,
    DSSITUACAOVIAGEM: s.DSSITUACAOVIAGEM ?? s.dssituacaoviagem,
    FGSITVIAGEM: null,
    FGACTIVE: ativo ? 'S' : 'N'
  };
}

// Listar situações de viagem (com filtros: codigo, descricao, situacao, fg)
router.get('/situacoes-viagem', async (req, res) => {
  try {
    const tenantId = tenantIdForRequest(req);
    const { codigo, descricao, situacao, fg } = req.query;
    const params = [tenantId];
    let next = 2;
    let extra = '';
    if (codigo != null && String(codigo).trim() !== '') {
      extra += ` AND "CDSITUACAOVIAGEM" = $${next}`;
      params.push(parseInt(codigo, 10));
      next++;
    }
    if (descricao != null && String(descricao).trim() !== '') {
      extra += ` AND "DSSITUACAOVIAGEM" ILIKE $${next}`;
      params.push(`%${String(descricao).trim()}%`);
      next++;
    }
    if (situacao === 'S') {
      extra += ` AND ("FGACTIVE" = 'A' OR "FGACTIVE" = 'S' OR "FGACTIVE" = 'T')`;
    } else if (situacao === 'N') {
      extra += ` AND ("FGACTIVE" = 'I' OR "FGACTIVE" = 'N')`;
    }
    if (fg != null && String(fg).trim() !== '') {
      extra += ` AND UPPER(TRIM(COALESCE("FGSITVIAGEM", ''))) = UPPER(TRIM($${next}))`;
      params.push(String(fg).trim().toUpperCase().substring(0, 1));
      next++;
    }

    const pool = await poolPromise;
    const q = `SELECT "CDSITUACAOVIAGEM", "DSSITUACAOVIAGEM", "FGSITVIAGEM", "FGACTIVE" FROM "SITUACAOVIAGEM" WHERE ("TENANT_ID" = $1 OR "TENANT_ID" = 'default')${extra} ORDER BY "DSSITUACAOVIAGEM"`;
    let result = await pool.query(q, params);
    const rows = result.rows || [];
    return res.json(rows.map(mapRow));
  } catch (err) {
    if (err.code === '42703') {
      try {
        const tenantId = tenantIdForRequest(req);
        const { codigo, descricao, situacao, fg } = req.query;
        const params = [tenantId];
        let next = 2;
        let extra = '';
        if (codigo != null && String(codigo).trim() !== '') {
          extra += ` AND "CDSITUACAOVIAGEM" = $${next}`;
          params.push(parseInt(codigo, 10));
          next++;
        }
        if (descricao != null && String(descricao).trim() !== '') {
          extra += ` AND "DSSITUACAOVIAGEM" ILIKE $${next}`;
          params.push(`%${String(descricao).trim()}%`);
          next++;
        }
        if (situacao === 'S') {
          extra += ` AND ("FGACTIVE" = 'A' OR "FGACTIVE" = 'S' OR "FGACTIVE" = 'T')`;
        } else if (situacao === 'N') {
          extra += ` AND ("FGACTIVE" = 'I' OR "FGACTIVE" = 'N')`;
        }
        const pool = await poolPromise;
        const sqlFallback = `SELECT "CDSITUACAOVIAGEM", "DSSITUACAOVIAGEM", "FGACTIVE" FROM "SITUACAOVIAGEM" WHERE ("TENANT_ID" = $1 OR "TENANT_ID" = 'default')${extra} ORDER BY "DSSITUACAOVIAGEM"`;
        const result2 = await pool.query(sqlFallback, params);
        const rows2 = result2.rows || [];
        return res.json(rows2.map(mapRowSemFg));
      } catch (e2) {
        console.error('Erro ao listar situações (fallback):', e2);
      }
    }
    console.error('Erro ao listar situações de viagem:', err);
    res.status(500).json({ error: 'Erro ao carregar situações.' });
  }
});

router.get('/situacoes-viagem/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);
    const result = await pool.query(
      `SELECT "CDSITUACAOVIAGEM", "DSSITUACAOVIAGEM", "FGSITVIAGEM", "FGACTIVE"
       FROM "SITUACAOVIAGEM"
       WHERE "CDSITUACAOVIAGEM" = $1 AND ("TENANT_ID" = $2 OR "TENANT_ID" = 'default')`,
      [idNum, tenantId]
    );
    const rows = result.rows || [];
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Situação de viagem não encontrada.' });
    }
    return res.json(mapRow(rows[0]));
  } catch (err) {
    if (err.code === '42703') {
      try {
        const pool = await poolPromise;
        const tenantId = tenantIdForRequest(req);
        const idNum = parseInt(req.params.id, 10);
        const result = await pool.query(
          `SELECT "CDSITUACAOVIAGEM", "DSSITUACAOVIAGEM", "FGACTIVE"
           FROM "SITUACAOVIAGEM"
           WHERE "CDSITUACAOVIAGEM" = $1 AND ("TENANT_ID" = $2 OR "TENANT_ID" = 'default')`,
          [idNum, tenantId]
        );
        const rows = result.rows || [];
        if (rows.length === 0) {
          return res.status(404).json({ error: 'Situação de viagem não encontrada.' });
        }
        return res.json(mapRowSemFg(rows[0]));
      } catch (e2) {
        console.error('Erro ao buscar situação (fallback):', e2);
      }
    }
    console.error('Erro ao buscar situação de viagem:', err);
    res.status(500).json({ error: 'Erro ao buscar situação de viagem.' });
  }
});

router.post('/situacoes-viagem', async (req, res) => {
  try {
    const { DSSITUACAOVIAGEM, FGSITVIAGEM } = req.body;
    if (!DSSITUACAOVIAGEM?.trim()) {
      return res.status(400).json({ error: 'Nome da situação é obrigatório.' });
    }
    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);
    const descricao = DSSITUACAOVIAGEM.trim();
    const fgsit = FGSITVIAGEM != null && String(FGSITVIAGEM).trim() !== '' ? String(FGSITVIAGEM).trim().toUpperCase().substring(0, 1) : null;
    const existente = await pool.query(
      `SELECT 1 FROM "SITUACAOVIAGEM" WHERE UPPER(TRIM("DSSITUACAOVIAGEM")) = UPPER(TRIM($1)) AND "TENANT_ID" = $2 LIMIT 1`,
      [descricao, tenantId]
    );
    if (existente.rows && existente.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe uma situação com esta descrição. Não é permitido cadastrar duplicados.' });
    }
    const getProximoId = async () => {
      const r = await pool.query('SELECT COALESCE(MAX("CDSITUACAOVIAGEM"), 0) + 1 AS "maxId" FROM "SITUACAOVIAGEM"');
      return getFirstNumericValue(r.rows && r.rows[0] ? [r.rows[0]] : [], 1);
    };
    let novoId = await getProximoId();
    const insertComFg = async (nid) =>
      pool.query(
        `INSERT INTO "SITUACAOVIAGEM" ("CDSITUACAOVIAGEM", "DSSITUACAOVIAGEM", "FGSITVIAGEM", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG", "TENANT_ID")
         VALUES ($1, $2, $3, 'A', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', $4)`,
        [nid, descricao, fgsit, tenantId]
      );
    const insertSemFg = async (nid) =>
      pool.query(
        `INSERT INTO "SITUACAOVIAGEM" ("CDSITUACAOVIAGEM", "DSSITUACAOVIAGEM", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG", "TENANT_ID")
         VALUES ($1, $2, 'A', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', $3)`,
        [nid, descricao, tenantId]
      );
    try {
      await insertComFg(novoId);
    } catch (e) {
      if (e.code === '42703') {
        await insertSemFg(novoId);
      } else if (String(e.code) === '23505') {
        novoId = await getProximoId();
        try {
          await insertComFg(novoId);
        } catch (e2) {
          if (e2.code === '42703') await insertSemFg(novoId);
          else throw e2;
        }
      } else throw e;
    }
    res.status(201).json({ success: true, message: 'Situação de viagem cadastrada com sucesso!' });
  } catch (err) {
    console.error('Erro ao inserir situação:', err);
    res.status(500).json({ error: 'Erro ao cadastrar situação.' });
  }
});

router.put('/situacoes-viagem/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { DSSITUACAOVIAGEM, FGACTIVE, FGSITVIAGEM } = req.body;
    if (!DSSITUACAOVIAGEM?.trim() || !['S', 'N'].includes(FGACTIVE)) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }
    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum <= 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    const existente = await pool.query(
      `SELECT 1 FROM "SITUACAOVIAGEM"
       WHERE UPPER(TRIM("DSSITUACAOVIAGEM")) = UPPER(TRIM($1)) AND "CDSITUACAOVIAGEM" != $2 AND "TENANT_ID" = $3 LIMIT 1`,
      [DSSITUACAOVIAGEM.trim(), idNum, tenantId]
    );
    if (existente.rows && existente.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe outra situação com esta descrição. Não é permitido duplicar.' });
    }
    const fgactiveDB = FGACTIVE === 'S' ? 'A' : 'I';
    const fgsit = FGSITVIAGEM != null && String(FGSITVIAGEM).trim() !== '' ? String(FGSITVIAGEM).trim().toUpperCase().substring(0, 1) : null;

    let upd;
    try {
      upd = await pool.query(
        `UPDATE "SITUACAOVIAGEM" SET "DSSITUACAOVIAGEM" = $1, "FGSITVIAGEM" = $2, "FGACTIVE" = $3, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM', "SERVERORIG" = 'AppDVcargas'
         WHERE "CDSITUACAOVIAGEM" = $4 AND "TENANT_ID" = $5`,
        [DSSITUACAOVIAGEM.trim(), fgsit, fgactiveDB, idNum, tenantId]
      );
    } catch (e) {
      if (e.code === '42703') {
        upd = await pool.query(
          `UPDATE "SITUACAOVIAGEM" SET "DSSITUACAOVIAGEM" = $1, "FGACTIVE" = $2, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM', "SERVERORIG" = 'AppDVcargas'
           WHERE "CDSITUACAOVIAGEM" = $3 AND "TENANT_ID" = $4`,
          [DSSITUACAOVIAGEM.trim(), fgactiveDB, idNum, tenantId]
        );
      } else throw e;
    }
    if (!upd.rowCount) {
      return res.status(404).json({ error: 'Situação não encontrada ou não pode ser alterada (catálogo compartilhado).' });
    }
    res.json({ success: true, message: 'Situação atualizada com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar situação:', err);
    res.status(500).json({ error: 'Erro ao atualizar situação.' });
  }
});

router.delete('/situacoes-viagem/:id', async (req, res) => {
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
      `SELECT "FGACTIVE" FROM "SITUACAOVIAGEM" WHERE "CDSITUACAOVIAGEM" = $1 AND "TENANT_ID" = $2`,
      [idNum, tenantId]
    );
    if (!checkResult.rows || checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Situação não encontrada.' });
    }
    const statusAtual = checkResult.rows[0].FGACTIVE ?? checkResult.rows[0].fgactive;
    const estaAtivo = statusAtual === 'A' || statusAtual === 'S' || statusAtual === 'T';
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
    const updateResult = await pool.query(
      `UPDATE "SITUACAOVIAGEM" SET "FGACTIVE" = $1, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM', "SERVERORIG" = 'AppDVcargas'
       WHERE "CDSITUACAOVIAGEM" = $2 AND "TENANT_ID" = $3`,
      [novaSituacao, idNum, tenantId]
    );
    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Situação não encontrada.' });
    }
    res.json({ success: true, message: mensagem, newStatus: novaSituacao === 'A' ? 'S' : 'N' });
  } catch (err) {
    console.error('Erro ao alterar status da situação:', err);
    res.status(500).json({ error: 'Erro ao alterar status da situação.' });
  }
});

router.post('/situacoes-viagem/executar-init-sql', async (req, res) => {
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
