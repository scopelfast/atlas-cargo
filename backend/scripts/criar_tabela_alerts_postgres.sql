-- Tabela ALERTS para PostgreSQL (Alertas do Sistema - módulo operação)
-- Equivalente a criar_tabela_alerts.sql + ajustar_tabela_alerts_para_modulo.sql
-- Execute uma vez no banco Atlas Cargo (PostgreSQL).

CREATE TABLE IF NOT EXISTS "ALERTS" (
  "ID"                SERIAL PRIMARY KEY,
  "IDVIAGEM"          DECIMAL(15,0) NOT NULL,
  "CDMOTORISTA"       DECIMAL(15,0) NULL,
  "TYPE"              VARCHAR(20) NOT NULL,
  "MESSAGE"           VARCHAR(255) NOT NULL,
  "SEVERITY"          VARCHAR(10) NOT NULL DEFAULT 'medium',
  "PRIORIDADE"        VARCHAR(20) NULL DEFAULT 'Normal',
  "STATUS"            VARCHAR(50) NOT NULL DEFAULT 'Pendente',
  "DETAILS"           TEXT NULL,
  "CREATED_AT"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "RESOLVED"          BOOLEAN NOT NULL DEFAULT false,
  "RESOLVED_AT"       TIMESTAMPTZ NULL,
  "RESOLVED_BY"       INT NULL,
  "ID_USUARIO_LEU"    INT NULL,
  "DH_LEITURA"        TIMESTAMPTZ NULL,
  "ID_USUARIO_TRATOU" INT NULL,
  "DH_TRATAMENTO"     TIMESTAMPTZ NULL,
  "OBSERVACOES"       TEXT NULL
);

CREATE INDEX IF NOT EXISTS ix_alerts_viagem ON "ALERTS" ("IDVIAGEM");
CREATE INDEX IF NOT EXISTS ix_alerts_status ON "ALERTS" ("STATUS", "CREATED_AT" DESC);
CREATE INDEX IF NOT EXISTS ix_alerts_type ON "ALERTS" ("TYPE", "SEVERITY");
CREATE INDEX IF NOT EXISTS ix_alerts_created_at ON "ALERTS" ("CREATED_AT" DESC);

COMMENT ON TABLE "ALERTS" IS 'Alertas automáticos do sistema (parada, atraso, offline, desvio)';
