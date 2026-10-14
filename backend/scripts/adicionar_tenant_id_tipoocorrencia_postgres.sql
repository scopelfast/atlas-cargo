-- Script: adicionar_tenant_id_tipoocorrencia_postgres.sql
-- Coluna "TENANT_ID" em TIPOOCORRENCIA (macros / Gerenciar Tipos de Ocorrência).
-- Legado: 'default'. API: leitura tenant OU 'default'; escrita só linhas do tenant.
-- Idempotente. PostgreSQL 11+.

ALTER TABLE "TIPOOCORRENCIA" ADD COLUMN IF NOT EXISTS "TENANT_ID" VARCHAR(64) NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_tipoocorrencia_tenant ON "TIPOOCORRENCIA" ("TENANT_ID");
