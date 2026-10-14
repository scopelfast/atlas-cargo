-- Alinha WMS_CARGA_PROGRAMADA.ST_CARGA (e motorista/placa) com WMS_EXPEDICAO_CARGA
-- para cargas já expedidas antes da sincronização automática no controller.
-- Idempotente; executar uma vez por ambiente se necessário.

UPDATE "WMS_CARGA_PROGRAMADA" c
   SET "ST_CARGA" = e."ST_EXPEDICAO",
       "NM_MOTORISTA" = COALESCE(NULLIF(TRIM(e."NM_MOTORISTA"), ''), c."NM_MOTORISTA"),
       "PLACA" = COALESCE(NULLIF(TRIM(e."PLACA"), ''), c."PLACA")
  FROM "WMS_EXPEDICAO_CARGA" e
 WHERE e."CD_CARGA" = c."CD_CARGA"
   AND e."TENANT_ID" = c."TENANT_ID"
   AND UPPER(TRIM(COALESCE(e."ST_EXPEDICAO", ''))) IN ('EM_EXPEDICAO', 'EXPEDIDA')
   AND UPPER(TRIM(COALESCE(c."ST_CARGA", ''))) = 'RASCUNHO';
