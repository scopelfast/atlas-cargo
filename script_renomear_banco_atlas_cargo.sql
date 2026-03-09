-- ============================================================================
-- Renomear banco: divulgacarga_prd → atlas_cargo_prd
-- Execute no pgAdmin conectado ao banco "postgres" (não ao divulgacarga_prd).
-- Atlas Cargo
-- ============================================================================

-- 1) Encerrar todas as conexões com o banco que será renomeado
-- (obrigatório: PostgreSQL não renomeia banco com sessões ativas)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT pid
    FROM pg_stat_activity
    WHERE datname = 'divulgacarga_prd'
      AND pid <> pg_backend_pid()
  ) LOOP
    PERFORM pg_terminate_backend(r.pid);
  END LOOP;
END $$;

-- 2) Renomear o banco
ALTER DATABASE divulgacarga_prd RENAME TO atlas_cargo_prd;

-- Pronto. Atualize o .env do backend:
--   DB_DATABASE=atlas_cargo_prd
-- e reinicie a aplicação.
