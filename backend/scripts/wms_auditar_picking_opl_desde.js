'use strict';

/**
 * Auditoria: espelhos OPL, picking gravado e reservas desde uma data.
 * Uso: node scripts/wms_auditar_picking_opl_desde.js [tenantId] [YYYY-MM-DD]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../config/db');

const tenantId = process.argv[2] || 'default';
const desde = process.argv[3] || '2026-05-18';

async function main() {
  const espelhos = await pool.query(
    `SELECT a."CD_OPL_ARQUIVO", a."NM_ARQUIVO", a."DH_IMPORT", a."SG_USER", a."Q_PEDIDOS", a."Q_ITENS", a."CD_DONO",
            COUNT(i."CD_OPL_ITEM")::int AS tot_itens,
            COUNT(i."CD_OPL_ITEM") FILTER (WHERE i."QT_COLETADA" IS NOT NULL)::int AS com_coletada,
            COUNT(i."CD_OPL_ITEM") FILTER (WHERE i."QT_COLETADA" IS NOT NULL AND i."QT_COLETADA" = i."QT_PEDIDA")::int AS ok_iguais,
            COUNT(i."CD_OPL_ITEM") FILTER (WHERE i."QT_COLETADA" IS NOT NULL AND i."QT_COLETADA" IS DISTINCT FROM i."QT_PEDIDA")::int AS divergentes,
            COUNT(i."CD_OPL_ITEM") FILTER (WHERE i."QT_COLETADA" IS NULL)::int AS pendentes
       FROM "WMS_OPL_ARQUIVO" a
       LEFT JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
       LEFT JOIN "WMS_OPL_ITEM" i ON i."CD_OPL_PEDIDO" = p."CD_OPL_PEDIDO"
      WHERE a."TENANT_ID" = $1
        AND a."DH_IMPORT" >= $2::date
      GROUP BY a."CD_OPL_ARQUIVO", a."NM_ARQUIVO", a."DH_IMPORT", a."SG_USER", a."Q_PEDIDOS", a."Q_ITENS", a."CD_DONO"
      ORDER BY a."DH_IMPORT"`,
    [tenantId, desde]
  );

  const reservas = await pool.query(
    `SELECT r."CD_OPL_ARQUIVO", COUNT(*)::int AS skus, SUM(r."QTD_RESERVADA")::numeric AS qtd_total
       FROM "WMS_RESERVA_ESTOQUE_OPL" r
       JOIN "WMS_OPL_ARQUIVO" a ON a."CD_OPL_ARQUIVO" = r."CD_OPL_ARQUIVO" AND a."TENANT_ID" = r."TENANT_ID"
      WHERE r."TENANT_ID" = $1 AND a."DH_IMPORT" >= $2::date
      GROUP BY r."CD_OPL_ARQUIVO"`,
    [tenantId, desde]
  );
  const resMap = new Map(reservas.rows.map((r) => [r.CD_OPL_ARQUIVO, r]));

  let cargasOpl = { rows: [] };
  try {
    cargasOpl = await pool.query(
      `SELECT DISTINCT a."CD_OPL_ARQUIVO", c."CD_CARGA", c."NM_DESCRICAO", c."ST_CARGA",
              COALESCE(e."ST_EXPEDICAO", '—') AS st_exp
         FROM "WMS_OPL_ARQUIVO" a
         JOIN "WMS_OPL_PEDIDO" p ON p."CD_OPL_ARQUIVO" = a."CD_OPL_ARQUIVO"
         JOIN "WMS_CARGA_PEDIDO" cp ON cp."TENANT_ID" = a."TENANT_ID"
           AND regexp_replace(TRIM(cp."NR_PEDIDO"), '^0+', '') = regexp_replace(TRIM(p."NUM_PEDIDO"), '^0+', '')
         JOIN "WMS_CARGA_PROGRAMADA" c ON c."CD_CARGA" = cp."CD_CARGA" AND c."TENANT_ID" = cp."TENANT_ID"
         LEFT JOIN "WMS_EXPEDICAO_CARGA" e ON e."CD_CARGA" = c."CD_CARGA" AND e."TENANT_ID" = c."TENANT_ID"
        WHERE a."TENANT_ID" = $1 AND a."DH_IMPORT" >= $2::date
        ORDER BY a."CD_OPL_ARQUIVO", c."CD_CARGA"`,
      [tenantId, desde]
    );
  } catch (e) {
    cargasOpl.err = e.message;
  }

  const exp = await pool.query(
    `SELECT COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e."ST_EXPEDICAO",''))) = 'EXPEDIDA')::int AS expedidas,
            COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e."ST_EXPEDICAO",''))) = 'EM_EXPEDICAO')::int AS em_exp
       FROM "WMS_EXPEDICAO_CARGA" e
       JOIN "WMS_CARGA_PROGRAMADA" c ON c."CD_CARGA" = e."CD_CARGA" AND c."TENANT_ID" = e."TENANT_ID"
      WHERE e."TENANT_ID" = $1
        AND COALESCE(e."DH_INICIO", e."DH_ATUALIZACAO", c."DH_CRIACAO") >= $2::date`,
    [tenantId, desde]
  ).catch((e) => ({ rows: [], err: e.message }));

  const rec = await pool.query(
    `SELECT COUNT(*)::int AS docs,
            COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE("ST_RECEBIMENTO",''))) IN ('ENCERRADO','CONFERIDO'))::int AS encerrados
       FROM "WMS_NFE_RECEBIMENTO"
      WHERE "TENANT_ID" = $1 AND "DH_IMPORT" >= $2::date`,
    [tenantId, desde]
  ).catch((e) => ({ rows: [], err: e.message }));

  const mov = await pool.query(
    `SELECT COUNT(*)::int AS linhas,
            COUNT(DISTINCT "REF_CD_CARGA") FILTER (WHERE "REF_CD_CARGA" IS NOT NULL)::int AS cargas_ref,
            COUNT(DISTINCT "REF_CD_OPL_ARQUIVO") FILTER (WHERE "REF_CD_OPL_ARQUIVO" IS NOT NULL)::int AS opl_ref
       FROM "WMS_MOVIMENTO_ESTOQUE_LEDGER"
      WHERE "TENANT_ID" = $1 AND "DH_MOVIMENTO" >= $2::date`,
    [tenantId, desde]
  ).catch((e) => ({ rows: [], err: e.message }));

  const cats = { auto_ok: [], parcial: [], com_div: [], pendente: [], vazio: [] };
  let totItens = 0;
  let totColetada = 0;
  let totAutoOk = 0;
  let totDiv = 0;

  for (const r of espelhos.rows) {
    totItens += r.tot_itens || 0;
    totColetada += r.com_coletada || 0;
    totAutoOk += r.ok_iguais || 0;
    totDiv += r.divergentes || 0;
    const t = r.tot_itens || 0;
    const c = r.com_coletada || 0;
    const item = { ...r, reserva: resMap.get(r.CD_OPL_ARQUIVO) };
    if (t === 0) cats.vazio.push(item);
    else if (c === 0) cats.pendente.push(item);
    else if (c >= t && (r.divergentes || 0) === 0) cats.auto_ok.push(item);
    else if ((r.divergentes || 0) > 0) cats.com_div.push(item);
    else cats.parcial.push(item);
  }

  const out = {
    desde,
    tenantId,
    espelhos: espelhos.rows.length,
    categorias: {
      suspeito_auto_ok: cats.auto_ok.length,
      com_divergencia: cats.com_div.length,
      parcial: cats.parcial.length,
      pendente: cats.pendente.length,
    },
    itens: { totais: totItens, com_coletada: totColetada, ok_iguais: totAutoOk, divergentes: totDiv },
    reservas: {
      espelhos: reservas.rows.length,
      skus: reservas.rows.reduce((s, r) => s + (r.skus || 0), 0),
    },
    expedicao: exp.rows[0] || exp.err,
    recebimento: rec.rows[0] || rec.err,
    ledger: mov.rows[0] || mov.err,
    cargas_vinculos: cargasOpl.err || cargasOpl.rows.length,
    lista_suspeitos: cats.auto_ok.map((e) => ({
      id: e.CD_OPL_ARQUIVO,
      data: e.DH_IMPORT,
      arquivo: e.NM_ARQUIVO,
      picking: `${e.com_coletada}/${e.tot_itens}`,
      reserva_skus: e.reserva ? e.reserva.skus : 0,
    })),
    lista_com_div: cats.com_div.map((e) => ({
      id: e.CD_OPL_ARQUIVO,
      arquivo: e.NM_ARQUIVO,
      div: e.divergentes,
      picking: `${e.com_coletada}/${e.tot_itens}`,
    })),
  };

  const susIds = new Set(cats.auto_ok.map((e) => e.CD_OPL_ARQUIVO));
  const cargasSus = (cargasOpl.rows || []).filter((r) => susIds.has(r.CD_OPL_ARQUIVO));
  const cargasUnicas = [...new Map(cargasSus.map((r) => [r.CD_CARGA, r])).values()];
  out.cargas_suspeitas = {
    total: cargasUnicas.length,
    expedidas: cargasUnicas.filter((r) => String(r.st_exp).toUpperCase() === 'EXPEDIDA').map((r) => r.CD_CARGA),
    em_expedicao: cargasUnicas.filter((r) => String(r.st_exp).toUpperCase() === 'EM_EXPEDICAO').map((r) => r.CD_CARGA),
  };

  // expedição / cargas / reservas (totais)
  try {
    const rExp = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e."ST_EXPEDICAO",''))) = 'EXPEDIDA')::int AS expedidas,
              COUNT(*) FILTER (WHERE UPPER(TRIM(COALESCE(e."ST_EXPEDICAO",''))) = 'EM_EXPEDICAO')::int AS em_exp
         FROM "WMS_EXPEDICAO_CARGA" e
        WHERE e."TENANT_ID" = $1`,
      [tenantId]
    );
    out.expedicao_total = rExp.rows[0];
  } catch (e) {
    out.expedicao_total = { err: e.message };
  }
  try {
    const rC = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE "DH_CRIACAO" >= $2::date)::int AS desde
         FROM "WMS_CARGA_PROGRAMADA" WHERE "TENANT_ID" = $1`,
      [tenantId, desde]
    );
    out.cargas = rC.rows[0];
  } catch (e) {
    out.cargas = { err: e.message };
  }
  try {
    const rR = await pool.query(
      `SELECT COUNT(*)::int AS linhas, COUNT(DISTINCT "CD_OPL_ARQUIVO")::int AS espelhos,
              COUNT(DISTINCT "CD_PRODUTO")::int AS produtos
         FROM "WMS_RESERVA_ESTOQUE_OPL" WHERE "TENANT_ID" = $1`,
      [tenantId]
    );
    out.reservas_total = rR.rows[0];
  } catch (e) {
    out.reservas_total = { err: e.message };
  }
  try {
    const rE = await pool.query(
      `SELECT COUNT(*)::int AS expedidas FROM "WMS_EXPEDICAO_CARGA" e
         JOIN "WMS_CARGA_PROGRAMADA" c ON c."CD_CARGA"=e."CD_CARGA" AND c."TENANT_ID"=e."TENANT_ID"
        WHERE e."TENANT_ID"=$1 AND UPPER(TRIM(COALESCE(e."ST_EXPEDICAO",'')))='EXPEDIDA'
          AND c."DH_CRIACAO">=$2::date`,
      [tenantId, desde]
    );
    out.expedidas_desde = rE.rows[0];
  } catch (e) {
    out.expedidas_desde = { err: e.message };
  }

  console.log(JSON.stringify(out, null, 2));
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
