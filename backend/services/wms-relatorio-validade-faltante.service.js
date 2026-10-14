'use strict';

const { pool } = require('../config/db');

const SQL_VALIDADE_FALTANTE = `
WITH linhas_nf AS (
  SELECT
    e."CD_DONO",
    (elem->>'cdProduto')::integer AS cd_produto,
    NULLIF(TRIM(elem->>'validade'), '') AS validade,
    COALESCE(NULLIF(TRIM(elem->>'qtdConvertida'), ''), '0')::numeric AS qtd
  FROM "WMS_NFE_ENTRADA" e
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e."CONFERENCIA_JSON", '[]'::jsonb)) AS elem
  WHERE e."TENANT_ID" = $1
    AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO", ''))) = 'ENCERRADA'
    AND e."CD_DONO" IS NOT NULL
    AND (elem->>'cdProduto') ~ '^[0-9]+$'
    AND ($2::integer IS NULL OR e."CD_DONO" = $2::integer)
),
nf_ag AS (
  SELECT
    "CD_DONO",
    cd_produto,
    SUM(qtd) FILTER (WHERE validade IS NOT NULL) AS qtd_nf_com_validade,
    SUM(qtd) FILTER (WHERE validade IS NULL) AS qtd_nf_sem_validade
  FROM linhas_nf
  WHERE qtd > 0
  GROUP BY "CD_DONO", cd_produto
),
inv_ag AS (
  SELECT
    isl."CD_DONO",
    isl."CD_PRODUTO" AS cd_produto,
    SUM(isl."QTD") FILTER (WHERE isl."VALIDADE" IS NOT NULL) AS qtd_inv_com_validade,
    SUM(isl."QTD") FILTER (WHERE isl."VALIDADE" IS NULL) AS qtd_inv_sem_validade
  FROM "WMS_INVENTARIO_SALDO_LOTE" isl
  WHERE isl."TENANT_ID" = $1
    AND ($2::integer IS NULL OR isl."CD_DONO" = $2::integer)
  GROUP BY isl."CD_DONO", isl."CD_PRODUTO"
  HAVING SUM(isl."QTD") > 1e-9
),
ent_sku AS (
  SELECT "CD_DONO", cd_produto, SUM(qtd) AS qtd_entrada_nf
  FROM linhas_nf
  WHERE qtd > 0
  GROUP BY "CD_DONO", cd_produto
),
mov AS (
  SELECT "CD_DONO", "CD_PRODUTO" AS cd_produto, SUM("QTD")::numeric AS qtd_mov
  FROM "WMS_MOVIMENTO_ESTOQUE"
  WHERE "TENANT_ID" = $1
    AND "CD_DONO" IS NOT NULL
    AND ($2::integer IS NULL OR "CD_DONO" = $2::integer)
  GROUP BY "CD_DONO", "CD_PRODUTO"
),
saldo AS (
  SELECT
    COALESCE(e."CD_DONO", m."CD_DONO") AS "CD_DONO",
    COALESCE(e.cd_produto, m.cd_produto) AS cd_produto,
    COALESCE(e.qtd_entrada_nf, 0) AS qtd_entrada_nf,
    COALESCE(m.qtd_mov, 0) AS qtd_mov,
    COALESCE(e.qtd_entrada_nf, 0) + COALESCE(m.qtd_mov, 0) AS qtd_saldo_sku
  FROM ent_sku e
  FULL OUTER JOIN mov m ON m."CD_DONO" = e."CD_DONO" AND m.cd_produto = e.cd_produto
)
SELECT
  s."CD_DONO",
  o."NOME" AS "NM_DONO",
  s.cd_produto AS "CD_PRODUTO",
  p."CODIGO" AS "CODIGO_PRODUTO",
  p."NOME" AS "NM_PRODUTO",
  p."TIPO_ARMAZENAGEM",
  s.qtd_entrada_nf,
  s.qtd_mov,
  s.qtd_saldo_sku,
  COALESCE(nf.qtd_nf_com_validade, 0) AS qtd_nf_com_validade,
  COALESCE(nf.qtd_nf_sem_validade, 0) AS qtd_nf_sem_validade,
  COALESCE(inv.qtd_inv_com_validade, 0) AS qtd_inv_com_validade,
  COALESCE(inv.qtd_inv_sem_validade, 0) AS qtd_inv_sem_validade,
  CASE
    /* Já coberto por NF e/ou inventário com validade — não entra no relatório de coleta */
    WHEN COALESCE(nf.qtd_nf_com_validade, 0) + COALESCE(inv.qtd_inv_com_validade, 0)
      >= s.qtd_saldo_sku - 1e-6
      THEN 'OK'
    WHEN s.qtd_entrada_nf <= 0
      AND COALESCE(inv.qtd_inv_com_validade, 0) + COALESCE(inv.qtd_inv_sem_validade, 0) > 0
      THEN 'SO_INVENTARIO_SEM_NF'
    WHEN s.qtd_entrada_nf <= 0 AND s.qtd_mov > 0 THEN 'SO_MOVIMENTO_SEM_NF'
    WHEN COALESCE(nf.qtd_nf_com_validade, 0) + COALESCE(inv.qtd_inv_com_validade, 0) <= 0
      AND (COALESCE(nf.qtd_nf_sem_validade, 0) + COALESCE(inv.qtd_inv_sem_validade, 0) > 0 OR s.qtd_entrada_nf > 0)
      THEN 'ENTRADA_SEM_VALIDADE'
    WHEN COALESCE(nf.qtd_nf_com_validade, 0) + COALESCE(inv.qtd_inv_com_validade, 0) > 0
      AND COALESCE(nf.qtd_nf_com_validade, 0) + COALESCE(inv.qtd_inv_com_validade, 0) < s.qtd_saldo_sku
      THEN 'VALIDADE_PARCIAL'
    ELSE 'OK'
  END AS situacao
FROM saldo s
INNER JOIN "WMS_PRODUTO_DONO" p
  ON p."CD_PRODUTO" = s.cd_produto AND p."TENANT_ID" = $1
LEFT JOIN "WMS_DONO_ESTOQUE" o ON o."CD_DONO" = s."CD_DONO" AND o."TENANT_ID" = $1
LEFT JOIN nf_ag nf ON nf."CD_DONO" = s."CD_DONO" AND nf.cd_produto = s.cd_produto
LEFT JOIN inv_ag inv ON inv."CD_DONO" = s."CD_DONO" AND inv.cd_produto = s.cd_produto
WHERE COALESCE(p."FG_CONTROLA_VALIDADE", 'N') = 'S'
  AND COALESCE(p."FGACTIVE", 'S') = 'S'
  AND s.qtd_saldo_sku > 1e-6
ORDER BY
  s."CD_DONO",
  CASE UPPER(TRIM(COALESCE(p."TIPO_ARMAZENAGEM", '')))
    WHEN 'CONGELADO' THEN 1
    WHEN 'REFRIGERADO' THEN 2
    WHEN 'SECO' THEN 3
    ELSE 9
  END,
  COALESCE(NULLIF(TRIM(p."TIPO_ARMAZENAGEM"), ''), '—'),
  CASE
    WHEN COALESCE(nf.qtd_nf_com_validade, 0) + COALESCE(inv.qtd_inv_com_validade, 0) <= 0
      AND s.qtd_entrada_nf <= 0 AND s.qtd_mov > 0 THEN 1
    WHEN COALESCE(nf.qtd_nf_com_validade, 0) + COALESCE(inv.qtd_inv_com_validade, 0) <= 0 THEN 2
    ELSE 3
  END,
  COALESCE(p."NOME", p."CODIGO", '')
`;

