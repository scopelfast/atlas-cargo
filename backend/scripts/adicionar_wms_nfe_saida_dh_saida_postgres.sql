-- Data de saída da mercadoria (ide.dSaiEnt / dhSaiEnt do XML NF-e de saída).
ALTER TABLE "WMS_NFE_SAIDA"
  ADD COLUMN IF NOT EXISTS "DH_SAIDA" TIMESTAMPTZ;

COMMENT ON COLUMN "WMS_NFE_SAIDA"."DH_SAIDA" IS
  'Data/hora de saída da mercadoria (XML: ide.dSaiEnt+hSaiEnt ou ide.dhSaiEnt). Distinto de DH_EMISSAO.';

CREATE INDEX IF NOT EXISTS idx_wms_nfe_saida_tenant_dh_saida
  ON "WMS_NFE_SAIDA" ("TENANT_ID", "DH_SAIDA" DESC);
