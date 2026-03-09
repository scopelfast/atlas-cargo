// backend/config/db.js - PostgreSQL (Atlas Cargo)
const { Pool } = require('pg');
require('dotenv').config();

if (!process.env.DB_SERVER && !process.env.DB_HOST) {
  console.error('⚠️ AVISO: DB_SERVER ou DB_HOST não encontrado nas variáveis de ambiente');
}

const config = {
  host: process.env.DB_HOST || process.env.DB_SERVER || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  database: process.env.DB_DATABASE || 'atlas_cargo_prd',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  max: 50,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
};

const pool = new Pool(config);

pool.on('error', (err) => {
  console.error('❌ Erro inesperado no pool PostgreSQL:', err);
});

// Converte SQL estilo SQL Server + mapa de parâmetros em SQL PostgreSQL + array de valores
function convertSqlToPg(sql, inputs) {
  const paramRegex = /@(\w+)/g;
  const values = [];
  let m;
  while ((m = paramRegex.exec(sql)) !== null) values.push(inputs[m[1]]);
  let i = 0;
  let pgSql = sql.replace(/@\w+/g, () => '$' + (++i));
  let topLimitParam = null;
  pgSql = pgSql.replace(/\bSELECT\s+TOP\s+\(\$(\d+)\)\s+/gi, (_, n) => {
    topLimitParam = n;
    return 'SELECT ';
  });
  pgSql = pgSql.replace(/\[dbo\]\.\[([^\]]+)\]/g, (_, t) => '"' + t.trim() + '"');
  // Preservar caso original de tabelas e colunas (compatível com banco em maiúsculas, ex.: migrado do SQL Server)
  pgSql = pgSql.replace(/\.\[([^\]]+)\]/g, (_, col) => '."' + col.trim() + '"');
  pgSql = pgSql.replace(/\[([^\]]+)\]/g, (_, n) => '"' + n.trim() + '"');

  // Migração SQL Server → PostgreSQL: nomes de tabela sem colchetes viram minúsculas no PG.
  // Quotar e manter maiúsculas quando aparecem em posição de tabela (INSERT INTO / UPDATE / FROM / JOIN).
  const quoteTableName = (m, t, after) => (t.startsWith('"') ? m : after + '"' + t.toUpperCase() + '"');
  pgSql = pgSql.replace(/\bINSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gi, (m, t) => quoteTableName(m, t, 'INSERT INTO '));
  pgSql = pgSql.replace(/\bUPDATE\s+([A-Za-z_][A-Za-z0-9_]*)\s+SET\b/gi, (m, t) => quoteTableName(m, t, 'UPDATE '));
  // Não quotar após FROM quando for subquery: FROM ( ... ) — evita quebra de CTE/alias
  pgSql = pgSql.replace(/\bFROM\s+(?!\()([A-Za-z_][A-Za-z0-9_]*)(\s)/gi, (m, t, s) => (t.startsWith('"') ? m : 'FROM "' + t.toUpperCase() + '"' + s));
  pgSql = pgSql.replace(/\b(LEFT|RIGHT|INNER|OUTER|CROSS)?\s*JOIN\s+([A-Za-z_][A-Za-z0-9_]*)(\s)/gi, (m, side, t, s) => {
    const join = side ? side + ' JOIN ' : 'JOIN ';
    return t.startsWith('"') ? m : join + '"' + t.toUpperCase() + '"' + s;
  });

  // Aliases sem aspas para PostgreSQL: referências como V.[col] viram v."COL"; alias em minúsculo
  pgSql = pgSql.replace(/(\b(?:FROM|JOIN)\s+(?:"[^"]+"|[a-z_][a-z0-9_]*))\s+(?:AS\s+)?(?!["])(?!(?:WHERE|ON|LEFT|INNER|RIGHT|JOIN|AND|OR|GROUP|ORDER|BY|SET|VALUES|EXCLUDED|LIMIT|OFFSET|UNION|SELECT|FROM)\b)(\w+)(?=\s|$|\))/gi, (_, p, a) => p + ' AS ' + a.toLowerCase());
  // DATEADD antes de GETDATE, para não sobrar DATEADD(SECOND, -5, CURRENT_TIMESTAMP) (PostgreSQL interpretaria SECOND como coluna)
  pgSql = pgSql.replace(/\bDATEADD\s*\(\s*SECOND\s*,\s*-\s*(\d+)\s*,\s*GETDATE\s*\(\s*\)\s*\)/gi, '(CURRENT_TIMESTAMP - INTERVAL \'$1 seconds\')');
  pgSql = pgSql.replace(/\bDATEADD\s*\(\s*SECOND\s*,\s*-\s*(\d+)\s*,\s*CURRENT_TIMESTAMP\s*\)/gi, '(CURRENT_TIMESTAMP - INTERVAL \'$1 seconds\')');
  pgSql = pgSql.replace(/\bGETDATE\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP');
  pgSql = pgSql.replace(/\bSYSUTCDATETIME\s*\(\s*\)/gi, 'CURRENT_TIMESTAMP');
  pgSql = pgSql.replace(/\bISNULL\s*\(/gi, 'COALESCE(');
  // SQL Server geography -> PostGIS (POINT é longitude latitude em WKT)
  pgSql = pgSql.replace(/geography::STPointFromText\s*\(\s*'POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)'\s*,\s*4326\s*\)/gi, 'ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography');
  // geography com parâmetros (ex.: CASE WHEN ... THEN geography::STPointFromText('POINT(' + CAST($12...) + ' ' + CAST($11...) + ')', 4326))
  pgSql = pgSql.replace(/geography::STPointFromText\s*\(\s*'POINT\s*\(\s*'\s*\+\s*CAST\s*\(\s*\$(\d+)\s+AS\s+NVARCHAR[^)]*\)\s*\+\s*'\s+'\s*\+\s*CAST\s*\(\s*\$(\d+)\s+AS\s+NVARCHAR[^)]*\)\s*\)\s*,\s*4326\s*\)/gi, 'ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography');
  // Parâmetros em ST_MakePoint: PostgreSQL precisa de tipo explícito (evita erro 42P18)
  pgSql = pgSql.replace(/ST_MakePoint\s*\(\s*\$(\d+)\s*,\s*\$(\d+)\s*\)/g, (_, a, b) => 'ST_MakePoint($' + a + '::double precision, $' + b + '::double precision)');
  pgSql = pgSql.replace(/\bSELECT\s+TOP\s+\d+\s+/gi, 'SELECT ');
  pgSql = pgSql.replace(/ORDER BY\s+("[^"]+"|\w+)\s+DESC\s*\)\s*(conv_top|conv_any)/gi, 'ORDER BY $1 DESC LIMIT 1 ) $2');
  pgSql = pgSql.replace(/\bOFFSET\s+(\$\d+)\s+ROWS\s+FETCH\s+NEXT\s+(\$\d+)\s+ROWS\s+ONLY/gi, 'OFFSET $1 LIMIT $2');
  pgSql = pgSql.replace(/\bOUTER\s+APPLY\s*\(\s*/gi, 'LEFT JOIN LATERAL ( ');
  pgSql = pgSql.replace(/\)\s*(conv_top|conv_any)\s+/g, ') $1 ON true ');
  if (topLimitParam) {
    pgSql = pgSql.replace(/\s*;?\s*$/, ` LIMIT $${topLimitParam}`);
  }
  return { pgSql, values };
}

