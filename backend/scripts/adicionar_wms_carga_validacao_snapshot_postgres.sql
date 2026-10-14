-- Snapshot de divergências NF×OPL na expedição (auditoria / sanção posterior).
-- Executar no PostgreSQL (atlas_cargo_prd). Idempotente.

ALTER TABLE "WMS_CARGA_VALIDACAO"
  ADD COLUMN IF NOT EXISTS "TP_MOMENTO" VARCHAR(32) NOT NULL DEFAULT 'VALIDACAO';

ALTER TABLE "WMS_CARGA_VALIDACAO"
  ADD COLUMN IF NOT EXISTS "PAYLOAD_JSON" JSONB;

ALTER TABLE "WMS_CARGA_VALIDACAO"
  ADD COLUMN IF NOT EXISTS "DS_EVENTO" VARCHAR(500);

COMMENT ON COLUMN "WMS_CARGA_VALIDACAO"."TP_MOMENTO" IS
  'VALIDACAO | INICIO_EXPEDICAO | SAIDA | SANACAO — momento do registro para auditoria.';

COMMENT ON COLUMN "WMS_CARGA_VALIDACAO"."PAYLOAD_JSON" IS
  'JSON completo (divergencias, conferencias, contadores) no momento do snapshot.';

COMMENT ON COLUMN "WMS_CARGA_VALIDACAO"."DS_EVENTO" IS
  'Texto livre (ex.: sanção após import OPL Lote 10).';

CREATE INDEX IF NOT EXISTS "idx_wms_carga_validacao_momento"
  ON "WMS_CARGA_VALIDACAO" ("TENANT_ID", "CD_CARGA", "TP_MOMENTO", "GERADO_EM" DESC);
