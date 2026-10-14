-- Guarda CDSITUACAOVIAGEM / FGSITVIAGEM antes de inativar (cancelar) para restaurar na reativação.
-- PostgreSQL, idempotente. Opcional: o controller tenta sem estas colunas se ainda não existirem.

ALTER TABLE "VIAGEMMESTRE"
  ADD COLUMN IF NOT EXISTS "PREV_CDSIT_INAT" INTEGER NULL;

ALTER TABLE "VIAGEMMESTRE"
  ADD COLUMN IF NOT EXISTS "PREV_FGSIT_INAT" CHAR(1) NULL;

COMMENT ON COLUMN "VIAGEMMESTRE"."PREV_CDSIT_INAT" IS 'CDSITUACAOVIAGEM antes da inativação (cancelamento lógico); usado ao reativar.';
COMMENT ON COLUMN "VIAGEMMESTRE"."PREV_FGSIT_INAT" IS 'FGSITVIAGEM antes da inativação; usado ao reativar.';
