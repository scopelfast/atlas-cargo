// backend/routes/mesorregiao.routes.js
// Manutenção da tabela MESOREGIAO (consultar, incluir, alterar, inativar)
// Chave composta: CDUF, CDMESOREGIAO

const express = require('express');
const router = express.Router();
const { poolPromise } = require('../config/db');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');

router.use(towerAuthAndTenant);

// Listar mesorregiões com filtros (para o módulo Gerenciar Mesorregião)
// GET /api/mesorregioes?cdpais=&cduf=&descricao=&situacao=
router.get('/mesorregioes', async (req, res) => {
  try {
    const { cdpais, cduf, descricao, situacao } = req.query;
    const pool = await poolPromise;
    const values = [];
    let idx = 0;
    const $ = (v) => { values.push(v); return `$${++idx}`; };

    let sql = `
      SELECT m."CDUF", m."CDMESOREGIAO", m."DSMESOREGIAO", m."FGACTIVE",
             e."ESTADO" AS ESTADO_UF, e."NMESTADO" AS NMESTADO
      FROM "MESOREGIAO" m
      LEFT JOIN "ESTADO" e ON e."CDUF" = m."CDUF"
      WHERE 1=1
    `;
    if (cdpais != null && cdpais !== '') sql += ` AND e."CDPAIS" = ${$(Number(cdpais))}`;
    if (cduf != null && cduf !== '') sql += ` AND m."CDUF" = ${$(Number(cduf))}`;
    if (descricao && descricao.trim()) sql += ` AND m."DSMESOREGIAO" ILIKE ${$('%' + descricao.trim() + '%')}`;
    if (situacao === 'S' || situacao === 'A') sql += ` AND m."FGACTIVE" = 'A'`;
    else if (situacao === 'N' || situacao === 'I') sql += ` AND m."FGACTIVE" = 'I'`;
    sql += ` ORDER BY e."ESTADO", m."DSMESOREGIAO"`;

    const result = await pool.query(sql, values);
    const rows = (result.rows || []).map(r => {
      const estadoUf = r.ESTADO_UF ?? r.estado_uf;
      const nmestado = r.NMESTADO ?? r.nmestado;
      return {
        CDUF: r.CDUF ?? r.cduf,
        CDMESOREGIAO: r.CDMESOREGIAO ?? r.cdmesoregiao,
        DSMESOREGIAO: r.DSMESOREGIAO ?? r.dsmesoregiao,
        FGACTIVE: (r.FGACTIVE ?? r.fgactive) === 'A' ? 'S' : 'N',
        ESTADO_UF: estadoUf ?? nmestado ?? '',
        NMESTADO: nmestado ?? estadoUf ?? ''
      };
    });
    res.json(rows);
  } catch (err) {
    console.error('Erro ao listar mesorregiões:', err);
    res.status(500).json({ error: 'Erro ao carregar mesorregiões.' });
  }
});

// Obter uma mesorregião por chave composta (deve vir antes de /:cduf)
// GET /api/mesorregioes/:cduf/:cdmesoregiao
router.get('/mesorregioes/:cduf/:cdmesoregiao', async (req, res) => {
  try {
    const cduf = Number(req.params.cduf);
    const cdmesoregiao = Number(req.params.cdmesoregiao);
    if (Number.isNaN(cduf) || Number.isNaN(cdmesoregiao)) {
      return res.status(400).json({ error: 'CDUF e CDMESOREGIAO devem ser numéricos.' });
    }
    const pool = await poolPromise;
    const result = await pool.query(
      `SELECT m."CDUF", m."CDMESOREGIAO", m."DSMESOREGIAO", m."FGACTIVE",
              e."ESTADO" AS ESTADO_UF, e."NMESTADO" AS NMESTADO
       FROM "MESOREGIAO" m
       LEFT JOIN "ESTADO" e ON e."CDUF" = m."CDUF"
       WHERE m."CDUF" = $1 AND m."CDMESOREGIAO" = $2`,
      [cduf, cdmesoregiao]
    );
    const r = (result.rows || [])[0];
    if (!r) return res.status(404).json({ error: 'Mesorregião não encontrada.' });
    const estadoUf = r.ESTADO_UF ?? r.estado_uf;
    const nmestado = r.NMESTADO ?? r.nmestado;
    res.json({
      CDUF: r.CDUF ?? r.cduf,
      CDMESOREGIAO: r.CDMESOREGIAO ?? r.cdmesoregiao,
      DSMESOREGIAO: r.DSMESOREGIAO ?? r.dsmesoregiao,
      FGACTIVE: (r.FGACTIVE ?? r.fgactive) === 'A' ? 'S' : 'N',
      ESTADO_UF: estadoUf ?? nmestado ?? '',
      NMESTADO: nmestado ?? estadoUf ?? ''
    });
  } catch (err) {
    console.error('Erro ao buscar mesorregião:', err);
    res.status(500).json({ error: 'Erro ao carregar mesorregião.' });
  }
});

