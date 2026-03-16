-- Script: Adicionar país por cadastro (Cadastro Geral)
-- O tipo de documento é definido por cadastro (país do cadastro), não só pela configuração.
-- Quando PAIS for NULL, o sistema usa o país padrão das Configurações.
-- PostgreSQL

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CADASTROGERAL' AND column_name = 'PAIS'
  ) THEN
    ALTER TABLE "CADASTROGERAL" ADD COLUMN "PAIS" VARCHAR(2) NULL;
    COMMENT ON COLUMN "CADASTROGERAL"."PAIS" IS 'País do cadastro (BR, PY, AR, UY). NULL = usar padrão das Configurações.';
  END IF;
END $$;

-- Comentário opcional (seguro se a coluna já existir)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CADASTROGERAL' AND column_name = 'PAIS') THEN
    EXECUTE 'COMMENT ON COLUMN "CADASTROGERAL"."PAIS" IS ''País do cadastro (BR, PY, AR, UY). NULL = usar padrão das Configurações.''';
  END IF;
END $$;
