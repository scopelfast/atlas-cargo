-- Atlas Pay — limpa dados operacionais (HML / reset de processo).
-- Idempotente. NÃO apaga catálogo/perfis FIN_PERM_* (acesso ao módulo permanece).
-- Ordem respeita FKs (fechamento → cobrança → contrato).
-- Eventos de cobrança são append-only (P0): SET LOCAL atlas.fin_evt_manutencao
-- (login postgres já é MEMBER de atlas_fin_manutencao no ambiente local).
--
-- Uso:
--   psql -h localhost -U postgres -d atlas_cargo_prd -f backend/scripts/financeiro_atlas_pay_limpar_operacional_postgres.sql

BEGIN;

SET LOCAL atlas.fin_evt_manutencao = '1';

-- 1) Eventos e fechamentos de uso
DELETE FROM "FIN_FECHAMENTO_USO_EVENTO";
UPDATE "FIN_FECHAMENTO_USO" SET "ID_COBRANCA" = NULL WHERE "ID_COBRANCA" IS NOT NULL;
DELETE FROM "FIN_FECHAMENTO_USO";

-- 2) Cobranças e eventos
DELETE FROM "FIN_COBRANCA_EVENTO";
DELETE FROM "FIN_COBRANCA";

-- 3) Contratos e componentes
DELETE FROM "FIN_CONTRATO_COMPONENTE";
DELETE FROM "FIN_CONTRATO";

COMMIT;

SELECT 'FIN_CONTRATO' AS tabela, COUNT(*)::int AS qtd FROM "FIN_CONTRATO"
UNION ALL
SELECT 'FIN_CONTRATO_COMPONENTE', COUNT(*)::int FROM "FIN_CONTRATO_COMPONENTE"
UNION ALL
SELECT 'FIN_COBRANCA', COUNT(*)::int FROM "FIN_COBRANCA"
UNION ALL
SELECT 'FIN_COBRANCA_EVENTO', COUNT(*)::int FROM "FIN_COBRANCA_EVENTO"
UNION ALL
SELECT 'FIN_FECHAMENTO_USO', COUNT(*)::int FROM "FIN_FECHAMENTO_USO"
UNION ALL
SELECT 'FIN_FECHAMENTO_USO_EVENTO', COUNT(*)::int FROM "FIN_FECHAMENTO_USO_EVENTO";