// Incluir nova mesorregião
// POST /api/mesorregioes
router.post('/mesorregioes', async (req, res) => {
  try {
    const { CDUF, CDMESOREGIAO, DSMESOREGIAO, FGACTIVE } = req.body;
    if (CDUF == null || CDMESOREGIAO == null || !DSMESOREGIAO?.trim()) {
      return res.status(400).json({ error: 'CDUF, CDMESOREGIAO e Descrição são obrigatórios.' });
    }
    const cduf = Number(CDUF);
    const cdmesoregiao = Number(CDMESOREGIAO);
    if (Number.isNaN(cduf) || Number.isNaN(cdmesoregiao)) {
      return res.status(400).json({ error: 'CDUF e CDMESOREGIAO devem ser numéricos.' });
    }
    const fg = (FGACTIVE === 'N' || FGACTIVE === 'I') ? 'I' : 'A';
    const pool = await poolPromise;
    await pool.query(
      `INSERT INTO "MESOREGIAO" ("CDUF", "CDMESOREGIAO", "DSMESOREGIAO", "FGACTIVE", "DHMAINTENANCE", "SGUSER")
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, 'SYSTEM')`,
      [cduf, cdmesoregiao, DSMESOREGIAO.trim(), fg]
    );
    res.status(201).json({ success: true, message: 'Mesorregião cadastrada com sucesso!' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe mesorregião com este CDUF e CDMESOREGIAO.' });
    console.error('Erro ao inserir mesorregião:', err);
    res.status(500).json({ error: 'Erro ao cadastrar mesorregião.' });
  }
});

// Atualizar mesorregião
// PUT /api/mesorregioes/:cduf/:cdmesoregiao
router.put('/mesorregioes/:cduf/:cdmesoregiao', async (req, res) => {
  try {
    const cduf = Number(req.params.cduf);
    const cdmesoregiao = Number(req.params.cdmesoregiao);
    if (Number.isNaN(cduf) || Number.isNaN(cdmesoregiao)) {
      return res.status(400).json({ error: 'CDUF e CDMESOREGIAO devem ser numéricos.' });
    }
    const { DSMESOREGIAO, FGACTIVE } = req.body;
    if (!DSMESOREGIAO?.trim()) return res.status(400).json({ error: 'Descrição é obrigatória.' });
    const fg = (FGACTIVE === 'N' || FGACTIVE === 'I') ? 'I' : 'A';
    const pool = await poolPromise;
    const result = await pool.query(
      `UPDATE "MESOREGIAO" SET "DSMESOREGIAO" = $1, "FGACTIVE" = $2, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM'
       WHERE "CDUF" = $3 AND "CDMESOREGIAO" = $4`,
      [DSMESOREGIAO.trim(), fg, cduf, cdmesoregiao]
    );
    if ((result.rowCount || 0) === 0) return res.status(404).json({ error: 'Mesorregião não encontrada.' });
    res.json({ success: true, message: 'Mesorregião atualizada com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar mesorregião:', err);
    res.status(500).json({ error: 'Erro ao atualizar mesorregião.' });
  }
});

// Inativar (ou exclusão física, conforme preferência)
// DELETE /api/mesorregioes/:cduf/:cdmesoregiao
router.delete('/mesorregioes/:cduf/:cdmesoregiao', async (req, res) => {
  try {
    const cduf = Number(req.params.cduf);
    const cdmesoregiao = Number(req.params.cdmesoregiao);
    if (Number.isNaN(cduf) || Number.isNaN(cdmesoregiao)) {
      return res.status(400).json({ error: 'CDUF e CDMESOREGIAO devem ser numéricos.' });
    }
    const pool = await poolPromise;
    // Inativar em vez de excluir (recomendado)
    const result = await pool.query(
      `UPDATE "MESOREGIAO" SET "FGACTIVE" = 'I', "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM'
       WHERE "CDUF" = $1 AND "CDMESOREGIAO" = $2`,
      [cduf, cdmesoregiao]
    );
    if ((result.rowCount || 0) === 0) return res.status(404).json({ error: 'Mesorregião não encontrada.' });
    res.json({ success: true, message: 'Mesorregião inativada com sucesso!' });
  } catch (err) {
    console.error('Erro ao inativar mesorregião:', err);
    res.status(500).json({ error: 'Erro ao inativar mesorregião.' });
  }
});

module.exports = router;
