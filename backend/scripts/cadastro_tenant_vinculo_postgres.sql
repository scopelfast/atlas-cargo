-- Liga um motorista do bolsão (tenant default) à torre que vai usá-lo.
-- A ficha original permanece no default. Senha e celular de login não são copiados.
-- Idempotente.

CREATE TABLE IF NOT EXISTS "CADASTRO_TENANT_VINCULO" (
  "TENANT_ID" varchar(64) NOT NULL,
  "CDCADASTRO" numeric(15,0) NOT NULL,
  "FGACTIVE" char(1) NOT NULL DEFAULT 'A',
  "STATUSAPROVACAO" char(1) NOT NULL DEFAULT 'P',
  "DHVINCULO" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "SGUSER" varchar(50) NULL,
  PRIMARY KEY ("TENANT_ID", "CDCADASTRO")
);

CREATE INDEX IF NOT EXISTS "IX_CADASTRO_TENANT_VINCULO_CAD"
  ON "CADASTRO_TENANT_VINCULO" ("CDCADASTRO");
