-- WMS — reserva de estoque ao concluir picking OPL (Fase C, MVP).
-- Saldo de referência = NF-e encerradas (mesma base da simulação de cobertura). Conflito bloqueia o último save.
-- PostgreSQL, idempotente. Executar após wms_separacao_opl_postgres.sql e wms_cadastros_mestre (dono).

CREATE TABLE IF NOT EXISTS "WMS_RESERVA_ESTOQUE_OPL" (
  "CD_RESERVA" BIGSERIAL PRIMARY KEY,
  "TENANT_ID" VARCHAR(64) NOT NULL,
  "CD_DONO" INTEGER NOT NULL REFERENCES "WMS_DONO_ESTOQUE" ("CD_DONO") ON DELETE CASCADE,
  "CD_PRODUTO" INTEGER NOT NULL,
  "CD_OPL_ARQUIVO" INTEGER NOT NULL REFERENCES "WMS_OPL_ARQUIVO" ("CD_OPL_ARQUIVO") ON DELETE CASCADE,
  "QTD_RESERVADA" NUMERIC(18, 6) NOT NULL,
  "DH_ATUALIZACAO" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "SG_USER" VARCHAR(64),
  CONSTRAINT uq_wms_reserva_opl_tenant_arquivo_produto UNIQUE ("TENANT_ID", "CD_OPL_ARQUIVO", "CD_PRODUTO")
);

COMMENT ON TABLE "WMS_RESERVA_ESTOQUE_OPL" IS 'Quantidade reservada por produto dono ao encerrar picking de um espelho OPL; soma com outros espelhos não pode exceder saldo estimado de NF-e encerradas.';

CREATE INDEX IF NOT EXISTS idx_wms_reserva_opl_tenant_dono_prod
  ON "WMS_RESERVA_ESTOQUE_OPL" ("TENANT_ID", "CD_DONO", "CD_PRODUTO");

CREATE INDEX IF NOT EXISTS idx_wms_reserva_opl_arquivo
  ON "WMS_RESERVA_ESTOQUE_OPL" ("CD_OPL_ARQUIVO");
