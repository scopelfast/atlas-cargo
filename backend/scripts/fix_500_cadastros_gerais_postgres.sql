-- ============================================================================
-- Correção rápida para 500 em GET /api/cadastros-gerais
-- Adiciona coluna PAIS em CADASTROGERAL se faltar (e suprime NOTICEs).
-- Executar no pgAdmin (Query Tool) no banco atlas_cargo_prd.
-- Idempotente: pode rodar mais de uma vez.
-- ============================================================================

SET client_min_messages = WARNING;

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
