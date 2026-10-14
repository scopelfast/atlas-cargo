-- PK composta (TENANT_ID, CDMOTORISTA) em DRIVER_REPUTATION — multi-tenant
-- Pré-requisito: coluna "TENANT_ID" na tabela (backend/scripts/adicionar_tenant_id_fase2_postgres.sql).
-- Idempotente na medida do possível: falha se já existir PK composta ou dados duplicados.
--
-- Uso: pgAdmin / psql no banco da aplicação.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    INNER JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
    INNER JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'DRIVER_REPUTATION'
      AND a.attname = 'TENANT_ID' AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Coluna TENANT_ID ausente em DRIVER_REPUTATION. Execute adicionar_tenant_id_fase2_postgres.sql primeiro.';
  END IF;
END $$;

-- Remover PK antiga só em "CDMOTORISTA" (nome padrão PostgreSQL)
ALTER TABLE public."DRIVER_REPUTATION" DROP CONSTRAINT IF EXISTS "DRIVER_REPUTATION_pkey";

-- Nova PK composta (um registro por motorista por tenant)
ALTER TABLE public."DRIVER_REPUTATION" ADD PRIMARY KEY ("TENANT_ID", "CDMOTORISTA");

CREATE INDEX IF NOT EXISTS "IX_DRIVER_REPUTATION_TENANT_SCORE"
  ON public."DRIVER_REPUTATION" ("TENANT_ID", "SCORE" DESC);
