-- adicionar_permissao_liberar_cobertura_separacao_postgres.sql
-- Cadastra tipo de atividade (alias do script de tabela; pode rodar isolado).

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
