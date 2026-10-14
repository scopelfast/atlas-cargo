-- Tipo de transportador/motorista (classificação BR): TAC, ETC, CTC, TAC_AGG, TAC_IND
-- Idempotente: pode executar mais de uma vez.
-- Atlas Cargo / SysScopel

ALTER TABLE "CADASTROGERAL" ADD COLUMN IF NOT EXISTS "TIPO_TRANSPORTE_BR" VARCHAR(24) NULL;

COMMENT ON COLUMN "CADASTROGERAL"."TIPO_TRANSPORTE_BR" IS 'Brasil: TAC, ETC, CTC, TAC_AGG (agregado), TAC_IND (independente); preenchido quando FGMOTORISTA ou FGTRANSPORTADOR.';
