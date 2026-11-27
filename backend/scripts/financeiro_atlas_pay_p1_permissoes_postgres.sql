-- =============================================================================
-- Atlas Pay P1 — modelo de permissões financeiras (idempotente)
-- NÃO faz parte do P0.2. NÃO executar junto com o canônico de constraints.
-- NÃO concede permissões a usuários existentes.
-- Coluna de override: EFEITO (C|R). Migração segura EFETO → EFEITO.
-- CHECK de auditoria inclui BOOTSTRAP_ADMIN mesmo se a tabela já existir.
-- Rollback: DROP filhas → pais (FIN_PERM_AUDIT, FIN_USUARIO_*, FIN_PERFIL_*, FIN_PERM_CATALOGO).
-- PostgreSQL 14+.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS "FIN_PERM_CATALOGO" (
  "CODIGO" varchar(64) PRIMARY KEY,
  "GRUPO" varchar(32) NOT NULL,
  "DESCRICAO" varchar(200) NOT NULL,
  "FGACTIVE" char(1) NOT NULL DEFAULT 'S',
  CONSTRAINT "CK_FIN_PERM_CAT_ATIVO" CHECK ("FGACTIVE" IN ('S', 'N'))
);

CREATE TABLE IF NOT EXISTS "FIN_PERFIL" (
  "CODIGO" varchar(64) PRIMARY KEY,
  "NM_PERFIL" varchar(120) NOT NULL,
  "DESCRICAO" varchar(400) NULL,
  "FG_SISTEMA" char(1) NOT NULL DEFAULT 'S',
  "FGACTIVE" char(1) NOT NULL DEFAULT 'S',
  CONSTRAINT "CK_FIN_PERFIL_SIS" CHECK ("FG_SISTEMA" IN ('S', 'N')),
  CONSTRAINT "CK_FIN_PERFIL_ATIVO" CHECK ("FGACTIVE" IN ('S', 'N'))
);

CREATE TABLE IF NOT EXISTS "FIN_PERFIL_PERMISSAO" (
  "CODIGO_PERFIL" varchar(64) NOT NULL REFERENCES "FIN_PERFIL" ("CODIGO") ON DELETE CASCADE,
  "CODIGO_PERM" varchar(64) NOT NULL REFERENCES "FIN_PERM_CATALOGO" ("CODIGO") ON DELETE CASCADE,
  PRIMARY KEY ("CODIGO_PERFIL", "CODIGO_PERM")
);

CREATE TABLE IF NOT EXISTS "FIN_USUARIO_PERFIL" (
  "TENANT_ID" varchar(64) NOT NULL,
  "SGUSUARIO" varchar(50) NOT NULL,
  "CODIGO_PERFIL" varchar(64) NOT NULL REFERENCES "FIN_PERFIL" ("CODIGO") ON DELETE RESTRICT,
  "DH_INCLUSAO" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "SGUSER_INCLUSAO" varchar(50) NULL,
  PRIMARY KEY ("TENANT_ID", "SGUSUARIO", "CODIGO_PERFIL")
);

CREATE INDEX IF NOT EXISTS "IX_FIN_USR_PERFIL_USER"
  ON "FIN_USUARIO_PERFIL" ("SGUSUARIO", "TENANT_ID");

-- Tabela nova já nasce com EFEITO. Versões antigas com EFETO são migradas no bloco abaixo.
CREATE TABLE IF NOT EXISTS "FIN_USUARIO_PERMISSAO" (
  "TENANT_ID" varchar(64) NOT NULL,
  "SGUSUARIO" varchar(50) NOT NULL,
  "CODIGO_PERM" varchar(64) NOT NULL REFERENCES "FIN_PERM_CATALOGO" ("CODIGO") ON DELETE CASCADE,
  "EFEITO" char(1) NOT NULL,
  "DH_INCLUSAO" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "SGUSER_INCLUSAO" varchar(50) NULL,
  PRIMARY KEY ("TENANT_ID", "SGUSUARIO", "CODIGO_PERM"),
  CONSTRAINT "CK_FIN_USR_PERM_EFEITO" CHECK ("EFEITO" IN ('C', 'R'))
);

-- Migração EFETO → EFEITO somente em public."FIN_USUARIO_PERMISSAO"
-- (sem perda silenciosa se as duas colunas coexistirem com valores divergentes)
DO $m$
DECLARE
  v_has_efeto boolean;
  v_has_efeito boolean;
  v_divergentes int;
