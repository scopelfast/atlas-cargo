-- Unique de documento por tenant em CADASTROGERAL (multi-tenant SaaS).
-- Antes existia apenas UK_CADASTROGERAL_CGCCPF (global): o mesmo CPF/CNPJ não podia existir em dois tenants.
-- Rode após backup. Idempotente na medida do possível.
--
-- Se o script falhar por duplicata DENTRO do mesmo TENANT_ID, corrija os dados antes de recriar a constraint.

ALTER TABLE "CADASTROGERAL" DROP CONSTRAINT IF EXISTS "UK_CADASTROGERAL_CGCCPF";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UK_CADASTROGERAL_TENANT_CGCCPF'
  ) THEN
    ALTER TABLE "CADASTROGERAL"
      ADD CONSTRAINT "UK_CADASTROGERAL_TENANT_CGCCPF" UNIQUE ("TENANT_ID", "CGCCPF");
  END IF;
END $$;
