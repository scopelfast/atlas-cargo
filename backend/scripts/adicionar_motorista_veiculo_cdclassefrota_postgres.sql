-- Classe de frota informada pelo app em MOTORISTA_VEICULO (opcional; FK lógica a CLASSEFROTA).
-- Idempotente. Executar no mesmo banco dos outros scripts do app motorista.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_VEICULO' AND column_name = 'CDCLASSEFROTA'
  ) THEN
    ALTER TABLE "MOTORISTA_VEICULO" ADD COLUMN "CDCLASSEFROTA" smallint NULL;
    COMMENT ON COLUMN "MOTORISTA_VEICULO"."CDCLASSEFROTA" IS 'Classe de frota (CLASSEFROTA) declarada pelo motorista no app.';
  END IF;
END $$;
