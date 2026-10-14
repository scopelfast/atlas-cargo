'use strict';

const { pool } = require('../config/db');
const { buildWhereCargasProgramadas, trimQuery } = require('./wms-carga-programada-filtro.service');
const { buildWhereNfesSaida, CARGAS_TXT_SQL } = require('./wms-nfe-saida-filtro.service');

const MAX_LINHAS_EXPORT = 15000;

function schemaMissing(err) {
  return err && (err.code === '42P01' || err.code === '42703');
}

function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[;"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function csvLine(cols) {
  return cols.map(csvCell).join(';');
}

function fmtDhIso(v) {
  if (v == null) return '';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const ID_VIAGEM_ROTA_SQL = `(
  SELECT ro."IDVIAGEM"
    FROM "WMS_CARGA_ROTA_OPERACIONAL" ro
    INNER JOIN "VIAGEMMESTRE" v ON v."IDVIAGEM" = ro."IDVIAGEM" AND v."TENANT_ID" = ro."TENANT_ID"
   WHERE ro."TENANT_ID" = c."TENANT_ID"
     AND ro."CD_CARGA" = c."CD_CARGA"
     AND ro."ST_ROTA" = 'CALCULADA'
     AND ro."IDVIAGEM" IS NOT NULL
     AND (v."FGACTIVE" = 'A' OR v."FGACTIVE" = 'S')
     AND COALESCE(upper(trim(v."FGSITVIAGEM"::text)), '') <> 'C'
   ORDER BY ro."VERSAO" DESC, ro."CD_ROTA_OPER" DESC
   LIMIT 1
)`;

/**
 * NF-e vinculadas a cargas que passam nos filtros do grid (+ número/série/viagem).
 */
async function listarNfExportacaoCargas(tenantId, query) {
  const { where, params } = buildWhereCargasProgramadas(tenantId, query, { applyStExpedicao: true });
  const wc = `WHERE ${where.join(' AND ')}`;
  const numeroNf = trimQuery(query.numeroNf ?? query.numero_nf ?? query.nuNf);
  const serie = trimQuery(query.serie ?? query.nuSerie);
  let nfClause = '';
  if (numeroNf) {
    const dig = numeroNf.replace(/\D/g, '');
    if (dig) {
      params.push(`%${dig}%`);
      nfClause += ` AND regexp_replace(trim(COALESCE(n."NUMERO_NF", '')), '[^0-9]', '', 'g') LIKE $${params.length}`;
    } else {
      params.push(`%${numeroNf.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`);
      nfClause += ` AND n."NUMERO_NF" ILIKE $${params.length} ESCAPE '\\'`;
    }
  }
  if (serie) {
    params.push(serie);
    nfClause += ` AND trim(COALESCE(n."SERIE", '')) = $${params.length}`;
  }

  const sql = `
    SELECT
      c."CD_CARGA",
      c."NM_DESCRICAO",
      c."ST_CARGA",
      c."DH_CRIACAO" AS "DH_CRIACAO_CARGA",
      COALESCE(ex."ST_EXPEDICAO", 'PRONTA_EXPEDICAO') AS "ST_EXPEDICAO",
      ex."DH_INICIO" AS "DH_INICIO_EXPEDICAO",
      ex."DH_SAIDA",
      ${ID_VIAGEM_ROTA_SQL} AS "IDVIAGEM",
      j."ORDEM",
      j."DH_INCLUSAO" AS "DH_INCLUSAO_CARGA",
      n."CD_NFE_SAIDA",
      n."NUMERO_NF",
      n."SERIE",
      n."CHAVE_NFE",
      n."DH_EMISSAO",
      n."DH_IMPORTACAO",
      n."CD_DONO",
      d."NOME" AS "NM_DONO",
      n."CNPJ_DEST",
      n."XNOME_DEST",
      n."CNPJ_ENTREGA",
      n."XNOME_ENTREGA",
      n."XLGR_DEST",
      n."NRO_DEST",
      n."XBAIRRO_DEST",
      n."XMUN_DEST",
      n."UF_DEST",
      n."CEP_DEST",
      n."Q_ITENS",
      n."VNF_TOTAL"
      FROM "WMS_CARGA_PROGRAMADA" c
      INNER JOIN "WMS_CARGA_PROGRAMADA_NFE" j ON j."CD_CARGA" = c."CD_CARGA"
      INNER JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA" AND n."TENANT_ID" = c."TENANT_ID"
      LEFT JOIN "WMS_EXPEDICAO_CARGA" ex
        ON ex."CD_CARGA" = c."CD_CARGA" AND ex."TENANT_ID" = c."TENANT_ID"
      LEFT JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = n."CD_DONO" AND d."TENANT_ID" = n."TENANT_ID"
     ${wc}
       ${nfClause}
     ORDER BY c."CD_CARGA", j."ORDEM", j."CD_NFE_SAIDA"
     LIMIT ${MAX_LINHAS_EXPORT}`;

  try {
    const r = await pool.query(sql, params);
    return { rows: r.rows || [], truncado: (r.rows || []).length >= MAX_LINHAS_EXPORT };
  } catch (e) {
    if (schemaMissing(e)) return { err: 'schema', message: e.message };
    throw e;
  }
}

function montarCsvNfCargas(rows, meta) {
  meta = meta || {};
  const header = [
    'CD_CARGA',
    'DESCRICAO_CARGA',
    'ST_CARGA',
    'ST_EXPEDICAO',
    'DH_CRIACAO_CARGA',
    'DH_INICIO_EXPEDICAO',
    'DH_SAIDA',
    'IDVIAGEM',
    'ORDEM_NF',
    'CD_NFE_SAIDA',
    'NUMERO_NF',
    'SERIE',
    'CHAVE_NFE',
    'DH_EMISSAO',
    'DH_IMPORTACAO',
    'CD_DONO',
    'NM_DONO',
    'CNPJ_DEST',
    'RAZAO_DEST',
    'CNPJ_ENTREGA',
    'NOME_ENTREGA',
    'LOGRADOURO',
    'NUMERO',
    'BAIRRO',
    'CIDADE',
    'UF',
    'CEP',
    'Q_ITENS',
    'VNF_TOTAL',
  ];
  const lines = [csvLine(header)];
  for (const r of rows || []) {
    lines.push(
      csvLine([
        r.CD_CARGA,
        r.NM_DESCRICAO,
        r.ST_CARGA,
        r.ST_EXPEDICAO,
        fmtDhIso(r.DH_CRIACAO_CARGA),
        fmtDhIso(r.DH_INICIO_EXPEDICAO),
        fmtDhIso(r.DH_SAIDA),
        r.IDVIAGEM,
        r.ORDEM,
        r.CD_NFE_SAIDA,
        r.NUMERO_NF,
        r.SERIE,
        r.CHAVE_NFE,
        fmtDhIso(r.DH_EMISSAO),
        fmtDhIso(r.DH_IMPORTACAO),
        r.CD_DONO,
        r.NM_DONO,
        r.CNPJ_DEST,
        r.XNOME_DEST,
        r.CNPJ_ENTREGA,
        r.XNOME_ENTREGA,
        r.XLGR_DEST,
        r.NRO_DEST,
        r.XBAIRRO_DEST,
        r.XMUN_DEST,
        r.UF_DEST,
        r.CEP_DEST,
        r.Q_ITENS,
        r.VNF_TOTAL,
      ])
    );
  }
  if (meta.truncado) {
    lines.push(
      csvLine([
        'AVISO',
        `Exportação limitada a ${MAX_LINHAS_EXPORT} linhas — refine os filtros.`,
      ])
    );
  }
  return lines.join('\r\n');
}

/** NF-e importadas (com ou sem carga), filtros da aba Filtros. */
async function listarNfExportacaoImportadas(tenantId, query) {
  const { where, params } = buildWhereNfesSaida(tenantId, query);
  const sqlComRota = `
    SELECT n.*,
           EXISTS (SELECT 1 FROM "WMS_CARGA_PROGRAMADA_NFE" j WHERE j."CD_NFE_SAIDA" = n."CD_NFE_SAIDA") AS "EM_CARGA",
           ${CARGAS_TXT_SQL} AS "CARGAS_TXT",
           d."NOME" AS "NM_DONO",
           e."NR_ROTA" AS "EE_NR_ROTA"
      FROM "WMS_NFE_SAIDA" n
      LEFT JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = n."CD_DONO" AND d."TENANT_ID" = n."TENANT_ID"
      LEFT JOIN "CADASTRO_ENDERECO_ENTREGA" e
        ON e."CD_ENDERECO_ENTREGA" = n."CD_ENDERECO_ENTREGA"
       AND e."TENANT_ID" = n."TENANT_ID"
       AND e."FGACTIVE" = 'A'
     WHERE ${where.join(' AND ')}
     ORDER BY n."DH_IMPORTACAO" DESC, n."CD_NFE_SAIDA" DESC
     LIMIT ${MAX_LINHAS_EXPORT}`;
  const sqlLegado = `
    SELECT n.*,
           EXISTS (SELECT 1 FROM "WMS_CARGA_PROGRAMADA_NFE" j WHERE j."CD_NFE_SAIDA" = n."CD_NFE_SAIDA") AS "EM_CARGA",
           ${CARGAS_TXT_SQL} AS "CARGAS_TXT",
           d."NOME" AS "NM_DONO"
      FROM "WMS_NFE_SAIDA" n
      LEFT JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = n."CD_DONO" AND d."TENANT_ID" = n."TENANT_ID"
     WHERE ${where.join(' AND ')}
     ORDER BY n."DH_IMPORTACAO" DESC, n."CD_NFE_SAIDA" DESC
     LIMIT ${MAX_LINHAS_EXPORT}`;
  try {
    let r;
    try {
      r = await pool.query(sqlComRota, params);
    } catch (e) {
      if (e && e.code === '42703') r = await pool.query(sqlLegado, params);
      else throw e;
    }
    return { rows: r.rows || [], truncado: (r.rows || []).length >= MAX_LINHAS_EXPORT };
  } catch (e) {
    if (schemaMissing(e)) return { err: 'schema', message: e.message };
    throw e;
  }
}

function montarCsvNfImportadas(rows, meta) {
  meta = meta || {};
  const header = [
    'CD_NFE_SAIDA',
    'NUMERO_NF',
    'SERIE',
    'CHAVE_NFE',
    'NR_ROTA',
    'EM_CARGA',
    'CARGAS',
    'DH_EMISSAO',
    'DH_SAIDA',
    'DH_IMPORTACAO',
    'CD_DONO',
    'NM_DONO',
    'CNPJ_DEST',
    'RAZAO_DEST',
    'CNPJ_ENTREGA',
    'NOME_ENTREGA',
    'CIDADE',
    'UF',
    'Q_ITENS',
    'VNF_TOTAL',
  ];
  const lines = [csvLine(header)];
  for (const r of rows || []) {
    lines.push(
      csvLine([
        r.CD_NFE_SAIDA,
        r.NUMERO_NF,
        r.SERIE,
        r.CHAVE_NFE,
        r.EE_NR_ROTA,
        r.EM_CARGA ? 'S' : 'N',
        r.CARGAS_TXT,
        fmtDhIso(r.DH_EMISSAO),
        fmtDhIso(r.DH_SAIDA),
        fmtDhIso(r.DH_IMPORTACAO),
        r.CD_DONO,
        r.NM_DONO,
        r.CNPJ_DEST,
        r.XNOME_DEST,
        r.CNPJ_ENTREGA,
        r.XNOME_ENTREGA,
        r.XMUN_DEST,
        r.UF_DEST,
        r.Q_ITENS,
        r.VNF_TOTAL,
      ])
    );
  }
  if (meta.truncado) {
    lines.push(csvLine(['AVISO', `Exportação limitada a ${MAX_LINHAS_EXPORT} linhas.`]));
  }
  return lines.join('\r\n');
}

module.exports = {
  listarNfExportacaoCargas,
  montarCsvNfCargas,
  listarNfExportacaoImportadas,
  montarCsvNfImportadas,
  MAX_LINHAS_EXPORT,
};
