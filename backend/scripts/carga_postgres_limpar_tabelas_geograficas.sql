-- =============================================================================
-- Script PostgreSQL: LIMPAR tabelas geográficas antes de nova carga
-- Execute ESTE script no PostgreSQL ANTES de rodar os INSERTs gerados no SQL Server
-- Ordem: tabelas que referenciam outras primeiro (filhas), depois pais
-- =============================================================================
--
-- *** AVISO IMPORTANTE ***
-- TRUNCATE ... CASCADE também esvazia TODAS as tabelas que referenciam
-- CIDADE, ROTEIRO, etc., por exemplo:
--   ROTEIRO, ROTEIRO_CG, ROTEIROPONTOS, VIAGEMMESTRE, CONVOCACAO,
--   ALERTS, MESSAGES, SOS_ALERTS, VIAGEMMOTORISTA, VIAGEMVEICULO, etc.
-- Use este script apenas em ambiente de desenvolvimento/teste ou em carga inicial.
-- Em produção, se já existirem viagens/roteiros/convocações, NÃO execute este
-- script sem backup; prefira carga incremental (INSERT/UPDATE por chave).
-- =============================================================================

-- Ordem de TRUNCATE: filhas primeiro (quem referencia), depois pais
-- REGIAOCIDADE -> CIDADE
-- CIDADE -> ESTADO, PAIS, MICROREGIAO, MESOREGIAO, REGIAOFISCAL
-- (ROTEIRO, CADASTROGERAL, etc. referenciam CIDADE -> CASCADE os esvazia)
-- MICROREGIAO -> ESTADO (CDUF)
-- MESOREGIAO -> ESTADO (CDUF)
-- ESTADO -> PAIS
-- REGIAOFISCAL (sem FK para as outras)
-- PAIS (raiz)

TRUNCATE TABLE "REGIAOCIDADE" CASCADE;
TRUNCATE TABLE "CIDADE" CASCADE;
TRUNCATE TABLE "MICROREGIAO" CASCADE;
TRUNCATE TABLE "MESOREGIAO" CASCADE;
TRUNCATE TABLE "ESTADO" CASCADE;
TRUNCATE TABLE "REGIAOFISCAL" CASCADE;
TRUNCATE TABLE "PAIS" CASCADE;

-- Reabilitar (se desabilitou acima)
-- SET session_replication_role = DEFAULT;

-- Conferir (opcional)
-- SELECT 'PAIS' AS tabela, COUNT(*) AS total FROM "PAIS"
-- UNION ALL SELECT 'ESTADO', COUNT(*) FROM "ESTADO"
-- UNION ALL SELECT 'MESOREGIAO', COUNT(*) FROM "MESOREGIAO"
-- UNION ALL SELECT 'MICROREGIAO', COUNT(*) FROM "MICROREGIAO"
-- UNION ALL SELECT 'CIDADE', COUNT(*) FROM "CIDADE"
-- UNION ALL SELECT 'REGIAOCIDADE', COUNT(*) FROM "REGIAOCIDADE"
-- UNION ALL SELECT 'REGIAOFISCAL', COUNT(*) FROM "REGIAOFISCAL";
