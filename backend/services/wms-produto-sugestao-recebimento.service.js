'use strict';

const { codigoProdutoMatchKey } = require('../utils/wms-codigo-produto-mask');

function tableMissing(err) {
  return err && err.code === '42P01';
}

function scoreRow(row, ctx) {
  const { digQ, qLower, digC, xLower } = ctx;
  const cod = String(row.CODIGO || '').trim();
  const codOp = String(row.CODIGO_OPERACIONAL || '').trim();
  const codEst = String(row.CODIGO_ESTOQUE || cod).trim();
  const nome = String(row.NOME || '').toLowerCase();
  const cd = codigoProdutoMatchKey(cod);
  const cdOp = codigoProdutoMatchKey(codOp);
  const cdEst = codigoProdutoMatchKey(codEst);
  let score = 0;

  if (digC && (cd === digC || cdOp === digC || cdEst === digC)) score += 500;
  if (digC && cdOp && cdOp.indexOf(digC) === 0) score += 120;
  if (digC && cdEst && cdEst.indexOf(digC) === 0) score += 100;
  // Preferência do sufixo exato do cProd (ex. …4500 → .00, não irmão .01 da mesma família).
  if (digC && digC.length >= 10 && cd && cd.length >= 10 && digC.slice(0, 8) === cd.slice(0, 8)) {
    if (digC.slice(-2) === cd.slice(-2)) score += 80;
    else score -= 40;
  }

  if (xLower && nome) {
    if (nome === xLower) score += 220;
    else if (nome.indexOf(xLower) >= 0 || xLower.indexOf(nome) >= 0) score += 120;
  }

  if (digQ) {
    if (cd === digQ || cdOp === digQ) score += 90;
    else if (cd.indexOf(digQ) >= 0 || cdOp.indexOf(digQ) >= 0 || cdEst.indexOf(digQ) >= 0) score += 55;
    if (cdOp && digQ.indexOf(cdOp) === 0) score += 40;
    if (cdEst && digQ.indexOf(cdEst) === 0) score += 35;
  }
  if (qLower && nome.indexOf(qLower) >= 0) score += 30;
  if (qLower && cod.toLowerCase().indexOf(qLower) >= 0) score += 25;

  if (row._deparaMatch) score += 600;
  return score;
}

/**
 * Busca produtos do dono (estoque + operacional) para autocomplete da conferência NF-e.
 * @returns {Promise<Array<object>>}
 */
