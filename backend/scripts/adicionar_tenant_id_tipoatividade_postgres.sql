-- TIPOATIVIDADE: isolamento por tenant (sem vazar cadastros do default para outros tenants).
-- Idempotente. Alinhar DEFAULT com DEFAULT_TENANT_ID / .env após rodar adicionar_tenant_id_fase2_postgres.sql nas demais tabelas.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    INNER JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    INNER JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname = 'TIPOATIVIDADE'
      AND a.attname = 'TENANT_ID'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    ALTER TABLE "TIPOATIVIDADE"
      ADD COLUMN "TENANT_ID" VARCHAR(64) NOT NULL DEFAULT 'default';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tipoatividade_tenant ON "TIPOATIVIDADE" ("TENANT_ID");
