'use strict';

function trimQuery(v) {
  return v != null ? String(v).trim() : '';
}

/**
 * Monta WHERE/params para lista e resumo de cargas programadas.
 * @param {string} tenantId
 * @param {object} query
 * @param {{ applyStExpedicao?: boolean }} [opts]
 */
function buildWhereCargasProgramadas(tenantId, query, opts = {}) {
  const applyStExpedicao = opts.applyStExpedicao !== false;
  const stCarga = trimQuery(query.stCarga ?? query.statusCarga).toUpperCase();
  const stExpedicao = trimQuery(query.stExpedicao ?? query.st_expedicao).toUpperCase();
  const dhDe = trimQuery(query.dhCriacaoDe);
  const dhAte = trimQuery(query.dhCriacaoAte);
  const dhExpDe = trimQuery(query.dhExpedicaoDe ?? query.dh_expedicao_de);
  const dhExpAte = trimQuery(query.dhExpedicaoAte ?? query.dh_expedicao_ate);
  const buscaRaw = trimQuery(query.busca ?? query.q);
  const idViagemRaw = trimQuery(query.idViagem ?? query.id_viagem ?? query.wmsIdViagem);
  const numeroNfCarga = trimQuery(query.numeroNf ?? query.numero_nf ?? query.nuNf);
  const serieCarga = trimQuery(query.serie ?? query.nuSerie);

  const where = ['c."TENANT_ID" = $1'];
  const params = [tenantId];

  if (stCarga) {
    params.push(stCarga);
    where.push(`c."ST_CARGA" = $${params.length}`);
  }
  if (dhDe) {
    params.push(dhDe);
    where.push(`c."DH_CRIACAO" >= $${params.length}::date`);
  }
  if (dhAte) {
    params.push(dhAte);
    where.push(`c."DH_CRIACAO" < ($${params.length}::date + INTERVAL '1 day')`);
  }
  if (dhExpDe || dhExpAte) {
    const parts = [
      `EXISTS (
         SELECT 1 FROM "WMS_EXPEDICAO_CARGA" exd
        WHERE exd."CD_CARGA" = c."CD_CARGA"
          AND exd."TENANT_ID" = c."TENANT_ID"
          AND exd."DH_SAIDA" IS NOT NULL`,
    ];
    if (dhExpDe) {
      params.push(dhExpDe);
      parts.push(`AND exd."DH_SAIDA" >= $${params.length}::date`);
    }
    if (dhExpAte) {
      params.push(dhExpAte);
      parts.push(`AND exd."DH_SAIDA" < ($${params.length}::date + INTERVAL '1 day')`);
    }
    parts.push(')');
    where.push(parts.join('\n          '));
  }
  if (buscaRaw) {
    const asNum = parseInt(buscaRaw, 10);
    if (String(asNum) === buscaRaw && Number.isFinite(asNum) && asNum > 0) {
      params.push(asNum);
      where.push(`c."CD_CARGA" = $${params.length}::integer`);
    } else {
      const pat = `%${buscaRaw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
      params.push(pat);
      where.push(`c."NM_DESCRICAO" ILIKE $${params.length} ESCAPE '\\'`);
    }
  }
  if (idViagemRaw) {
    const idV = parseInt(idViagemRaw, 10);
    if (Number.isFinite(idV) && idV > 0) {
      params.push(idV);
      where.push(
        `EXISTS (
           SELECT 1 FROM "WMS_CARGA_ROTA_OPERACIONAL" rof
          WHERE rof."TENANT_ID" = c."TENANT_ID"
            AND rof."CD_CARGA" = c."CD_CARGA"
            AND rof."IDVIAGEM" = $${params.length}::integer
        )`
      );
    }
  }
  if (numeroNfCarga) {
    const dig = numeroNfCarga.replace(/\D/g, '');
    const nfParts = [
      `EXISTS (
         SELECT 1 FROM "WMS_CARGA_PROGRAMADA_NFE" jnf
         JOIN "WMS_NFE_SAIDA" nn ON nn."CD_NFE_SAIDA" = jnf."CD_NFE_SAIDA" AND nn."TENANT_ID" = c."TENANT_ID"
        WHERE jnf."CD_CARGA" = c."CD_CARGA"`,
    ];
    if (dig) {
      params.push(`%${dig}%`);
      nfParts.push(
        `AND regexp_replace(trim(COALESCE(nn."NUMERO_NF", '')), '[^0-9]', '', 'g') LIKE $${params.length}`
      );
    } else {
      params.push(`%${numeroNfCarga.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`);
      nfParts.push(`AND nn."NUMERO_NF" ILIKE $${params.length} ESCAPE '\\'`);
    }
    if (serieCarga) {
      params.push(serieCarga);
      nfParts.push(`AND trim(COALESCE(nn."SERIE", '')) = $${params.length}`);
    }
    nfParts.push(')');
    where.push(nfParts.join('\n          '));
  } else if (serieCarga) {
    params.push(serieCarga);
    where.push(
      `EXISTS (
         SELECT 1 FROM "WMS_CARGA_PROGRAMADA_NFE" jnf
         JOIN "WMS_NFE_SAIDA" nn ON nn."CD_NFE_SAIDA" = jnf."CD_NFE_SAIDA" AND nn."TENANT_ID" = c."TENANT_ID"
        WHERE jnf."CD_CARGA" = c."CD_CARGA"
          AND trim(COALESCE(nn."SERIE", '')) = $${params.length}
      )`
    );
  }
  if (applyStExpedicao && stExpedicao) {
    if (stExpedicao === 'SEM_REGISTRO' || stExpedicao === 'SEM') {
      where.push(
        `NOT EXISTS (SELECT 1 FROM "WMS_EXPEDICAO_CARGA" ex WHERE ex."CD_CARGA" = c."CD_CARGA" AND ex."TENANT_ID" = c."TENANT_ID")`
      );
    } else if (stExpedicao === 'PRONTA_EXPEDICAO' || stExpedicao === 'PRONTA') {
      where.push(
        `(NOT EXISTS (SELECT 1 FROM "WMS_EXPEDICAO_CARGA" ex WHERE ex."CD_CARGA" = c."CD_CARGA" AND ex."TENANT_ID" = c."TENANT_ID") ` +
          `OR EXISTS (SELECT 1 FROM "WMS_EXPEDICAO_CARGA" ex2 WHERE ex2."CD_CARGA" = c."CD_CARGA" AND ex2."TENANT_ID" = c."TENANT_ID" AND ex2."ST_EXPEDICAO" = 'PRONTA_EXPEDICAO'))`
      );
    } else if (stExpedicao === 'EM_EXPEDICAO' || stExpedicao === 'EXPEDIDA') {
      params.push(stExpedicao);
      where.push(
        `EXISTS (SELECT 1 FROM "WMS_EXPEDICAO_CARGA" ex3 WHERE ex3."CD_CARGA" = c."CD_CARGA" AND ex3."TENANT_ID" = c."TENANT_ID" AND ex3."ST_EXPEDICAO" = $${params.length})`
      );
    } else if (
      stExpedicao === 'NAO_EXPEDIDA' ||
      stExpedicao === 'NAO_SAIDA' ||
      stExpedicao === 'PENDENTE_SAIDA'
    ) {
      where.push(
        `NOT EXISTS (
           SELECT 1 FROM "WMS_EXPEDICAO_CARGA" ex4
          WHERE ex4."CD_CARGA" = c."CD_CARGA"
            AND ex4."TENANT_ID" = c."TENANT_ID"
            AND ex4."ST_EXPEDICAO" = 'EXPEDIDA'
        )`
      );
    }
  }
  return { where, params, stExpedicao };
}

module.exports = { buildWhereCargasProgramadas, trimQuery };
