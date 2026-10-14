-- WMS — Impede dois produtos ATIVOS com o mesmo SKU lógico (dígitos do CODIGO), por dono.
-- Rode DEPOIS de wms_unificar_duplicados_produto_postgres.sql (senão o CREATE INDEX falha).
--
-- Com isso: import XML/OL e cadastro manual não conseguem gravar 6031021420 se já existe 6.03.10.214.20.

-- === Índice único SKU lógico (WMS_PRODUTO_DONO) — pgAdmin: execute este arquivo inteiro ===

CREATE UNIQUE INDEX IF NOT EXISTS uq_wms_produto_dono_sku_chave_ativo
  ON "WMS_PRODUTO_DONO" (
    "TENANT_ID",
    "CD_DONO",
    lower(regexp_replace(trim("CODIGO"), '[^0-9A-Za-z]', '', 'g'))
  )
  WHERE COALESCE("FGACTIVE", 'S') = 'S'
    AND length(regexp_replace(trim("CODIGO"), '[^0-9A-Za-z]', '', 'g')) >= 4;

-- OK — um SKU (chave de dígitos) por dono, produtos ativos.
