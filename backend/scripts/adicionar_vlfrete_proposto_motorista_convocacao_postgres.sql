-- Proposta de frete informada pelo motorista ao aceitar pela página pública (/convocacao/:id).
-- Execute uma vez no PostgreSQL (Atlas Cargo).
-- Moeda: usa a mesma da viagem (VIAGEMMESTRE.MOEDA) na interface; valor numérico único na convocação.

ALTER TABLE "CONVOCACAO"
  ADD COLUMN IF NOT EXISTS "VL_FRETE_PROPOSTO_MOTORISTA" NUMERIC(15, 2) NULL;

COMMENT ON COLUMN "CONVOCACAO"."VL_FRETE_PROPOSTO_MOTORISTA" IS 'Valor de frete proposto pelo motorista ao aceitar (link público ou app); opcional.';
