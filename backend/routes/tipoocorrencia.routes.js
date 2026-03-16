// backend/routes/tipoocorrencia.routes.js - Manutenção da tabela TIPOOCORRENCIA
const express = require('express');
const router = express.Router();
const { poolPromise, getFirstNumericValue } = require('../config/db');

function normalizarFgActive(val) {
  if (val === 'A' || val === 'S' || val === 'T') return 'S';
  return 'N';
}

function fgActiveParaDb(val) {
  return val === 'S' ? 'A' : 'I';
}

// Helper: ler coluna ignorando maiúsculas/minúsculas (PostgreSQL com "TIPOOCORRENCIA" pode devolver qualquer caso)
function getCol(row, key) {
  if (!row || typeof row !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  const k = typeof key === 'string' ? key.toLowerCase() : key;
  if (Object.prototype.hasOwnProperty.call(row, k)) return row[k];
  const upper = typeof key === 'string' ? key.toUpperCase() : key;
  return row[upper];
}

// Listar tipos de ocorrência (com filtros opcionais)
// Tabela no PostgreSQL: "TIPOOCORRENCIA" (com aspas, maiúsculas) – mesmo formato do SELECT * FROM "TIPOOCORRENCIA"
router.get('/tipos-ocorrencia', async (req, res) => {
  try {
    const { codigo, descricao, situacao } = req.query;
    const pool = await poolPromise;
    const params = [];
    let n = 0;
    let where = '';
    if (codigo && String(codigo).trim() !== '') {
      n++; params.push(parseInt(codigo, 10));
      where += ` AND "CDTIPOOCORRENCIA" = $${n}`;
    }
    if (descricao && String(descricao).trim() !== '') {
      n++; params.push('%' + String(descricao).trim() + '%');
      where += ` AND "DSTIPOOCORRENCIA" LIKE $${n}`;
    }
    if (situacao === 'S' || situacao === 'N') {
      n++; params.push(situacao === 'S' ? 'A' : 'I');
      where += ` AND (COALESCE("FGACTIVE", 'I') = $${n})`;
    }
    const sql = `SELECT * FROM "TIPOOCORRENCIA" WHERE 1=1${where} ORDER BY "CDTIPOOCORRENCIA"`;
    const result = await pool.query(sql, params);
    const rows = result.rows || [];
    if (process.env.NODE_ENV !== 'production') console.log('[TipoOcorrencia] GET /tipos-ocorrencia ->', rows.length, 'registros');
    const lista = rows.map(r => ({
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

// Buscar tipo de ocorrência por ID (query nativa com "TIPOOCORRENCIA")
router.get('/tipos-ocorrencia/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum < 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    const pool = await poolPromise;
    const result = await pool.query(
      'SELECT * FROM "TIPOOCORRENCIA" WHERE "CDTIPOOCORRENCIA" = $1',
      [idNum]
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

// Inserir novo tipo de ocorrência
router.post('/tipos-ocorrencia', async (req, res) => {
  try {
    const { DSTIPOOCORRENCIA, CDEDIPADRAO, FGSITUACAO, SEQ, CDSITUACAOVIAGEM, FG_CONTROLE_TEMPO, TEMPO_MAXIMO_MINUTOS } = req.body;
    if (!DSTIPOOCORRENCIA?.trim()) {
      return res.status(400).json({ error: 'Descrição do tipo de ocorrência é obrigatória.' });
    }
    const pool = await poolPromise;
    const descricao = DSTIPOOCORRENCIA.trim();
    const existente = await pool.query(
      `SELECT 1 FROM "TIPOOCORRENCIA" WHERE UPPER(TRIM("DSTIPOOCORRENCIA")) = UPPER(TRIM($1)) LIMIT 1`,
      [descricao]
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
    const fgControleTempo = (FG_CONTROLE_TEMPO === 'S' || FG_CONTROLE_TEMPO === true) ? 'S' : 'N';
    const tempoMax = TEMPO_MAXIMO_MINUTOS != null && String(TEMPO_MAXIMO_MINUTOS).trim() !== '' ? parseInt(TEMPO_MAXIMO_MINUTOS, 10) : null;
    try {
      await pool
        .request()
        .input('CDTIPOOCORRENCIA', novoId)
        .input('DSTIPOOCORRENCIA', descricao)
        .input('CDEDIPADRAO', cdedipadrao)
        .input('FGSITUACAO', fgsituacao)
        .input('SEQ', seq)
        .input('CDSITUACAOVIAGEM', cdSituacaoViagem)
        .input('FG_CONTROLE_TEMPO', fgControleTempo)
        .input('TEMPO_MAXIMO_MINUTOS', tempoMax)
        .query(`
          INSERT INTO [dbo].[TIPOOCORRENCIA] ([CDTIPOOCORRENCIA], [DSTIPOOCORRENCIA], [CDEDIPADRAO], [FGSITUACAO], [SEQ], [CDSITUACAOVIAGEM], [FG_CONTROLE_TEMPO], [TEMPO_MAXIMO_MINUTOS], [FGACTIVE], [DHMAINTENANCE], [SGUSER], [SERVERORIG])
          VALUES (@CDTIPOOCORRENCIA, @DSTIPOOCORRENCIA, @CDEDIPADRAO, @FGSITUACAO, @SEQ, @CDSITUACAOVIAGEM, @FG_CONTROLE_TEMPO, @TEMPO_MAXIMO_MINUTOS, 'A', GETDATE(), 'SYSTEM', 'AppDVcargas')
        `);
    } catch (e) {
      if (String(e.code) === '23505') {
        novoId = await getProximoId();
        await pool
          .request()
          .input('CDTIPOOCORRENCIA', novoId)
          .input('DSTIPOOCORRENCIA', descricao)
          .input('CDEDIPADRAO', cdedipadrao)
          .input('FGSITUACAO', fgsituacao)
          .input('SEQ', seq)
          .input('CDSITUACAOVIAGEM', cdSituacaoViagem)
          .input('FG_CONTROLE_TEMPO', fgControleTempo)
          .input('TEMPO_MAXIMO_MINUTOS', tempoMax)
          .query(`
            INSERT INTO [dbo].[TIPOOCORRENCIA] ([CDTIPOOCORRENCIA], [DSTIPOOCORRENCIA], [CDEDIPADRAO], [FGSITUACAO], [SEQ], [CDSITUACAOVIAGEM], [FG_CONTROLE_TEMPO], [TEMPO_MAXIMO_MINUTOS], [FGACTIVE], [DHMAINTENANCE], [SGUSER], [SERVERORIG])
            VALUES (@CDTIPOOCORRENCIA, @DSTIPOOCORRENCIA, @CDEDIPADRAO, @FGSITUACAO, @SEQ, @CDSITUACAOVIAGEM, @FG_CONTROLE_TEMPO, @TEMPO_MAXIMO_MINUTOS, 'A', GETDATE(), 'SYSTEM', 'AppDVcargas')
          `);
      } else throw e;
    }
    res.status(201).json({ success: true, message: 'Tipo de ocorrência cadastrado com sucesso!' });
  } catch (err) {
    console.error('Erro ao inserir tipo de ocorrência:', err);
    res.status(500).json({ error: 'Erro ao cadastrar tipo de ocorrência.' });
  }
});

// Atualizar tipo de ocorrência
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
    const existente = await pool.query(
      `SELECT 1 FROM "TIPOOCORRENCIA" WHERE UPPER(TRIM("DSTIPOOCORRENCIA")) = UPPER(TRIM($1)) AND "CDTIPOOCORRENCIA" != $2 LIMIT 1`,
      [DSTIPOOCORRENCIA.trim(), idNum]
    );
    if (existente.rows && existente.rows.length > 0) {
      return res.status(409).json({ error: 'Já existe outro tipo de ocorrência com esta descrição.' });
    }
    const fgDb = FGACTIVE === 'S' ? 'A' : 'I';
    const cdedipadrao = CDEDIPADRAO != null ? String(CDEDIPADRAO).trim().substring(0, 5) || null : null;
    const fgsituacao = FGSITUACAO != null ? String(FGSITUACAO).trim().substring(0, 2) || null : null;
    const seq = SEQ != null && String(SEQ).trim() !== '' ? parseInt(SEQ, 10) : null;
    const cdSituacaoViagem = CDSITUACAOVIAGEM != null && String(CDSITUACAOVIAGEM).trim() !== '' ? parseInt(CDSITUACAOVIAGEM, 10) : null;
    const fgControleTempo = (FG_CONTROLE_TEMPO === 'S' || FG_CONTROLE_TEMPO === true) ? 'S' : 'N';
    const tempoMax = TEMPO_MAXIMO_MINUTOS != null && String(TEMPO_MAXIMO_MINUTOS).trim() !== '' ? parseInt(TEMPO_MAXIMO_MINUTOS, 10) : null;
    await pool
      .request()
      .input('CDTIPOOCORRENCIA', idNum)
      .input('DSTIPOOCORRENCIA', DSTIPOOCORRENCIA.trim())
      .input('CDEDIPADRAO', cdedipadrao)
      .input('FGSITUACAO', fgsituacao)
      .input('SEQ', seq)
      .input('CDSITUACAOVIAGEM', cdSituacaoViagem)
      .input('FG_CONTROLE_TEMPO', fgControleTempo)
      .input('TEMPO_MAXIMO_MINUTOS', tempoMax)
      .input('FGACTIVE', fgDb)
      .query(`
        UPDATE [dbo].[TIPOOCORRENCIA]
        SET 
          [DSTIPOOCORRENCIA] = @DSTIPOOCORRENCIA,
          [CDEDIPADRAO] = @CDEDIPADRAO,
          [FGSITUACAO] = @FGSITUACAO,
          [SEQ] = @SEQ,
          [CDSITUACAOVIAGEM] = @CDSITUACAOVIAGEM,
          [FG_CONTROLE_TEMPO] = @FG_CONTROLE_TEMPO,
          [TEMPO_MAXIMO_MINUTOS] = @TEMPO_MAXIMO_MINUTOS,
          [FGACTIVE] = @FGACTIVE,
          [DHMAINTENANCE] = GETDATE(),
          [SGUSER] = 'SYSTEM',
          [SERVERORIG] = 'AppDVcargas'
        WHERE [CDTIPOOCORRENCIA] = @CDTIPOOCORRENCIA
      `);
    res.json({ success: true, message: 'Tipo de ocorrência atualizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar tipo de ocorrência:', err);
    res.status(500).json({ error: 'Erro ao atualizar tipo de ocorrência.' });
  }
});

// Ativar/Desativar tipo de ocorrência (toggle FGACTIVE)
router.delete('/tipos-ocorrencia/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.query;
    const idNum = parseInt(id, 10);
    if (isNaN(idNum) || idNum < 0) {
      return res.status(400).json({ error: 'ID inválido.' });
    }
    const pool = await poolPromise;
    const checkResult = await pool
      .request()
      .input('CDTIPOOCORRENCIA', idNum)
      .query(`SELECT [FGACTIVE] FROM [dbo].[TIPOOCORRENCIA] WHERE [CDTIPOOCORRENCIA] = @CDTIPOOCORRENCIA`);
    if (checkResult.recordset.length === 0) {
      return res.status(404).json({ error: 'Tipo de ocorrência não encontrado.' });
    }
    const atual = checkResult.recordset[0].FGACTIVE;
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
    await pool
      .request()
      .input('CDTIPOOCORRENCIA', idNum)
      .input('FGACTIVE', novaSituacao)
      .query(`
        UPDATE [dbo].[TIPOOCORRENCIA]
        SET [FGACTIVE] = @FGACTIVE, [DHMAINTENANCE] = GETDATE(), [SGUSER] = 'SYSTEM', [SERVERORIG] = 'AppDVcargas'
        WHERE [CDTIPOOCORRENCIA] = @CDTIPOOCORRENCIA
      `);
    res.json({ success: true, message: mensagem, newStatus: novaSituacao === 'A' ? 'S' : 'N' });
  } catch (err) {
    console.error('Erro ao alterar status do tipo de ocorrência:', err);
    res.status(500).json({ error: 'Erro ao alterar status.' });
  }
});

module.exports = router;
