-- Script: tipoequipamento_uk_tenant_ds_postgres.sql
-- Objetivo: trocar UNIQUE só em DSTIPOEQUIPAMENTO por UNIQUE ("TENANT_ID","DSTIPOEQUIPAMENTO"),
--           permitindo a mesma descrição em tenants diferentes (multi-tenant).
-- Pré-requisito: coluna "TENANT_ID" em "TIPOEQUIPAMENTO" (adicionar_tenant_id_catalogos_equipamento_postgres.sql).
-- Executar no pgAdmin: banco atlas_cargo_prd. Idempotente.

ALTER TABLE "TIPOEQUIPAMENTO" DROP CONSTRAINT IF EXISTS "uk_tipoequipamento_ds";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uk_tipoequipamento_tenant_ds'
  ) THEN
    ALTER TABLE "TIPOEQUIPAMENTO"
      ADD CONSTRAINT "uk_tipoequipamento_tenant_ds" UNIQUE ("TENANT_ID", "DSTIPOEQUIPAMENTO");
  END IF;
END $$;
