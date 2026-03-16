const db = require('./backend/config/db');

(async () => {
  const pool = await db.poolPromise;
  
  const idviagem = "1";
  const userId = "2";
  const userType = "driver";

  const idViagemNum = parseFloat(idviagem);
  const senderIdNum = parseFloat(userId);
  const senderTypeStr = (userType || '').substring(0, 20);

  const isMotorista = senderTypeStr.toUpperCase() === 'MOTORISTA' || senderTypeStr.toUpperCase() === 'DRIVER';

  console.log({ idViagemNum, senderIdNum, senderTypeStr, isMotorista });

  let updateQuery = `
        UPDATE public."MESSAGES" m
        SET "READ_BY_RECEIVER" = true, "DH_LEITURA" = NOW()
        FROM public."CONVERSAS" c
        WHERE m."ID_CONVERSA" = c."ID"
          AND m."IDVIAGEM" = $1
          AND (m."SENDER_ID" IS DISTINCT FROM $2 OR m."SENDER_TYPE" IS DISTINCT FROM $3)
          AND (COALESCE(m."READ_BY_RECEIVER", false) IS NOT TRUE)
      `;

  if (isMotorista) {
    updateQuery += `
      AND (
        c."ID_MOTORISTA" = $2 
        OR EXISTS (SELECT 1 FROM public."VIAGEMMOTORISTA" vm WHERE vm."IDVIAGEM" = c."ID_VIAGEM" AND vm."CDMOTORISTA" = $2)
        OR m."IDVIAGEM" IN (SELECT "IDVIAGEM" FROM public."VIAGEMMOTORISTA" WHERE "CDMOTORISTA" = $2)
      )
    `;
  }

  // print query
  console.log("Query:", updateQuery);
  
  try {
    const res = await pool.query(updateQuery, [idViagemNum, senderIdNum, senderTypeStr]);
    console.log("Rows affected (MESSAGES):", res.rowCount || (res.rowsAffected && res.rowsAffected[0]));
  } catch (e) {
    console.error("Error updating MESSAGES:", e);
  }

  let updateConvQuery = `
    UPDATE public."CONVERSAS" c
    SET "MENSAGENS_NAO_LIDAS" = (
      SELECT COUNT(*)::int
      FROM public."MESSAGES" m
      WHERE m."ID_CONVERSA" = c."ID"
        AND (m."SENDER_ID" IS DISTINCT FROM $2 OR m."SENDER_TYPE" IS DISTINCT FROM $3)
        AND (COALESCE(m."READ_BY_RECEIVER", false) IS NOT TRUE)
    )
    WHERE c."ID_VIAGEM" = $1
  `;

  if (isMotorista) {
    updateConvQuery += `
      AND (
        c."ID_MOTORISTA" = $2 
        OR EXISTS (SELECT 1 FROM public."VIAGEMMOTORISTA" vm WHERE vm."IDVIAGEM" = c."ID_VIAGEM" AND vm."CDMOTORISTA" = $2)
        OR c."ID_VIAGEM" IN (SELECT "IDVIAGEM" FROM public."VIAGEMMOTORISTA" WHERE "CDMOTORISTA" = $2)
      )
    `;
  }

  try {
    const res = await pool.query(updateConvQuery, [idViagemNum, senderIdNum, senderTypeStr]);
    console.log("Rows affected (CONVERSAS):", res.rowCount || (res.rowsAffected && res.rowsAffected[0]));
  } catch (e) {
    console.error("Error updating CONVERSAS:", e);
  }

  process.exit(0);
})();
