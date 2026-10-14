-- Data física de recebimento na doca (lançamentos retroativos).
-- PostgreSQL, idempotente.

ALTER TABLE "WMS_NFE_ENTRADA"
  ADD COLUMN IF NOT EXISTS "DT_RECEBIMENTO" DATE;

COMMENT ON COLUMN "WMS_NFE_ENTRADA"."DT_RECEBIMENTO" IS
  'Data em que a mercadoria entrou fisicamente (doca). Usada em relatórios de movimentação/estoque; se NULL, usa data do encerramento/conferência.';

CREATE INDEX IF NOT EXISTS idx_wms_nfe_entrada_tenant_dt_receb
  ON "WMS_NFE_ENTRADA" ("TENANT_ID", "DT_RECEBIMENTO" DESC);
