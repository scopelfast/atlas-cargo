-- WMS — % cobrança sobre valor das NF-e expedidas (por dono do estoque).
-- PostgreSQL, idempotente. Executar após adicionar_wms_estoque_valor_snapshot_postgres.sql

ALTER TABLE "WMS_DONO_ESTOQUE"
  ADD COLUMN IF NOT EXISTS "PCT_COBRANCA_EXPEDICAO" NUMERIC(8, 4);

COMMENT ON COLUMN "WMS_DONO_ESTOQUE"."PCT_COBRANCA_EXPEDICAO" IS
  'Percentual de cobrança sobre o valor (vNF) das NF-e expedidas no período. Ex.: 1.5 = 1,5%. Não usa peso.';