async function buscarSugestoesProdutoRecebimento(db, tenantId, cdDono, opts = {}) {
  const q = String(opts.q || '').trim();
  const cProd = String(opts.cProd || '').trim();
  const xProd = String(opts.xProd || '').trim();
  const limitN = Math.min(Math.max(parseInt(opts.limit, 10) || 50, 1), 80);

  const digQ = codigoProdutoMatchKey(q);
  const digC = codigoProdutoMatchKey(cProd);
  const qLower = q.toLowerCase();
  const xLower = xProd.toLowerCase();
  const nomeQ = q.length >= 2 ? `%${q.replace(/%/g, '').replace(/_/g, ' ')}%` : null;
  const nomeX = xProd.length >= 3 ? `%${xProd.replace(/%/g, '').replace(/_/g, ' ')}%` : null;

  if (!digQ && !nomeQ && !digC && !nomeX) return [];

  const byCd = new Map();

  function mesclarLinhaSugestao(prev, next) {
    if (!prev) return { ...next };
    const out = { ...prev, ...next };
    const codPrev = String(prev.CODIGO || '').trim();
    const codNext = String(next.CODIGO || '').trim();
    const est =
      String(next.CODIGO_ESTOQUE || '').trim() ||
      String(prev.CODIGO_ESTOQUE || '').trim() ||
      (codPrev.indexOf('.') >= 0 ? codPrev : '') ||
      (codNext.indexOf('.') >= 0 ? codNext : '');
    if (est) {
      out.CODIGO_ESTOQUE = est;
      out.CODIGO = est;
    }
    const op =
      String(next.CODIGO_OPERACIONAL || '').trim() ||
      (codNext && est && codNext !== est ? codNext : '') ||
      String(prev.CODIGO_OPERACIONAL || '').trim();
    if (op) out.CODIGO_OPERACIONAL = op;
    return out;
  }

  /** Um item por CD_PRODUTO (evita duplicar estoque + operacional na mesma lista). */
  function push(row) {
    const cdProd = parseInt(row.CD_PRODUTO, 10);
    if (!Number.isFinite(cdProd)) return;
    const key = 'id:' + cdProd;
    const prev = byCd.get(key);
    byCd.set(key, mesclarLinhaSugestao(prev, row));
  }

  if (digC) {
    const rDep = await db.query(
      `SELECT d."CODIGO_INTERNO"
         FROM "WMS_DEPARA_PRODUTO" d
        WHERE d."TENANT_ID" = $1 AND d."CD_DONO" = $2::integer
          AND COALESCE(d."FGACTIVE", 'S') = 'S'
          AND LOWER(TRIM(d."CODIGO_EXTERNO")) = LOWER(TRIM($3::text))
        LIMIT 1`,
      [tenantId, cdDono, cProd]
    );
    if (rDep.rows[0]) {
      const interno = String(rDep.rows[0].CODIGO_INTERNO || '').trim();
      const digI = codigoProdutoMatchKey(interno);
      if (digI) {
        const rP = await db.query(
          `SELECT p."CD_PRODUTO", p."CODIGO", p."NOME", p."UNIDADE",
                  COALESCE(p."FG_CONTROLA_LOTE", 'N') AS "FG_CONTROLA_LOTE",
                  COALESCE(p."FG_CONTROLA_VALIDADE", 'N') AS "FG_CONTROLA_VALIDADE",
                  o."MASCARA_CODIGO_PRODUTO"
             FROM "WMS_PRODUTO_DONO" p
             INNER JOIN "WMS_DONO_ESTOQUE" o
               ON o."CD_DONO" = p."CD_DONO" AND o."TENANT_ID" = p."TENANT_ID"
            WHERE p."TENANT_ID" = $1 AND p."CD_DONO" = $2::integer
              AND COALESCE(p."FGACTIVE", 'S') = 'S'
              AND (
                LOWER(TRIM(p."CODIGO")) = LOWER(TRIM($3::text))
                OR LOWER(regexp_replace(TRIM(p."CODIGO"), '[^0-9A-Za-z]', '', 'g')) = $4
              )
            LIMIT 1`,
          [tenantId, cdDono, interno, digI]
        );
        if (rP.rows[0]) {
          push({ ...rP.rows[0], CODIGO_ESTOQUE: rP.rows[0].CODIGO, _deparaMatch: true });
        }
      }
    }
  }

  const filtros = [];
  const params = [tenantId, cdDono];
  let pi = 3;
  if (digQ) {
    filtros.push(
      `LOWER(regexp_replace(TRIM(p."CODIGO"), '[^0-9A-Za-z]', '', 'g')) LIKE $${pi}`
    );
    params.push(`%${digQ}%`);
    pi++;
  }
  if (nomeQ) {
    filtros.push(`UPPER(p."NOME") LIKE UPPER($${pi})`);
    params.push(nomeQ);
    pi++;
  }
  if (!filtros.length && nomeX) {
    filtros.push(`UPPER(p."NOME") LIKE UPPER($${pi})`);
    params.push(nomeX);
    pi++;
  }
  if (!filtros.length && digC) {
    filtros.push(
      `LOWER(regexp_replace(TRIM(p."CODIGO"), '[^0-9A-Za-z]', '', 'g')) LIKE $${pi}`
    );
    params.push(`%${digC}%`);
    pi++;
  }

  if (filtros.length) {
    const sqlP = `
      SELECT p."CD_PRODUTO", p."CODIGO", p."NOME", p."UNIDADE",
             COALESCE(p."FG_CONTROLA_LOTE", 'N') AS "FG_CONTROLA_LOTE",
             COALESCE(p."FG_CONTROLA_VALIDADE", 'N') AS "FG_CONTROLA_VALIDADE",
             o."MASCARA_CODIGO_PRODUTO",
             p."CODIGO" AS "CODIGO_ESTOQUE",
             NULL::text AS "CODIGO_OPERACIONAL",
             NULL::numeric AS "FATOR_CONVERSAO"
        FROM "WMS_PRODUTO_DONO" p
        INNER JOIN "WMS_DONO_ESTOQUE" o
          ON o."CD_DONO" = p."CD_DONO" AND o."TENANT_ID" = p."TENANT_ID"
       WHERE p."TENANT_ID" = $1 AND p."CD_DONO" = $2::integer
         AND COALESCE(p."FGACTIVE", 'S') = 'S'
         AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
         AND (${filtros.join(' OR ')})
       ORDER BY p."NOME", p."CODIGO"
       LIMIT ${limitN + 20}`;
    const rP = await db.query(sqlP, params);
    (rP.rows || []).forEach((row) => push(row));
  }

  try {
    const filtrosOp = [];
    const paramsOp = [tenantId, cdDono];
    let oi = 3;
    if (digQ) {
      filtrosOp.push(
        `(LOWER(regexp_replace(TRIM(op."CODIGO_OPERACIONAL"), '[^0-9A-Za-z]', '', 'g')) LIKE $${oi}
          OR LOWER(regexp_replace(TRIM(op."CODIGO_ESTOQUE"), '[^0-9A-Za-z]', '', 'g')) LIKE $${oi})`
      );
      paramsOp.push(`%${digQ}%`);
      oi++;
    }
    if (nomeQ) {
      filtrosOp.push(`UPPER(p."NOME") LIKE UPPER($${oi})`);
      paramsOp.push(nomeQ);
      oi++;
    }
    if (!filtrosOp.length && nomeX) {
      filtrosOp.push(`UPPER(p."NOME") LIKE UPPER($${oi})`);
      paramsOp.push(nomeX);
      oi++;
    }
    if (filtrosOp.length) {
      const sqlOp = `
        SELECT p."CD_PRODUTO", p."CODIGO", p."CODIGO" AS "CODIGO_ESTOQUE", p."NOME", p."UNIDADE",
               COALESCE(p."FG_CONTROLA_LOTE", 'N') AS "FG_CONTROLA_LOTE",
               COALESCE(p."FG_CONTROLA_VALIDADE", 'N') AS "FG_CONTROLA_VALIDADE",
               o."MASCARA_CODIGO_PRODUTO",
               op."CODIGO_OPERACIONAL",
               op."FATOR_CONVERSAO"
          FROM "WMS_PRODUTO_OPERACIONAL" op
          INNER JOIN "WMS_PRODUTO_DONO" p
            ON p."CD_PRODUTO" = op."CD_PRODUTO" AND p."TENANT_ID" = op."TENANT_ID"
          INNER JOIN "WMS_DONO_ESTOQUE" o
            ON o."CD_DONO" = p."CD_DONO" AND o."TENANT_ID" = p."TENANT_ID"
         WHERE op."TENANT_ID" = $1 AND op."CD_DONO" = $2::integer
           AND COALESCE(op."FGACTIVE", 'S') = 'S'
           AND COALESCE(p."FGACTIVE", 'S') = 'S'
           AND (${filtrosOp.join(' OR ')})
         ORDER BY p."NOME", op."CODIGO_OPERACIONAL"
         LIMIT ${limitN + 20}`;
      const rOp = await db.query(sqlOp, paramsOp);
      (rOp.rows || []).forEach((row) => push(row));
    }
  } catch (e) {
    if (!tableMissing(e)) throw e;
  }

  const ctx = { digQ, qLower, digC, xLower };
  const scored = Array.from(byCd.values()).map((row) => {
    const s = scoreRow(row, ctx);
    return { ...row, _score: s };
  });
  scored.sort(
    (a, b) =>
      (b._score || 0) - (a._score || 0) ||
      String(a.CODIGO || '').localeCompare(String(b.CODIGO || ''), 'pt-BR')
  );
  return scored
    .filter((r) => (r._score || 0) > 0 || scored.length <= limitN)
    .slice(0, limitN)
    .map(({ _score, _deparaMatch, ...rest }) => rest);
}

module.exports = { buscarSugestoesProdutoRecebimento };
