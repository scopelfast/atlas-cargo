const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const sql = require('../config/mssql-compat');
const { poolPromise } = require('../config/db');
const {
  sqlPlacasEsperadasPorViagemMotoristaParams,
  sqlDsClasseConjuntoPorViagemMotoristaParams,
} = require('../helpers/convocacao-placas-esperadas.sql');
const { tenantIdForRequest } = require('../utils/tenant-context');
const { getSgUser } = require('../utils/audit');
const alertNotificationService = require('../services/alert-notification-service');

let schemaReady = false;
const runningDispatches = new Set();

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function tokenSecret() {
  return process.env.JWT_SECRET || 'atlas-cargo-local-secret';
}

function makePublicToken(payload) {
  return jwt.sign(payload, tokenSecret(), { algorithm: 'HS256' });
}

function parsePublicToken(token) {
  return jwt.verify(String(token || ''), tokenSecret());
}

/** Latitude/longitude enviadas pelo navegador na página pública (oportunidades). */
function parseCoordsOportunidade(body) {
  const lat = Number(body && body.latitude);
  const lng = Number(body && body.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Exibe CPF/CNPJ do cadastro na página pública (token já restringe o acesso ao destinatário). */
function formatarCpfCnpjMotorista(val) {
  const raw = String(val || '').replace(/\D/g, '');
  if (raw.length === 11) {
    return {
      rotulo: 'CPF',
      texto: raw.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'),
    };
  }
  if (raw.length === 14) {
    return {
      rotulo: 'CNPJ',
      texto: raw.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5'),
    };
  }
  return { rotulo: 'CPF', texto: '—' };
}

async function ensureSchema(pool) {
  if (schemaReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "OPORT_CAMPANHA" (
      "ID" BIGSERIAL PRIMARY KEY,
      "TENANT_ID" VARCHAR(64) NOT NULL,
      "NOME" VARCHAR(160) NOT NULL,
      "STATUS" VARCHAR(20) NOT NULL DEFAULT 'RASCUNHO',
      "MENSAGEM_TEMPLATE" TEXT NOT NULL,
      "EXPIRA_EM_HORAS" INT NOT NULL DEFAULT 48,
      "TOTAL_VIAGENS" INT NOT NULL DEFAULT 0,
      "TOTAL_DESTINATARIOS" INT NOT NULL DEFAULT 0,
      "TOTAL_ENVIADOS" INT NOT NULL DEFAULT 0,
      "TOTAL_FALHAS" INT NOT NULL DEFAULT 0,
      "CRIADO_POR" VARCHAR(80) NOT NULL,
      "CRIADO_EM" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "ATUALIZADO_EM" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS "IX_OPORT_CAMPANHA_TENANT_STATUS"
      ON "OPORT_CAMPANHA" ("TENANT_ID", "STATUS", "CRIADO_EM");

    CREATE TABLE IF NOT EXISTS "OPORT_CAMPANHA_VIAGEM" (
      "ID" BIGSERIAL PRIMARY KEY,
      "TENANT_ID" VARCHAR(64) NOT NULL,
      "ID_CAMPANHA" BIGINT NOT NULL REFERENCES "OPORT_CAMPANHA"("ID") ON DELETE CASCADE,
      "IDVIAGEM" NUMERIC(15,0) NOT NULL,
      "FGACTIVE" CHAR(1) NOT NULL DEFAULT 'S',
      "CRIADO_EM" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("TENANT_ID", "ID_CAMPANHA", "IDVIAGEM")
    );
    CREATE INDEX IF NOT EXISTS "IX_OPORT_CAMP_VIAGEM"
      ON "OPORT_CAMPANHA_VIAGEM" ("TENANT_ID", "ID_CAMPANHA");

    CREATE TABLE IF NOT EXISTS "OPORT_CAMPANHA_DEST" (
      "ID" BIGSERIAL PRIMARY KEY,
      "TENANT_ID" VARCHAR(64) NOT NULL,
      "ID_CAMPANHA" BIGINT NOT NULL REFERENCES "OPORT_CAMPANHA"("ID") ON DELETE CASCADE,
      "CDCADASTRO_MOTORISTA" NUMERIC(15,0) NOT NULL,
      "NOME_MOTORISTA" VARCHAR(160),
      "TELEFONE_E164" VARCHAR(20),
      "TOKEN_PUBLICO" TEXT NOT NULL,
      "TOKEN_EXPIRA_EM" TIMESTAMP NOT NULL,
      "STATUS_ENVIO" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE',
      "ULTIMO_ERRO" TEXT,
      "DH_ENVIO" TIMESTAMP NULL,
      "DH_PRIMEIRO_ACESSO" TIMESTAMP NULL,
      "DH_ULTIMO_ACESSO" TIMESTAMP NULL,
      "IDCONVOCACAO_REF" INT NULL,
      "CRIADO_EM" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("TENANT_ID", "ID_CAMPANHA", "CDCADASTRO_MOTORISTA")
    );
    CREATE INDEX IF NOT EXISTS "IX_OPORT_DEST_CAMP_STATUS"
      ON "OPORT_CAMPANHA_DEST" ("TENANT_ID", "ID_CAMPANHA", "STATUS_ENVIO");
    CREATE INDEX IF NOT EXISTS "IX_OPORT_DEST_TOKEN"
      ON "OPORT_CAMPANHA_DEST" ("TENANT_ID", "ID_CAMPANHA");

    CREATE TABLE IF NOT EXISTS "OPORT_CAMPANHA_CONVOCACAO" (
      "ID" BIGSERIAL PRIMARY KEY,
      "TENANT_ID" VARCHAR(64) NOT NULL,
      "ID_CAMPANHA" BIGINT NOT NULL REFERENCES "OPORT_CAMPANHA"("ID") ON DELETE CASCADE,
      "ID_DESTINATARIO" BIGINT NOT NULL REFERENCES "OPORT_CAMPANHA_DEST"("ID") ON DELETE CASCADE,
      "IDVIAGEM" NUMERIC(15,0) NOT NULL,
      "IDCONVOCACAO" INT NOT NULL,
      "CRIADO_EM" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("TENANT_ID","ID_CAMPANHA","ID_DESTINATARIO","IDVIAGEM")
    );
    CREATE INDEX IF NOT EXISTS "IX_OPORT_CONV_DEST"
      ON "OPORT_CAMPANHA_CONVOCACAO" ("TENANT_ID","ID_DESTINATARIO");

    CREATE TABLE IF NOT EXISTS "OPORT_CAMPANHA_EVENTO" (
      "ID" BIGSERIAL PRIMARY KEY,
      "TENANT_ID" VARCHAR(64) NOT NULL,
      "ID_CAMPANHA" BIGINT NOT NULL REFERENCES "OPORT_CAMPANHA"("ID") ON DELETE CASCADE,
      "ID_DESTINATARIO" BIGINT NULL REFERENCES "OPORT_CAMPANHA_DEST"("ID") ON DELETE CASCADE,
      "IDVIAGEM" NUMERIC(15,0) NULL,
      "TIPO_EVENTO" VARCHAR(40) NOT NULL,
      "DETALHES" TEXT NULL,
      "IP_ORIGEM" VARCHAR(64) NULL,
      "USER_AGENT" TEXT NULL,
      "CRIADO_EM" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS "IX_OPORT_EVENTO_CAMP"
      ON "OPORT_CAMPANHA_EVENTO" ("TENANT_ID", "ID_CAMPANHA", "CRIADO_EM");
  `);
  await pool.query(`
    ALTER TABLE "OPORT_CAMPANHA"
      ADD COLUMN IF NOT EXISTS "INTERVALO_MS" INT NOT NULL DEFAULT 650,
      ADD COLUMN IF NOT EXISTS "MAX_POR_EXECUCAO" INT NOT NULL DEFAULT 5000,
      ADD COLUMN IF NOT EXISTS "RETRY_MAX" INT NOT NULL DEFAULT 3,
      ADD COLUMN IF NOT EXISTS "SOMENTE_CELULAR_VALIDO" CHAR(1) NOT NULL DEFAULT 'N',
      ADD COLUMN IF NOT EXISTS "PROCESSADOS" INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "ERROS_PROCESSAMENTO" INT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "DISPARO_INICIADO_EM" TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS "DISPARO_FINALIZADO_EM" TIMESTAMP NULL;
    ALTER TABLE "OPORT_CAMPANHA_DEST"
      ADD COLUMN IF NOT EXISTS "TENTATIVAS" INT NOT NULL DEFAULT 0;
  `);
  schemaReady = true;
}

async function nextIdConvocacao(pool) {
  const r = await pool.query(`SELECT COALESCE(MAX("IDCONVOCACAO"), 0) + 1 AS next_id FROM "CONVOCACAO"`);
  const row = (r.rows || [])[0] || {};
  return Number(row.next_id || row.NEXT_ID || 1);
}

/** Atualiza texto/link/celular da convocação sem apagar histórico; celular vazio mantém o já salvo. */
async function atualizarConvocacaoCampanha(pool, idConv, tenantId, { nrCelular, txtConvocacao, linkConvocacao }) {
  await pool.query(
    `UPDATE "CONVOCACAO" SET
       "NRCELULAR" = COALESCE(NULLIF(TRIM(COALESCE($1::text, '')), ''), "NRCELULAR"),
       "TXTCONVOCACAO" = $2,
       "LINKCONVOCACAO" = $3,
       "DHMAINTENANCE" = CURRENT_TIMESTAMP
     WHERE "IDCONVOCACAO" = $4 AND "TENANT_ID" = $5`,
    [nrCelular || null, txtConvocacao || null, linkConvocacao || null, idConv, tenantId]
  );
}

async function upsertCampanhaConvocacaoLink(pool, { tenantId, idCampanha, idDestinatario, idViagem, idConv }) {
  await pool.query(
    `INSERT INTO "OPORT_CAMPANHA_CONVOCACAO" ("TENANT_ID","ID_CAMPANHA","ID_DESTINATARIO","IDVIAGEM","IDCONVOCACAO")
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT ("TENANT_ID","ID_CAMPANHA","ID_DESTINATARIO","IDVIAGEM")
     DO UPDATE SET "IDCONVOCACAO" = EXCLUDED."IDCONVOCACAO"`,
    [tenantId, idCampanha, idDestinatario, idViagem, idConv]
  );
}

/**
 * Garante uma convocação por (viagem + motorista + tenant), alinhado ao fluxo da torre:
 * reutiliza linha existente em CONVOCACAO em vez de criar várias para a mesma viagem/motorista.
 * Retorna null se já existir CONFIRMADA para esse par (não deve ocorrer com viagens filtradas na campanha).
 */
async function ensureConvocacaoCampanha(pool, {
  tenantId,
  idCampanha,
  idDestinatario,
  idViagem,
  cdCadastroMotorista,
  nrCelular,
  txtConvocacao,
  linkConvocacao,
  sgUser
}) {
  const map = await pool.query(
    `SELECT "IDCONVOCACAO" FROM "OPORT_CAMPANHA_CONVOCACAO"
      WHERE "TENANT_ID"=$1 AND "ID_CAMPANHA"=$2 AND "ID_DESTINATARIO"=$3 AND "IDVIAGEM"=$4
      LIMIT 1`,
    [tenantId, idCampanha, idDestinatario, idViagem]
  );
  const found = (map.rows || [])[0];
  if (found) {
    const idConv = Number(found.IDCONVOCACAO || found.idconvocacao);
    await atualizarConvocacaoCampanha(pool, idConv, tenantId, { nrCelular, txtConvocacao, linkConvocacao });
    return idConv;
  }

  const ex = await pool.query(
    `SELECT "IDCONVOCACAO", "STATUS" FROM "CONVOCACAO"
      WHERE "TENANT_ID"=$1 AND "IDVIAGEM"=$2 AND "CDCADASTRO_MOTORISTA"=$3
      ORDER BY COALESCE("DHCONVOCACAO", "DHMAINTENANCE") DESC NULLS LAST
      LIMIT 1`,
    [tenantId, idViagem, cdCadastroMotorista]
  );
  const r0 = (ex.rows || [])[0];
  if (r0) {
    const st = String(r0.STATUS || r0.status || '').toUpperCase();
    if (st === 'CONFIRMADA') return null;
    const idReused = Number(r0.IDCONVOCACAO || r0.idconvocacao);
    await atualizarConvocacaoCampanha(pool, idReused, tenantId, { nrCelular, txtConvocacao, linkConvocacao });
    await upsertCampanhaConvocacaoLink(pool, {
      tenantId,
      idCampanha,
      idDestinatario,
      idViagem,
      idConv: idReused
    });
    return idReused;
  }

  const idConv = await nextIdConvocacao(pool);
  let txtPlacasSnapshot = null;
  let txtClassesSnapshot = null;
  try {
    const snapRes = await pool
      .request()
      .input('TENANT_ID', sql.NVarChar(64), tenantId)
      .input('IDVIAGEM', sql.Decimal(15, 0), idViagem)
      .input('CDCADASTRO_MOTORISTA', sql.Decimal(15, 0), cdCadastroMotorista)
      .query(
        `SELECT (${sqlPlacasEsperadasPorViagemMotoristaParams()}) AS [TXT_PLACAS_SNAPSHOT], (${sqlDsClasseConjuntoPorViagemMotoristaParams()}) AS [TXT_CLASSES_CONJ_SNAPSHOT]`
      );
    const srow = (snapRes.recordset || [])[0];
    if (srow) {
      txtPlacasSnapshot = srow.TXT_PLACAS_SNAPSHOT ?? srow.txt_placas_snapshot ?? null;
      txtClassesSnapshot = srow.TXT_CLASSES_CONJ_SNAPSHOT ?? srow.txt_classes_conj_snapshot ?? null;
    }
  } catch (e) {
    console.warn('[oportunidades-campanhas] snapshot placas/classes convocação:', e && e.message);
  }
  await pool.query(
    `INSERT INTO "CONVOCACAO"
      ("IDCONVOCACAO","IDVIAGEM","CDCADASTRO_MOTORISTA","STATUS","DHCONVOCACAO","SGUSUARIO_OPERADOR","NRCELULAR","TXTCONVOCACAO","LINKCONVOCACAO","TENANT_ID","SGUSER","SERVERORIG","TXT_PLACAS_SNAPSHOT","TXT_CLASSES_CONJ_SNAPSHOT")
     VALUES ($1,$2,$3,'PENDENTE',CURRENT_TIMESTAMP,$4,$5,$6,$7,$8,$4,'AppDVcargas',$9,$10)`,
    [
      idConv,
      idViagem,
      cdCadastroMotorista,
      sgUser,
      nrCelular || null,
      txtConvocacao || null,
      linkConvocacao || null,
      tenantId,
      txtPlacasSnapshot,
      txtClassesSnapshot,
    ]
  );
  await upsertCampanhaConvocacaoLink(pool, {
    tenantId,
    idCampanha,
    idDestinatario,
    idViagem,
    idConv
  });
  return idConv;
}

/** Mesmo registro usado na fila Switch da torre, para GET /api/logs-webhook-meta?idViagem= aparecer envios da campanha. */
async function gravarLogWebhookMetaCampanha(pool, {
  idConvocacao,
  ok,
  numero,
  error,
  sgUser,
  statusHttp,
  tempoMs,
  detalhes
}) {
  try {
    const logStatusEnvio = ok ? 'ENVIADO' : 'ERRO';
    const titulo = `Switch Digital - ${ok ? 'Enviado' : 'Erro'}`;
    const mensagem = ok ? `Enviado para ${numero}` : (String(error || 'Erro no envio').substring(0, 500) || `Erro no envio para ${numero}`);
    const detalhesStr = String(detalhes || '').substring(0, 4000);
    await pool.query(
      `INSERT INTO "LOGSWEBHOOKMETA"
        ("IDCONVOCACAO","TIPO","TITULO","MENSAGEM","DETALHES","STATUS_HTTP","TEMPO_RESPOSTA","DHLOG","DHMAINTENANCE","SGUSER","SERVERORIG")
       VALUES ($1,'envio_switch',$2,$3,$4,$5,$6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,$7,'AppDVcargas')`,
      [
        idConvocacao,
        titulo.substring(0, 200),
        mensagem.substring(0, 1000),
        detalhesStr,
        statusHttp != null ? Number(statusHttp) : null,
        tempoMs != null ? Number(tempoMs) : null,
        String(sgUser || 'SYSTEM').substring(0, 50)
      ]
    );
  } catch (e) {
    console.warn('[oport] gravarLogWebhookMetaCampanha:', e.message);
  }
}

async function registrarEvento(pool, { tenantId, idCampanha, idDestinatario = null, idViagem = null, tipo, detalhes = null, ip = null, ua = null }) {
  await pool.query(
    `INSERT INTO "OPORT_CAMPANHA_EVENTO"
      ("TENANT_ID","ID_CAMPANHA","ID_DESTINATARIO","IDVIAGEM","TIPO_EVENTO","DETALHES","IP_ORIGEM","USER_AGENT")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [tenantId, idCampanha, idDestinatario, idViagem, tipo, detalhes, ip, ua]
  );
}

/**
 * Base URL para links públicos (convocações, campanhas de oportunidades no WhatsApp).
 * Em produção atrás de proxy, defina PUBLIC_URL no .env (ex.: https://app.seudominio.com).
 */
function getBasePublicUrl(req) {
  const envUrl = String(process.env.PUBLIC_URL || process.env.PUBLIC_APP_BASE_URL || '').trim();
  if (envUrl) {
    return envUrl.replace(/\/$/, '');
  }
  try {
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return `${proto}://${host}`;
  } catch (_) {
    return '';
  }
}

function dispatchKey(tenantId, idCampanha) {
  return `${tenantId}::${idCampanha}`;
}

function isValidE164Br(num) {
  const d = String(num || '').replace(/\D/g, '');
  if (!d.startsWith('55')) return false;
  return d.length === 12 || d.length === 13;
}

async function processarDisparoCampanha({
  tenantId,
  idCampanha,
  sgUser,
  basePublicUrl
}) {
  const key = dispatchKey(tenantId, idCampanha);
  if (runningDispatches.has(key)) return;
  runningDispatches.add(key);
  const pool = await poolPromise;
  try {
    await ensureSchema(pool);
    const campRs = await pool.query(
      `SELECT * FROM "OPORT_CAMPANHA" WHERE "TENANT_ID"=$1 AND "ID"=$2 LIMIT 1`,
      [tenantId, idCampanha]
    );
    const campanha = (campRs.rows || [])[0];
    if (!campanha) return;
    const intervaloMs = Math.max(200, Math.min(10000, Number(campanha.INTERVALO_MS || campanha.intervalo_ms || 650)));
    const maxPorExecucao = Math.max(1, Math.min(50000, Number(campanha.MAX_POR_EXECUCAO || campanha.max_por_execucao || 5000)));
    const retryMax = Math.max(0, Math.min(10, Number(campanha.RETRY_MAX || campanha.retry_max || 3)));
    const onlyValidCell = String(campanha.SOMENTE_CELULAR_VALIDO || campanha.somente_celular_valido || 'N').toUpperCase() === 'S';
    const viagensRs = await pool.query(
      `SELECT "IDVIAGEM" FROM "OPORT_CAMPANHA_VIAGEM" WHERE "TENANT_ID"=$1 AND "ID_CAMPANHA"=$2 AND "FGACTIVE"='S'`,
      [tenantId, idCampanha]
    );
    const viagemIdsRaw = (viagensRs.rows || []).map((r) => Number(r.IDVIAGEM || r.idviagem)).filter((n) => Number.isFinite(n));
    /** Não enviar campanha para viagens que já têm motorista confirmado (evita convocação paralela indevida). */
    let viagemIds = [];
    for (const vid of viagemIdsRaw) {
      const ex = await pool.query(
        `SELECT 1 FROM "CONVOCACAO" WHERE "TENANT_ID"=$1 AND "IDVIAGEM"=$2 AND "STATUS"='CONFIRMADA' LIMIT 1`,
        [tenantId, vid]
      );
      if (!(ex.rows || []).length) viagemIds.push(vid);
    }
    const cfg = await alertNotificationService.getConfig(pool, tenantId);
    const switchCfg = cfg.switch || {};
    if (!switchCfg.token) {
      await pool.query(
        `UPDATE "OPORT_CAMPANHA" SET "STATUS"='ERRO', "ERROS_PROCESSAMENTO"="ERROS_PROCESSAMENTO"+1, "ATUALIZADO_EM"=CURRENT_TIMESTAMP WHERE "TENANT_ID"=$1 AND "ID"=$2`,
        [tenantId, idCampanha]
      );
      return;
    }

    let enviadosCount = Number(campanha.TOTAL_ENVIADOS || campanha.total_enviados || 0);
    let falhasCount = Number(campanha.TOTAL_FALHAS || campanha.total_falhas || 0);
    let processados = Number(campanha.PROCESSADOS || campanha.processados || 0);
    while (processados < maxPorExecucao) {
      const dRs = await pool.query(
        `SELECT "ID","CDCADASTRO_MOTORISTA","NOME_MOTORISTA","TELEFONE_E164","TOKEN_PUBLICO","TENTATIVAS"
           FROM "OPORT_CAMPANHA_DEST"
          WHERE "TENANT_ID"=$1 AND "ID_CAMPANHA"=$2
            AND ("STATUS_ENVIO"='PENDENTE' OR ("STATUS_ENVIO"='ERRO' AND "TENTATIVAS" < $3))
          ORDER BY "ID"
          LIMIT 1`,
        [tenantId, idCampanha, retryMax]
      );
      const d = (dRs.rows || [])[0];
      if (!d) break;
      const campSt = await pool.query(
        `SELECT "STATUS" FROM "OPORT_CAMPANHA" WHERE "TENANT_ID"=$1 AND "ID"=$2 LIMIT 1`,
        [tenantId, idCampanha]
      );
      const statusAtual = String((campSt.rows || [])[0]?.STATUS || (campSt.rows || [])[0]?.status || 'PROCESSANDO').toUpperCase();
      if (statusAtual !== 'PROCESSANDO') break;
      const idDest = Number(d.ID || d.id);
      const nome = String(d.NOME_MOTORISTA || d.nome_motorista || 'Motorista').trim();
      const link = `${basePublicUrl}/motorista/pages/oportunidades-publicas.html?t=${encodeURIComponent(String(d.TOKEN_PUBLICO || d.token_publico || ''))}`;
      let msg = String(campanha.MENSAGEM_TEMPLATE || campanha.mensagem_template || '');
      msg = msg.replace(/\{\{\s*nome\s*\}\}/gi, nome);
      msg = msg.replace(/\{\{\s*link_oportunidades\s*\}\}/gi, link);
      const numero = String(d.TELEFONE_E164 || d.telefone_e164 || '');
      if (onlyValidCell && !isValidE164Br(numero)) {
        const tentativas = Number(d.TENTATIVAS || d.tentativas || 0) + 1;
        await pool.query(
          `UPDATE "OPORT_CAMPANHA_DEST"
              SET "STATUS_ENVIO"='ERRO', "ULTIMO_ERRO"='Telefone inválido para envio (E.164 BR)', "DH_ENVIO"=CURRENT_TIMESTAMP, "TENTATIVAS"=$1
            WHERE "TENANT_ID"=$2 AND "ID"=$3`,
          [tentativas, tenantId, idDest]
        );
        falhasCount += 1;
        processados += 1;
        await pool.query(
          `UPDATE "OPORT_CAMPANHA"
              SET "TOTAL_ENVIADOS"=$1, "TOTAL_FALHAS"=$2, "PROCESSADOS"=$3, "ATUALIZADO_EM"=CURRENT_TIMESTAMP
            WHERE "TENANT_ID"=$4 AND "ID"=$5`,
          [enviadosCount, falhasCount, processados, tenantId, idCampanha]
        );
        continue;
      }

      const convIds = [];
      if (viagemIds.length === 0) {
        const tentativas = Number(d.TENTATIVAS || d.tentativas || 0) + 1;
        await pool.query(
          `UPDATE "OPORT_CAMPANHA_DEST"
              SET "STATUS_ENVIO"='ERRO', "ULTIMO_ERRO"=$1, "DH_ENVIO"=CURRENT_TIMESTAMP, "TENTATIVAS"=$2
            WHERE "TENANT_ID"=$3 AND "ID"=$4`,
          [
            'Nenhuma viagem elegível: todas já possuem motorista confirmado (remova-as da campanha ou encerre o disparo).',
            tentativas,
            tenantId,
            idDest
          ]
        );
        falhasCount += 1;
        processados += 1;
        await pool.query(
          `UPDATE "OPORT_CAMPANHA"
              SET "TOTAL_ENVIADOS"=$1, "TOTAL_FALHAS"=$2, "PROCESSADOS"=$3, "ATUALIZADO_EM"=CURRENT_TIMESTAMP
            WHERE "TENANT_ID"=$4 AND "ID"=$5`,
          [enviadosCount, falhasCount, processados, tenantId, idCampanha]
        );
        await new Promise((resolve) => setTimeout(resolve, intervaloMs));
        continue;
      }

      for (const idViagem of viagemIds) {
        const idConv = await ensureConvocacaoCampanha(pool, {
          tenantId,
          idCampanha,
          idDestinatario: idDest,
          idViagem,
          cdCadastroMotorista: Number(d.CDCADASTRO_MOTORISTA || d.cdcadastro_motorista),
          nrCelular: numero,
          txtConvocacao: msg,
          linkConvocacao: link,
          sgUser
        });
        if (idConv != null) convIds.push(idConv);
      }

      if (convIds.length === 0) {
        const tentativas = Number(d.TENTATIVAS || d.tentativas || 0) + 1;
        await pool.query(
          `UPDATE "OPORT_CAMPANHA_DEST"
              SET "STATUS_ENVIO"='ERRO', "ULTIMO_ERRO"=$1, "DH_ENVIO"=CURRENT_TIMESTAMP, "TENTATIVAS"=$2
            WHERE "TENANT_ID"=$3 AND "ID"=$4`,
          [
            'Não foi possível registrar convocação para esta viagem e motorista (ex.: convocação já confirmada).',
            tentativas,
            tenantId,
            idDest
          ]
        );
        falhasCount += 1;
        processados += 1;
        await pool.query(
          `UPDATE "OPORT_CAMPANHA"
              SET "TOTAL_ENVIADOS"=$1, "TOTAL_FALHAS"=$2, "PROCESSADOS"=$3, "ATUALIZADO_EM"=CURRENT_TIMESTAMP
            WHERE "TENANT_ID"=$4 AND "ID"=$5`,
          [enviadosCount, falhasCount, processados, tenantId, idCampanha]
        );
        await new Promise((resolve) => setTimeout(resolve, intervaloMs));
        continue;
      }

      const t0 = Date.now();
      const env = await alertNotificationService.sendViaSwitch(switchCfg, numero, msg);
      const tempoEnvio = Date.now() - t0;
      const tentativas = Number(d.TENTATIVAS || d.tentativas || 0) + 1;
      const convIdsUnicos = [...new Set(convIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
      const detalhesMeta = JSON.stringify({
        origem: 'campanha_oportunidades',
        idCampanha: Number(idCampanha),
        statusHttp: env.statusHttp ?? null,
        responseBody:
          env.responseBody != null ? String(env.responseBody).substring(0, 2000) : null,
        error: env.error != null ? String(env.error).substring(0, 500) : null
      });
      await pool.query(
        `UPDATE "OPORT_CAMPANHA_DEST"
            SET "STATUS_ENVIO"=$1, "ULTIMO_ERRO"=$2, "DH_ENVIO"=CURRENT_TIMESTAMP, "IDCONVOCACAO_REF"=$3, "TENTATIVAS"=$4
          WHERE "TENANT_ID"=$5 AND "ID"=$6`,
        [
          env.ok ? 'ENVIADO' : 'ERRO',
          env.ok ? null : String(env.error || 'Erro no envio').substring(0, 1000),
          convIdsUnicos.length ? convIdsUnicos[0] : null,
          tentativas,
          tenantId,
          idDest
        ]
      );

      for (const idConv of convIdsUnicos) {
        await pool.query(
          `INSERT INTO "LOG_ENVIO_WHATSAPP"
            ("IDCONVOCACAO","NRCELULAR","STATUS_ENVIO","MENSAGEM_ERRO","DHENVIO","DHRESPOSTA_API","TENTATIVAS","SGUSER","SERVERORIG")
           VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,$5,$6,'AppDVcargas')`,
          [idConv, numero || null, env.ok ? 'ENVIADO' : 'ERRO', env.ok ? null : String(env.error || 'Erro no envio').substring(0, 500), tentativas, sgUser]
        );
        await gravarLogWebhookMetaCampanha(pool, {
          idConvocacao: idConv,
          ok: env.ok,
          numero,
          error: env.error,
          sgUser,
          statusHttp: env.statusHttp,
          tempoMs: tempoEnvio,
          detalhes: detalhesMeta
        });
      }
      if (env.ok && convIdsUnicos.length > 0) {
        for (const idConv of convIdsUnicos) {
          await pool.query(
            `UPDATE "CONVOCACAO" SET "DHENVIOMETA"=CURRENT_TIMESTAMP, "DHMAINTENANCE"=CURRENT_TIMESTAMP
             WHERE "IDCONVOCACAO"=$1 AND "TENANT_ID"=$2`,
            [idConv, tenantId]
          );
        }
      }
      await registrarEvento(pool, {
        tenantId,
        idCampanha,
        idDestinatario: idDest,
        tipo: env.ok ? 'WHATSAPP_ENVIADO' : 'WHATSAPP_ERRO',
        detalhes: env.ok ? 'OK' : String(env.error || 'Erro'),
      });
      if (env.ok) enviadosCount += 1;
      else falhasCount += 1;
      processados += 1;
      await pool.query(
        `UPDATE "OPORT_CAMPANHA"
            SET "TOTAL_ENVIADOS"=$1, "TOTAL_FALHAS"=$2, "PROCESSADOS"=$3, "ATUALIZADO_EM"=CURRENT_TIMESTAMP
          WHERE "TENANT_ID"=$4 AND "ID"=$5`,
        [enviadosCount, falhasCount, processados, tenantId, idCampanha]
      );
      await new Promise((resolve) => setTimeout(resolve, intervaloMs));
    }

    await pool.query(
      `UPDATE "OPORT_CAMPANHA"
          SET "STATUS"=CASE WHEN "STATUS"='PAUSADA' THEN "STATUS" ELSE 'DISPARADA' END,
              "DISPARO_FINALIZADO_EM"=CASE WHEN "STATUS"='PAUSADA' THEN "DISPARO_FINALIZADO_EM" ELSE CURRENT_TIMESTAMP END,
              "ATUALIZADO_EM"=CURRENT_TIMESTAMP
        WHERE "TENANT_ID"=$1 AND "ID"=$2`,
      [tenantId, idCampanha]
    );
  } catch (err) {
    console.error('[oport] processarDisparoCampanha:', err);
    await pool.query(
      `UPDATE "OPORT_CAMPANHA"
          SET "STATUS"='ERRO', "ERROS_PROCESSAMENTO"="ERROS_PROCESSAMENTO"+1, "ATUALIZADO_EM"=CURRENT_TIMESTAMP
        WHERE "TENANT_ID"=$1 AND "ID"=$2`,
      [tenantId, idCampanha]
    );
  } finally {
    runningDispatches.delete(key);
  }
}

const controller = {
  async listarViagensElegiveis(req, res) {
    try {
      const tenantId = tenantIdForRequest(req);
      const pool = await poolPromise;
      await ensureSchema(pool);
      const q = String(req.query.q || '').trim();
      const vals = [tenantId];
      let sql = `
        SELECT
          v."IDVIAGEM",
          v."DTPREVINICIO",
          v."DTPREVFINAL",
          v."VLFRETE",
          COALESCE(v."MOEDA",'BRL') AS "MOEDA",
          co."NMCIDADE" AS "ORIGEM_CIDADE",
          co."ESTADO" AS "ORIGEM_ESTADO",
          cd."NMCIDADE" AS "DESTINO_CIDADE",
          cd."ESTADO" AS "DESTINO_ESTADO",
          r."DSROTEIRO",
          sv."DSSITUACAOVIAGEM"
        FROM "VIAGEMMESTRE" v
        LEFT JOIN "ROTEIRO" r ON r."IDROTEIRO" = v."IDROTEIRO" AND (r."TENANT_ID" = v."TENANT_ID" OR r."TENANT_ID" = 'default')
        LEFT JOIN "CIDADE" co ON co."CDCIDADE" = r."CDCIDADEORIGEM"
        LEFT JOIN "CIDADE" cd ON cd."CDCIDADE" = r."CDCIDADEDESTINO"
        LEFT JOIN "SITUACAOVIAGEM" sv ON sv."CDSITUACAOVIAGEM" = v."CDSITUACAOVIAGEM" AND (sv."TENANT_ID" = v."TENANT_ID" OR sv."TENANT_ID" = 'default')
        WHERE v."TENANT_ID" = $1
          AND (v."FGACTIVE" = 'S' OR v."FGACTIVE" = 'A')
          AND (
            v."FGSITVIAGEM" IN ('D','P')
            OR UPPER(COALESCE(sv."DSSITUACAOVIAGEM",'')) LIKE '%PREPAR%'
            OR UPPER(COALESCE(sv."DSSITUACAOVIAGEM",'')) LIKE '%PROGRAM%'
          )
          AND NOT EXISTS (
            SELECT 1 FROM "CONVOCACAO" c
            WHERE c."IDVIAGEM" = v."IDVIAGEM" AND c."TENANT_ID" = v."TENANT_ID" AND c."STATUS" IN ('ACEITA','CONFIRMADA')
          )
      `;
      if (q) {
        vals.push(`%${q.toUpperCase()}%`);
        sql += ` AND (UPPER(COALESCE(r."DSROTEIRO",'')) LIKE $2 OR CAST(v."IDVIAGEM" AS TEXT) LIKE $2)`;
      }
      sql += ` ORDER BY v."DTPREVINICIO" DESC NULLS LAST LIMIT 300`;
      const rs = await pool.query(sql, vals);
      res.json({ viagens: rs.rows || [] });
    } catch (err) {
      console.error('[oport] listarViagensElegiveis:', err);
      res.status(500).json({ error: 'Erro ao listar viagens elegíveis.' });
    }
  },

  async listarMotoristasElegiveis(req, res) {
    try {
      const tenantId = tenantIdForRequest(req);
      const pool = await poolPromise;
      await ensureSchema(pool);
      const q = String(req.query.q || '').trim().toUpperCase();
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.max(20, Math.min(500, Number(req.query.limit) || 100));
      const offset = (page - 1) * limit;
      const modoRegras = String(req.query.modoRegras || 'TODOS').toUpperCase();
      const validarClasseFrota = String(req.query.validarClasseFrota || 'N').toUpperCase() === 'S';
      const validarRastreamento = String(req.query.validarRastreamento || 'N').toUpperCase() === 'S';
      const validarLocalEmbarque = String(req.query.validarLocalEmbarque || 'N').toUpperCase() === 'S';
      const validarLocalDesembarque = String(req.query.validarLocalDesembarque || 'N').toUpperCase() === 'S';
      const viagemIds = String(req.query.viagemIds || '')
        .split(',')
        .map((x) => String(x || '').trim())
        .filter((x) => x !== '')
        .map((x) => Number(x))
        .filter((n) => Number.isFinite(n) && n > 0);
      const vals = [tenantId];
      let whereSql = `
        SELECT cg."CDCADASTRO", cg."RZSOCIAL", cg."NRCELULAR", cg."CDCIDADE", c."ESTADO", c."NMCIDADE"
        FROM "CADASTROGERAL" cg
        LEFT JOIN "CIDADE" c ON c."CDCIDADE" = cg."CDCIDADE"
        WHERE cg."TENANT_ID" = $1
          AND (cg."FGACTIVE" = 'S' OR cg."FGACTIVE" = 'A')
          AND (
            COALESCE(cg."FGMOTORISTA",'N') = 'S'
            OR (cg."FGMOTORISTA" IS NULL AND COALESCE(cg."FGTIPOCADASTRO",'') = 'M')
          )
      `;
      if (q) {
        vals.push(`%${q}%`);
        whereSql += ` AND (UPPER(COALESCE(cg."RZSOCIAL",'')) LIKE $2 OR COALESCE(cg."NRCELULAR",'') LIKE $2)`;
      }
      if (modoRegras === 'FILTRAR' && viagemIds.length > 0 && (validarClasseFrota || validarRastreamento || validarLocalEmbarque || validarLocalDesembarque)) {
        vals.push(viagemIds);
        const pViagem = vals.length;
        whereSql += `
          AND EXISTS (
            SELECT 1
            FROM "VIAGEMMESTRE" v
            LEFT JOIN "ROTEIRO" r ON r."IDROTEIRO" = v."IDROTEIRO" AND (r."TENANT_ID" = v."TENANT_ID" OR r."TENANT_ID" = 'default')
            LEFT JOIN "CIDADE" co ON co."CDCIDADE" = r."CDCIDADEORIGEM"
            LEFT JOIN "CIDADE" cd ON cd."CDCIDADE" = r."CDCIDADEDESTINO"
            LEFT JOIN "PAIS" poi ON poi."CDPAIS" = co."CDPAIS"
            LEFT JOIN "PAIS" pod ON pod."CDPAIS" = cd."CDPAIS"
            WHERE v."TENANT_ID" = $1
              AND v."IDVIAGEM" = ANY($${pViagem}::numeric[])
              ${validarClasseFrota ? `AND (
                v."CDCLASSEFROTA" IS NULL
                OR EXISTS (
                SELECT 1 FROM "CLASSEFROTA_CG" ccf
                 WHERE ccf."CDCADASTRO" = cg."CDCADASTRO"
                   AND ccf."CDCLASSEFROTA" = v."CDCLASSEFROTA"
                   AND (ccf."FGACTIVE" = 'S' OR ccf."FGACTIVE" = 'A')
                )
              )` : ''}
              ${validarRastreamento ? `AND (
                (CASE WHEN UPPER(TRIM(BOTH FROM COALESCE(v."FGRASTREADO"::text, 'N'))) IN ('S','1','Y','SIM','TRUE') THEN 'S' ELSE 'N' END) <> 'S'
                OR (CASE WHEN UPPER(TRIM(BOTH FROM COALESCE(cg."FGRASTREADO"::text, 'N'))) IN ('S','1','Y','SIM','TRUE') THEN 'S' ELSE 'N' END) = 'S'
              )` : ''}
              ${validarLocalEmbarque ? `AND (
                r."CDCIDADEORIGEM" IS NULL
                OR NOT EXISTS (
                    SELECT 1 FROM "CADASTRO_LOCAL_PREFERIDO" lp
                    WHERE lp."CDCADASTRO" = cg."CDCADASTRO" AND lp."TIPO" = 'E'
                  )
                OR EXISTS (
                    SELECT 1 FROM "CADASTRO_LOCAL_PREFERIDO" lp
                    WHERE lp."CDCADASTRO" = cg."CDCADASTRO"
                      AND lp."TIPO" = 'E'
                      AND (
                        LENGTH(TRIM(COALESCE(lp."PAIS", ''))) = 0
                        OR UPPER(SUBSTRING(TRIM(lp."PAIS"), 1, 2))
                          = UPPER(SUBSTRING(TRIM(COALESCE(poi."SGPAIS", 'BR')), 1, 2))
                      )
                      AND (lp."CDUF" IS NULL OR lp."CDUF" = co."CDUF")
                      AND (
                        co."CDMESOREGIAO" IS NULL
                        OR lp."CDMESOREGIAO" IS NULL
                        OR lp."CDMESOREGIAO" = co."CDMESOREGIAO"
                      )
                  )
              )` : ''}
              ${validarLocalDesembarque ? `AND (
                r."CDCIDADEDESTINO" IS NULL
                OR NOT EXISTS (
                    SELECT 1 FROM "CADASTRO_LOCAL_PREFERIDO" lp
                    WHERE lp."CDCADASTRO" = cg."CDCADASTRO" AND lp."TIPO" = 'D'
                  )
                OR EXISTS (
                    SELECT 1 FROM "CADASTRO_LOCAL_PREFERIDO" lp
                    WHERE lp."CDCADASTRO" = cg."CDCADASTRO"
                      AND lp."TIPO" = 'D'
                      AND (
                        LENGTH(TRIM(COALESCE(lp."PAIS", ''))) = 0
                        OR UPPER(SUBSTRING(TRIM(lp."PAIS"), 1, 2))
                          = UPPER(SUBSTRING(TRIM(COALESCE(pod."SGPAIS", 'BR')), 1, 2))
                      )
                      AND (lp."CDUF" IS NULL OR lp."CDUF" = cd."CDUF")
                      AND (
                        cd."CDMESOREGIAO" IS NULL
                        OR lp."CDMESOREGIAO" IS NULL
                        OR lp."CDMESOREGIAO" = cd."CDMESOREGIAO"
                      )
                  )
              )` : ''}
          )
        `;
      }
      const cntSql = `SELECT COUNT(1)::int AS total FROM (${whereSql}) q`;
      const cntRs = await pool.query(cntSql, vals);
      const total = Number((cntRs.rows || [])[0]?.total || 0);
      const dataSql = `${whereSql} ORDER BY cg."RZSOCIAL" LIMIT $${vals.length + 1} OFFSET $${vals.length + 2}`;
      const rs = await pool.query(dataSql, [...vals, limit, offset]);
      res.json({
        motoristas: rs.rows || [],
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) }
      });
    } catch (err) {
      console.error('[oport] listarMotoristasElegiveis:', err);
      res.status(500).json({ error: 'Erro ao listar motoristas.' });
    }
  },

  async criarCampanha(req, res) {
    let client = null;
    try {
      const tenantId = tenantIdForRequest(req);
      const sgUser = getSgUser(req);
      if (!sgUser) return res.status(401).json({ error: 'Usuário não autenticado.' });
      const body = req.body || {};
      const nome = String(body.nome || '').trim();
      const template = String(body.mensagemTemplate || '').trim();
      const expiraHoras = Math.max(1, Math.min(240, Number(body.expiraHoras) || 48));
      const intervaloMs = Math.max(200, Math.min(10000, Number(body.intervaloMs) || 650));
      const maxPorExecucao = Math.max(1, Math.min(50000, Number(body.maxPorExecucao) || 5000));
      const retryMax = Math.max(0, Math.min(10, Number(body.retryMax) || 3));
      const somenteCelularValido = String(body.somenteCelularValido || 'N').toUpperCase() === 'S' ? 'S' : 'N';
      const viagemIds = Array.isArray(body.viagemIds) ? body.viagemIds.map(toNum).filter((n) => n != null) : [];
      const motoristaIds = Array.isArray(body.motoristaIds) ? body.motoristaIds.map(toNum).filter((n) => n != null) : [];
      if (!nome) return res.status(400).json({ error: 'Nome da campanha é obrigatório.' });
      if (!template) return res.status(400).json({ error: 'Template da mensagem é obrigatório.' });
      if (viagemIds.length === 0) return res.status(400).json({ error: 'Selecione ao menos 1 viagem.' });
      if (motoristaIds.length === 0) return res.status(400).json({ error: 'Selecione ao menos 1 motorista.' });

      const pool = await poolPromise;
      await ensureSchema(pool);
      client = await pool.connect();
      await client.query('BEGIN');
      const camp = await client.query(
        `INSERT INTO "OPORT_CAMPANHA"
          ("TENANT_ID","NOME","STATUS","MENSAGEM_TEMPLATE","EXPIRA_EM_HORAS","INTERVALO_MS","MAX_POR_EXECUCAO","RETRY_MAX","SOMENTE_CELULAR_VALIDO","TOTAL_VIAGENS","TOTAL_DESTINATARIOS","CRIADO_POR")
         VALUES ($1,$2,'RASCUNHO',$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING "ID"`,
        [tenantId, nome, template, expiraHoras, intervaloMs, maxPorExecucao, retryMax, somenteCelularValido, viagemIds.length, motoristaIds.length, String(sgUser)]
      );
      const idCampanha = Number(camp.rows[0].ID || camp.rows[0].id);

      for (const idv of viagemIds) {
        await client.query(
          `INSERT INTO "OPORT_CAMPANHA_VIAGEM" ("TENANT_ID","ID_CAMPANHA","IDVIAGEM")
           VALUES ($1,$2,$3)
           ON CONFLICT ("TENANT_ID","ID_CAMPANHA","IDVIAGEM") DO NOTHING`,
          [tenantId, idCampanha, idv]
        );
      }

      const mot = await client.query(
        `SELECT cg."CDCADASTRO", COALESCE(NULLIF(TRIM(cg."RZSOCIAL"),''), 'Motorista') AS nome, TRIM(COALESCE(cg."NRCELULAR",'')) AS celular
         FROM "CADASTROGERAL" cg
         WHERE cg."TENANT_ID" = $1 AND cg."CDCADASTRO" = ANY($2::numeric[])`,
        [tenantId, motoristaIds]
      );
      const expira = new Date(Date.now() + expiraHoras * 60 * 60 * 1000);
      for (const r of mot.rows || []) {
        const idMotorista = Number(r.cdcadastro || r.CDCADASTRO);
        const payload = { t: tenantId, c: idCampanha, m: idMotorista, exp: Math.floor(expira.getTime() / 1000) };
        const token = makePublicToken(payload);
        await client.query(
          `INSERT INTO "OPORT_CAMPANHA_DEST"
            ("TENANT_ID","ID_CAMPANHA","CDCADASTRO_MOTORISTA","NOME_MOTORISTA","TELEFONE_E164","TOKEN_PUBLICO","TOKEN_EXPIRA_EM")
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT ("TENANT_ID","ID_CAMPANHA","CDCADASTRO_MOTORISTA")
           DO UPDATE SET "NOME_MOTORISTA" = EXCLUDED."NOME_MOTORISTA",
                         "TELEFONE_E164" = EXCLUDED."TELEFONE_E164",
                         "TOKEN_PUBLICO" = EXCLUDED."TOKEN_PUBLICO",
                         "TOKEN_EXPIRA_EM" = EXCLUDED."TOKEN_EXPIRA_EM"`,
          [tenantId, idCampanha, idMotorista, String(r.nome || ''), String(r.celular || ''), token, expira.toISOString()]
        );
      }
      await registrarEvento(client, { tenantId, idCampanha, tipo: 'CAMPANHA_CRIADA', detalhes: `Viagens=${viagemIds.length}; Motoristas=${motoristaIds.length}` });
      await client.query('COMMIT');
      client.release();
      client = null;
      res.json({ success: true, idCampanha });
    } catch (err) {
      if (client) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        try { client.release(); } catch (_) {}
        client = null;
      }
      console.error('[oport] criarCampanha:', err);
      res.status(500).json({ error: 'Erro ao criar campanha.', details: err.message });
    }
  },

  async listarCampanhas(req, res) {
    try {
      const tenantId = tenantIdForRequest(req);
      const pool = await poolPromise;
      await ensureSchema(pool);
      const rs = await pool.query(
        `SELECT "ID","NOME","STATUS","TOTAL_VIAGENS","TOTAL_DESTINATARIOS","TOTAL_ENVIADOS","TOTAL_FALHAS","PROCESSADOS","INTERVALO_MS","MAX_POR_EXECUCAO","RETRY_MAX","SOMENTE_CELULAR_VALIDO","DISPARO_INICIADO_EM","DISPARO_FINALIZADO_EM","CRIADO_POR","CRIADO_EM"
         FROM "OPORT_CAMPANHA"
         WHERE "TENANT_ID" = $1
         ORDER BY "CRIADO_EM" DESC
         LIMIT 200`,
        [tenantId]
      );
      res.json({ campanhas: rs.rows || [] });
    } catch (err) {
      console.error('[oport] listarCampanhas:', err);
      res.status(500).json({ error: 'Erro ao listar campanhas.' });
    }
  },

  async obterCampanha(req, res) {
    try {
      const tenantId = tenantIdForRequest(req);
      const idCampanha = Number(req.params.id);
      const pool = await poolPromise;
      await ensureSchema(pool);
      const camp = await pool.query(`SELECT * FROM "OPORT_CAMPANHA" WHERE "TENANT_ID"=$1 AND "ID"=$2`, [tenantId, idCampanha]);
      if (!(camp.rows || []).length) return res.status(404).json({ error: 'Campanha não encontrada.' });
      const viagens = await pool.query(
        `SELECT cv."IDVIAGEM", v."DTPREVINICIO", v."DTPREVFINAL", v."VLFRETE", COALESCE(v."MOEDA",'BRL') AS "MOEDA",
                co."NMCIDADE" AS "ORIGEM_CIDADE", co."ESTADO" AS "ORIGEM_ESTADO",
                cd."NMCIDADE" AS "DESTINO_CIDADE", cd."ESTADO" AS "DESTINO_ESTADO"
           FROM "OPORT_CAMPANHA_VIAGEM" cv
           INNER JOIN "VIAGEMMESTRE" v ON v."IDVIAGEM" = cv."IDVIAGEM" AND v."TENANT_ID" = cv."TENANT_ID"
           LEFT JOIN "ROTEIRO" r ON r."IDROTEIRO" = v."IDROTEIRO" AND (r."TENANT_ID"=v."TENANT_ID" OR r."TENANT_ID"='default')
           LEFT JOIN "CIDADE" co ON co."CDCIDADE" = r."CDCIDADEORIGEM"
           LEFT JOIN "CIDADE" cd ON cd."CDCIDADE" = r."CDCIDADEDESTINO"
          WHERE cv."TENANT_ID"=$1 AND cv."ID_CAMPANHA"=$2 AND cv."FGACTIVE"='S'
          ORDER BY cv."ID"`,
        [tenantId, idCampanha]
      );
      const dest = await pool.query(
        `SELECT "ID","CDCADASTRO_MOTORISTA","NOME_MOTORISTA","TELEFONE_E164","STATUS_ENVIO","ULTIMO_ERRO","DH_ENVIO","DH_PRIMEIRO_ACESSO","DH_ULTIMO_ACESSO"
           FROM "OPORT_CAMPANHA_DEST"
          WHERE "TENANT_ID"=$1 AND "ID_CAMPANHA"=$2
          ORDER BY "ID"`,
        [tenantId, idCampanha]
      );
      res.json({ campanha: camp.rows[0], viagens: viagens.rows || [], destinatarios: dest.rows || [] });
    } catch (err) {
      console.error('[oport] obterCampanha:', err);
      res.status(500).json({ error: 'Erro ao obter campanha.' });
    }
  },

  async dispararCampanha(req, res) {
    try {
      const tenantId = tenantIdForRequest(req);
      const sgUser = getSgUser(req) || 'SYSTEM';
      const idCampanha = Number(req.params.id);
      const pool = await poolPromise;
      await ensureSchema(pool);
      const campRs = await pool.query(`SELECT * FROM "OPORT_CAMPANHA" WHERE "TENANT_ID"=$1 AND "ID"=$2`, [tenantId, idCampanha]);
      const campanha = (campRs.rows || [])[0];
      if (!campanha) return res.status(404).json({ error: 'Campanha não encontrada.' });
      const intervaloMs = Math.max(200, Math.min(10000, Number(req.body && req.body.intervaloMs) || Number(campanha.INTERVALO_MS || 650)));
      const maxPorExecucao = Math.max(1, Math.min(50000, Number(req.body && req.body.maxPorExecucao) || Number(campanha.MAX_POR_EXECUCAO || 5000)));
      const retryMax = Math.max(0, Math.min(10, Number(req.body && req.body.retryMax) || Number(campanha.RETRY_MAX || 3)));
      const somenteCelularValido = String((req.body && req.body.somenteCelularValido) || campanha.SOMENTE_CELULAR_VALIDO || 'N').toUpperCase() === 'S' ? 'S' : 'N';
      const pendRs = await pool.query(
        `SELECT COUNT(1)::int AS total
           FROM "OPORT_CAMPANHA_DEST"
          WHERE "TENANT_ID"=$1 AND "ID_CAMPANHA"=$2 AND ("STATUS_ENVIO"='PENDENTE' OR "STATUS_ENVIO"='ERRO')`,
        [tenantId, idCampanha]
      );
      const pendentes = Number((pendRs.rows || [])[0]?.total || 0);
      await pool.query(
        `UPDATE "OPORT_CAMPANHA"
            SET "STATUS"='PROCESSANDO',
                "INTERVALO_MS"=$1,
                "MAX_POR_EXECUCAO"=$2,
                "RETRY_MAX"=$3,
                "SOMENTE_CELULAR_VALIDO"=$4,
                "DISPARO_INICIADO_EM"=CURRENT_TIMESTAMP,
                "DISPARO_FINALIZADO_EM"=NULL,
                "ATUALIZADO_EM"=CURRENT_TIMESTAMP
          WHERE "TENANT_ID"=$5 AND "ID"=$6`,
        [intervaloMs, maxPorExecucao, retryMax, somenteCelularValido, tenantId, idCampanha]
      );
      const base = getBasePublicUrl(req);
      setTimeout(() => {
        processarDisparoCampanha({ tenantId, idCampanha, sgUser, basePublicUrl: base }).catch((e) => {
          console.error('[oport] worker disparo:', e);
        });
      }, 0);
      res.json({
        success: true,
        started: true,
        status: 'PROCESSANDO',
        pendentes,
        intervaloMs,
        maxPorExecucao,
        retryMax,
        somenteCelularValido
      });
    } catch (err) {
      console.error('[oport] dispararCampanha:', err);
      res.status(500).json({ error: 'Erro ao disparar campanha.', details: err.message });
    }
  },

  async pausarCampanha(req, res) {
    try {
      const tenantId = tenantIdForRequest(req);
      const idCampanha = Number(req.params.id);
      const pool = await poolPromise;
      await ensureSchema(pool);
      await pool.query(
        `UPDATE "OPORT_CAMPANHA"
            SET "STATUS"='PAUSADA', "ATUALIZADO_EM"=CURRENT_TIMESTAMP
          WHERE "TENANT_ID"=$1 AND "ID"=$2`,
        [tenantId, idCampanha]
      );
      res.json({ success: true, status: 'PAUSADA' });
    } catch (err) {
      console.error('[oport] pausarCampanha:', err);
      res.status(500).json({ error: 'Erro ao pausar campanha.' });
    }
  },

  async retomarCampanha(req, res) {
    try {
      const tenantId = tenantIdForRequest(req);
      const sgUser = getSgUser(req) || 'SYSTEM';
      const idCampanha = Number(req.params.id);
      const pool = await poolPromise;
      await ensureSchema(pool);
      await pool.query(
        `UPDATE "OPORT_CAMPANHA"
            SET "STATUS"='PROCESSANDO', "ATUALIZADO_EM"=CURRENT_TIMESTAMP
          WHERE "TENANT_ID"=$1 AND "ID"=$2`,
        [tenantId, idCampanha]
      );
      const base = getBasePublicUrl(req);
      setTimeout(() => {
        processarDisparoCampanha({ tenantId, idCampanha, sgUser, basePublicUrl: base }).catch((e) => {
          console.error('[oport] worker retomar:', e);
        });
      }, 0);
      res.json({ success: true, status: 'PROCESSANDO' });
    } catch (err) {
      console.error('[oport] retomarCampanha:', err);
      res.status(500).json({ error: 'Erro ao retomar campanha.' });
    }
  },

  async reprocessarFalhas(req, res) {
    try {
      const tenantId = tenantIdForRequest(req);
      const idCampanha = Number(req.params.id);
      const pool = await poolPromise;
      await ensureSchema(pool);
      await pool.query(
        `UPDATE "OPORT_CAMPANHA_DEST"
            SET "STATUS_ENVIO"='PENDENTE', "ULTIMO_ERRO"=NULL
          WHERE "TENANT_ID"=$1 AND "ID_CAMPANHA"=$2 AND "STATUS_ENVIO"='ERRO'`,
        [tenantId, idCampanha]
      );
      res.json({ success: true });
    } catch (err) {
      console.error('[oport] reprocessarFalhas:', err);
      res.status(500).json({ error: 'Erro ao reprocessar falhas.' });
    }
  },

  async publicoDetalhes(req, res) {
    try {
      const token = String(req.params.token || '');
      const pool = await poolPromise;
      await ensureSchema(pool);
      let d = await pool.query(
        `SELECT "ID","TENANT_ID","NOME_MOTORISTA","CDCADASTRO_MOTORISTA","ID_CAMPANHA","TOKEN_EXPIRA_EM"
           FROM "OPORT_CAMPANHA_DEST"
          WHERE "TOKEN_PUBLICO"=$1
          LIMIT 1`,
        [token]
      );
      let dest = (d.rows || [])[0];
      if (!dest) {
        // Fallback: se o segredo JWT mudou, tenta localizar por payload decodificado.
        const decoded = jwt.decode(token) || {};
        const tenantIdDec = String(decoded.t || '').trim();
        const idCampanhaDec = Number(decoded.c);
        const idMotoristaDec = Number(decoded.m);
        if (!tenantIdDec || !Number.isFinite(idCampanhaDec) || !Number.isFinite(idMotoristaDec)) {
          return res.status(401).json({ error: 'Link inválido ou expirado.' });
        }
        d = await pool.query(
          `SELECT "ID","TENANT_ID","NOME_MOTORISTA","CDCADASTRO_MOTORISTA","ID_CAMPANHA","TOKEN_EXPIRA_EM"
             FROM "OPORT_CAMPANHA_DEST"
            WHERE "TENANT_ID"=$1 AND "ID_CAMPANHA"=$2 AND "CDCADASTRO_MOTORISTA"=$3
            ORDER BY "ID" DESC
            LIMIT 1`,
          [tenantIdDec, idCampanhaDec, idMotoristaDec]
        );
        dest = (d.rows || [])[0];
      }
      if (!dest) return res.status(404).json({ error: 'Link inválido ou expirado.' });
      const tenantId = String(dest.TENANT_ID || dest.tenant_id || '').trim();
      const idCampanha = Number(dest.ID_CAMPANHA || dest.id_campanha);
      const idMotorista = Number(dest.CDCADASTRO_MOTORISTA || dest.cdcadastro_motorista);
      const expDb = dest.TOKEN_EXPIRA_EM || dest.token_expira_em;
      if (expDb && new Date(expDb) < new Date()) {
        return res.status(401).json({ error: 'Link inválido ou expirado.' });
      }

      await pool.query(
        `UPDATE "OPORT_CAMPANHA_DEST"
            SET "DH_ULTIMO_ACESSO"=CURRENT_TIMESTAMP,
                "DH_PRIMEIRO_ACESSO"=COALESCE("DH_PRIMEIRO_ACESSO", CURRENT_TIMESTAMP)
          WHERE "ID"=$1`,
        [Number(dest.ID || dest.id)]
      );
      await pool.query(
        `UPDATE "CONVOCACAO" c
            SET "DHACESSO" = COALESCE(c."DHACESSO", CURRENT_TIMESTAMP),
                "DHMAINTENANCE" = CURRENT_TIMESTAMP
          WHERE c."TENANT_ID"=$1
            AND c."IDCONVOCACAO" IN (
              SELECT oc."IDCONVOCACAO"
                FROM "OPORT_CAMPANHA_CONVOCACAO" oc
               WHERE oc."TENANT_ID"=$1
                 AND oc."ID_CAMPANHA"=$2
                 AND oc."ID_DESTINATARIO"=$3
            )`,
        [tenantId, idCampanha, Number(dest.ID || dest.id)]
      );
      await registrarEvento(pool, {
        tenantId,
        idCampanha,
        idDestinatario: Number(dest.ID || dest.id),
        tipo: 'LINK_ACESSADO',
        detalhes: null,
        ip: req.ip,
        ua: req.headers['user-agent'] || null
      });

      const cgDoc = await pool.query(
        `SELECT TRIM(COALESCE(cg."CGCCPF",'')) AS doc
           FROM "CADASTROGERAL" cg
          WHERE cg."TENANT_ID"=$1 AND cg."CDCADASTRO"=$2
          LIMIT 1`,
        [tenantId, idMotorista]
      );
      const docRaw = (cgDoc.rows || [])[0]?.doc ?? (cgDoc.rows || [])[0]?.DOC ?? '';
      const docFmt = formatarCpfCnpjMotorista(docRaw);

      const camp = await pool.query(
        `SELECT "ID","NOME","MENSAGEM_TEMPLATE" FROM "OPORT_CAMPANHA" WHERE "TENANT_ID"=$1 AND "ID"=$2`,
        [tenantId, idCampanha]
      );
      const viagens = await pool.query(
        `SELECT cv."IDVIAGEM", v."DTPREVINICIO", v."DTPREVFINAL", v."VLFRETE", COALESCE(v."MOEDA",'BRL') AS "MOEDA",
                co."NMCIDADE" AS "ORIGEM_CIDADE", co."ESTADO" AS "ORIGEM_ESTADO",
                cd."NMCIDADE" AS "DESTINO_CIDADE", cd."ESTADO" AS "DESTINO_ESTADO", v."OBSERV"
           FROM "OPORT_CAMPANHA_VIAGEM" cv
           INNER JOIN "VIAGEMMESTRE" v ON v."IDVIAGEM" = cv."IDVIAGEM" AND v."TENANT_ID"=cv."TENANT_ID"
           LEFT JOIN "ROTEIRO" r ON r."IDROTEIRO" = v."IDROTEIRO" AND (r."TENANT_ID"=v."TENANT_ID" OR r."TENANT_ID"='default')
           LEFT JOIN "CIDADE" co ON co."CDCIDADE" = r."CDCIDADEORIGEM"
           LEFT JOIN "CIDADE" cd ON cd."CDCIDADE" = r."CDCIDADEDESTINO"
          WHERE cv."TENANT_ID"=$1 AND cv."ID_CAMPANHA"=$2 AND cv."FGACTIVE"='S'
          ORDER BY cv."ID"`,
        [tenantId, idCampanha]
      );
      const destId = Number(dest.ID || dest.id);
      const statusRes = await pool.query(
        `SELECT oc."IDVIAGEM", UPPER(TRIM(COALESCE(c."STATUS",''))) AS "ST"
           FROM "OPORT_CAMPANHA_CONVOCACAO" oc
           INNER JOIN "CONVOCACAO" c ON c."IDCONVOCACAO" = oc."IDCONVOCACAO" AND c."TENANT_ID" = oc."TENANT_ID"
          WHERE oc."TENANT_ID"=$1 AND oc."ID_CAMPANHA"=$2 AND oc."ID_DESTINATARIO"=$3`,
        [tenantId, idCampanha, destId]
      );
      const mapSt = {};
      (statusRes.rows || []).forEach((row) => {
        const idv = Number(row.IDVIAGEM ?? row.idviagem);
        if (!Number.isFinite(idv)) return;
        mapSt[idv] = String(row.ST ?? row.st ?? '').trim();
      });
      const viagensRows = viagens.rows || [];
      viagensRows.forEach((v) => {
        const idv = Number(v.IDVIAGEM ?? v.idviagem);
        v.statusManifestacao = Number.isFinite(idv) ? mapSt[idv] || null : null;
      });
      res.json({
        campanha: (camp.rows || [])[0] || null,
        motorista: {
          id: Number(dest.CDCADASTRO_MOTORISTA || dest.cdcadastro_motorista),
          nome: String(dest.NOME_MOTORISTA || dest.nome_motorista || 'Motorista'),
          documentoRotulo: docFmt.rotulo,
          documento: docFmt.texto
        },
        viagens: viagensRows
      });
    } catch (err) {
      return res.status(401).json({ error: 'Link inválido ou expirado.' });
    }
  },

  async publicoInteresse(req, res) {
    try {
      const token = String(req.params.token || '');
      const idViagem = Number(req.body && req.body.idViagem);
      const acao = String((req.body && req.body.acao) || 'INTERESSE').toUpperCase();
      if (!Number.isFinite(idViagem)) return res.status(400).json({ error: 'idViagem inválido.' });

      const pool = await poolPromise;
      await ensureSchema(pool);
      let d = await pool.query(
        `SELECT "ID","TENANT_ID","NOME_MOTORISTA","CDCADASTRO_MOTORISTA","ID_CAMPANHA","TOKEN_EXPIRA_EM"
           FROM "OPORT_CAMPANHA_DEST"
          WHERE "TOKEN_PUBLICO"=$1
          LIMIT 1`,
        [token]
      );
      let dest = (d.rows || [])[0];
      if (!dest) {
        const decoded = jwt.decode(token) || {};
        const tenantIdDec = String(decoded.t || '').trim();
        const idCampanhaDec = Number(decoded.c);
        const idMotoristaDec = Number(decoded.m);
        if (!tenantIdDec || !Number.isFinite(idCampanhaDec) || !Number.isFinite(idMotoristaDec)) {
          return res.status(401).json({ error: 'Link inválido ou expirado.' });
        }
        d = await pool.query(
          `SELECT "ID","TENANT_ID","NOME_MOTORISTA","CDCADASTRO_MOTORISTA","ID_CAMPANHA","TOKEN_EXPIRA_EM"
             FROM "OPORT_CAMPANHA_DEST"
            WHERE "TENANT_ID"=$1 AND "ID_CAMPANHA"=$2 AND "CDCADASTRO_MOTORISTA"=$3
            ORDER BY "ID" DESC
            LIMIT 1`,
          [tenantIdDec, idCampanhaDec, idMotoristaDec]
        );
        dest = (d.rows || [])[0];
      }
      if (!dest) return res.status(404).json({ error: 'Link inválido ou expirado.' });
      const tenantId = String(dest.TENANT_ID || dest.tenant_id || '').trim();
      const idCampanha = Number(dest.ID_CAMPANHA || dest.id_campanha);
      const expDb = dest.TOKEN_EXPIRA_EM || dest.token_expira_em;
      if (expDb && new Date(expDb) < new Date()) {
        return res.status(401).json({ error: 'Link inválido ou expirado.' });
      }

      const idDest = Number(dest.ID || dest.id);
      const newStatus = acao === 'RECUSA' ? 'RECUSADA' : 'ACEITA';
      const ex = await pool.query(
        `SELECT UPPER(TRIM(COALESCE(c."STATUS",''))) AS "ST"
           FROM "OPORT_CAMPANHA_CONVOCACAO" oc
           INNER JOIN "CONVOCACAO" c ON c."IDCONVOCACAO" = oc."IDCONVOCACAO" AND c."TENANT_ID" = oc."TENANT_ID"
          WHERE oc."TENANT_ID"=$1 AND oc."ID_CAMPANHA"=$2 AND oc."ID_DESTINATARIO"=$3 AND oc."IDVIAGEM"=$4
          LIMIT 1`,
        [tenantId, idCampanha, idDest, idViagem]
      );
      const row0 = (ex.rows || [])[0];
      if (!row0) {
        return res.status(404).json({
          error: 'Não encontramos convocação para esta viagem neste convite. Atualize a página ou use o link enviado pela transportadora.'
        });
      }
      const oldStatus = String(row0.ST ?? row0.st ?? '').toUpperCase().trim();
      const travadas = new Set(['CONFIRMADA', 'ACEITA_DESCARTADA']);
      if (travadas.has(oldStatus)) {
        const msg =
          oldStatus === 'CONFIRMADA'
            ? 'Esta convocação já foi confirmada. Qualquer dúvida, fale com a transportadora.'
            : 'Esta oportunidade já foi encerrada para você nesta viagem (não selecionada).';
        return res.status(409).json({ error: msg, statusAtual: oldStatus });
      }

      const coords = parseCoordsOportunidade(req.body);
      const mudancaParaAceita = oldStatus !== newStatus && newStatus === 'ACEITA';
      if (mudancaParaAceita && !coords) {
        return res.status(400).json({
          error:
            'Para manifestar interesse é obrigatório permitir o envio da sua localização neste aparelho (o navegador vai pedir permissão).',
          code: 'LOCALIZACAO_OBRIGATORIA'
        });
      }

      // Já estava ACEITA: permite só atualizar GPS (ex.: manifestou interesse antes da obrigatoriedade de localização).
      if (oldStatus === newStatus && oldStatus === 'ACEITA' && coords && acao !== 'RECUSA') {
        const geoOnly = await pool.query(
          `UPDATE "CONVOCACAO" c
              SET "LATITUDE" = $5::double precision,
                  "LONGITUDE" = $6::double precision,
                  "DHMAINTENANCE" = CURRENT_TIMESTAMP,
                  "SGUSER" = 'APP_MOTORISTA_LINK'
            WHERE c."TENANT_ID"=$1
              AND c."IDVIAGEM"=$2
              AND UPPER(TRIM(COALESCE(c."STATUS",''))) = 'ACEITA'
              AND c."IDCONVOCACAO" IN (
                SELECT oc."IDCONVOCACAO"
                  FROM "OPORT_CAMPANHA_CONVOCACAO" oc
                 WHERE oc."TENANT_ID"=$1
                   AND oc."ID_CAMPANHA"=$3
                   AND oc."ID_DESTINATARIO"=$4
                   AND oc."IDVIAGEM"=$2
              )`,
          [tenantId, idViagem, idCampanha, idDest, coords.lat, coords.lng]
        );
        let dhOk = false;
        if ((geoOnly.rowCount || 0) > 0) {
          try {
            await pool.query(
              `UPDATE "CONVOCACAO" c
                  SET "DH_LOCALIZACAO_MOTORISTA" = CURRENT_TIMESTAMP,
                      "DHMAINTENANCE" = CURRENT_TIMESTAMP
                WHERE c."TENANT_ID"=$1
                  AND c."IDVIAGEM"=$2
                  AND c."IDCONVOCACAO" IN (
                    SELECT oc."IDCONVOCACAO"
                      FROM "OPORT_CAMPANHA_CONVOCACAO" oc
                     WHERE oc."TENANT_ID"=$1
                       AND oc."ID_CAMPANHA"=$3
                       AND oc."ID_DESTINATARIO"=$4
                       AND oc."IDVIAGEM"=$2
                  )`,
              [tenantId, idViagem, idCampanha, idDest]
            );
            dhOk = true;
          } catch (eDh) {
            if (eDh.code !== '42703') console.warn('[oport] DH_LOCALIZACAO_MOTORISTA:', eDh.message);
          }
        }
        return res.json({
          success: true,
          unchanged: true,
          status: newStatus,
          localizacaoAtualizada: (geoOnly.rowCount || 0) > 0,
          dhLocalizacaoMotorista: dhOk
        });
      }

      if (oldStatus === newStatus) {
        return res.json({ success: true, unchanged: true, status: newStatus });
      }

      const latParam = coords ? coords.lat : null;
      const lngParam = coords ? coords.lng : null;

      // Travamento otimista: só atualiza se o status no banco ainda for o lido (evita correr a torre/app).
      const upd = await pool.query(
        `UPDATE "CONVOCACAO" c
            SET "STATUS" = $4,
                "DHRESPOSTA" = CURRENT_TIMESTAMP,
                "DHMAINTENANCE" = CURRENT_TIMESTAMP,
                "SGUSER" = 'APP_MOTORISTA_LINK',
                "LATITUDE" = COALESCE($7::double precision, c."LATITUDE"),
                "LONGITUDE" = COALESCE($8::double precision, c."LONGITUDE")
          WHERE c."TENANT_ID"=$1
            AND c."IDVIAGEM"=$2
            AND UPPER(TRIM(COALESCE(c."STATUS",''))) = UPPER(TRIM(COALESCE($6::text,'')))
            AND c."IDCONVOCACAO" IN (
              SELECT oc."IDCONVOCACAO"
                FROM "OPORT_CAMPANHA_CONVOCACAO" oc
               WHERE oc."TENANT_ID"=$1
                 AND oc."ID_CAMPANHA"=$3
                 AND oc."ID_DESTINATARIO"=$5
                 AND oc."IDVIAGEM"=$2
            )`,
        [tenantId, idViagem, idCampanha, newStatus, idDest, oldStatus, latParam, lngParam]
      );

      if ((upd.rowCount || 0) === 0) {
        const snap = await pool.query(
          `SELECT UPPER(TRIM(COALESCE(c."STATUS",''))) AS "ST"
             FROM "OPORT_CAMPANHA_CONVOCACAO" oc
             INNER JOIN "CONVOCACAO" c ON c."IDCONVOCACAO" = oc."IDCONVOCACAO" AND c."TENANT_ID" = oc."TENANT_ID"
            WHERE oc."TENANT_ID"=$1 AND oc."ID_CAMPANHA"=$2 AND oc."ID_DESTINATARIO"=$3 AND oc."IDVIAGEM"=$4
            LIMIT 1`,
          [tenantId, idCampanha, idDest, idViagem]
        );
        const curSt = String((snap.rows || [])[0]?.ST ?? (snap.rows || [])[0]?.st ?? '').trim();
        const travSnap = new Set(['CONFIRMADA', 'ACEITA_DESCARTADA']);
        let msg =
          'O status desta convocação mudou enquanto você respondia (torre ou outro canal). Atualize a página.';
        if (curSt && travSnap.has(curSt)) {
          msg =
            curSt === 'CONFIRMADA'
              ? 'Esta convocação já foi confirmada na torre. Não é possível alterar pela página de oportunidades.'
              : 'Esta oportunidade já foi encerrada para você (não selecionada). Não é possível alterar aqui.';
        } else if (!curSt) {
          msg = 'Não foi possível atualizar a convocação. Atualize a página ou use o link enviado pela transportadora.';
        }
        return res.status(409).json({ error: msg, statusAtual: curSt || null, conflict: true });
      }

      if (coords && mudancaParaAceita) {
        try {
          await pool.query(
            `UPDATE "CONVOCACAO" c
                SET "DH_LOCALIZACAO_MOTORISTA" = CURRENT_TIMESTAMP,
                    "DHMAINTENANCE" = CURRENT_TIMESTAMP
              WHERE c."TENANT_ID"=$1
                AND c."IDVIAGEM"=$2
                AND c."IDCONVOCACAO" IN (
                  SELECT oc."IDCONVOCACAO"
                    FROM "OPORT_CAMPANHA_CONVOCACAO" oc
                   WHERE oc."TENANT_ID"=$1
                     AND oc."ID_CAMPANHA"=$3
                     AND oc."ID_DESTINATARIO"=$4
                     AND oc."IDVIAGEM"=$2
                )`,
            [tenantId, idViagem, idCampanha, idDest]
          );
        } catch (eDh) {
          if (eDh.code !== '42703') console.warn('[oport] DH_LOCALIZACAO_MOTORISTA (aceita):', eDh.message);
        }
      }

      const detAudit = [
        `conv_status:${oldStatus}->${newStatus}`,
        `idviagem:${idViagem}`,
        'origem:link_oport_publica'
      ].join(';');
      await registrarEvento(pool, {
        tenantId,
        idCampanha,
        idDestinatario: idDest,
        idViagem,
        tipo: acao === 'RECUSA' ? 'MOTORISTA_RECUSA' : 'MOTORISTA_INTERESSE',
        detalhes: detAudit,
        ip: req.ip,
        ua: req.headers['user-agent'] || null
      });

      const cfg = await alertNotificationService.getConfig(pool, tenantId);
      const switchCfg = cfg.switch || {};
      if (switchCfg.token) {
        const cont = await pool.query(
          `SELECT cg."NRCELULAR" AS celular
             FROM "VIAGEMMESTRE" v
             LEFT JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = v."CDCONTRATADOR" AND cg."TENANT_ID" = v."TENANT_ID"
            WHERE v."TENANT_ID"=$1 AND v."IDVIAGEM"=$2
            LIMIT 1`,
          [tenantId, idViagem]
        );
        const cel = cont.rows && cont.rows[0] ? String(cont.rows[0].celular || '') : '';
        if (cel) {
          const nome = String(dest.NOME_MOTORISTA || dest.nome_motorista || 'Motorista');
          const acaoWhatsapp =
            acao === 'RECUSA'
              ? '*recusou na oportunidade*'
              : '*demonstrou interesse na oportunidade*';
          const msg =
            `Atenção: *${nome}*\n${acaoWhatsapp}\nViagem #${idViagem}\n\nFavor tratar no Relatório de Convocações.`;
          await alertNotificationService.sendViaSwitch(switchCfg, cel, msg);
        }
      }
      res.json({ success: true, unchanged: false, status: newStatus });
    } catch (err) {
      console.error('[oport] publicoInteresse:', err);
      res.status(500).json({ error: 'Erro ao registrar interesse.' });
    }
  }
};

module.exports = controller;
