-- Script: adicionar_tenant_id_catalogos_equipamento_postgres.sql
-- Objetivo: coluna "TENANT_ID" nos catálogos usados pelo módulo Gerenciar Equipamentos (combos e modelos).
-- Legado recebe 'default'. Visibilidade na API: linhas do tenant OU 'default' (catálogo compartilhado).
-- Executar no pgAdmin: banco atlas_cargo_prd. Idempotente (pode rodar várias vezes).
-- Requer PostgreSQL 11+ (ADD COLUMN IF NOT EXISTS).

ALTER TABLE "GRUPOEQUIPAMENTO" ADD COLUMN IF NOT EXISTS "TENANT_ID" VARCHAR(64) NOT NULL DEFAULT 'default';
ALTER TABLE "TIPOEQUIPAMENTO" ADD COLUMN IF NOT EXISTS "TENANT_ID" VARCHAR(64) NOT NULL DEFAULT 'default';
ALTER TABLE "MARCAEQUIPAMENTO" ADD COLUMN IF NOT EXISTS "TENANT_ID" VARCHAR(64) NOT NULL DEFAULT 'default';
ALTER TABLE "MODELOEQUIPAMENTO" ADD COLUMN IF NOT EXISTS "TENANT_ID" VARCHAR(64) NOT NULL DEFAULT 'default';
ALTER TABLE "CLASSEFROTA" ADD COLUMN IF NOT EXISTS "TENANT_ID" VARCHAR(64) NOT NULL DEFAULT 'default';

CREATE INDEX IF NOT EXISTS idx_grupoequipamento_tenant ON "GRUPOEQUIPAMENTO" ("TENANT_ID");
CREATE INDEX IF NOT EXISTS idx_tipoequipamento_tenant ON "TIPOEQUIPAMENTO" ("TENANT_ID");
CREATE INDEX IF NOT EXISTS idx_marcaequipamento_tenant ON "MARCAEQUIPAMENTO" ("TENANT_ID");
CREATE INDEX IF NOT EXISTS idx_modeloequipamento_tenant ON "MODELOEQUIPAMENTO" ("TENANT_ID");
CREATE INDEX IF NOT EXISTS idx_classefrota_tenant ON "CLASSEFROTA" ("TENANT_ID");
