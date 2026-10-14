-- WMS — valor de estoque (snapshot diário para pico / cobrança % sobre valor).
-- PostgreSQL, idempotente. Executar no pgAdmin após backup.
-- Cobrança: percentual sobre o VALOR do estoque (R$), não peso.

-- % de cobrança armazenagem por dono (ex.: 2.5000 = 2,5% sobre o valor de pico do período).
ALTER TABLE "WMS_DONO_ESTOQUE"
  ADD COLUMN IF NOT EXISTS "PCT_COBRANCA_ESTOQUE" NUMERIC(8, 4);

COMMENT ON COLUMN "WMS_DONO_ESTOQUE"."PCT_COBRANCA_ESTOQUE" IS
  'Percentual de cobrança sobre valor de estoque (pico do período). Ex.: 2.5 = 2,5%.';

-- Fallback quando NF entrada não tem vUnCom mapeado ao produto.
ALTER TABLE "WMS_PRODUTO_DONO"
  ADD COLUMN IF NOT EXISTS "VALOR_REFERENCIA" NUMERIC(18, 4);

COMMENT ON COLUMN "WMS_PRODUTO_DONO"."VALOR_REFERENCIA" IS
  'Valor unitário de referência (R$) para valorização de estoque quando não há preço na última NF entrada.';

CREATE TABLE IF NOT EXISTS "WMS_ESTOQUE_SNAPSHOT_DIARIO" (
  "CD_SNAPSHOT" BIGSERIAL PRIMARY KEY,
  "TENANT_ID" VARCHAR(64) NOT NULL,
  "CD_DONO" INTEGER NOT NULL REFERENCES "WMS_DONO_ESTOQUE" ("CD_DONO") ON DELETE CASCADE,
  "DT_REFERENCIA" DATE NOT NULL,
  "VALOR_TOTAL" NUMERIC(18, 2) NOT NULL DEFAULT 0,
  "QTD_SKUS" INTEGER NOT NULL DEFAULT 0,
  "QTD_SKUS_SEM_PRECO" INTEGER NOT NULL DEFAULT 0,
  "QTD_UNIDADES_SEM_PRECO" NUMERIC(18, 4) NOT NULL DEFAULT 0,
  "METODO_VALOR" VARCHAR(40) NOT NULL DEFAULT 'ULTIMA_NF_ENTRADA',
  "PCT_COBRANCA" NUMERIC(8, 4),
  "VALOR_COBRANCA_ESTIMADO" NUMERIC(18, 2) NOT NULL DEFAULT 0,
  "DH_GERACAO" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uk_wms_est_snap_tenant_dono_dt UNIQUE ("TENANT_ID", "CD_DONO", "DT_REFERENCIA")
);

CREATE INDEX IF NOT EXISTS idx_wms_est_snap_tenant_dt
  ON "WMS_ESTOQUE_SNAPSHOT_DIARIO" ("TENANT_ID", "DT_REFERENCIA" DESC);

CREATE INDEX IF NOT EXISTS idx_wms_est_snap_tenant_dono_dt
  ON "WMS_ESTOQUE_SNAPSHOT_DIARIO" ("TENANT_ID", "CD_DONO", "DT_REFERENCIA" DESC);
