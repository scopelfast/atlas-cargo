-- Assinatura de rota WMS (paradas + embarque + retorno) para reutilizar ROTEIRO entre viagens equivalentes.
-- Idempotente.

ALTER TABLE "ROTEIRO" ADD COLUMN IF NOT EXISTS "SIG_WMS_ROTA" VARCHAR(64) NULL;

COMMENT ON COLUMN "ROTEIRO"."SIG_WMS_ROTA" IS 'SHA-256 (hex 64) da sequência WMS/OSRM; viagens com mesma assinatura reutilizam este IDROTEIRO.';

CREATE UNIQUE INDEX IF NOT EXISTS "UX_ROTEIRO_TENANT_SIG_WMS"
  ON "ROTEIRO" ("TENANT_ID", "SIG_WMS_ROTA")
  WHERE "SIG_WMS_ROTA" IS NOT NULL AND btrim("SIG_WMS_ROTA") <> '';
