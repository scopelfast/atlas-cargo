// backend/routes/tipoocorrencia.routes.js - Manutenção da tabela TIPOOCORRENCIA
const express = require('express');
const sql = require('../config/mssql-compat');
const router = express.Router();
const { poolPromise, getFirstNumericValue } = require('../config/db');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');
const { tenantIdForRequest } = require('../utils/tenant-context');

router.use(towerAuthAndTenant);

function normalizarFgActive(val) {
  if (val === 'A' || val === 'S' || val === 'T') return 'S';
  return 'N';
}

function getCol(row, key) {
  if (!row || typeof row !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  const k = typeof key === 'string' ? key.toLowerCase() : key;
  if (Object.prototype.hasOwnProperty.call(row, k)) return row[k];
  const upper = typeof key === 'string' ? key.toUpperCase() : key;
  return row[upper];
}

router.get('/tipos-ocorrencia', async (req, res) => {
  try {
    const tenantId = tenantIdForRequest(req);
    const { codigo, descricao, situacao } = req.query;
    const params = [tenantId];
    let next = 2;
    let where = `("TENANT_ID" = $1 OR "TENANT_ID" = 'default')`;
    if (codigo && String(codigo).trim() !== '') {
      const c = parseInt(codigo, 10);
      if (!isNaN(c) && c >= 0) {
        where += ` AND "CDTIPOOCORRENCIA" = $${next}`;
        params.push(c);
        next++;
      }
    }
    if (descricao && String(descricao).trim() !== '') {
      where += ` AND "DSTIPOOCORRENCIA" ILIKE $${next}`;
      params.push(`%${String(descricao).trim()}%`);
      next++;
    }
    if (situacao === 'S') {
      where += ` AND ("FGACTIVE" = 'A' OR "FGACTIVE" = 'S' OR "FGACTIVE" = 'T')`;
    } else if (situacao === 'N') {
      where += ` AND ("FGACTIVE" = 'I' OR "FGACTIVE" = 'N')`;
    }
    const pool = await poolPromise;
    const q = `SELECT * FROM "TIPOOCORRENCIA" WHERE ${where} ORDER BY "CDTIPOOCORRENCIA"`;
    const result = await pool.query(q, params);
    const rows = result.rows || [];
    if (process.env.NODE_ENV !== 'production') console.log('[TipoOcorrencia] GET /tipos-ocorrencia ->', rows.length, 'registros');
    const lista = rows.map((r) => ({
      CDTIPOOCORRENCIA: getCol(r, 'CDTIPOOCORRENCIA'),
      DSTIPOOCORRENCIA: getCol(r, 'DSTIPOOCORRENCIA') ?? '',
      FGSITUACAO: getCol(r, 'FGSITUACAO') ?? '',
      SEQ: getCol(r, 'SEQ'),
      CDSITUACAOVIAGEM: getCol(r, 'CDSITUACAOVIAGEM') != null ? Number(getCol(r, 'CDSITUACAOVIAGEM')) : null,
      FG_CONTROLE_TEMPO: (getCol(r, 'FG_CONTROLE_TEMPO') || 'N').toString().toUpperCase().trim() === 'S' ? 'S' : 'N',
      TEMPO_MAXIMO_MINUTOS: getCol(r, 'TEMPO_MAXIMO_MINUTOS') != null ? Number(getCol(r, 'TEMPO_MAXIMO_MINUTOS')) : null,
      FGACTIVE: normalizarFgActive(getCol(r, 'FGACTIVE'))
    }));
    res.json(lista);
  } catch (err) {
    console.error('Erro ao listar tipos de ocorrência:', err);
    res.status(500).json({ error: 'Erro ao carregar tipos de ocorrência.' });
  }
});

router.get('/tipos-ocorrencia/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum < 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);
    const result = await pool.query(
      `SELECT * FROM "TIPOOCORRENCIA" WHERE "CDTIPOOCORRENCIA" = $1
       AND ("TENANT_ID" = $2 OR "TENANT_ID" = 'default')`,
      [idNum, tenantId]
    );
    const rows = result.rows || [];
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Tipo de ocorrência não encontrado.' });
    }
    const r = rows[0];
    res.json({
      CDTIPOOCORRENCIA: getCol(r, 'CDTIPOOCORRENCIA'),
      DSTIPOOCORRENCIA: getCol(r, 'DSTIPOOCORRENCIA') ?? '',
      CDEDIPADRAO: getCol(r, 'CDEDIPADRAO') ?? '',
      FGSITUACAO: getCol(r, 'FGSITUACAO') ?? '',
      SEQ: getCol(r, 'SEQ'),
      CDSITUACAOVIAGEM: getCol(r, 'CDSITUACAOVIAGEM') != null ? Number(getCol(r, 'CDSITUACAOVIAGEM')) : null,
      FG_CONTROLE_TEMPO: (getCol(r, 'FG_CONTROLE_TEMPO') || 'N').toString().toUpperCase().trim() === 'S' ? 'S' : 'N',
      TEMPO_MAXIMO_MINUTOS: getCol(r, 'TEMPO_MAXIMO_MINUTOS') != null ? Number(getCol(r, 'TEMPO_MAXIMO_MINUTOS')) : null,
      FGACTIVE: normalizarFgActive(getCol(r, 'FGACTIVE'))
    });
  } catch (err) {
    console.error('Erro ao buscar tipo de ocorrência:', err);
    res.status(500).json({ error: 'Erro ao buscar tipo de ocorrência.' });
  }
});

