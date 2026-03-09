-- =============================================
-- Script: Adicionar colunas de desativação (soft delete) em CONTROLEVALIDADE
-- Banco: PostgreSQL (Atlas Cargo)
-- Uso: histórico para seguro — quem liberou (SGUSER), quem removeu (SGUSER_REMOVIDO/DHREMOVIDO)
-- =============================================

-- FGATIVO: S = ativa, N = desativada (removida). Default S para registros existentes e novos.
ALTER TABLE "CONTROLEVALIDADE"
  ADD COLUMN IF NOT EXISTS "FGATIVO" char(1) DEFAULT 'S';

-- Quem desativou e quando (dados para seguro)
ALTER TABLE "CONTROLEVALIDADE"
  ADD COLUMN IF NOT EXISTS "SGUSER_REMOVIDO" varchar(50) NULL;

ALTER TABLE "CONTROLEVALIDADE"
  ADD COLUMN IF NOT EXISTS "DHREMOVIDO" timestamp NULL;

-- Garantir que registros já existentes fiquem ativos
UPDATE "CONTROLEVALIDADE"
SET "FGATIVO" = 'S'
WHERE "FGATIVO" IS NULL;

-- Comentários (opcional)
COMMENT ON COLUMN "CONTROLEVALIDADE"."FGATIVO" IS 'S=ativa, N=desativada (removida). Não excluir registro.';
COMMENT ON COLUMN "CONTROLEVALIDADE"."SGUSER_REMOVIDO" IS 'Login do usuário que desativou a validade (histórico para seguro).';
COMMENT ON COLUMN "CONTROLEVALIDADE"."DHREMOVIDO" IS 'Data/hora em que a validade foi desativada (histórico para seguro).';
