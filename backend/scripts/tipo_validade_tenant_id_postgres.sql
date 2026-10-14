-- Script: tipo_validade_tenant_id_postgres.sql
-- Multi-tenant: coluna "TENANT_ID" em TIPOVALIDADE (filtro por tenant no app).
-- Legado recebe 'default'. Idempotente. Executar após adicionar_tenant_id_fase2_postgres.sql em CONTROLEVALIDADE (recomendado).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute a
    INNER JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    INNER JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname = 'TIPOVALIDADE'
      AND a.attname = 'TENANT_ID'
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    ALTER TABLE "TIPOVALIDADE"
      ADD COLUMN "TENANT_ID" VARCHAR(64) NOT NULL DEFAULT 'default';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tipovalidade_tenant ON "TIPOVALIDADE" ("TENANT_ID");
