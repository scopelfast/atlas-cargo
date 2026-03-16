-- =============================================================================
-- Carga de dados: MOTIVOREABERTURA e MOTIVORECUSA (PostgreSQL)
-- Execute no banco atlas_cargo_prd: psql -U postgres -d atlas_cargo_prd -f carga_motivoreabertura_motivorecusa_postgres.sql
-- Ou rode o conteúdo no DBeaver/pgAdmin.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- MOTIVOREABERTURA
-- -----------------------------------------------------------------------------
INSERT INTO "MOTIVOREABERTURA" (
  "CDMOTIVO", "DSMOTIVO", "FGACTIVE", "DHINCLUSAO", "SGUSERINCLUSAO", "DHMAINTENANCE", "SGUSER", "SERVERORIG"
)
VALUES
  (1, 'Motorista Desistiu da Carga', 'A', '2025-11-28 12:23:55.567', 'SYSTEM', NULL, NULL, 'AppDVcargas'),
  (2, 'Necessidade de Mais Convocações', 'A', '2025-11-28 12:23:55.723', 'SYSTEM', NULL, NULL, 'AppDVcargas')
ON CONFLICT ("CDMOTIVO") DO UPDATE SET
  "DSMOTIVO" = EXCLUDED."DSMOTIVO",
  "FGACTIVE" = EXCLUDED."FGACTIVE",
  "DHINCLUSAO" = EXCLUDED."DHINCLUSAO",
  "SGUSERINCLUSAO" = EXCLUDED."SGUSERINCLUSAO",
  "SERVERORIG" = EXCLUDED."SERVERORIG";

-- Ajustar sequence para permitir próximos inserts automáticos
SELECT setval(pg_get_serial_sequence('"MOTIVOREABERTURA"', 'CDMOTIVO'), COALESCE((SELECT MAX("CDMOTIVO") FROM "MOTIVOREABERTURA"), 1));

-- -----------------------------------------------------------------------------
-- MOTIVORECUSA
-- -----------------------------------------------------------------------------
INSERT INTO "MOTIVORECUSA" (
  "CDMOTIVO", "DSMOTIVO", "FGACTIVE", "DHINCLUSAO", "SGUSERINCLUSAO", "DHMAINTENANCE", "SGUSER", "SERVERORIG"
)
VALUES
  (1, 'Destino', 'A', '2025-11-28 10:32:38.150', 'SYSTEM', NULL, NULL, 'AppDVcargas'),
  (2, 'Prazo de Pagamento', 'A', '2025-11-28 10:32:38.150', 'SYSTEM', NULL, NULL, 'AppDVcargas'),
  (3, 'Valor do Frete', 'A', '2025-11-28 10:32:38.150', 'SYSTEM', NULL, NULL, 'AppDVcargas'),
  (4, 'Peso da Carga', 'A', '2025-11-28 10:32:38.150', 'SYSTEM', NULL, NULL, 'AppDVcargas'),
  (5, 'Disponibilidade', 'A', '2025-11-28 10:32:38.160', 'SYSTEM', NULL, NULL, 'AppDVcargas')
ON CONFLICT ("CDMOTIVO") DO UPDATE SET
  "DSMOTIVO" = EXCLUDED."DSMOTIVO",
  "FGACTIVE" = EXCLUDED."FGACTIVE",
  "DHINCLUSAO" = EXCLUDED."DHINCLUSAO",
  "SGUSERINCLUSAO" = EXCLUDED."SGUSERINCLUSAO",
  "SERVERORIG" = EXCLUDED."SERVERORIG";

-- Ajustar sequence para permitir próximos inserts automáticos
SELECT setval(pg_get_serial_sequence('"MOTIVORECUSA"', 'CDMOTIVO'), COALESCE((SELECT MAX("CDMOTIVO") FROM "MOTIVORECUSA"), 1));

-- Conferência (opcional)
-- SELECT * FROM "MOTIVOREABERTURA" ORDER BY "CDMOTIVO";
-- SELECT * FROM "MOTIVORECUSA" ORDER BY "CDMOTIVO";
