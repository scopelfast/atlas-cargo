'use strict';
require('dotenv').config();
const { pool } = require('../config/db');
const {
  buscarEnderecoEntregaParaParada,
  resolverNrRotaNfSaida,
  carregarMapaNrRotaPorChaveImport,
  carregarIndiceRotaPorCodigoDestinatario,
  extrairNrRotaDescricaoCarga,
} = require('../services/cadastro-endereco-entrega-match.service');
const { nomeEntregaUnidadeOuLocalDestino } = require('../services/wms-nfe-saida-destino-display.service');

async function main() {
  const tenantId = 'default';
  const nums = ['20260', '20259'];
  const mapa = await carregarMapaNrRotaPorChaveImport(pool, tenantId, ['02143616001380']);
  const indice = await carregarIndiceRotaPorCodigoDestinatario(pool, tenantId);
  for (const num of nums) {
    const r = await pool.query(
      `SELECT n.*
         FROM "WMS_NFE_SAIDA" n
         JOIN "WMS_CARGA_PROGRAMADA_NFE" j ON j."CD_NFE_SAIDA" = n."CD_NFE_SAIDA"
        WHERE n."TENANT_ID" = $1
          AND n."NUMERO_NF"::text = $2
        LIMIT 1`,
      [tenantId, num]
    );
    const n = r.rows[0];
    if (!n) {
      console.log('NF', num, 'não encontrada');
      continue;
    }
    console.log('=== NF', num, '===');
    console.log('nome:', nomeEntregaUnidadeOuLocalDestino(n));
    console.log('end:', n.XLGR_DEST, '|', n.NRO_DEST, '|', n.CEP_DEST, '|', n.UF_DEST, '|', n.XMUN_DEST);
    const cargaRow = await pool.query(
      `SELECT c."CD_CARGA", c."NM_DESCRICAO"
         FROM "WMS_CARGA_PROGRAMADA_NFE" j
         JOIN "WMS_CARGA_PROGRAMADA" c ON c."CD_CARGA" = j."CD_CARGA"
        WHERE j."CD_NFE_SAIDA" = $1 AND c."TENANT_ID" = $2
        LIMIT 1`,
      [n.CD_NFE_SAIDA, tenantId]
    );
    const nrHint = cargaRow.rows[0]
      ? extrairNrRotaDescricaoCarga(cargaRow.rows[0].NM_DESCRICAO)
      : null;

    const hit = await buscarEnderecoEntregaParaParada(pool, tenantId, {
      cnpjEntrega: n.CNPJ_ENTREGA || n.CNPJ_DEST,
      nmEntrega: nomeEntregaUnidadeOuLocalDestino(n),
      uf: n.UF_DEST,
      municipio: n.XMUN_DEST,
      cep: n.CEP_DEST,
      logradouro: n.XLGR_DEST,
      numero: n.NRO_DEST,
      complemento: n.XCPL_DEST,
    });
    console.log('hit:', hit);
    const res = await resolverNrRotaNfSaida(pool, tenantId, n, mapa, indice, {
      nrRotaHint: nrHint,
    });
    console.log('resolver:', res);

    const dup = await pool.query(
      `SELECT e."CD_ENDERECO_ENTREGA", e."DS_PONTO_ENTREGA", e."NR_ROTA", e."LOGRADOURO", e."NUMERO"
         FROM "CADASTRO_ENDERECO_ENTREGA" e
         JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = e."CD_CLIENTE"
        WHERE e."TENANT_ID" = $1
          AND e."FGACTIVE" = 'A'
          AND regexp_replace(coalesce(e."CEP", ''), '[^0-9]', '', 'g') = $2
          AND upper(trim(coalesce(e."LOGRADOURO", ''))) = upper(trim($3::text))`,
      [tenantId, String(n.CEP_DEST || '').replace(/\D/g, '').slice(0, 8), n.XLGR_DEST]
    );
    console.log('cadastros mesmo CEP+logr:', dup.rows);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
