const { poolPromise } = require('../config/db');

let tabelaPronta = false;

const EVENTOS = new Set([
  'nao_encontrado',
  'identificacao_invalida',
  'sem_celular',
  'ambiguo',
  'inativo',
  'whatsapp_enviado',
  'whatsapp_falhou',
  'senha_alterada',
  'codigo_invalido',
  'senha_falhou',
]);

async function garantirTabela(pool) {
  if (tabelaPronta) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "RECUPERACAO_SENHA_LOG" (
      "ID" bigserial PRIMARY KEY,
      "DH" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "CANAL" varchar(20) NOT NULL,
      "EVENTO" varchar(40) NOT NULL,
      "RESULTADO" char(1) NOT NULL,
      "IDENTIFICADOR" varchar(80) NULL,
      "CDCADASTRO" numeric(15,0) NULL,
      "DESTINO" varchar(20) NULL,
      "DETALHE" varchar(400) NULL,
      "IP" varchar(64) NULL
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS "IX_RECUPERACAO_SENHA_LOG_DH"
      ON "RECUPERACAO_SENHA_LOG" ("DH" DESC)
  `);
  tabelaPronta = true;
}

function ipDe(req) {
  const fwd = req && req.headers ? req.headers['x-forwarded-for'] : '';
  const raw = (fwd && String(fwd).split(',')[0]) || (req && req.ip) || '';
  return String(raw).replace(/^::ffff:/, '').trim().slice(0, 64);
}

function identificador(canal, tipo, raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (canal === 'painel') return s.slice(0, 50);
  const digitos = s.replace(/\D/g, '');
  const rotulo = tipo === 'cnpj' ? 'CNPJ' : (tipo === 'celular' ? 'Celular' : 'CPF');
  if (digitos.length >= 4) return `${rotulo} ••••${digitos.slice(-4)}`;
  return rotulo;
}

function detalheLimpo(texto) {
  return String(texto || '').replace(/\b\d{6}\b/g, '••••••').slice(0, 400);
}

async function registrar(pool, item) {
  try {
    const db = pool || await poolPromise;
    await garantirTabela(db);
    const evento = EVENTOS.has(item.evento) ? item.evento : 'senha_falhou';
    const canal = item.canal === 'painel' ? 'painel' : 'motorista';
    const resultado = item.resultado === 'S' ? 'S' : 'N';
    const cd = item.cdCadastro != null && Number.isFinite(Number(item.cdCadastro))
      ? Number(item.cdCadastro)
      : null;
    const destino = String(item.destino || '').replace(/\D/g, '').slice(0, 20) || null;
    await db.query(
      `INSERT INTO "RECUPERACAO_SENHA_LOG"
         ("CANAL", "EVENTO", "RESULTADO", "IDENTIFICADOR", "CDCADASTRO", "DESTINO", "DETALHE", "IP")
       VALUES ($1, $2, $3, $4, $5::numeric, $6, $7, $8)`,
      [
        canal,
        evento,
        resultado,
        item.identificador ? String(item.identificador).slice(0, 80) : null,
        cd,
        destino,
        detalheLimpo(item.detalhe),
        item.ip ? String(item.ip).slice(0, 64) : null,
      ]
    );
  } catch (err) {
    console.error('[recuperacao-senha-log]', err.message);
  }
}

async function listar(pool, query) {
  await garantirTabela(pool);
  const vals = [];
  let where = 'WHERE 1=1';
  const canal = String(query.canal || '').trim().toLowerCase();
  if (canal === 'motorista' || canal === 'painel') {
    vals.push(canal);
    where += ` AND "CANAL" = $${vals.length}`;
  }
  const resultado = String(query.resultado || '').trim().toUpperCase();
  if (resultado === 'S' || resultado === 'N') {
    vals.push(resultado);
    where += ` AND "RESULTADO" = $${vals.length}`;
  }
  const q = String(query.q || '').trim();
  if (q) {
    vals.push(`%${q}%`);
    where += ` AND (
      COALESCE("IDENTIFICADOR", '') ILIKE $${vals.length}
      OR COALESCE("DESTINO", '') ILIKE $${vals.length}
      OR COALESCE("DETALHE", '') ILIKE $${vals.length}
      OR CAST("CDCADASTRO" AS TEXT) ILIKE $${vals.length}
    )`;
  }
  const limite = Math.max(20, Math.min(500, Number(query.limite) || 200));
  vals.push(limite);
  const rs = await pool.query(
    `SELECT "ID", "DH", "CANAL", "EVENTO", "RESULTADO", "IDENTIFICADOR", "CDCADASTRO", "DESTINO", "DETALHE", "IP"
       FROM "RECUPERACAO_SENHA_LOG"
       ${where}
      ORDER BY "DH" DESC, "ID" DESC
      LIMIT $${vals.length}`,
    vals
  );
  return rs.rows || [];
}

module.exports = {
  garantirTabela,
  ipDe,
  identificador,
  registrar,
  listar,
};
