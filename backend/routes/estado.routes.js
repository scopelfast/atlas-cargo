// backend/routes/estado.routes.js
// Manutenção da tabela ESTADO (consultar, incluir, alterar, inativar)
// Chave composta: CDPAIS, CDUF. Permite cadastrar estados de PY, AR, UY além do BR.

const express = require('express');
const router = express.Router();
const { poolPromise } = require('../config/db');
const { towerAuthAndTenant } = require('../middleware/tower-auth-chain.middleware');
const { listEstados } = require('../controllers/estado-public.controller');

// Leitura pública (ex.: app motorista / cadastro sem JWT da torre)
// GET /api/estados?cdpais=&pais=&nome=&sigla=&situacao=  (pais = sigla ex: BR, PY, AR)
// Nota: o mesmo handler é registrado em cidades.routes antes do towerAuth para garantir ordem.
router.get('/estados', listEstados);

// Obter um estado por chave composta
// GET /api/estados/:cdpais/:cduf
router.get('/estados/:cdpais/:cduf', async (req, res) => {
  try {
    const cdpais = Number(req.params.cdpais);
    const cduf = Number(req.params.cduf);
    if (Number.isNaN(cdpais) || Number.isNaN(cduf)) {
      return res.status(400).json({ error: 'CDPAIS e CDUF devem ser numéricos.' });
    }
    const pool = await poolPromise;
    const result = await pool.query(
      `SELECT e."CDPAIS", e."CDUF", e."ESTADO", e."NMESTADO", e."FGACTIVE",
              p."DSPAIS", p."SGPAIS" AS PAIS_SIGLA
       FROM "ESTADO" e
       LEFT JOIN "PAIS" p ON p."CDPAIS" = e."CDPAIS"
       WHERE e."CDPAIS" = $1 AND e."CDUF" = $2`,
      [cdpais, cduf]
    );
    const r = (result.rows || [])[0];
    if (!r) return res.status(404).json({ error: 'Estado não encontrado.' });
    const dspais = r.DSPAIS ?? r.dspais;
    const paisSigla = r.PAIS_SIGLA ?? r.pais_sigla;
    res.json({
      CDPAIS: r.CDPAIS ?? r.cdpais,
      CDUF: r.CDUF ?? r.cduf,
      ESTADO: r.ESTADO ?? r.estado,
      NMESTADO: r.NMESTADO ?? r.nmestado,
      FGACTIVE: (r.FGACTIVE ?? r.fgactive) === 'A' ? 'S' : 'N',
      DSPAIS: dspais,
      PAIS_SIGLA: paisSigla ?? dspais ?? ''
    });
  } catch (err) {
    console.error('Erro ao buscar estado:', err);
    res.status(500).json({ error: 'Erro ao carregar estado.' });
  }
});

router.use(towerAuthAndTenant);

// Incluir novo estado
// POST /api/estados
router.post('/estados', async (req, res) => {
  try {
    const { CDPAIS, CDUF, ESTADO, NMESTADO, FGACTIVE } = req.body;
    if (CDPAIS == null || CDUF == null || !NMESTADO?.trim()) {
      return res.status(400).json({ error: 'País, CDUF e Nome do estado são obrigatórios.' });
    }
    const cdpais = Number(CDPAIS);
    const cduf = Number(CDUF);
    if (Number.isNaN(cdpais) || Number.isNaN(cduf)) {
      return res.status(400).json({ error: 'CDPAIS e CDUF devem ser numéricos.' });
    }
    const sigla = (ESTADO != null && String(ESTADO).trim()) ? String(ESTADO).trim().toUpperCase().substring(0, 10) : null;
    const fg = (FGACTIVE === 'N' || FGACTIVE === 'I') ? 'I' : 'A';
    const pool = await poolPromise;
    await pool.query(
      `INSERT INTO "ESTADO" ("CDPAIS", "CDUF", "ESTADO", "NMESTADO", "FGACTIVE", "DHMAINTENANCE", "SGUSER")
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, 'SYSTEM')`,
      [cdpais, cduf, sigla, NMESTADO.trim(), fg]
    );
    res.status(201).json({ success: true, message: 'Estado cadastrado com sucesso!' });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Já existe estado com este país e CDUF.' });
    console.error('Erro ao inserir estado:', err);
    res.status(500).json({ error: 'Erro ao cadastrar estado.' });
  }
});

// Atualizar estado
// PUT /api/estados/:cdpais/:cduf
router.put('/estados/:cdpais/:cduf', async (req, res) => {
  try {
    const cdpais = Number(req.params.cdpais);
    const cduf = Number(req.params.cduf);
    if (Number.isNaN(cdpais) || Number.isNaN(cduf)) {
      return res.status(400).json({ error: 'CDPAIS e CDUF devem ser numéricos.' });
    }
    const { ESTADO, NMESTADO, FGACTIVE } = req.body;
    if (!NMESTADO?.trim()) return res.status(400).json({ error: 'Nome do estado é obrigatório.' });
    const sigla = (ESTADO != null && String(ESTADO).trim()) ? String(ESTADO).trim().toUpperCase().substring(0, 10) : null;
    const fg = (FGACTIVE === 'N' || FGACTIVE === 'I') ? 'I' : 'A';
    const pool = await poolPromise;
    const result = await pool.query(
      `UPDATE "ESTADO" SET "ESTADO" = $1, "NMESTADO" = $2, "FGACTIVE" = $3, "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM'
       WHERE "CDPAIS" = $4 AND "CDUF" = $5`,
      [sigla, NMESTADO.trim(), fg, cdpais, cduf]
    );
    if ((result.rowCount || 0) === 0) return res.status(404).json({ error: 'Estado não encontrado.' });
    res.json({ success: true, message: 'Estado atualizado com sucesso!' });
  } catch (err) {
    console.error('Erro ao atualizar estado:', err);
    res.status(500).json({ error: 'Erro ao atualizar estado.' });
  }
});

// Inativar estado
// DELETE /api/estados/:cdpais/:cduf
router.delete('/estados/:cdpais/:cduf', async (req, res) => {
  try {
    const cdpais = Number(req.params.cdpais);
    const cduf = Number(req.params.cduf);
    if (Number.isNaN(cdpais) || Number.isNaN(cduf)) {
      return res.status(400).json({ error: 'CDPAIS e CDUF devem ser numéricos.' });
    }
    const pool = await poolPromise;
    const result = await pool.query(
      `UPDATE "ESTADO" SET "FGACTIVE" = 'I', "DHMAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SYSTEM'
       WHERE "CDPAIS" = $1 AND "CDUF" = $2`,
      [cdpais, cduf]
    );
    if ((result.rowCount || 0) === 0) return res.status(404).json({ error: 'Estado não encontrado.' });
    res.json({ success: true, message: 'Estado inativado com sucesso!' });
  } catch (err) {
    console.error('Erro ao inativar estado:', err);
    res.status(500).json({ error: 'Erro ao inativar estado.' });
  }
});

module.exports = router;
