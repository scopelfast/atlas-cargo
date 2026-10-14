-- WMS — saldo declarado por lote/validade no encerramento do inventário.
-- Complementa WMS_MOVIMENTO_ESTOQUE (ajuste por SKU) com detalhe físico para Posição e Datas críticas.
-- PostgreSQL, idempotente.

CREATE TABLE IF NOT EXISTS "WMS_INVENTARIO_SALDO_LOTE" (
  "CD_SALDO" BIGSERIAL PRIMARY KEY,
  "TENANT_ID" VARCHAR(64) NOT NULL,
  "CD_DONO" INTEGER NOT NULL REFERENCES "WMS_DONO_ESTOQUE" ("CD_DONO") ON DELETE CASCADE,
  "CD_PRODUTO" INTEGER NOT NULL,
  "LOTE" VARCHAR(60),
  "VALIDADE" DATE,
  "QTD" NUMERIC(18, 6) NOT NULL,
  "REF_CD_INVENTARIO" INTEGER NOT NULL,
  "REF_CD_LINHA" INTEGER,
  "DH_REGISTRO" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "SG_USER" VARCHAR(64)
);

COMMENT ON TABLE "WMS_INVENTARIO_SALDO_LOTE" IS
  'Quantidade física contada por produto+lote+validade no último inventário encerrado que tocou o SKU. Alimenta Posição/Datas críticas; saldo SKU continua no ledger (NF + WMS_MOVIMENTO_ESTOQUE).';

CREATE INDEX IF NOT EXISTS idx_wms_inv_saldo_lote_tenant_dono_prod
  ON "WMS_INVENTARIO_SALDO_LOTE" ("TENANT_ID", "CD_DONO", "CD_PRODUTO");

CREATE INDEX IF NOT EXISTS idx_wms_inv_saldo_lote_inventario
  ON "WMS_INVENTARIO_SALDO_LOTE" ("REF_CD_INVENTARIO");

CREATE UNIQUE INDEX IF NOT EXISTS uk_wms_inv_saldo_lote_dono_prod_lote_val
  ON "WMS_INVENTARIO_SALDO_LOTE" (
    "TENANT_ID",
    "CD_DONO",
    "CD_PRODUTO",
    COALESCE("LOTE", ''),
    COALESCE("VALIDADE", DATE '1970-01-01')
  );
