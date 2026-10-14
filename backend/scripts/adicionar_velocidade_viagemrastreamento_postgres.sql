-- Coluna VELOCIDADE (km/h) em VIAGEMRASTREAMENTO — PostgreSQL
-- Necessária para INSERT do app motorista e para alert-service (excesso de velocidade, parada por vel., ETA).
-- Idempotente: ignora se a coluna já existir.

DO $$
DECLARE
  qn text;
BEGIN
  SELECT format('%I.%I', schemaname::name, tablename::name)
  INTO qn
  FROM pg_tables
  WHERE schemaname IN ('public', 'dbo')
    AND lower(tablename) = 'viagemrastreamento'
  ORDER BY CASE WHEN schemaname = 'public' THEN 0 ELSE 1 END
  LIMIT 1;

  IF qn IS NULL THEN
    RAISE NOTICE 'Tabela VIAGEMRASTREAMENTO não encontrada em public/dbo — nada a fazer.';
    RETURN;
  END IF;

  EXECUTE format(
    'ALTER TABLE %s ADD COLUMN IF NOT EXISTS "VELOCIDADE" NUMERIC(5,2) NULL',
    qn
  );

  EXECUTE format(
    'COMMENT ON COLUMN %s."VELOCIDADE" IS %L',
    qn,
    'Velocidade instantânea em km/h (telemetria GPS)'
  );
END $$;
