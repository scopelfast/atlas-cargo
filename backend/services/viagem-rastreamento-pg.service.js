'use strict';

/**
 * Descobre tabela/schema reais de rastreamento no PostgreSQL e mapeia colunas (idviagem vs ID_VIAGEM, latitude vs LATITUDE, etc.).
 * Um único OID evita misturar colunas de duas tabelas homônimas em public/dbo.
 */

function quotePgIdent(name) {
  const s = String(name || '');
  return '"' + s.replace(/"/g, '""') + '"';
}

let cachedCtx = null;

function resolveColsFromAttnames(list) {
  const pick = (...candidates) => {
    for (const c of candidates) {
      const found = list.find((x) => x.toLowerCase() === String(c).toLowerCase());
      if (found) return quotePgIdent(found);
    }
    return null;
  };
  return {
    idv: pick('IDVIAGEM', 'idviagem', 'id_viagem', 'ID_VIAGEM', 'viagem_id'),
    lat: pick('LATITUDE', 'latitude', 'lat', 'vl_latitude', 'coord_lat'),
    lon: pick('LONGITUDE', 'longitude', 'lon', 'lng', 'vl_longitude', 'coord_lon'),
    dh: pick('DHREGISTRO', 'dhregistro', 'DH_REGISTRO', 'dt_registro', 'created_at', 'dh_posicao'),
    dhp: pick('DHPOSICAO', 'dhpOSICAO', 'dhposicao', 'dt_posicao'),
    vel: pick('VELOCIDADE', 'velocidade', 'vel', 'speed'),
    // Evitar o candidato curto "seq" (colisão com outros campos); incluir nomes comuns de migração.
    seq: pick(
      'SEQUENCIA',
      'sequencia',
      'NR_SEQUENCIA',
      'nr_sequencia',
      'NRSEQ',
      'nrseq',
    ),
    dsp: pick('DSPOSICAO', 'dsposicao', 'ds_posicao'),
    prec: pick('PRECISAO', 'precisao', 'NRPRECISAO', 'nrprecisao', 'nr_precisao'),
    bat: pick('BATERIA', 'bateria'),
    tipo: pick('TIPO', 'tipo'),
    fonte: pick('FONTE', 'fonte'),
    fgstatus: pick('FGSTATUS', 'fgstatus'),
    fgactive: pick('FGACTIVE', 'fgactive'),
    cdcad: pick('CDCADASTRO', 'cdcadastro', 'cd_cadastro'),
    alt: pick('ALTITUDE', 'altitude'),
    dir: pick('DIRECAO', 'direcao'),
    ver: pick('VERSAOAPP', 'versaoapp', 'versao_app'),
    tenant: pick('TENANT_ID', 'tenant_id'),
  };
}

function emptyCols() {
  return {
    idv: null,
    lat: null,
    lon: null,
    dh: null,
    dhp: null,
    vel: null,
    seq: null,
    dsp: null,
    prec: null,
    bat: null,
    tipo: null,
    fonte: null,
    fgstatus: null,
    fgactive: null,
    cdcad: null,
    alt: null,
    dir: null,
    ver: null,
    tenant: null,
  };
}

/**
 * @returns {Promise<{ fromSql: string, schema: string, tablename: string, cols: ReturnType<typeof resolveColsFromAttnames>, found: boolean }>}
 */
async function resolveViagemRastreamentoPg(pool) {
  // Cache com found=false vinha de bug (tabela vazia no 1º boot): invalidar e redescobrir.
  if (cachedCtx && !cachedCtx.found) cachedCtx = null;
  if (cachedCtx) return cachedCtx;

  let schema = 'public';
  let tablename = 'VIAGEMRASTREAMENTO';
  let found = false;

  for (const logical of ['viagemrastreamento', 'viagem_rastreamento']) {
    const r = await pool.query(
      `SELECT schemaname::text AS sc, tablename::text AS tn
       FROM pg_tables
       WHERE schemaname IN ('dbo', 'public') AND LOWER(tablename) = $1`,
      [logical]
    );
    const rows = r.rows || [];
    const scored = [];
    for (const row of rows) {
      const sc = String(row.sc ?? row.SC ?? 'public').trim();
      const tn = String(row.tn ?? row.TN ?? '').trim();
      if (!tn) continue;
      const fs = `${quotePgIdent(sc)}.${quotePgIdent(tn)}`;
      try {
        // Tabela vazia: LIMIT 1 retornaria 0 linhas — não usar como critério de existência.
        await pool.query(`SELECT 1 FROM ${fs} LIMIT 0`);
        const cnt = await pool.query(`SELECT COUNT(*)::bigint AS c FROM ${fs}`);
        const c = Number(cnt.rows[0]?.c ?? cnt.rows[0]?.C ?? 0);
        scored.push({ sc, tn, fromSql: fs, c });
      } catch (_) {
        /* sem acesso ou relação inexistente */
      }
    }
    if (!scored.length) continue;
    scored.sort((a, b) => {
      if (b.c !== a.c) return b.c - a.c;
      // Ambas vazias: public primeiro (INSERT sem schema costuma resolver em public).
      if (a.c === 0 && b.c === 0) {
        if (a.sc === 'public' && b.sc !== 'public') return -1;
        if (b.sc === 'public' && a.sc !== 'public') return 1;
      }
      if (a.sc === 'dbo' && b.sc !== 'dbo') return -1;
      if (b.sc === 'dbo' && a.sc !== 'dbo') return 1;
      return 0;
    });
    const best = scored[0];
    schema = best.sc;
    tablename = best.tn;
    found = true;
    break;
  }

  let cols = emptyCols();
  let relOid = null;
  if (found) {
    const oidRow = await pool.query(
      `SELECT c.oid::oid AS oid
       FROM pg_class c
       INNER JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r', 'p')
         AND n.nspname::text = $1
         AND c.relname::text = $2
       LIMIT 1`,
      [schema, tablename],
    );
    relOid = oidRow.rows[0]?.oid ?? oidRow.rows[0]?.OID ?? null;
    if (!relOid) {
      found = false;
      cols = emptyCols();
    } else {
      const att = await pool.query(
        `SELECT a.attname::text AS an
         FROM pg_attribute a
         WHERE a.attrelid = $1::oid
           AND a.attnum > 0
           AND NOT a.attisdropped
         ORDER BY a.attnum`,
        [relOid],
      );
      const list = (att.rows || []).map((x) => String(x.an ?? x.AN ?? '').trim()).filter(Boolean);
      cols = resolveColsFromAttnames(list);
    }
  }

  const fromSql = `${quotePgIdent(schema)}.${quotePgIdent(tablename)}`;
  cachedCtx = { fromSql, schema, tablename, cols, found, relOid };
  return cachedCtx;
}

function clearViagemRastreamentoPgCache() {
  cachedCtx = null;
}

/** Confirma que o identificador citado existe na relação alvo (evita cache/schema errado). */
async function pgQuotedColumnExists(pool, fromSql, quotedIdent) {
  if (!quotedIdent) return false;
  try {
    await pool.query(`SELECT ${quotedIdent} FROM ${fromSql} LIMIT 0`);
    return true;
  } catch (e) {
    if (e && e.code === '42703') return false;
    throw e;
  }
}

/** Expressão de “data da posição” para ORDER BY / filtro (DHPOSICAO ou DHREGISTRO). */
function exprDhPosicaoGps(cols) {
  if (cols.dhp && cols.dh) return `COALESCE(${cols.dhp}, ${cols.dh})`;
  if (cols.dh) return cols.dh;
  if (cols.dhp) return cols.dhp;
  return null;
}

/** Mesma lógica que exprDhPosicaoGps, com prefixo de alias `vr.` (queries com JOIN). */
function vrDhOrdSql(cols) {
  if (cols.dhp && cols.dh) return `COALESCE(vr.${cols.dhp}, vr.${cols.dh})`;
  if (cols.dh) return `vr.${cols.dh}`;
  if (cols.dhp) return `vr.${cols.dhp}`;
  return null;
}

/** Normaliza chaves do row do PG para LATITUDE / LONGITUDE / DHREGISTRO / VELOCIDADE. */
function rowRastreamentoCanon(row) {
  if (!row) return null;
  return {
    ...row,
    LATITUDE: row.LATITUDE ?? row.latitude,
    LONGITUDE: row.LONGITUDE ?? row.longitude,
    DHREGISTRO: row.DHREGISTRO ?? row.dhregistro ?? row.DHPOSICAO ?? row.dhpOSICAO ?? row.dhposicao,
    VELOCIDADE: row.VELOCIDADE ?? row.velocidade,
  };
}

/**
 * INSERT de ponto GPS na tabela de rastreamento da viagem (PostgreSQL).
 * Monta colunas com os nomes reais descobertos em pg_attribute (evita 500 por coluna inexistente / casing).
 */
async function insertGpsViagemRastreamento(pool, opts) {
  const { getFirstNumericValue } = require('../config/db');

  const {
    tenantId,
    idViagem,
    cdCadastro,
    latitude,
    longitude,
    velocidade,
    precisao,
    altitude,
    fgstatus,
    direcao,
    tipo,
    dsPosicao,
    versaoApp,
    dataPosicao,
  } = opts;

  const ctx = await resolveViagemRastreamentoPg(pool);
  if (!ctx.found || !ctx.cols.idv || !ctx.cols.lat || !ctx.cols.lon || !ctx.cols.cdcad) {
    throw new Error(
      'Tabela de rastreamento não encontrada ou sem colunas mínimas (IDVIAGEM/LATITUDE/LONGITUDE/CDCADASTRO).',
    );
  }
  const { fromSql, cols } = ctx;
  if (!cols.dhp && !cols.dh) {
    throw new Error(
      'Tabela de rastreamento sem coluna de data da posição (DHPOSICAO ou DHREGISTRO).',
    );
  }

  let seqCol = cols.seq;
  if (seqCol && !(await pgQuotedColumnExists(pool, fromSql, seqCol))) {
    clearViagemRastreamentoPgCache();
    seqCol = null;
  }

  let proximaSequencia = 1;
  if (seqCol) {
    const seqResult = await pool.query(
      `SELECT COALESCE(MAX(${seqCol}), 0) + 1 AS proximaSequencia FROM ${fromSql} WHERE ${cols.idv} = $1`,
      [parseFloat(idViagem)],
    );
    proximaSequencia = getFirstNumericValue(seqResult.rows, 1);
  }

  const dp = dataPosicao instanceof Date ? dataPosicao : new Date(dataPosicao);
  const params = [];
  const fragments = [];

  function addColumn(colIdent, value) {
    params.push(value);
    fragments.push({ col: colIdent, ph: '$' + params.length });
  }

  function addTimestampLiteral(colIdent) {
    fragments.push({ col: colIdent, ph: 'CURRENT_TIMESTAMP' });
  }

  addColumn(cols.idv, parseFloat(idViagem));
  addColumn(cols.cdcad, parseFloat(cdCadastro));
  addColumn(cols.lat, parseFloat(latitude));
  addColumn(cols.lon, parseFloat(longitude));

  if (cols.vel) addColumn(cols.vel, velocidade != null ? velocidade : null);
  if (cols.prec) addColumn(cols.prec, precisao != null ? Math.round(Number(precisao)) : null);

  if (cols.alt && altitude != null && altitude !== '' && Number.isFinite(parseFloat(altitude))) {
    addColumn(cols.alt, parseFloat(altitude));
  }

  if (cols.fgstatus) {
    addColumn(cols.fgstatus, String(fgstatus || 'P').trim().charAt(0) || 'P');
  }

  if (cols.dir && direcao != null && direcao !== '' && Number.isFinite(parseFloat(direcao))) {
    addColumn(cols.dir, parseFloat(direcao));
  }

  if (seqCol) addColumn(seqCol, proximaSequencia);

  const dspMax = 480;
  const dspStr = String(dsPosicao || '').slice(0, dspMax);
  if (cols.dsp) addColumn(cols.dsp, dspStr);

  if (cols.dhp && cols.dh && cols.dhp !== cols.dh) {
    addColumn(cols.dhp, dp);
    addTimestampLiteral(cols.dh);
  } else if (cols.dhp && cols.dh && cols.dhp === cols.dh) {
    addColumn(cols.dhp, dp);
  } else if (cols.dh) {
    addColumn(cols.dh, dp);
  } else if (cols.dhp) {
    addColumn(cols.dhp, dp);
  }

  if (cols.tipo) addColumn(cols.tipo, String(tipo || 'M').trim().charAt(0) || 'M');
  if (cols.fonte) addColumn(cols.fonte, 'APP');
  if (cols.ver && versaoApp) addColumn(cols.ver, String(versaoApp).slice(0, 20));
  if (cols.tenant && tenantId != null && String(tenantId).trim() !== '') {
    addColumn(cols.tenant, String(tenantId).trim());
  }
  if (cols.fgactive) addColumn(cols.fgactive, 'T');

  const colSql = fragments.map((f) => f.col).join(', ');
  const valSql = fragments.map((f) => f.ph).join(', ');
  const sqlText = `INSERT INTO ${fromSql} (${colSql}) VALUES (${valSql})`;

  try {
    await pool.query(sqlText, params);
  } catch (err) {
    err.message = `[VIAGEMRASTREAMENTO INSERT] ${err.message}`;
    throw err;
  }
}

module.exports = {
  resolveViagemRastreamentoPg,
  clearViagemRastreamentoPgCache,
  rowRastreamentoCanon,
  quotePgIdent,
  exprDhPosicaoGps,
  vrDhOrdSql,
  insertGpsViagemRastreamento,
};
