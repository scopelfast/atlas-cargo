-- Fase 2 Multimoeda: adicionar coluna MOEDA onde há valor monetário (seguro: IF NOT EXISTS)
-- PostgreSQL. Executar UMA VEZ antes de implantar o backend que retorna MOEDA nas APIs.
-- Valores existentes permanecem; nova coluna default 'BRL'.
-- Atlas Cargo - Plano Multimoeda/Multilíngua

-- VIAGEMMESTRE (viagem mestre: VLFRETE)
ALTER TABLE "VIAGEMMESTRE"
  ADD COLUMN IF NOT EXISTS "MOEDA" VARCHAR(3) DEFAULT 'BRL';

-- Comentário para documentação
COMMENT ON COLUMN "VIAGEMMESTRE"."MOEDA" IS 'Código ISO 4217 da moeda do frete (ex: BRL, PYG). Fase 2 multimoeda.';
