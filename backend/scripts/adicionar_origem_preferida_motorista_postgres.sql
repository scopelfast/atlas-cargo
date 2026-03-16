-- Script: Adicionar origem preferida (embarque) ao motorista (MOTORISTA_COMPLEMENTO)
-- Uso: aba Locais preferidos no Gerenciar Cadastro Geral – onde o motorista prefere carregar.
-- PostgreSQL

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_COMPLEMENTO' AND column_name = 'PAIS_EMBARQUE_PREF'
  ) THEN
    ALTER TABLE "MOTORISTA_COMPLEMENTO" ADD COLUMN "PAIS_EMBARQUE_PREF" VARCHAR(2) NULL;
    COMMENT ON COLUMN "MOTORISTA_COMPLEMENTO"."PAIS_EMBARQUE_PREF" IS 'País de origem preferida/embarque (BR, PY, AR, etc.).';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_COMPLEMENTO' AND column_name = 'SIGLA_ESTADO_EMBARQUE_PREF'
  ) THEN
    ALTER TABLE "MOTORISTA_COMPLEMENTO" ADD COLUMN "SIGLA_ESTADO_EMBARQUE_PREF" VARCHAR(10) NULL;
    COMMENT ON COLUMN "MOTORISTA_COMPLEMENTO"."SIGLA_ESTADO_EMBARQUE_PREF" IS 'Sigla do estado/UF de origem preferida (embarque).';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_COMPLEMENTO' AND column_name = 'REGIAO_EMBARQUE_PREF'
  ) THEN
    ALTER TABLE "MOTORISTA_COMPLEMENTO" ADD COLUMN "REGIAO_EMBARQUE_PREF" VARCHAR(60) NULL;
    COMMENT ON COLUMN "MOTORISTA_COMPLEMENTO"."REGIAO_EMBARQUE_PREF" IS 'Região de origem preferida (embarque), opcional.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_COMPLEMENTO' AND column_name = 'CIDADE_EMBARQUE_PREF'
  ) THEN
    ALTER TABLE "MOTORISTA_COMPLEMENTO" ADD COLUMN "CIDADE_EMBARQUE_PREF" VARCHAR(100) NULL;
    COMMENT ON COLUMN "MOTORISTA_COMPLEMENTO"."CIDADE_EMBARQUE_PREF" IS 'Nome da cidade de origem preferida (embarque).';
  END IF;
END $$;