BEGIN
  SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'FIN_USUARIO_PERMISSAO'
              AND column_name = 'EFETO'
         ),
         EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'FIN_USUARIO_PERMISSAO'
              AND column_name = 'EFEITO'
         )
    INTO v_has_efeto, v_has_efeito;

  IF v_has_efeto AND v_has_efeito THEN
    EXECUTE $q$
      SELECT COUNT(*)::int
        FROM public."FIN_USUARIO_PERMISSAO"
       WHERE "EFETO" IS DISTINCT FROM "EFEITO"
    $q$ INTO v_divergentes;
    IF v_divergentes > 0 THEN
      RAISE EXCEPTION
        'P1: FIN_USUARIO_PERMISSAO possui EFETO e EFEITO com % linha(s) divergente(s); corrija manualmente antes de reexecutar',
        v_divergentes;
    END IF;
    ALTER TABLE public."FIN_USUARIO_PERMISSAO" DROP COLUMN "EFETO";
  ELSIF v_has_efeto AND NOT v_has_efeito THEN
    ALTER TABLE public."FIN_USUARIO_PERMISSAO" RENAME COLUMN "EFETO" TO "EFEITO";
  END IF;

  -- Constraint de EFEITO (renomear legado ou recriar)
  IF EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'FIN_USUARIO_PERMISSAO'
       AND c.conname = 'CK_FIN_USR_PERM_EFETO'
  ) AND NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'FIN_USUARIO_PERMISSAO'
       AND c.conname = 'CK_FIN_USR_PERM_EFEITO'
  ) THEN
    ALTER TABLE public."FIN_USUARIO_PERMISSAO"
      RENAME CONSTRAINT "CK_FIN_USR_PERM_EFETO" TO "CK_FIN_USR_PERM_EFEITO";
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'FIN_USUARIO_PERMISSAO'
       AND c.conname = 'CK_FIN_USR_PERM_EFEITO'
  ) THEN
    ALTER TABLE public."FIN_USUARIO_PERMISSAO"
      ADD CONSTRAINT "CK_FIN_USR_PERM_EFEITO" CHECK ("EFEITO" IN ('C', 'R'));
  END IF;
END
$m$;

