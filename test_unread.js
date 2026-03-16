const db = require('./backend/config/db');

(async () => {
  const pool = await db.poolPromise;
  
  // check total unread messages
  const unreadRes = await pool.query(`SELECT COUNT(*)::int AS total FROM public."MESSAGES" WHERE (COALESCE("READ_BY_RECEIVER", false) IS NOT TRUE)`);
  console.log("Total unread overall:", unreadRes.rows[0].total);

  // check total unread for driver 1 (assuming SENDER_TYPE=OPERADOR)
  const drvUnread = await pool.query(`
    SELECT m."ID", m."IDVIAGEM", m."SENDER_TYPE", m."SENDER_ID", m."READ_BY_RECEIVER", m."CONTENT", c."ID_MOTORISTA" 
    FROM public."MESSAGES" m
    LEFT JOIN public."CONVERSAS" c ON m."ID_CONVERSA" = c."ID"
    WHERE (COALESCE(m."READ_BY_RECEIVER", false) IS NOT TRUE)
  `);
  console.log("Unread messages details:", drvUnread.rows);

  process.exit(0);
})();
