-- Controle de linhas já apontadas no relatório de shelf-life (Datas críticas).
-- PostgreSQL, idempotente.

CREATE TABLE IF NOT EXISTS "WMS_SHELF_APONTADO" (
  "CD_APONTADO" BIGSERIAL PRIMARY KEY,
  "TENANT_ID" VARCHAR(64) NOT NULL,
  "CD_DONO" INTEGER NOT NULL,
  "CD_PRODUTO" INTEGER NOT NULL,
  "LOTE" VARCHAR(80) NOT NULL DEFAULT '',
  "VALIDADE" DATE NOT NULL,
  "CODIGO_PRODUTO" VARCHAR(80),
  "NM_PRODUTO" VARCHAR(200),
  "DH_APONTADO" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "SG_USER" VARCHAR(64),
  "ORIGEM" VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
  "FG_ATIVO" CHAR(1) NOT NULL DEFAULT 'S',
  "DH_DESAPONTADO" TIMESTAMPTZ,
  "SG_USER_DESAPONTADO" VARCHAR(64),
  CONSTRAINT chk_wms_shelf_apontado_fg CHECK ("FG_ATIVO" IN ('S', 'N')),
  CONSTRAINT chk_wms_shelf_apontado_origem CHECK ("ORIGEM" IN ('MANUAL', 'JOB'))
);

COMMENT ON TABLE "WMS_SHELF_APONTADO" IS 'Linhas de shelf-life já passadas ao cliente (dono+produto+lote+validade). FG_ATIVO=N = desmarcado (auditoria).';
COMMENT ON COLUMN "WMS_SHELF_APONTADO"."LOTE" IS 'Lote normalizado (trim); vazio quando a NF não traz lote.';
COMMENT ON COLUMN "WMS_SHELF_APONTADO"."ORIGEM" IS 'MANUAL=tela Datas críticas; JOB=e-mail automático de vencimento.';
COMMENT ON COLUMN "WMS_SHELF_APONTADO"."FG_ATIVO" IS 'S=apontado vigente; N=desmarcado.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_wms_shelf_apontado_ativo
  ON "WMS_SHELF_APONTADO" ("TENANT_ID", "CD_DONO", "CD_PRODUTO", "LOTE", "VALIDADE")
  WHERE "FG_ATIVO" = 'S';

CREATE INDEX IF NOT EXISTS idx_wms_shelf_apontado_tenant_dono
  ON "WMS_SHELF_APONTADO" ("TENANT_ID", "CD_DONO", "FG_ATIVO");
