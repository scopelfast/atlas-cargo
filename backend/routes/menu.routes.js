// backend/routes/menu.routes.js - PostgreSQL
const express = require('express');
const router = express.Router();
const { poolPromise } = require('../config/db');

// Mapeamento fixo CDTIPOATIVIDADE -> grupo (evita grupos numéricos "1", "4" no menu)
const GRUPO_POR_ID = {
  1: 'Cadastros', 2: 'Cadastros', 20: 'Cadastros',
  3: 'System', 5: 'System', 31: 'System', 32: 'System',
  4: 'Gestão', 30: 'Gestão', 33: 'Gestão', 40: 'Gestão', 41: 'Gestão', 42: 'Gestão', 43: 'Gestão',
  10: 'Equipamentos', 11: 'Equipamentos', 12: 'Equipamentos', 13: 'Equipamentos', 14: 'Equipamentos', 23: 'Equipamentos',
  21: 'Logística', 22: 'Logística', 24: 'Logística', 25: 'Logística'
};

router.get('/user-menu', async (req, res) => {
  try {
    const userLogin = req.headers['user-login'];

    if (!userLogin) {
      return res.status(400).json({ error: 'Login do usuário não fornecido.' });
    }

    const pool = await poolPromise;
    const result = await pool.query(
      `SELECT 
        t."CDTIPOATIVIDADE" AS id,
        t."DSTIPOATIVIDADE" AS nome,
        t."DSPROGRAMA" AS programa,
        COALESCE(TRIM(t."FGGRUPO"), 'OUTROS') AS grupo
      FROM "USUARIOATIVIDADE" ua
      INNER JOIN "USUARIO" u ON ua."SGUSUARIO" = u."SGUSUARIO"
      INNER JOIN "TIPOATIVIDADE" t ON ua."CDTIPOATIVIDADE" = t."CDTIPOATIVIDADE"
      WHERE u."SGUSUARIO" = $1
        AND u."FGACTIVE" = 'S'
        AND t."FGACTIVE" = 'S'
      ORDER BY t."CDTIPOATIVIDADE"`,
      [userLogin]
    );

    // Normalizar grupo: usar mapeamento por id para evitar "1", "4" e garantir labels corretos
    const menu = (result.rows || []).map(row => ({
      ...row,
      grupo: GRUPO_POR_ID[row.id] || (row.grupo && /^\d+$/.test(String(row.grupo).trim()) ? 'OUTROS' : (row.grupo || 'OUTROS'))
    }));

    res.json({ menu });
  } catch (err) {
    console.error('Erro ao carregar menu:', err);
    res.status(500).json({ error: 'Erro interno ao carregar menu.' });
  }
});

module.exports = router;