router.post('/tipos-ocorrencia', async (req, res) => {
  try {
    const { DSTIPOOCORRENCIA, CDEDIPADRAO, FGSITUACAO, SEQ, CDSITUACAOVIAGEM, FG_CONTROLE_TEMPO, TEMPO_MAXIMO_MINUTOS } = req.body;
    if (!DSTIPOOCORRENCIA?.trim()) {
      return res.status(400).json({ error: 'Descrição do tipo de ocorrência é obrigatória.' });
    }
    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);
    const descricao = DSTIPOOCORRENCIA.trim();
    const existente = await pool.query(
      `SELECT 1 FROM "TIPOOCORRENCIA"
       WHERE UPPER(TRIM("DSTIPOOCORRENCIA")) = UPPER(TRIM($1)) AND "TENANT_ID" = $2
       LIMIT 1`,
      [descricao, tenantId]
    );
    if (existente.rows && existente.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe um tipo de ocorrência com esta descrição.' });
    }
    const getProximoId = async () =>
      getFirstNumericValue(
        (await pool.request().query('SELECT COALESCE(MAX([CDTIPOOCORRENCIA]), 0) + 1 AS [maxId] FROM [dbo].[TIPOOCORRENCIA]')).recordset,
        1
      );
    let novoId = await getProximoId();
    const cdedipadrao = CDEDIPADRAO != null ? String(CDEDIPADRAO).trim().substring(0, 5) || null : null;
    const fgsituacao = FGSITUACAO != null ? String(FGSITUACAO).trim().substring(0, 2) || null : null;
    const seq = SEQ != null && String(SEQ).trim() !== '' ? parseInt(SEQ, 10) : null;
    const cdSituacaoViagem = CDSITUACAOVIAGEM != null && String(CDSITUACAOVIAGEM).trim() !== '' ? parseInt(CDSITUACAOVIAGEM, 10) : null;
    const fgControleTempo = FG_CONTROLE_TEMPO === 'S' || FG_CONTROLE_TEMPO === true ? 'S' : 'N';
    const tempoMax = TEMPO_MAXIMO_MINUTOS != null && String(TEMPO_MAXIMO_MINUTOS).trim() !== '' ? parseInt(TEMPO_MAXIMO_MINUTOS, 10) : null;

    const doInsert = async (nid) => {
      await pool
        .request()
        .input('CDTIPOOCORRENCIA', sql.SmallInt, nid)
        .input('DSTIPOOCORRENCIA', descricao)
        .input('CDEDIPADRAO', cdedipadrao)
        .input('FGSITUACAO', fgsituacao)
        .input('SEQ', seq)
        .input('CDSITUACAOVIAGEM', cdSituacaoViagem)
        .input('FG_CONTROLE_TEMPO', fgControleTempo)
        .input('TEMPO_MAXIMO_MINUTOS', tempoMax)
        .input('TENANT_ID', sql.VarChar(64), tenantId)
        .query(`
          INSERT INTO [dbo].[TIPOOCORRENCIA] ([CDTIPOOCORRENCIA], [DSTIPOOCORRENCIA], [CDEDIPADRAO], [FGSITUACAO], [SEQ], [CDSITUACAOVIAGEM], [FG_CONTROLE_TEMPO], [TEMPO_MAXIMO_MINUTOS], [FGACTIVE], [DHMAINTENANCE], [SGUSER], [SERVERORIG], [TENANT_ID])
          VALUES (@CDTIPOOCORRENCIA, @DSTIPOOCORRENCIA, @CDEDIPADRAO, @FGSITUACAO, @SEQ, @CDSITUACAOVIAGEM, @FG_CONTROLE_TEMPO, @TEMPO_MAXIMO_MINUTOS, 'A', GETDATE(), 'SYSTEM', 'AppDVcargas', @TENANT_ID)
        `);
    };
    try {
      await doInsert(novoId);
    } catch (e) {
      if (String(e.code) === '23505') {
        novoId = await getProximoId();
        await doInsert(novoId);
      } else throw e;
    }
    res.status(201).json({ success: true, message: 'Tipo de ocorrência cadastrado com sucesso!' });
  } catch (err) {
    console.error('Erro ao inserir tipo de ocorrência:', err);
    res.status(500).json({ error: 'Erro ao cadastrar tipo de ocorrência.' });
  }
});

