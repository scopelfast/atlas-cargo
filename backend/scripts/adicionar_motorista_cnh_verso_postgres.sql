-- Foto do verso da CNH / licença (app motorista + torre).
-- Idempotente.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_COMPLEMENTO' AND column_name = 'FOTOCNH_VERSO'
  ) THEN
    ALTER TABLE "MOTORISTA_COMPLEMENTO" ADD COLUMN "FOTOCNH_VERSO" varchar(500) NULL;
    COMMENT ON COLUMN "MOTORISTA_COMPLEMENTO"."FOTOCNH_VERSO" IS 'Caminho público da foto do verso da CNH/licença (app motorista).';
  END IF;
END $$;
