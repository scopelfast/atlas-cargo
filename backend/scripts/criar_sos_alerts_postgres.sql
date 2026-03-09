-- Tabela SOS_ALERTS para PostgreSQL (Atlas Cargo)
-- Equivalente à estrutura do SQL Server usada pelo controller de SOS.
-- Executar no banco atlas_cargo_prd (ou o que estiver em DB_DATABASE).
-- Requer: CREATE EXTENSION IF NOT EXISTS postgis;

CREATE EXTENSION IF NOT EXISTS postgis;

-- Nome em minúsculas para PostgreSQL; controller usa SOS_ALERTS que vira sos_alerts (unquoted).
CREATE TABLE IF NOT EXISTS sos_alerts (
  "ID" SERIAL PRIMARY KEY,
  cdmotorista DECIMAL(15,0) NOT NULL,
  cdviagem DECIMAL(15,0) NULL,
  location geography(Point, 4326) NULL,
  latitude FLOAT NULL,
  longitude FLOAT NULL,
  status VARCHAR(20) DEFAULT 'active' NOT NULL,
  priority VARCHAR(10) DEFAULT 'high' NOT NULL,
  message VARCHAR(500) NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
  resolved_at TIMESTAMP WITH TIME ZONE NULL,
  resolved_by DECIMAL(15,0) NULL,
  resolution_notes VARCHAR(500) NULL,
  synced SMALLINT DEFAULT 1 NOT NULL
);

-- Garantir que RETURNING "ID" do controller funcione
-- (coluna "ID" já criada acima)

CREATE INDEX IF NOT EXISTS ix_sos_alerts_status ON sos_alerts(status);
CREATE INDEX IF NOT EXISTS ix_sos_alerts_motorista ON sos_alerts(cdmotorista);
CREATE INDEX IF NOT EXISTS ix_sos_alerts_viagem ON sos_alerts(cdviagem);
CREATE INDEX IF NOT EXISTS ix_sos_alerts_created_at ON sos_alerts(created_at DESC);

COMMENT ON TABLE sos_alerts IS 'Alertas SOS (emergência) do app motorista';
