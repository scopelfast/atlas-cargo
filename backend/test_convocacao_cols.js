const db = require('./config/db');
async function test() {
  const pool = await db.poolPromise;
  try {
    const res = await pool.request().query("SELECT column_name FROM information_schema.columns WHERE table_name = 'HISTORICOREABERTURA'");
    console.log(res.recordset.map(r=>r.column_name).join(', '));
  } catch(e) {
    console.log(e);
  }
  process.exit(0);
}
test();