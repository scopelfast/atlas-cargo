-- =============================================
-- Adicionar coluna CDSITUACAOVIAGEM em TIPOOCORRENCIA (PostgreSQL)
-- Ao registrar uma macro, a situação da viagem será atualizada com este código.
-- =============================================

ALTER TABLE "TIPOOCORRENCIA"
ADD COLUMN IF NOT EXISTS "CDSITUACAOVIAGEM" SMALLINT NULL;

COMMENT ON COLUMN "TIPOOCORRENCIA"."CDSITUACAOVIAGEM" IS 'Código da situação da viagem (SITUACAOVIAGEM) a aplicar ao registrar esta macro';