CREATE TABLE IF NOT EXISTS "FIN_PERM_AUDIT" (
  "ID" bigserial PRIMARY KEY,
  "TENANT_ID" varchar(64) NOT NULL,
  "SGUSUARIO_ALVO" varchar(50) NULL,
  "SGUSUARIO_ATOR" varchar(50) NOT NULL,
  "OPERACAO" varchar(40) NOT NULL,
  "DETALHE" varchar(500) NULL,
  "CODIGO_PERFIL" varchar(64) NULL,
  "CODIGO_PERM" varchar(64) NULL,
  "IP" varchar(64) NULL,
  "DH_EVENTO" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Garante CK com BOOTSTRAP_ADMIN mesmo se a tabela veio de versão anterior (IF NOT EXISTS não altera CHECK)
ALTER TABLE public."FIN_PERM_AUDIT" DROP CONSTRAINT IF EXISTS "CK_FIN_PERM_AUDIT_OP";
ALTER TABLE public."FIN_PERM_AUDIT"
  ADD CONSTRAINT "CK_FIN_PERM_AUDIT_OP" CHECK (
    "OPERACAO" IN (
      'PERFIL_CONCEDER', 'PERFIL_REVOGAR',
      'PERM_CONCEDER', 'PERM_REVOGAR',
      'PERFIL_ALTERAR',
      'BOOTSTRAP_ADMIN',
      'NEGADO'
    )
  );

CREATE INDEX IF NOT EXISTS "IX_FIN_PERM_AUDIT_TENANT"
  ON "FIN_PERM_AUDIT" ("TENANT_ID", "DH_EVENTO" DESC);

INSERT INTO "FIN_PERM_CATALOGO" ("CODIGO", "GRUPO", "DESCRICAO") VALUES
  ('FIN_CONSULTAR', 'CONSULTA', 'Visualizar contratos, cobranças e eventos'),
  ('FIN_CONSULTAR_RELATORIOS', 'CONSULTA', 'Consultar relatórios financeiros'),
  ('FIN_CONTRATO_CONSULTAR', 'CONTRATO', 'Consultar contratos'),
  ('FIN_CONTRATO_CRIAR', 'CONTRATO', 'Criar contratos'),
  ('FIN_CONTRATO_EDITAR', 'CONTRATO', 'Editar contratos'),
  ('FIN_CONTRATO_CANCELAR', 'CONTRATO', 'Cancelar contratos'),
  ('FIN_CONTRATO_VERSIONAR', 'CONTRATO', 'Versionar / publicar contratos'),
  ('FIN_COBRANCA_CONSULTAR', 'COBRANCA', 'Consultar cobranças'),
  ('FIN_COBRANCA_GERAR', 'COBRANCA', 'Gerar cobranças'),
  ('FIN_COBRANCA_CANCELAR', 'COBRANCA', 'Cancelar cobranças'),
  ('FIN_COBRANCA_BAIXAR', 'COBRANCA', 'Baixa manual de cobranças'),
  ('FIN_CONFIGURAR', 'ADMIN', 'Configurar parâmetros financeiros'),
  ('FIN_GERENCIAR_PERMISSOES', 'ADMIN', 'Administrar permissões financeiras do tenant')
ON CONFLICT ("CODIGO") DO UPDATE
  SET "GRUPO" = EXCLUDED."GRUPO",
      "DESCRICAO" = EXCLUDED."DESCRICAO",
      "FGACTIVE" = 'S';

INSERT INTO "FIN_PERFIL" ("CODIGO", "NM_PERFIL", "DESCRICAO", "FG_SISTEMA") VALUES
  ('FINANCEIRO_CONSULTA', 'Financeiro — Consulta', 'Somente consulta', 'S'),
  ('FINANCEIRO_OPERADOR', 'Financeiro — Operador', 'Consulta, gerar cobrança e baixa', 'S'),
  ('FINANCEIRO_GESTOR', 'Financeiro — Gestor', 'Contratos e cobranças sem gerir permissões', 'S'),
  ('FINANCEIRO_ADMIN', 'Financeiro — Admin', 'Todas as permissões financeiras', 'S')
ON CONFLICT ("CODIGO") DO UPDATE
  SET "NM_PERFIL" = EXCLUDED."NM_PERFIL",
      "DESCRICAO" = EXCLUDED."DESCRICAO",
      "FG_SISTEMA" = 'S',
      "FGACTIVE" = 'S';

DELETE FROM "FIN_PERFIL_PERMISSAO"
 WHERE "CODIGO_PERFIL" IN ('FINANCEIRO_CONSULTA','FINANCEIRO_OPERADOR','FINANCEIRO_GESTOR','FINANCEIRO_ADMIN');

INSERT INTO "FIN_PERFIL_PERMISSAO" ("CODIGO_PERFIL", "CODIGO_PERM")
SELECT 'FINANCEIRO_CONSULTA', u.codigo
  FROM unnest(ARRAY[
    'FIN_CONSULTAR','FIN_CONSULTAR_RELATORIOS','FIN_CONTRATO_CONSULTAR','FIN_COBRANCA_CONSULTAR'
  ]::text[]) AS u(codigo);

INSERT INTO "FIN_PERFIL_PERMISSAO" ("CODIGO_PERFIL", "CODIGO_PERM")
SELECT 'FINANCEIRO_OPERADOR', u.codigo
  FROM unnest(ARRAY[
    'FIN_CONSULTAR','FIN_CONSULTAR_RELATORIOS','FIN_CONTRATO_CONSULTAR','FIN_COBRANCA_CONSULTAR',
    'FIN_COBRANCA_GERAR','FIN_COBRANCA_BAIXAR'
  ]::text[]) AS u(codigo);

INSERT INTO "FIN_PERFIL_PERMISSAO" ("CODIGO_PERFIL", "CODIGO_PERM")
SELECT 'FINANCEIRO_GESTOR', u.codigo
  FROM unnest(ARRAY[
    'FIN_CONSULTAR','FIN_CONSULTAR_RELATORIOS',
    'FIN_CONTRATO_CONSULTAR','FIN_CONTRATO_CRIAR','FIN_CONTRATO_EDITAR','FIN_CONTRATO_CANCELAR','FIN_CONTRATO_VERSIONAR',
    'FIN_COBRANCA_CONSULTAR','FIN_COBRANCA_GERAR','FIN_COBRANCA_CANCELAR','FIN_COBRANCA_BAIXAR',
    'FIN_CONFIGURAR'
  ]::text[]) AS u(codigo);

INSERT INTO "FIN_PERFIL_PERMISSAO" ("CODIGO_PERFIL", "CODIGO_PERM")
SELECT 'FINANCEIRO_ADMIN', c."CODIGO"
  FROM "FIN_PERM_CATALOGO" c
 WHERE c."FGACTIVE" = 'S';

COMMIT;

-- Bootstrap: 1ª atribuição FINANCEIRO_ADMIN via API (transação + advisory lock).
-- Sem INSERT em FIN_USUARIO_* neste script.
