-- adicionar_wms_opl_liberacao_cobertura_postgres.sql
-- Liberação supervisor: encerrar picking OPL com saldo insuficiente na simulação.
-- Executar no pgAdmin (PostgreSQL), idempotente.

CREATE TABLE IF NOT EXISTS "WMS_OPL_LIBERACAO_COBERTURA" (
  "CD_LIBERACAO" BIGSERIAL PRIMARY KEY,
  "CD_OPL_ARQUIVO" INTEGER NOT NULL,
  "TENANT_ID" VARCHAR(64) NOT NULL DEFAULT 'default',
  "CD_DONO" INTEGER,
  "DH_LIBERACAO" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "SG_USER" VARCHAR(64) NOT NULL,
  "AUTORIZADO_LOGIN" VARCHAR(50) NOT NULL,
  "AUTORIZADO_NOME" VARCHAR(120),
  "JUSTIFICATIVA" VARCHAR(1000) NOT NULL,
  "INCLUIU_RECEB_ABERTOS" CHAR(1) NOT NULL DEFAULT 'N',
  "RESUMO_JSON" JSONB
);

CREATE INDEX IF NOT EXISTS "idx_wms_opl_lib_cob_tenant_arq"
  ON "WMS_OPL_LIBERACAO_COBERTURA" ("TENANT_ID", "CD_OPL_ARQUIVO", "DH_LIBERACAO" DESC);

COMMENT ON TABLE "WMS_OPL_LIBERACAO_COBERTURA" IS
  'Supervisor autorizou encerrar picking OPL sem cobertura de estoque (trava MVP ignorada).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM "TIPOATIVIDADE"
     WHERE TRIM(COALESCE("DSPROGRAMA", '')) = 'wms-separacao-liberar-cobertura-picking'
       AND COALESCE("TENANT_ID", 'default') = 'default'
  ) THEN
    INSERT INTO "TIPOATIVIDADE" (
      "CDTIPOATIVIDADE",
      "DSTIPOATIVIDADE",
      "DSPROGRAMA",
      "FGACTIVE",
      "FGGRUPO",
      "DHMAINTENANCE",
      "SGUSER",
      "SERVERORIG",
      "TENANT_ID"
    )
    SELECT
      COALESCE(MAX(t."CDTIPOATIVIDADE"), 0) + 1,
      'Lib. picking OPL s/ cobertura',
      'wms-separacao-liberar-cobertura-picking',
      'S',
      'WMS',
      CURRENT_TIMESTAMP,
      'SYSTEM',
      'AppDVcargas',
      'default'
    FROM "TIPOATIVIDADE" t;
  END IF;
END $$;
