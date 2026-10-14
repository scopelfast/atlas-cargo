-- Script: adicionar_tenant_id_tipoviagem_postgres.sql
-- Coluna "TENANT_ID" em TIPOVIAGEM (Gerenciar Tipos de Viagem / combos).
-- Legado: 'default'. API: leitura tenant OU 'default'; escrita só linhas do tenant.
-- Idempotente. PostgreSQL 11+.

ALTER TABLE "TIPOVIAGEM" ADD COLUMN IF NOT EXISTS "TENANT_ID" VARCHAR(64) NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_tipoviagem_tenant ON "TIPOVIAGEM" ("TENANT_ID");
