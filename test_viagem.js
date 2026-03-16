const db = require('./backend/config/db');

(async () => {
  const pool = await db.poolPromise;
  
  // check VIAGEMMOTORISTA
  const vm1 = await pool.query(`SELECT * FROM public."VIAGEMMOTORISTA" WHERE "IDVIAGEM" = 1`);
  console.log("VIAGEMMOTORISTA for id 1:", vm1.rows);

  // check VIAGEMMESTRE
  const vm2 = await pool.query(`SELECT "IDVIAGEM", "IDMOTORISTA" FROM public."VIAGEMMESTRE" WHERE "IDVIAGEM" = 1`);
  console.log("VIAGEMMESTRE for id 1:", vm2.rows);

  process.exit(0);
})();
