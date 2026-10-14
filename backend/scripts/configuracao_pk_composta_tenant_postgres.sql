-- Script: configuracao_pk_composta_tenant_postgres.sql
-- Fase 6 multi-tenant: CONFIGURACAO passa a ter chave primária ("TENANT_ID", "CHAVE").
--
-- Ordem recomendada em banco já existente:
--   1) backend/scripts/adicionar_tenant_id_fase2_postgres.sql (garante coluna TENANT_ID + default 'default')
--   2) Este script
--
-- Em banco novo criado só com script_db_postgres.sql atualizado, a tabela já nasce com PK composta — não rode este script.
--
-- Por que: com PK só em CHAVE não é possível uma linha por tenant para a mesma chave lógica.

-- Nome típico da PK em PostgreSQL para tabela "CONFIGURACAO"
ALTER TABLE "CONFIGURACAO" DROP CONSTRAINT IF EXISTS "CONFIGURACAO_pkey";

-- Garantir NOT NULL (fase2 já define default 'default')
UPDATE "CONFIGURACAO" SET "TENANT_ID" = 'default' WHERE "TENANT_ID" IS NULL OR TRIM("TENANT_ID"::text) = '';

ALTER TABLE "CONFIGURACAO" ADD PRIMARY KEY ("TENANT_ID", "CHAVE");
