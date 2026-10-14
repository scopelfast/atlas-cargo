-- Limite de usuários ativos (assentos) por plano e override por cliente SaaS.
-- PostgreSQL. Idempotente. Rode após saas_estrutura_plano_cliente_modulo_postgres.sql
-- NULL = sem limite (comportamento legado).

ALTER TABLE "SAAS_PLANO"
  ADD COLUMN IF NOT EXISTS "MAX_ASSENTOS_USUARIOS" integer NULL;

COMMENT ON COLUMN "SAAS_PLANO"."MAX_ASSENTOS_USUARIOS" IS 'Máximo de usuários FGACTIVE=S no tenant; NULL = ilimitado.';

ALTER TABLE "SAAS_CLIENTE_CONTRATANTE"
  ADD COLUMN IF NOT EXISTS "MAX_ASSENTOS_USUARIOS_OVR" integer NULL;

COMMENT ON COLUMN "SAAS_CLIENTE_CONTRATANTE"."MAX_ASSENTOS_USUARIOS_OVR" IS 'Override por tenant; NULL = usar SAAS_PLANO.MAX_ASSENTOS_USUARIOS.';
