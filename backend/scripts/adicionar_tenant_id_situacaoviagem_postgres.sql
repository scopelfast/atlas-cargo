-- Script: adicionar_tenant_id_situacaoviagem_postgres.sql
-- Coluna "TENANT_ID" em SITUACAOVIAGEM (Gerenciar Situações de Viagem / combos).
-- Legado: 'default'. API: leitura tenant OU 'default'; escrita só linhas do tenant.
-- Idempotente. PostgreSQL 11+.

ALTER TABLE "SITUACAOVIAGEM" ADD COLUMN IF NOT EXISTS "TENANT_ID" VARCHAR(64) NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_situacaoviagem_tenant ON "SITUACAOVIAGEM" ("TENANT_ID");