const ROTULO_SITUACAO = {
  SO_MOVIMENTO_SEM_NF: 'Só movimento — sem NF encerrada',
  ENTRADA_SEM_VALIDADE: 'Entrada sem validade informada',
  VALIDADE_PARCIAL: 'Validade parcial (saldo > rastreado)',
  SO_INVENTARIO_SEM_NF: 'Só inventário — sem NF',
};

async function listarValidadeFaltante(tenantId, cdDonoOpt) {
  const cd =
    cdDonoOpt != null && String(cdDonoOpt).trim() !== '' ? parseInt(cdDonoOpt, 10) : null;
  const r = await pool.query(SQL_VALIDADE_FALTANTE, [tenantId, Number.isFinite(cd) ? cd : null]);
  const rows = (r.rows || []).filter((row) => row.situacao && row.situacao !== 'OK');
  for (const row of rows) {
    row.SITUACAO_LABEL = ROTULO_SITUACAO[row.situacao] || row.situacao;
  }
  return { rows, rotuloSituacao: ROTULO_SITUACAO };
}

function linhasValidadeFaltanteParaCsv(rows) {
  const cols = [
    'CD_DONO',
    'NM_DONO',
    'TIPO_ARMAZENAGEM',
    'SITUACAO_LABEL',
    'CODIGO_PRODUTO',
    'NM_PRODUTO',
    'QTD_SALDO_SKU',
    'QTD_NF_COM_VALIDADE',
    'QTD_FALTANTE',
    'LOTE',
    'VALIDADE',
    'QTD_COLETADA',
    'OBS',
    'SITUACAO',
    'QTD_ENTRADA_NF',
    'QTD_MOV',
    'QTD_NF_SEM_VALIDADE',
    'QTD_INV_COM_VALIDADE',
    'QTD_INV_SEM_VALIDADE',
  ];
  const esc = (v) => {
    if (v == null) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const qtdFaltante = (row) => {
    const saldo = Number(row.qtd_saldo_sku ?? row.QTD_SALDO_SKU) || 0;
    const comVal =
      (Number(row.qtd_nf_com_validade ?? row.QTD_NF_COM_VALIDADE) || 0) +
      (Number(row.qtd_inv_com_validade ?? row.QTD_INV_COM_VALIDADE) || 0);
    const falt = Math.max(0, saldo - comVal);
    return Number.isFinite(falt) ? falt : '';
  };
  const head = cols.join(';');
  const body = (rows || [])
    .map((row) =>
      cols
        .map((c) => {
          if (c === 'SITUACAO') return esc(row.situacao || row.SITUACAO);
          if (c === 'SITUACAO_LABEL') return esc(row.SITUACAO_LABEL);
          if (c === 'QTD_SALDO_SKU') return esc(row.qtd_saldo_sku ?? row.QTD_SALDO_SKU);
          if (c === 'QTD_ENTRADA_NF') return esc(row.qtd_entrada_nf ?? row.QTD_ENTRADA_NF);
          if (c === 'QTD_MOV') return esc(row.qtd_mov ?? row.QTD_MOV);
          if (c === 'QTD_NF_COM_VALIDADE') return esc(row.qtd_nf_com_validade ?? row.QTD_NF_COM_VALIDADE);
          if (c === 'QTD_NF_SEM_VALIDADE') return esc(row.qtd_nf_sem_validade ?? row.QTD_NF_SEM_VALIDADE);
          if (c === 'QTD_INV_COM_VALIDADE') return esc(row.qtd_inv_com_validade ?? row.QTD_INV_COM_VALIDADE);
          if (c === 'QTD_INV_SEM_VALIDADE') return esc(row.qtd_inv_sem_validade ?? row.QTD_INV_SEM_VALIDADE);
          if (c === 'QTD_FALTANTE') return esc(qtdFaltante(row));
          if (c === 'LOTE' || c === 'VALIDADE' || c === 'QTD_COLETADA' || c === 'OBS') return '';
          return esc(row[c] ?? row[c.toLowerCase()]);
        })
        .join(';')
    )
    .join('\n');
  return `${head}\n${body}`;
}

module.exports = {
  listarValidadeFaltante,
  linhasValidadeFaltanteParaCsv,
  ROTULO_SITUACAO,
};
