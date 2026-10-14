-- Foto do comprovante de endereço (conta de luz, água, etc.) no cadastro do motorista.
-- Idempotente.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_COMPLEMENTO' AND column_name = 'FOTO_COMPROVANTE_ENDERECO'
  ) THEN
    ALTER TABLE "MOTORISTA_COMPLEMENTO" ADD COLUMN "FOTO_COMPROVANTE_ENDERECO" varchar(500) NULL;
    COMMENT ON COLUMN "MOTORISTA_COMPLEMENTO"."FOTO_COMPROVANTE_ENDERECO" IS 'Caminho público da foto do comprovante de endereço (app motorista).';
  END IF;
END $$;
