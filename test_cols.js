const db = require('./backend/config/db');

(async () => {
  const pool = await db.poolPromise;
  
  // check VIAGEMMESTRE columns
  const cols = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'VIAGEMMESTRE'
  `);
  console.log("Columns:", cols.rows.map(r => r.column_name));

  process.exit(0);
})();
