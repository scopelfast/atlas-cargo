-- Peso logístico por NF-e (planilha / PesoNF), usado no resumo de cargas quando preenchido.
ALTER TABLE "WMS_NFE_SAIDA"
  ADD COLUMN IF NOT EXISTS "PESO_RESUMO_KG" NUMERIC(14, 3);

COMMENT ON COLUMN "WMS_NFE_SAIDA"."PESO_RESUMO_KG" IS
  'Peso (kg) para resumo de programação. Fonte: planilha (PesoNF) ou informado na importação. Se NULL, calcula PESO_KG×qCom das linhas.';
