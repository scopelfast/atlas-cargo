-- =============================================
-- Adiciona coluna FGSITVIAGEM na tabela SITUACAOVIAGEM (PostgreSQL)
-- Código de situação usado em VIAGEMMESTRE (ex.: P=Programada, D=Preparação, T=Em trânsito, A=Aprovada, F=Finalizada, etc.)
-- =============================================

ALTER TABLE "SITUACAOVIAGEM"
ADD COLUMN IF NOT EXISTS "FGSITVIAGEM" CHAR(1) NULL;

COMMENT ON COLUMN "SITUACAOVIAGEM"."FGSITVIAGEM" IS 'Código da situação (usado em VIAGEMMESTRE): P=Programada, D=Preparação, T=Em trânsito, A=Aprovada, F=Finalizada, C=Cancelada, E=Final de rota, M=Emissão documentos';
