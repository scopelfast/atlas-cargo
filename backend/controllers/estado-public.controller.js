// Listagem pública de estados (cadastro motorista, combos) — sem JWT da torre.
// GET /api/estados?cdpais=&pais=&nome=&sigla=&situacao=  (pais = sigla ex: BR, PY, AR)

const { poolPromise } = require('../config/db');

async function listEstados(req, res) {
  try {
    let { cdpais, pais, nome, sigla, situacao } = req.query;
    const pool = await poolPromise;
    if ((cdpais == null || cdpais === '') && pais != null && String(pais).trim() !== '') {
      const rawPais = String(pais).trim();
      if (/^\d+$/.test(rawPais)) {
        cdpais = Number(rawPais);
      } else {
        const siglaPais = rawPais.toUpperCase();
        const rPais = await pool.query('SELECT "CDPAIS" FROM "PAIS" WHERE UPPER(TRIM("SGPAIS")) = $1 LIMIT 1', [siglaPais]);
        if (rPais.rows && rPais.rows.length > 0) cdpais = rPais.rows[0].CDPAIS ?? rPais.rows[0].cdpais;
      }
    }
    const values = [];
    let idx = 0;
    const $ = (v) => {
      values.push(v);
      return `$${++idx}`;
    };

    let sql = `
      SELECT e."CDPAIS", e."CDUF", e."ESTADO", e."NMESTADO", e."FGACTIVE",
             p."DSPAIS", p."SGPAIS" AS PAIS_SIGLA
      FROM "ESTADO" e
      LEFT JOIN "PAIS" p ON p."CDPAIS" = e."CDPAIS"
      WHERE 1=1
    `;
    if (cdpais != null && cdpais !== '') sql += ` AND e."CDPAIS" = ${$(Number(cdpais))}`;
    if (nome && nome.trim()) sql += ` AND e."NMESTADO" ILIKE ${$('%' + nome.trim() + '%')}`;
    if (sigla && sigla.trim()) sql += ` AND e."ESTADO" ILIKE ${$('%' + sigla.trim() + '%')}`;
    if (situacao === 'S' || situacao === 'A') sql += ` AND e."FGACTIVE" = 'A'`;
    else if (situacao === 'N' || situacao === 'I') sql += ` AND e."FGACTIVE" = 'I'`;
    sql += ` ORDER BY p."DSPAIS", e."NMESTADO"`;

    const result = await pool.query(sql, values);
    const rows = (result.rows || []).map((r) => {
      const fg = (r.FGACTIVE ?? r.fgactive) === 'A' ? 'S' : 'N';
      const dspais = r.DSPAIS ?? r.dspais;
      const paisSigla = r.PAIS_SIGLA ?? r.pais_sigla;
      return {
        CDPAIS: r.CDPAIS ?? r.cdpais,
        CDUF: r.CDUF ?? r.cduf,
        ESTADO: r.ESTADO ?? r.estado,
        NMESTADO: r.NMESTADO ?? r.nmestado,
        FGACTIVE: fg,
        DSPAIS: dspais,
        PAIS_SIGLA: paisSigla ?? dspais ?? (r.CDPAIS ?? r.cdpais) ?? ''
      };
    });
    res.json(rows);
  } catch (err) {
    console.error('Erro ao listar estados:', err);
    res.status(500).json({ error: 'Erro ao carregar estados.' });
  }
}

module.exports = { listEstados };
