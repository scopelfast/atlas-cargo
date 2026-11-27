-- Inventário pré-apply P0 Atlas Pay — SOMENTE no banco de HOMOLOGAÇÃO isolado.
-- NÃO executar contra atlas_cargo_prd / produção.
-- Somente SELECT; sem DDL/DML.

SELECT current_database() AS db, version() AS pg_version, now() AS ts;

SELECT rolname, rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
       rolreplication, rolbypassrls
  FROM pg_roles
 WHERE rolname = 'atlas_fin_manutencao';

SELECT conname, contype, conrelid::regclass AS table_name, convalidated
  FROM pg_constraint
 WHERE conname LIKE 'CK_FIN_%' OR conname LIKE 'FK_FIN_%'
 ORDER BY 1;

SELECT indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND (indexname LIKE 'UK_FIN_%' OR indexname LIKE 'IX_FIN_%')
 ORDER BY 1;

SELECT p.proname, pg_get_userbyid(p.proowner) AS owner, p.prosecdef
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.proname LIKE 'fn_fin_%'
 ORDER BY 1;

SELECT tgname, tgrelid::regclass AS table_name, tgenabled
  FROM pg_trigger
 WHERE NOT tgisinternal AND tgname LIKE 'trg_fin_%'
 ORDER BY 1;

-- D13 sample (leitura): membership app_user → manutenção
SELECT
  EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') AS app_user_exists,
  CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user')
       THEN pg_has_role('app_user', 'atlas_fin_manutencao', 'MEMBER')
       ELSE NULL END AS app_user_member_manut;
