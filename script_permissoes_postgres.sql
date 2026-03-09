-- =============================================================================
-- Permissões para o usuário da aplicação (PostgreSQL)
-- Execute no banco atlas_cargo_prd, como superuser (postgres).
-- Substitua 'sa' pelo usuário configurado em DB_USER no .env
-- =============================================================================

-- Conectar ao banco correto antes de executar:
-- \c atlas_cargo_prd

-- Dar uso no schema public (geralmente já tem)
GRANT USAGE ON SCHEMA public TO sa;

-- Todas as tabelas: SELECT, INSERT, UPDATE, DELETE
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sa;

-- Sequences (serial/bigserial) para INSERT poder obter próximo valor
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sa;

-- Tabelas e sequences criadas no futuro (opcional)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO sa;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO sa;

-- =============================================================================
-- Pronto. O usuário 'sa' (ou o que estiver em DB_USER) pode ler/escrever em
-- todas as tabelas do schema public.
-- =============================================================================
