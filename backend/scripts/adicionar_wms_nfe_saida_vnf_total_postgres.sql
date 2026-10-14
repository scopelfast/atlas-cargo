-- Valor total da NF (ICMSTot/vNF) para resumo de programação de cargas.
ALTER TABLE "WMS_NFE_SAIDA"
  ADD COLUMN IF NOT EXISTS "VNF_TOTAL" NUMERIC(15, 2);

COMMENT ON COLUMN "WMS_NFE_SAIDA"."VNF_TOTAL" IS 'Valor total da NF (vNF do XML). Preenchido na importação do XML de saída.';
