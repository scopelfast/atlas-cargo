// backend/routes/menu.routes.js
const express = require('express');
const router = express.Router();
const { poolPromise } = require('../config/db');

router.get('/user-menu', async (req, res) => {
  try {
    const userLogin = req.headers['user-login'];

    if (!userLogin) {
      return res.status(400).json({ error: 'Login do usuário não fornecido.' });
    }

      const pool = await poolPromise;
      const result = await pool
        .request()
        .input('userLogin', userLogin)
        .query(`
          SELECT 
            t.CDTIPOATIVIDADE AS id,
            t.DSTIPOATIVIDADE AS nome,
            t.DSPROGRAMA AS programa,
            ISNULL(t.FGGRUPO, 'OUTROS') AS grupo
          FROM USUARIOATIVIDADE ua
          INNER JOIN USUARIO u 
            ON ua.SGUSUARIO = u.SGUSUARIO
          INNER JOIN TIPOATIVIDADE t 
            ON ua.CDTIPOATIVIDADE = t.CDTIPOATIVIDADE
          WHERE 
            u.SGUSUARIO = @userLogin
            AND u.FGACTIVE = 'S'
            AND t.FGACTIVE = 'S'
          ORDER BY t.FGGRUPO, t.DSTIPOATIVIDADE
        `);

    res.json({ menu: result.recordset });
  } catch (err) {
    console.error('Erro ao carregar menu:', err);
    res.status(500).json({ error: 'Erro interno ao carregar menu.' });
  }
});

module.exports = router;