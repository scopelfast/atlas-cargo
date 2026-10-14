-- Corrige TENANT_ID em logs gravados antes de passar a persistir o tenant no login/ações.
-- "USUARIO" tem um único TENANT_ID por SGUSUARIO; alinha linhas ainda com default legado.
-- Idempotente para linhas já corretas (UPDATE só onde difere).

UPDATE "USUARIOLOGACESSO" l
SET "TENANT_ID" = COALESCE(NULLIF(TRIM(u."TENANT_ID"), ''), 'default')
FROM "USUARIO" u
WHERE l."SGUSUARIO" = u."SGUSUARIO"
  AND l."TENANT_ID" IS DISTINCT FROM COALESCE(NULLIF(TRIM(u."TENANT_ID"), ''), 'default');

UPDATE "USUARIOLOGACAO" a
SET "TENANT_ID" = COALESCE(NULLIF(TRIM(u."TENANT_ID"), ''), 'default')
FROM "USUARIO" u
WHERE a."SGUSUARIO" = u."SGUSUARIO"
  AND a."TENANT_ID" IS DISTINCT FROM COALESCE(NULLIF(TRIM(u."TENANT_ID"), ''), 'default');
