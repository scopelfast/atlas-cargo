-- Snapshot de placas/classes no momento da convocação (auditoria).
-- Listagens usam COALESCE(snapshot, cálculo ao vivo) para registos antigos sem snapshot.

ALTER TABLE "CONVOCACAO" ADD COLUMN IF NOT EXISTS "TXT_PLACAS_SNAPSHOT" text NULL;
ALTER TABLE "CONVOCACAO" ADD COLUMN IF NOT EXISTS "TXT_CLASSES_CONJ_SNAPSHOT" text NULL;

COMMENT ON COLUMN "CONVOCACAO"."TXT_PLACAS_SNAPSHOT" IS 'Placas esperadas (viagem ou motorista) gravadas na criação da convocação; não seguir alterações posteriores do cadastro.';
COMMENT ON COLUMN "CONVOCACAO"."TXT_CLASSES_CONJ_SNAPSHOT" IS 'Classes do conjunto gravadas na criação da convocação; auditoria.';
