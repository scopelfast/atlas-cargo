'use strict';
/**
 * Preenche VALOR_REFERENCIA onde está vazio/zero:
 * 1) último preço de NF de entrada (mesma regra do módulo Valor)
 * 2) se não houver, último preço de NF de saída (vUnCom ou vProd/qCom)
 *
 * Uso: node scripts/_fill_valor_referencia.js [--dry-run] [--so-sem-preco]
 *   --so-sem-preco: só os SKUs com saldo e sem preço efetivo na posição valorizada
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const { pool } = require('../config/db');
const {
  obterUltimoPrecoEntradaMap,
  calcularPosicaoValorizada,
  aplicarImportValorReferencia,
} = require('../services/wms-estoque-valor.service');

const DRY = process.argv.includes('--dry-run');
const SO_SEM_PRECO = process.argv.includes('--so-sem-preco');
const TENANT = 'default';

function sqlNormCodigo(expr) {
  return `regexp_replace(upper(trim(COALESCE(${expr}, ''))), '[^0-9A-Z]', '', 'g')`;
}

async function obterUltimoPrecoSaidaMap(tenantId) {
  const sql = `
    WITH docs AS (
      SELECT
        n."TENANT_ID",
        n."CD_DONO",
        n."CD_NFE_SAIDA" AS cd_nfe,
        COALESCE(n."DH_EMISSAO", n."DH_REGISTRO", n."DH_MAINTENANCE") AS dh_ref,
        n."LINHAS_JSON"
      FROM "WMS_NFE_SAIDA" n
      WHERE n."TENANT_ID" = $1
        AND n."CD_DONO" IS NOT NULL
        AND jsonb_typeof(n."LINHAS_JSON") = 'array'
        AND jsonb_array_length(n."LINHAS_JSON") > 0
    ),
    nf_lin AS (
      SELECT
        d."TENANT_ID",
        d."CD_DONO",
        d.dh_ref,
        d.cd_nfe,
        ln.elem AS item
      FROM docs d
      CROSS JOIN LATERAL jsonb_array_elements(d."LINHAS_JSON") AS ln(elem)
      WHERE TRIM(COALESCE(ln.elem->>'cProd', '')) <> ''
    ),
    priced AS (
      SELECT
        nl."CD_DONO",
        p."CD_PRODUTO",
        nl.dh_ref,
        nl.cd_nfe,
        COALESCE(
          NULLIF(NULLIF(TRIM(nl.item->>'vUnCom'), ''), '0')::numeric,
          CASE
            WHEN NULLIF(NULLIF(TRIM(nl.item->>'qCom'), ''), '0')::numeric > 0
             AND NULLIF(NULLIF(TRIM(nl.item->>'vProd'), ''), '0')::numeric > 0
            THEN NULLIF(NULLIF(TRIM(nl.item->>'vProd'), ''), '0')::numeric
               / NULLIF(NULLIF(TRIM(nl.item->>'qCom'), ''), '0')::numeric
            ELSE NULL
          END
        ) AS v_unit
      FROM nf_lin nl
      INNER JOIN "WMS_PRODUTO_DONO" p
        ON p."TENANT_ID" = nl."TENANT_ID"
       AND p."CD_DONO" = nl."CD_DONO"
       AND ${sqlNormCodigo('p."CODIGO"')} = ${sqlNormCodigo(`nl.item->>'cProd'`)}
      UNION ALL
      SELECT
        nl."CD_DONO",
        p."CD_PRODUTO",
        nl.dh_ref,
        nl.cd_nfe,
        COALESCE(
          NULLIF(NULLIF(TRIM(nl.item->>'vUnCom'), ''), '0')::numeric,
          CASE
            WHEN NULLIF(NULLIF(TRIM(nl.item->>'qCom'), ''), '0')::numeric > 0
             AND NULLIF(NULLIF(TRIM(nl.item->>'vProd'), ''), '0')::numeric > 0
            THEN NULLIF(NULLIF(TRIM(nl.item->>'vProd'), ''), '0')::numeric
               / NULLIF(NULLIF(TRIM(nl.item->>'qCom'), ''), '0')::numeric
            ELSE NULL
          END
        ) AS v_unit
      FROM nf_lin nl
      INNER JOIN "WMS_DEPARA_PRODUTO" dep
        ON dep."TENANT_ID" = nl."TENANT_ID"
       AND dep."CD_DONO" = nl."CD_DONO"
       AND COALESCE(TRIM(UPPER(dep."FGACTIVE")), 'S') = 'S'
       AND ${sqlNormCodigo('dep."CODIGO_EXTERNO"')} = ${sqlNormCodigo(`nl.item->>'cProd'`)}
      INNER JOIN "WMS_PRODUTO_DONO" p
        ON p."TENANT_ID" = nl."TENANT_ID"
       AND p."CD_DONO" = nl."CD_DONO"
       AND ${sqlNormCodigo('p."CODIGO"')} = ${sqlNormCodigo('dep."CODIGO_INTERNO"')}
    )
    SELECT DISTINCT ON ("CD_DONO", "CD_PRODUTO")
      "CD_DONO", "CD_PRODUTO", v_unit AS "V_UNIT", dh_ref AS "DH_REF"
    FROM priced
    WHERE v_unit IS NOT NULL AND v_unit > 0
    ORDER BY "CD_DONO", "CD_PRODUTO", dh_ref DESC NULLS LAST, cd_nfe DESC
  `;
  const r = await pool.query(sql, [tenantId]);
  const map = new Map();
  for (const row of r.rows || []) {
    map.set(`${row.CD_DONO}|${row.CD_PRODUTO}`, {
      vUnit: Number(row.V_UNIT) || 0,
      fonte: 'NF_SAIDA',
      dhRef: row.DH_REF,
    });
  }
  return map;
}

(async () => {
  console.log('modo', DRY ? 'DRY-RUN' : 'GRAVAR', SO_SEM_PRECO ? 'só sem preço efetivo' : 'todos sem VALOR_REFERENCIA');

  const cad = await pool.query(
    `SELECT p."CD_DONO", p."CD_PRODUTO", p."CODIGO", p."NOME",
            p."VALOR_REFERENCIA"::float AS vr, d."NOME" AS dono
       FROM "WMS_PRODUTO_DONO" p
       JOIN "WMS_DONO_ESTOQUE" d
         ON d."CD_DONO" = p."CD_DONO" AND d."TENANT_ID" = p."TENANT_ID"
      WHERE p."TENANT_ID" = $1
        AND COALESCE(TRIM(UPPER(p."FGACTIVE")), 'S') = 'S'
        AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
        AND (p."VALOR_REFERENCIA" IS NULL OR p."VALOR_REFERENCIA" <= 0)
      ORDER BY d."NOME", p."CODIGO"`,
    [TENANT]
  );

  let alvos = cad.rows;
  if (SO_SEM_PRECO) {
    const pos = await calcularPosicaoValorizada(TENANT, null, {});
    const keys = new Set(
      (pos.linhas || [])
        .filter((x) => x.FONTE_PRECO === 'SEM_PRECO' || x.VLR_UNITARIO == null)
        .map((x) => `${x.CD_DONO}|${x.CD_PRODUTO}`)
    );
    alvos = cad.rows.filter((r) => keys.has(`${r.CD_DONO}|${r.CD_PRODUTO}`));
    console.log('sem preço efetivo na posição:', keys.size, 'com VR vazio entre eles:', alvos.length);
  }

  console.log('candidatos sem VALOR_REFERENCIA:', alvos.length);
  console.log('carregando preços entrada…');
  const mapaEnt = await obterUltimoPrecoEntradaMap(TENANT, null, null, null);
  console.log('preços entrada:', mapaEnt.size);
  console.log('carregando preços saída…');
  const mapaSai = await obterUltimoPrecoSaidaMap(TENANT);
  console.log('preços saída:', mapaSai.size);

  const linhas = [];
  const detalhe = [];
  let deEnt = 0;
  let deSai = 0;
  let semFonte = 0;

  for (const p of alvos) {
    const k = `${p.CD_DONO}|${p.CD_PRODUTO}`;
    const ent = mapaEnt.get(k);
    const sai = mapaSai.get(k);
    let fonte = null;
    let valor = null;
    if (ent && Number(ent.vUnit) > 0) {
      fonte = 'NF_ENTRADA';
      valor = Number(ent.vUnit);
      deEnt += 1;
    } else if (sai && Number(sai.vUnit) > 0) {
      fonte = 'NF_SAIDA';
      valor = Number(sai.vUnit);
      deSai += 1;
    } else {
      semFonte += 1;
      detalhe.push({
        dono: p.dono,
        codigo: p.CODIGO,
        nome: p.NOME,
        fonte: 'SEM_FONTE',
        valor: '',
      });
      continue;
    }
    // arredonda a 4 casas (coluna NUMERIC 18,4)
    valor = Math.round(valor * 10000) / 10000;
    linhas.push({ cdDono: p.CD_DONO, cdProduto: p.CD_PRODUTO, codigo: p.CODIGO, valor });
    detalhe.push({
      dono: p.dono,
      codigo: p.CODIGO,
      nome: p.NOME,
      fonte,
      valor,
    });
  }

  console.log(
    JSON.stringify({ candidatos: alvos.length, deEntrada: deEnt, deSaida: deSai, semFonte, aAtualizar: linhas.length }, null, 2)
  );

  const csv = ['dono;codigo;nome;fonte;valor'];
  for (const d of detalhe) {
    csv.push(
      [d.dono, d.codigo, String(d.nome || '').replace(/;/g, ','), d.fonte, d.valor].join(';')
    );
  }
  const csvPath = 'C:/Users/scope/Downloads/fill-valor-referencia.csv';
  fs.writeFileSync(csvPath, csv.join('\n'), 'utf8');
  console.log('csv', csvPath);

  if (!linhas.length) {
    console.log('nada a gravar');
    await pool.end();
    process.exit(0);
  }

  const result = await aplicarImportValorReferencia(TENANT, linhas, { dryRun: DRY });
  console.log('resultado', JSON.stringify(result, null, 2));
  await pool.end();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