router.put('/tipos-ocorrencia/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { DSTIPOOCORRENCIA, CDEDIPADRAO, FGSITUACAO, SEQ, FGACTIVE, CDSITUACAOVIAGEM, FG_CONTROLE_TEMPO, TEMPO_MAXIMO_MINUTOS } = req.body;
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum < 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    if (!DSTIPOOCORRENCIA?.trim()) {
      return res.status(400).json({ error: 'Descrição é obrigatória.' });
    }
    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);
    const existente = await pool.query(
      `SELECT 1 FROM "TIPOOCORRENCIA"
       WHERE UPPER(TRIM("DSTIPOOCORRENCIA")) = UPPER(TRIM($1))
         AND "CDTIPOOCORRENCIA" != $2
         AND "TENANT_ID" = $3
       LIMIT 1`,
      [DSTIPOOCORRENCIA.trim(), idNum, tenantId]
    );
    if (existente.rows && existente.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe outro tipo de ocorrência com esta descrição.' });
    }
    const fgDb = FGACTIVE === 'S' ? 'A' : 'I';
    const cdedipadrao = CDEDIPADRAO != null ? String(CDEDIPADRAO).trim().substring(0, 5) || null : null;
    const fgsituacao = FGSITUACAO != null ? String(FGSITUACAO).trim().substring(0, 2) || null : null;
    const seq = SEQ != null && String(SEQ).trim() !== '' ? parseInt(SEQ, 10) : null;
    const cdSituacaoViagem = CDSITUACAOVIAGEM != null && String(CDSITUACAOVIAGEM).trim() !== '' ? parseInt(CDSITUACAOVIAGEM, 10) : null;
    const fgControleTempo = FG_CONTROLE_TEMPO === 'S' || FG_CONTROLE_TEMPO === true ? 'S' : 'N';
    const tempoMax = TEMPO_MAXIMO_MINUTOS != null && String(TEMPO_MAXIMO_MINUTOS).trim() !== '' ? parseInt(TEMPO_MAXIMO_MINUTOS, 10) : null;

    const upd = await pool.query(
      `UPDATE "TIPOOCORRENCIA"
       SET "DSTIPOOCORRENCIA" = $1, "CDEDIPADRAO" = $2, "FGSITUACAO" = $3, "SEQ" = $4,
           "CDSITUACAOVIAGEM" = $5, "FG_CONTROLE_TEMPO" = $6, "TEMPO_MAXIMO_MINUTOS" = $7,
           "FGACTIVE" = $8, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM', "SERVERORIG" = 'AppDVcargas'
       WHERE "CDTIPOOCORRENCIA" = $9 AND "TENANT_ID" = $10`,
      [
        DSTIPOOCORRENCIA.trim(),
        cdedipadrao,
        fgsituacao,
        seq,
        cdSituacaoViagem,
        fgControleTempo,
        tempoMax,
        fgDb,
        idNum,
        tenantId
      ]
    );
    if (!upd.rowCount) {
      return res.status(404).json({ error: 'Tipo de ocorrência não encontrado ou não pode ser alterado (catálogo compartilhado).' });
    }
    res.json({ success: true, message: 'Tipo de ocorrência atualizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar tipo de ocorrência:', err);
    res.status(500).json({ error: 'Erro ao atualizar tipo de ocorrência.' });
  }
});

router.delete('/tipos-ocorrencia/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.query;
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum < 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    const pool = await poolPromise;
    const tenantId = tenantIdForRequest(req);
    const checkResult = await pool.query(
      `SELECT "FGACTIVE" FROM "TIPOOCORRENCIA" WHERE "CDTIPOOCORRENCIA" = $1 AND "TENANT_ID" = $2`,
      [idNum, tenantId]
    );
    if (!checkResult.rows || checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tipo de ocorrência não encontrado.' });
    }
    const atual = getCol(checkResult.rows[0], 'FGACTIVE');
    const estaAtivo = atual === 'A' || atual === 'S' || atual === 'T';
    let novaSituacao, mensagem;
    if (action === 'activate') {
      novaSituacao = 'A';
      mensagem = 'Tipo de ocorrência reativado com sucesso!';
    } else if (action === 'deactivate') {
      novaSituacao = 'I';
      mensagem = 'Tipo de ocorrência desativado com sucesso!';
    } else {
      novaSituacao = estaAtivo ? 'I' : 'A';
      mensagem = estaAtivo ? 'Tipo de ocorrência desativado com sucesso!' : 'Tipo de ocorrência reativado com sucesso!';
    }
    const updateResult = await pool.query(
      `UPDATE "TIPOOCORRENCIA"
       SET "FGACTIVE" = $1, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM', "SERVERORIG" = 'AppDVcargas'
       WHERE "CDTIPOOCORRENCIA" = $2 AND "TENANT_ID" = $3`,
      [novaSituacao, idNum, tenantId]
    );
    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Tipo de ocorrência não encontrado.' });
    }
    res.json({ success: true, message: mensagem, newStatus: novaSituacao === 'A' ? 'S' : 'N' });
  } catch (err) {
    console.error('Erro ao alterar status do tipo de ocorrência:', err);
    res.status(500).json({ error: 'Erro ao alterar status.' });
  }
});

module.exports = router;
