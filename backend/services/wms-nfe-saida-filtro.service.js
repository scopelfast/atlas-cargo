'use strict';

const { trimQuery } = require('./wms-carga-programada-filtro.service');

/**
 * WHERE/params para listagem e export de NF-e importadas (WMS_NFE_SAIDA).
 */
function buildWhereNfesSaida(tenantId, query) {
  const where = [`n."TENANT_ID" = $1`];
  const params = [tenantId];

  const emCarga = String(query.emCarga || '').toUpperCase().trim();
  if (emCarga === 'S') {
    where.push(`EXISTS (SELECT 1 FROM "WMS_CARGA_PROGRAMADA_NFE" j WHERE j."CD_NFE_SAIDA" = n."CD_NFE_SAIDA")`);
  } else if (emCarga === 'N') {
    where.push(
      `NOT EXISTS (SELECT 1 FROM "WMS_CARGA_PROGRAMADA_NFE" j WHERE j."CD_NFE_SAIDA" = n."CD_NFE_SAIDA")`
    );
  }

  const cdDonoRaw = query.cdDono ?? query.cd_dono ?? query.CD_DONO;
  const cdDono = cdDonoRaw != null && String(cdDonoRaw).trim() !== '' ? parseInt(cdDonoRaw, 10) : NaN;
  if (Number.isFinite(cdDono) && cdDono > 0) {
    params.push(cdDono);
    where.push(`n."CD_DONO" = $${params.length}::integer`);
  }

  const de = trimQuery(query.dhEmissaoDe ?? query.dh_emissao_de);
  const ate = trimQuery(query.dhEmissaoAte ?? query.dh_emissao_ate);
  if (de) {
    params.push(de);
    where.push(`n."DH_EMISSAO" >= $${params.length}::date`);
  }
  if (ate) {
    params.push(ate);
    where.push(`n."DH_EMISSAO" < ($${params.length}::date + INTERVAL '1 day')`);
  }

  const numeroNf = trimQuery(query.numeroNf ?? query.numero_nf ?? query.nuNf);
  const serie = trimQuery(query.serie ?? query.nuSerie);
  if (numeroNf) {
    const dig = numeroNf.replace(/\D/g, '');
    if (dig) {
      params.push(`%${dig}%`);
      where.push(`regexp_replace(trim(COALESCE(n."NUMERO_NF", '')), '[^0-9]', '', 'g') LIKE $${params.length}`);
    } else {
      params.push(`%${numeroNf.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`);
      where.push(`n."NUMERO_NF" ILIKE $${params.length} ESCAPE '\\'`);
    }
  }
  if (serie) {
    params.push(serie);
    where.push(`trim(COALESCE(n."SERIE", '')) = $${params.length}`);
  }

  const pedido = trimQuery(query.pedido ?? query.nrPedido ?? query.xPed);
  if (pedido) {
    const dig = pedido.replace(/\D/g, '');
    if (dig) {
      params.push(`%${dig}%`);
      where.push(`EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(n."LINHAS_JSON", '[]'::jsonb)) AS ln(elem)
         WHERE regexp_replace(trim(COALESCE(ln.elem->>'xPed', ln.elem->>'xped', '')), '[^0-9]', '', 'g') LIKE $${params.length}
      )`);
    } else {
      params.push(`%${pedido.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`);
      where.push(`EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(n."LINHAS_JSON", '[]'::jsonb)) AS ln(elem)
         WHERE COALESCE(ln.elem->>'xPed', ln.elem->>'xped', '') ILIKE $${params.length} ESCAPE '\\'
      )`);
    }
  }

  const codigoProd = trimQuery(query.codigoProduto ?? query.codigoProd ?? query.codigo ?? query.cProd);
  if (codigoProd) {
    params.push(`%${codigoProd.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`);
    where.push(`EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(n."LINHAS_JSON", '[]'::jsonb)) AS ln(elem)
       WHERE COALESCE(ln.elem->>'cProd', ln.elem->>'codigo', '') ILIKE $${params.length} ESCAPE '\\'
    )`);
  }

  const descProd = trimQuery(
    query.descricaoProduto ?? query.descricaoProd ?? query.descricao ?? query.xProd
  );
  if (descProd) {
    params.push(`%${descProd.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`);
    where.push(`EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(n."LINHAS_JSON", '[]'::jsonb)) AS ln(elem)
       WHERE COALESCE(ln.elem->>'xProd', ln.elem->>'descricao', '') ILIKE $${params.length} ESCAPE '\\'
    )`);
  }

  const saiDe = trimQuery(query.dhSaidaDe ?? query.dh_saida_de);
  const saiAte = trimQuery(query.dhSaidaAte ?? query.dh_saida_ate);
  if (saiDe) {
    params.push(saiDe);
    where.push(`n."DH_SAIDA" >= $${params.length}::date`);
  }
  if (saiAte) {
    params.push(saiAte);
    where.push(`n."DH_SAIDA" < ($${params.length}::date + INTERVAL '1 day')`);
  }

  return { where, params };
}

const CARGAS_TXT_SQL = `(
  SELECT string_agg(
           c2."CD_CARGA"::text || COALESCE(' — ' || NULLIF(trim(c2."NM_DESCRICAO"), ''), ''),
           '; ' ORDER BY c2."CD_CARGA"
         )
    FROM "WMS_CARGA_PROGRAMADA_NFE" j2
    JOIN "WMS_CARGA_PROGRAMADA" c2
      ON c2."CD_CARGA" = j2."CD_CARGA" AND c2."TENANT_ID" = n."TENANT_ID"
   WHERE j2."CD_NFE_SAIDA" = n."CD_NFE_SAIDA"
)`;

module.exports = { buildWhereNfesSaida, CARGAS_TXT_SQL };
