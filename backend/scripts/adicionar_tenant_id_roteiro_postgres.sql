-- Script: adicionar_tenant_id_roteiro_postgres.sql
-- Coluna "TENANT_ID" em ROTEIRO (Gerenciar Roteiros / combo viagens).
-- Legado: 'default'. API: leitura tenant OU 'default'; escrita só linhas do tenant.
-- Idempotente. PostgreSQL 11+.

ALTER TABLE "ROTEIRO" ADD COLUMN IF NOT EXISTS "TENANT_ID" VARCHAR(64) NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_roteiro_tenant ON "ROTEIRO" ("TENANT_ID");
