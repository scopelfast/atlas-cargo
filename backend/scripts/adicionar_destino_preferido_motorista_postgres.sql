-- Script: Adicionar região de destino preferido ao motorista (MOTORISTA_COMPLEMENTO)
-- Uso: divulgação de cargas - para onde o motorista tem preferência de embarque.
-- PostgreSQL

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_COMPLEMENTO' AND column_name = 'PAIS_DESTINO_PREF'
  ) THEN
    ALTER TABLE "MOTORISTA_COMPLEMENTO" ADD COLUMN "PAIS_DESTINO_PREF" VARCHAR(2) NULL;
    COMMENT ON COLUMN "MOTORISTA_COMPLEMENTO"."PAIS_DESTINO_PREF" IS 'País de destino preferido (BR, PY, AR, etc.).';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_COMPLEMENTO' AND column_name = 'SIGLA_ESTADO_DESTINO_PREF'
  ) THEN
    ALTER TABLE "MOTORISTA_COMPLEMENTO" ADD COLUMN "SIGLA_ESTADO_DESTINO_PREF" VARCHAR(10) NULL;
    COMMENT ON COLUMN "MOTORISTA_COMPLEMENTO"."SIGLA_ESTADO_DESTINO_PREF" IS 'Sigla do estado/UF de destino preferido.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_COMPLEMENTO' AND column_name = 'CIDADE_DESTINO_PREF'
  ) THEN
    ALTER TABLE "MOTORISTA_COMPLEMENTO" ADD COLUMN "CIDADE_DESTINO_PREF" VARCHAR(100) NULL;
    COMMENT ON COLUMN "MOTORISTA_COMPLEMENTO"."CIDADE_DESTINO_PREF" IS 'Nome da cidade de destino preferido (opcional).';
  END IF;
END $$;

-- Garantir que NRCELULAR aceite E.164 (até 15 dígitos) - se for varchar pequeno, alterar
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CADASTROGERAL' AND column_name = 'NRCELULAR') THEN
    -- Alterar apenas se o tipo for numérico ou muito curto (opcional)
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'CADASTROGERAL' AND column_name = 'NRCELULAR'
        AND data_type = 'numeric'
    ) THEN
      ALTER TABLE "CADASTROGERAL" ALTER COLUMN "NRCELULAR" TYPE VARCHAR(20);
    END IF;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL; -- Ignorar se já for varchar ou não existir
END $$;
