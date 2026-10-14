-- WMS — movimento de estoque (ledger append-only, MVP).
-- Saída na confirmação de expedição da carga (quantidades das NF-e mapeadas por de-para).
-- PostgreSQL, idempotente. Executar após wms_cadastros_mestre_postgres.sql (FK CD_DONO).

CREATE TABLE IF NOT EXISTS "WMS_MOVIMENTO_ESTOQUE" (
  "CD_MOVIMENTO" BIGSERIAL PRIMARY KEY,
  "TENANT_ID" VARCHAR(64) NOT NULL,
  "CD_DONO" INTEGER NOT NULL REFERENCES "WMS_DONO_ESTOQUE" ("CD_DONO") ON DELETE CASCADE,
  "CD_PRODUTO" INTEGER NOT NULL,
  "QTD" NUMERIC(18, 6) NOT NULL,
  "TP_MOVIMENTO" VARCHAR(32) NOT NULL,
  "REF_CD_CARGA" INTEGER,
  "REF_CD_OPL_ARQUIVO" INTEGER,
  "IDEMPOTENCY_KEY" VARCHAR(128) NOT NULL,
  "DH_REGISTRO" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "SG_USER" VARCHAR(64),
  CONSTRAINT uq_wms_movimento_est_tenant_idem UNIQUE ("TENANT_ID", "IDEMPOTENCY_KEY")
);

COMMENT ON TABLE "WMS_MOVIMENTO_ESTOQUE" IS 'Alterações de saldo lógico por produto dono; QTD negativa = saída. Saldo de referência = recebimentos encerrados (CONFERENCIA_JSON) + soma desta tabela (MVP).';

CREATE INDEX IF NOT EXISTS idx_wms_movimento_tenant_dono_prod
  ON "WMS_MOVIMENTO_ESTOQUE" ("TENANT_ID", "CD_DONO", "CD_PRODUTO");

CREATE INDEX IF NOT EXISTS idx_wms_movimento_tenant_carga
  ON "WMS_MOVIMENTO_ESTOQUE" ("TENANT_ID", "REF_CD_CARGA");
