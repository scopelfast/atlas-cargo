const db = require('./config/db');
async function test() {
  const pool = await db.poolPromise;
  try {
    console.log("Inserindo motivos de reabertura...");
    const queries = [
      `INSERT INTO "MOTIVOREABERTURA" ("CDMOTIVO", "DSMOTIVO", "FGACTIVE", "DHINCLUSAO", "SGUSERINCLUSAO") VALUES (1, 'Erro de seleção / Confirmação indevida', 'A', CURRENT_TIMESTAMP, 'SISTEMA') ON CONFLICT ("CDMOTIVO") DO NOTHING`,
      `INSERT INTO "MOTIVOREABERTURA" ("CDMOTIVO", "DSMOTIVO", "FGACTIVE", "DHINCLUSAO", "SGUSERINCLUSAO") VALUES (2, 'Motorista desistiu da viagem', 'A', CURRENT_TIMESTAMP, 'SISTEMA') ON CONFLICT ("CDMOTIVO") DO NOTHING`,
      `INSERT INTO "MOTIVOREABERTURA" ("CDMOTIVO", "DSMOTIVO", "FGACTIVE", "DHINCLUSAO", "SGUSERINCLUSAO") VALUES (3, 'Problema com o veículo', 'A', CURRENT_TIMESTAMP, 'SISTEMA') ON CONFLICT ("CDMOTIVO") DO NOTHING`,
      `INSERT INTO "MOTIVOREABERTURA" ("CDMOTIVO", "DSMOTIVO", "FGACTIVE", "DHINCLUSAO", "SGUSERINCLUSAO") VALUES (4, 'Outros', 'A', CURRENT_TIMESTAMP, 'SISTEMA') ON CONFLICT ("CDMOTIVO") DO NOTHING`
    ];

    for (let q of queries) {
      await pool.request().query(q);
    }
    console.log("Motivos inseridos com sucesso.");
  } catch(e) {
    console.log("Error:", e.message);
  }
  process.exit(0);
}
test();