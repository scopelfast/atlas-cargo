-- Confirmação de placas na convocação (Fase C — app motorista)
-- Execute no PostgreSQL de cada ambiente após deploy do backend/app.

ALTER TABLE "CONVOCACAO" ADD COLUMN IF NOT EXISTS "FGCONFIRMACAOPLACAS" varchar(1) NULL;
ALTER TABLE "CONVOCACAO" ADD COLUMN IF NOT EXISTS "TXTPLACASDIVERGENCIA" text NULL;
ALTER TABLE "CONVOCACAO" ADD COLUMN IF NOT EXISTS "DHCONFIRMACAOPLACAS" timestamp NULL;

COMMENT ON COLUMN "CONVOCACAO"."FGCONFIRMACAOPLACAS" IS 'C=confirmou placas da viagem; D=divergência informada; NULL=não registrado';
COMMENT ON COLUMN "CONVOCACAO"."TXTPLACASDIVERGENCIA" IS 'Texto do motorista ao declarar divergência de placas';
COMMENT ON COLUMN "CONVOCACAO"."DHCONFIRMACAOPLACAS" IS 'Data/hora do registro da confirmação ou divergência';
