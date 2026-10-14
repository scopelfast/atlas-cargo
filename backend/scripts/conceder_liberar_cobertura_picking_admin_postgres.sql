-- conceder_liberar_cobertura_picking_admin_postgres.sql
-- Liberação supervisor no picking OPL (estoque-separacao).
-- Rode no pgAdmin com Auto-commit ON (ou um bloco por vez).
-- Se aparecer 25P02: Query Tool → ROLLBACK; ou feche a aba e abra de novo.

-- 1) Tipo de atividade (programa)
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
FROM "TIPOATIVIDADE" t
WHERE NOT EXISTS (
  SELECT 1
    FROM "TIPOATIVIDADE" x
   WHERE TRIM(COALESCE(x."DSPROGRAMA", '')) = 'wms-separacao-liberar-cobertura-picking'
     AND COALESCE(x."TENANT_ID", 'default') = 'default'
);

-- 2) Vincular ao login admin (autorizador na tela de separação)
INSERT INTO "USUARIOATIVIDADE" ("SGUSUARIO", "CDTIPOATIVIDADE", "DHMAINTENANCE", "SGUSER", "SERVERORIG")
SELECT
  u."SGUSUARIO",
  t."CDTIPOATIVIDADE",
  CURRENT_TIMESTAMP,
  'SYSTEM',
  'AppDVcargas'
FROM "USUARIO" u
CROSS JOIN "TIPOATIVIDADE" t
WHERE lower(trim(u."SGUSUARIO")) = 'admin'
  AND u."FGACTIVE" = 'S'
  AND TRIM(COALESCE(t."DSPROGRAMA", '')) = 'wms-separacao-liberar-cobertura-picking'
  AND COALESCE(t."TENANT_ID", 'default') = 'default'
  AND t."FGACTIVE" = 'S'
  AND NOT EXISTS (
    SELECT 1
      FROM "USUARIOATIVIDADE" ua
     WHERE ua."SGUSUARIO" = u."SGUSUARIO"
       AND ua."CDTIPOATIVIDADE" = t."CDTIPOATIVIDADE"
  );

-- 3) Conferência
SELECT u."SGUSUARIO",
       t."CDTIPOATIVIDADE",
       t."DSTIPOATIVIDADE",
       t."DSPROGRAMA"
  FROM "USUARIOATIVIDADE" ua
  JOIN "USUARIO" u ON u."SGUSUARIO" = ua."SGUSUARIO"
  JOIN "TIPOATIVIDADE" t ON t."CDTIPOATIVIDADE" = ua."CDTIPOATIVIDADE"
 WHERE lower(trim(u."SGUSUARIO")) = 'admin'
   AND TRIM(COALESCE(t."DSPROGRAMA", '')) = 'wms-separacao-liberar-cobertura-picking';
