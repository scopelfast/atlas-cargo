-- adicionar_permissao_liberar_validade_min_recebimento_postgres.sql
-- Cadastra tipo de atividade (DSPROGRAMA) para o supervisor liberar recebimento com validade abaixo do mínimo do dono.
-- PostgreSQL, idempotente. Não depende de WMS_RECEBIMENTO_LIBERACAO_VALIDADE; ordem de execução em relação a esse script é livre.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM "TIPOATIVIDADE"
     WHERE TRIM(COALESCE("DSPROGRAMA", '')) = 'wms-recebimento-liberar-validade-min'
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
      'Liberar validade mínima no recebimento',
      'wms-recebimento-liberar-validade-min',
      'S',
      'WMS',
      CURRENT_TIMESTAMP,
      'SYSTEM',
      'AppDVcargas',
      'default'
    FROM "TIPOATIVIDADE" t;
  END IF;
END $$;
