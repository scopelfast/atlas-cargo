-- adicionar_permissao_liberar_divergencia_expedicao_postgres.sql
-- Objetivo: cadastrar tipo de atividade para liberar expedição com divergência.
-- Executar no pgAdmin, banco atlas_cargo_prd (PostgreSQL).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM "TIPOATIVIDADE"
     WHERE TRIM(COALESCE("DSPROGRAMA", '')) = 'wms-expedicao-liberar-divergencia'
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
      'Liberar expedição com divergência',
      'wms-expedicao-liberar-divergencia',
      'S',
      'WMS',
      CURRENT_TIMESTAMP,
      'SYSTEM',
      'AppDVcargas',
      'default'
    FROM "TIPOATIVIDADE" t;
  END IF;
END $$;
