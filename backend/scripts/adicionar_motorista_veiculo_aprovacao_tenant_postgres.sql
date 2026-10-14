-- Nome: adicionar_motorista_veiculo_aprovacao_tenant_postgres.sql
-- Objetivo: Fase B app motorista — pendência de veículo por tenant, placa normalizada, aprovação na torre.
-- Executar no pgAdmin, banco atlas_cargo_prd (ou ambiente equivalente). Idempotente.

-- Colunas em MOTORISTA_VEICULO
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_VEICULO' AND column_name = 'TENANT_ID'
  ) THEN
    ALTER TABLE "MOTORISTA_VEICULO" ADD COLUMN "TENANT_ID" varchar(64) NULL;
    COMMENT ON COLUMN "MOTORISTA_VEICULO"."TENANT_ID" IS 'Tenant do cadastro do motorista (escopo SaaS).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_VEICULO' AND column_name = 'PLACA_NORMALIZADA'
  ) THEN
    ALTER TABLE "MOTORISTA_VEICULO" ADD COLUMN "PLACA_NORMALIZADA" varchar(10) NULL;
    COMMENT ON COLUMN "MOTORISTA_VEICULO"."PLACA_NORMALIZADA" IS 'Placa só A-Z0-9, para unicidade e busca.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_VEICULO' AND column_name = 'STATUSAPROVACAO'
  ) THEN
    ALTER TABLE "MOTORISTA_VEICULO" ADD COLUMN "STATUSAPROVACAO" char(1) NULL DEFAULT 'P';
    COMMENT ON COLUMN "MOTORISTA_VEICULO"."STATUSAPROVACAO" IS 'P=Pendente, A=Aprovado, R=Rejeitado (frota informada pelo app).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_VEICULO' AND column_name = 'PAPEL_CONJUNTO'
  ) THEN
    ALTER TABLE "MOTORISTA_VEICULO" ADD COLUMN "PAPEL_CONJUNTO" varchar(20) NULL;
    COMMENT ON COLUMN "MOTORISTA_VEICULO"."PAPEL_CONJUNTO" IS 'Papel no conjunto: CAVALO, CARRETA, etc.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_VEICULO' AND column_name = 'CDEQUIPAMENTO'
  ) THEN
    ALTER TABLE "MOTORISTA_VEICULO" ADD COLUMN "CDEQUIPAMENTO" numeric(15,0) NULL;
    COMMENT ON COLUMN "MOTORISTA_VEICULO"."CDEQUIPAMENTO" IS 'Preenchido na torre ao vincular EQUIPAMENTO oficial (opcional).';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_VEICULO' AND column_name = 'MOTIVOREPROVACAO'
  ) THEN
    ALTER TABLE "MOTORISTA_VEICULO" ADD COLUMN "MOTIVOREPROVACAO" varchar(500) NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_VEICULO' AND column_name = 'DHAPROVACAO'
  ) THEN
    ALTER TABLE "MOTORISTA_VEICULO" ADD COLUMN "DHAPROVACAO" timestamp NULL;
  END IF;
END $$;

-- Backfill TENANT_ID a partir do motorista
UPDATE "MOTORISTA_VEICULO" mv
SET "TENANT_ID" = cg."TENANT_ID"
FROM "CADASTROGERAL" cg
WHERE mv."CDCADASTRO" = cg."CDCADASTRO"
  AND (mv."TENANT_ID" IS NULL OR TRIM(mv."TENANT_ID"::text) = '')
  AND cg."TENANT_ID" IS NOT NULL;

-- Backfill PLACA_NORMALIZADA (maiúsculas, sem hífen)
UPDATE "MOTORISTA_VEICULO"
SET "PLACA_NORMALIZADA" = UPPER(REGEXP_REPLACE(COALESCE("PLACA", ''), '[^A-Z0-9]', '', 'gi'))
WHERE ("PLACA_NORMALIZADA" IS NULL OR TRIM("PLACA_NORMALIZADA"::text) = '')
  AND "PLACA" IS NOT NULL
  AND LENGTH(REGEXP_REPLACE(COALESCE("PLACA", ''), '[^A-Z0-9]', '', 'gi')) >= 7;

-- Registros antigos sem status: tratar como já aprovados (comportamento pré-Fase B)
UPDATE "MOTORISTA_VEICULO"
SET "STATUSAPROVACAO" = 'A'
WHERE "STATUSAPROVACAO" IS NULL;

-- Índice único: um veículo ativo por motorista + tenant + placa normalizada
DROP INDEX IF EXISTS "UK_MV_TENANT_CAD_PLACA_ATIVO";
CREATE UNIQUE INDEX "UK_MV_TENANT_CAD_PLACA_ATIVO"
  ON "MOTORISTA_VEICULO" ("TENANT_ID", "CDCADASTRO", "PLACA_NORMALIZADA")
  WHERE COALESCE("FGACTIVE", 'S') = 'S'
    AND "PLACA_NORMALIZADA" IS NOT NULL
    AND LENGTH(TRIM("PLACA_NORMALIZADA"::text)) >= 7;

CREATE INDEX IF NOT EXISTS "IX_MV_TENANT_STATUS"
  ON "MOTORISTA_VEICULO" ("TENANT_ID", "STATUSAPROVACAO")
  WHERE COALESCE("STATUSAPROVACAO", 'P') = 'P';