// Compatibilidade com código que usa pool.request().input().query() (estilo mssql)
pool.request = function () {
  const inputs = {};
  return {
    input: function (name, typeOrValue, value) {
      inputs[name] = arguments.length === 3 ? value : typeOrValue;
      return this;
    },
    query: async function (sql) {
      const { pgSql, values } = convertSqlToPg(sql, inputs);
      const result = await pool.query(pgSql, values);
      return {
        recordset: result.rows || [],
        rowsAffected: [result.rowCount ?? 0],
      };
    },
  };
};

/**
 * Cria uma transação compatível com PostgreSQL (substituto de sql.Transaction do mssql).
 * Uso: const transaction = await createTransaction(pool); await transaction.begin(); ... await transaction.commit();
 */
async function createTransaction(poolInstance) {
  const client = await poolInstance.connect();
  return {
    async begin() {
      await client.query('BEGIN');
    },
    async commit() {
      await client.query('COMMIT');
      client.release();
    },
    async rollback() {
      await client.query('ROLLBACK');
      client.release();
    },
    request() {
      const inputs = {};
      return {
        input(name, typeOrValue, value) {
          inputs[name] = arguments.length === 3 ? value : typeOrValue;
          return this;
        },
        async query(sql) {
          const { pgSql, values } = convertSqlToPg(sql, inputs);
          const result = await client.query(pgSql, values);
          return {
            recordset: result.rows || [],
            rowsAffected: [result.rowCount ?? 0],
          };
        },
      };
    },
  };
}

// Compatível com código que usa poolPromise (await poolPromise)
const poolPromise = Promise.resolve(pool);

/**
 * Lê o primeiro valor numérico da primeira linha do recordset (independente do nome da coluna).
 * Útil para queries como SELECT COALESCE(MAX(id), 0) + 1 AS nextId -> evita erro por capitalização no PostgreSQL.
 */
function getFirstNumericValue(recordset, defaultValue = 0) {
  const row = recordset && recordset[0];
  if (!row || typeof row !== 'object') return defaultValue;
  const val = Object.values(row)[0];
  if (val === undefined || val === null) return defaultValue;
  const num = typeof val === 'number' ? val : parseInt(val, 10);
  return Number.isFinite(num) ? num : defaultValue;
}

// Testar conexão ao carregar
pool.query('SELECT 1')
  .then(() => {
    console.log('✅ Conexão com PostgreSQL (Atlas Cargo) estabelecida');
  })
  .catch((err) => {
    console.error('❌ Erro na conexão com PostgreSQL:', err.message);
    console.warn('⚠️ Verifique host, porta, database, usuário e senha no .env');
  });

module.exports = {
  pool,
  poolPromise,
  getFirstNumericValue,
  createTransaction,
};
