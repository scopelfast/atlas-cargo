-- ============================================================================
-- AJUSTES POSTGRES (estrutura + dados) – desde ~mar/2026
-- Banco alvo : atlas_cargo_prd (PostgreSQL)
-- Uso        : pgAdmin (Query Tool) ou psql -d atlas_cargo_prd -f ajustes_postgres_20260301_a_hoje.sql
-- Observação : Scripts são idempotentes sempre que possível (IF NOT EXISTS / ON CONFLICT).
--              Pode executar mais de uma vez sem quebrar.
--              NOTICEs de "already exists" são suprimidos (client_min_messages = WARNING).
-- ============================================================================

SET client_min_messages = WARNING;

-- ---------------------------------------------------------------------------
-- 1) CADASTROGERAL – coluna PAIS (evita 500 em listar) e flags "Aplicável para"
-- ---------------------------------------------------------------------------

-- Coluna PAIS (obrigatória para o listar do Cadastro Geral)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CADASTROGERAL' AND column_name = 'PAIS'
  ) THEN
    ALTER TABLE "CADASTROGERAL" ADD COLUMN "PAIS" VARCHAR(2) NULL;
    COMMENT ON COLUMN "CADASTROGERAL"."PAIS" IS 'País do cadastro (BR, PY, AR, UY). NULL = usar padrão das Configurações.';
  END IF;
END $$;

-- Flags "Aplicável para" (Operador, Motorista, etc.)

-- Script: Aplicável para (múltiplos papéis) no Cadastro Geral
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CADASTROGERAL' AND column_name = 'FGOPERADOR') THEN
    ALTER TABLE "CADASTROGERAL" ADD COLUMN "FGOPERADOR" CHAR(1) DEFAULT 'N';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CADASTROGERAL' AND column_name = 'FGPROGRAMADOR') THEN
    ALTER TABLE "CADASTROGERAL" ADD COLUMN "FGPROGRAMADOR" CHAR(1) DEFAULT 'N';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CADASTROGERAL' AND column_name = 'FGMOTORISTA') THEN
    ALTER TABLE "CADASTROGERAL" ADD COLUMN "FGMOTORISTA" CHAR(1) DEFAULT 'N';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CADASTROGERAL' AND column_name = 'FGTRANSPORTADOR') THEN
    ALTER TABLE "CADASTROGERAL" ADD COLUMN "FGTRANSPORTADOR" CHAR(1) DEFAULT 'N';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CADASTROGERAL' AND column_name = 'FGAGENTE') THEN
    ALTER TABLE "CADASTROGERAL" ADD COLUMN "FGAGENTE" CHAR(1) DEFAULT 'N';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CADASTROGERAL' AND column_name = 'FGGRUPO') THEN
    ALTER TABLE "CADASTROGERAL" ADD COLUMN "FGGRUPO" CHAR(1) DEFAULT 'N';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CADASTROGERAL' AND column_name = 'FGCERTIFICADORA') THEN
    ALTER TABLE "CADASTROGERAL" ADD COLUMN "FGCERTIFICADORA" CHAR(1) DEFAULT 'N';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'CADASTROGERAL' AND column_name = 'FGUNIDADENEGOCIO') THEN
    ALTER TABLE "CADASTROGERAL" ADD COLUMN "FGUNIDADENEGOCIO" CHAR(1) DEFAULT 'N';
  END IF;
END $$;

-- Migrar dados legados de FGTIPOCADASTRO para as novas flags
UPDATE "CADASTROGERAL" SET "FGOPERADOR" = 'S', "FGPROGRAMADOR" = 'S' WHERE "FGTIPOCADASTRO" = 'O';
UPDATE "CADASTROGERAL" SET "FGMOTORISTA" = 'S' WHERE "FGTIPOCADASTRO" = 'M';
UPDATE "CADASTROGERAL" SET "FGTRANSPORTADOR" = 'S' WHERE "FGTIPOCADASTRO" = 'T';
UPDATE "CADASTROGERAL" SET "FGAGENTE" = 'S' WHERE "FGTIPOCADASTRO" = 'A';
UPDATE "CADASTROGERAL" SET "FGGRUPO" = 'S' WHERE "FGTIPOCADASTRO" = 'G';
UPDATE "CADASTROGERAL" SET "FGCERTIFICADORA" = 'S' WHERE "FGTIPOCADASTRO" = 'C';
UPDATE "CADASTROGERAL" SET "FGUNIDADENEGOCIO" = 'S' WHERE "FGTIPOCADASTRO" = 'U';

-- Garantir que nenhuma fique NULL
UPDATE "CADASTROGERAL" SET
  "FGOPERADOR"       = COALESCE("FGOPERADOR", 'N'),
  "FGPROGRAMADOR"    = COALESCE("FGPROGRAMADOR", 'N'),
  "FGMOTORISTA"      = COALESCE("FGMOTORISTA", 'N'),
  "FGTRANSPORTADOR"  = COALESCE("FGTRANSPORTADOR", 'N'),
  "FGAGENTE"         = COALESCE("FGAGENTE", 'N'),
  "FGGRUPO"          = COALESCE("FGGRUPO", 'N'),
  "FGCERTIFICADORA"  = COALESCE("FGCERTIFICADORA", 'N'),
  "FGUNIDADENEGOCIO" = COALESCE("FGUNIDADENEGOCIO", 'N')
WHERE "FGOPERADOR" IS NULL OR "FGPROGRAMADOR" IS NULL OR "FGMOTORISTA" IS NULL
   OR "FGTRANSPORTADOR" IS NULL OR "FGAGENTE" IS NULL OR "FGGRUPO" IS NULL
   OR "FGCERTIFICADORA" IS NULL OR "FGUNIDADENEGOCIO" IS NULL;

-- Endereço opcional (PostgreSQL: DROP NOT NULL em coluna já nullable não gera erro)
ALTER TABLE "CADASTROGERAL" ALTER COLUMN "ENDERECO"   DROP NOT NULL;
ALTER TABLE "CADASTROGERAL" ALTER COLUMN "NRENDERECO" DROP NOT NULL;
ALTER TABLE "CADASTROGERAL" ALTER COLUMN "BAIRRO"     DROP NOT NULL;

COMMENT ON COLUMN "CADASTROGERAL"."ENDERECO"   IS 'Endereço (logradouro). Opcional.';
COMMENT ON COLUMN "CADASTROGERAL"."NRENDERECO" IS 'Número do endereço. Opcional.';
COMMENT ON COLUMN "CADASTROGERAL"."BAIRRO"     IS 'Bairro. Opcional.';

-- Garantir NRCELULAR como VARCHAR(20) (quando ainda numérico)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'CADASTROGERAL' AND column_name = 'NRCELULAR'
          AND data_type = 'numeric'
  ) THEN
    ALTER TABLE "CADASTROGERAL" ALTER COLUMN "NRCELULAR" TYPE VARCHAR(20);
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2) MOTORISTA_COMPLEMENTO – destino e origem preferidos
-- ---------------------------------------------------------------------------

-- Destino preferido
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_COMPLEMENTO' AND column_name = 'PAIS_DESTINO_PREF'
  ) THEN
    ALTER TABLE "MOTORISTA_COMPLEMENTO" ADD COLUMN "PAIS_DESTINO_PREF" VARCHAR(2) NULL;
    COMMENT ON COLUMN "MOTORISTA_COMPLEMENTO"."PAIS_DESTINO_PREF" IS 'País de destino preferido (BR, PY, AR, etc.).';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_COMPLEMENTO' AND column_name = 'SIGLA_ESTADO_DESTINO_PREF'
  ) THEN
    ALTER TABLE "MOTORISTA_COMPLEMENTO" ADD COLUMN "SIGLA_ESTADO_DESTINO_PREF" VARCHAR(10) NULL;
    COMMENT ON COLUMN "MOTORISTA_COMPLEMENTO"."SIGLA_ESTADO_DESTINO_PREF" IS 'Sigla do estado/UF de destino preferido.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_COMPLEMENTO' AND column_name = 'CIDADE_DESTINO_PREF'
  ) THEN
    ALTER TABLE "MOTORISTA_COMPLEMENTO" ADD COLUMN "CIDADE_DESTINO_PREF" VARCHAR(100) NULL;
    COMMENT ON COLUMN "MOTORISTA_COMPLEMENTO"."CIDADE_DESTINO_PREF" IS 'Nome da cidade de destino preferido (opcional).';
  END IF;
END $$;

-- Origem (embarque) preferida
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_COMPLEMENTO' AND column_name = 'PAIS_EMBARQUE_PREF'
  ) THEN
    ALTER TABLE "MOTORISTA_COMPLEMENTO" ADD COLUMN "PAIS_EMBARQUE_PREF" VARCHAR(2) NULL;
    COMMENT ON COLUMN "MOTORISTA_COMPLEMENTO"."PAIS_EMBARQUE_PREF" IS 'País de origem preferida/embarque (BR, PY, AR, etc.).';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_COMPLEMENTO' AND column_name = 'SIGLA_ESTADO_EMBARQUE_PREF'
  ) THEN
    ALTER TABLE "MOTORISTA_COMPLEMENTO" ADD COLUMN "SIGLA_ESTADO_EMBARQUE_PREF" VARCHAR(10) NULL;
    COMMENT ON COLUMN "MOTORISTA_COMPLEMENTO"."SIGLA_ESTADO_EMBARQUE_PREF" IS 'Sigla do estado/UF de origem preferida (embarque).';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_COMPLEMENTO' AND column_name = 'REGIAO_EMBARQUE_PREF'
  ) THEN
    ALTER TABLE "MOTORISTA_COMPLEMENTO" ADD COLUMN "REGIAO_EMBARQUE_PREF" VARCHAR(60) NULL;
    COMMENT ON COLUMN "MOTORISTA_COMPLEMENTO"."REGIAO_EMBARQUE_PREF" IS 'Região de origem preferida (embarque), opcional.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_COMPLEMENTO' AND column_name = 'CIDADE_EMBARQUE_PREF'
  ) THEN
    ALTER TABLE "MOTORISTA_COMPLEMENTO" ADD COLUMN "CIDADE_EMBARQUE_PREF" VARCHAR(100) NULL;
    COMMENT ON COLUMN "MOTORISTA_COMPLEMENTO"."CIDADE_EMBARQUE_PREF" IS 'Nome da cidade de origem preferida (embarque).';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3) CADASTRO_LOCAL_PREFERIDO – nova tabela de locais preferidos
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "CADASTRO_LOCAL_PREFERIDO" (
  "CDCADASTRO"     INT          NOT NULL,
  "SEQUENCIA"      INT          NOT NULL,
  "TIPO"           CHAR(1)      NOT NULL,
  "PAIS"           VARCHAR(2)   NOT NULL,
  "CDUF"           SMALLINT     NULL,
  "CDMESOREGIAO"   SMALLINT     NULL,
  "DHMAINTENANCE"  TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  "SGUSER"         VARCHAR(50)  NULL,
  CONSTRAINT "PK_CADASTRO_LOCAL_PREFERIDO" PRIMARY KEY ("CDCADASTRO", "SEQUENCIA"),
  CONSTRAINT "FK_CADASTRO_LOCAL_PREF_CADASTRO" FOREIGN KEY ("CDCADASTRO") REFERENCES "CADASTROGERAL" ("CDCADASTRO") ON DELETE CASCADE,
  CONSTRAINT "CHK_TIPO_LOCAL_PREF" CHECK ("TIPO" IN ('E', 'D'))
);

COMMENT ON TABLE "CADASTRO_LOCAL_PREFERIDO" IS 'Locais preferidos (E=origem/embarque, D=destino/desembarque) por cadastro. Um registro por linha; país obrigatório; CDUF/CDMESOREGIAO NULL = Todos.';
COMMENT ON COLUMN "CADASTRO_LOCAL_PREFERIDO"."TIPO" IS 'E = Origem (embarque), D = Destino (desembarque)';
COMMENT ON COLUMN "CADASTRO_LOCAL_PREFERIDO"."PAIS" IS 'Sigla do país (BR, PY, AR, UY). Obrigatório.';
COMMENT ON COLUMN "CADASTRO_LOCAL_PREFERIDO"."CDUF" IS 'Código UF (ESTADO). NULL = Todos os estados do país.';
COMMENT ON COLUMN "CADASTRO_LOCAL_PREFERIDO"."CDMESOREGIAO" IS 'Código mesorregião (MESOREGIAO). NULL = Todas as mesorregiões do estado.';

CREATE INDEX IF NOT EXISTS "IX_CADASTRO_LOCAL_PREF_CDCADASTRO" ON "CADASTRO_LOCAL_PREFERIDO" ("CDCADASTRO");

-- ---------------------------------------------------------------------------
-- 4) PAIS – países básicos, SGPAIS e DDI
-- ---------------------------------------------------------------------------

-- Países base
INSERT INTO "PAIS" (
  "CDPAIS", "DSPAIS", "SGPAIS", "CDBACEN", "FGACTIVE",
  "DHMAINTENANCE", "SGUSER", "OBJECTVERSION", "SERVERORIG", "DHCTRLREPLIC"
)
SELECT 1, 'Brasil', 'BR', 1058, 'A', '2012-02-11 11:58:40.240', 'carga', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM "PAIS" WHERE "CDPAIS" = 1);

INSERT INTO "PAIS" (
  "CDPAIS", "DSPAIS", "SGPAIS", "CDBACEN", "FGACTIVE",
  "DHMAINTENANCE", "SGUSER", "OBJECTVERSION", "SERVERORIG", "DHCTRLREPLIC"
)
SELECT 639, 'Argentina', 'AR', 639, 'A', '2012-02-11 11:58:40.263', 'carga', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM "PAIS" WHERE "CDPAIS" = 639);

INSERT INTO "PAIS" (
  "CDPAIS", "DSPAIS", "SGPAIS", "CDBACEN", "FGACTIVE",
  "DHMAINTENANCE", "SGUSER", "OBJECTVERSION", "SERVERORIG", "DHCTRLREPLIC"
)
SELECT 5860, 'Paraguai', 'PY', 5860, 'A', '2012-02-11 11:58:40.263', 'carga', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM "PAIS" WHERE "CDPAIS" = 5860);

INSERT INTO "PAIS" (
  "CDPAIS", "DSPAIS", "SGPAIS", "CDBACEN", "FGACTIVE",
  "DHMAINTENANCE", "SGUSER", "OBJECTVERSION", "SERVERORIG", "DHCTRLREPLIC"
)
SELECT 8451, 'Uruguai', 'UY', 8451, 'A', '2012-02-11 11:58:40.263', 'carga', NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM "PAIS" WHERE "CDPAIS" = 8451);

-- SGPAIS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'PAIS' AND column_name = 'SGPAIS'
  ) THEN
    ALTER TABLE "PAIS" ADD COLUMN "SGPAIS" VARCHAR(3) NULL;
    COMMENT ON COLUMN "PAIS"."SGPAIS" IS 'Sigla do país (BR, PY, AR, UY) para uso em combos e colunas VARCHAR(2).';
  END IF;
END $$;

UPDATE "PAIS" SET "SGPAIS" = 'BR' WHERE UPPER(TRIM("DSPAIS")) LIKE '%RASIL%'   AND (TRIM(COALESCE("SGPAIS", '')) = '');
UPDATE "PAIS" SET "SGPAIS" = 'PY' WHERE UPPER(TRIM("DSPAIS")) LIKE '%ARAGUAI%' AND (TRIM(COALESCE("SGPAIS", '')) = '');
UPDATE "PAIS" SET "SGPAIS" = 'AR' WHERE UPPER(TRIM("DSPAIS")) LIKE '%RGENTINA%' AND (TRIM(COALESCE("SGPAIS", '')) = '');
UPDATE "PAIS" SET "SGPAIS" = 'UY' WHERE UPPER(TRIM("DSPAIS")) LIKE '%URUGUAI%' AND (TRIM(COALESCE("SGPAIS", '')) = '');

-- DDI
ALTER TABLE "PAIS"
  ADD COLUMN IF NOT EXISTS "DDI" VARCHAR(5);

COMMENT ON COLUMN "PAIS"."DDI" IS 'Código telefônico internacional (ex.: 55, 595, 351).';

UPDATE "PAIS" SET "DDI" = '55'   WHERE "CDPAIS" = 1    AND (TRIM(COALESCE("DDI", '')) = '');
UPDATE "PAIS" SET "DDI" = '54'   WHERE "CDPAIS" = 639  AND (TRIM(COALESCE("DDI", '')) = '');
UPDATE "PAIS" SET "DDI" = '595'  WHERE "CDPAIS" = 5860 AND (TRIM(COALESCE("DDI", '')) = '');
UPDATE "PAIS" SET "DDI" = '598'  WHERE "CDPAIS" = 8451 AND (TRIM(COALESCE("DDI", '')) = '');

-- ---------------------------------------------------------------------------
-- 5) ALERTS / SOS_ALERTS / regras de compatibilidade
-- ---------------------------------------------------------------------------

-- Tabela ALERTS (caso ainda não exista ou esteja incompleta)
CREATE TABLE IF NOT EXISTS "ALERTS" (
  "ID"                SERIAL PRIMARY KEY,
  "IDVIAGEM"          DECIMAL(15,0) NOT NULL,
  "CDMOTORISTA"       DECIMAL(15,0) NULL,
  "TYPE"              VARCHAR(20) NOT NULL,
  "MESSAGE"           VARCHAR(255) NOT NULL,
  "SEVERITY"          VARCHAR(10) NOT NULL DEFAULT 'medium',
  "PRIORIDADE"        VARCHAR(20) NULL DEFAULT 'Normal',
  "STATUS"            VARCHAR(50) NOT NULL DEFAULT 'Pendente',
  "DETAILS"           TEXT NULL,
  "CREATED_AT"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "RESOLVED"          BOOLEAN NOT NULL DEFAULT false,
  "RESOLVED_AT"       TIMESTAMPTZ NULL,
  "RESOLVED_BY"       INT NULL,
  "ID_USUARIO_LEU"    INT NULL,
  "DH_LEITURA"        TIMESTAMPTZ NULL,
  "ID_USUARIO_TRATOU" INT NULL,
  "DH_TRATAMENTO"     TIMESTAMPTZ NULL,
  "OBSERVACOES"       TEXT NULL
);

CREATE INDEX IF NOT EXISTS ix_alerts_viagem      ON "ALERTS" ("IDVIAGEM");
CREATE INDEX IF NOT EXISTS ix_alerts_status      ON "ALERTS" ("STATUS", "CREATED_AT" DESC);
CREATE INDEX IF NOT EXISTS ix_alerts_type        ON "ALERTS" ("TYPE", "SEVERITY");
CREATE INDEX IF NOT EXISTS ix_alerts_created_at  ON "ALERTS" ("CREATED_AT" DESC);

COMMENT ON TABLE "ALERTS" IS 'Alertas automáticos do sistema (parada, atraso, offline, desvio)';

-- Coluna LOCATION_DESCRIPTION em SOS_ALERTS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'SOS_ALERTS'
      AND column_name = 'LOCATION_DESCRIPTION'
  ) THEN
    ALTER TABLE public."SOS_ALERTS"
    ADD COLUMN "LOCATION_DESCRIPTION" VARCHAR(500) NULL;
  END IF;
END $$;

-- Auditoria de regras de compatibilidade
CREATE TABLE IF NOT EXISTS "REGRA_COMPATIVEL_AUDIT" (
  "ID"                SERIAL PRIMARY KEY,
  "DHALTERACAO"       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "SGUSER"            VARCHAR(50) NULL,
  "CHAVE"             VARCHAR(80) NOT NULL,
  "VALOR_ANTERIOR"    VARCHAR(20) NULL,
  "VALOR_NOVO"        VARCHAR(20) NULL
);

COMMENT ON TABLE "REGRA_COMPATIVEL_AUDIT" IS 'Histórico de alterações das regras de compatibilidade (rastreamento, classe frota, local embarque, local desembarque).';

CREATE INDEX IF NOT EXISTS "IX_REGRA_COMPATIVEL_AUDIT_DH"    ON "REGRA_COMPATIVEL_AUDIT" ("DHALTERACAO");
CREATE INDEX IF NOT EXISTS "IX_REGRA_COMPATIVEL_AUDIT_CHAVE" ON "REGRA_COMPATIVEL_AUDIT" ("CHAVE");

-- ---------------------------------------------------------------------------
-- 6) TIPOOCORRENCIA / VIAGEMOCORRENCIA – macros e controle de tempo
-- ---------------------------------------------------------------------------

-- Colunas de controle de tempo
ALTER TABLE "TIPOOCORRENCIA"
  ADD COLUMN IF NOT EXISTS "FG_CONTROLE_TEMPO"    CHAR(1)  NULL DEFAULT 'N';

ALTER TABLE "TIPOOCORRENCIA"
  ADD COLUMN IF NOT EXISTS "TEMPO_MAXIMO_MINUTOS" INTEGER  NULL;

COMMENT ON COLUMN "TIPOOCORRENCIA"."FG_CONTROLE_TEMPO" IS 'S=controlar tempo para alerta, N=não controlar';
COMMENT ON COLUMN "TIPOOCORRENCIA"."TEMPO_MAXIMO_MINUTOS" IS 'Tempo máximo (min) nesta situação antes de gerar alerta; usado quando FG_CONTROLE_TEMPO=S';

-- Situação de viagem vinculada à macro
ALTER TABLE "TIPOOCORRENCIA"
  ADD COLUMN IF NOT EXISTS "CDSITUACAOVIAGEM" SMALLINT NULL;

COMMENT ON COLUMN "TIPOOCORRENCIA"."CDSITUACAOVIAGEM" IS 'Código da situação da viagem (SITUACAOVIAGEM) a aplicar ao registrar esta macro';

-- Dados padrão de macros (idempotente)
INSERT INTO "TIPOOCORRENCIA" (
  "CDTIPOOCORRENCIA",
  "DSTIPOOCORRENCIA",
  "CDEDIPADRAO",
  "FGSITUACAO",
  "SEQ",
  "DTCADASTRO",
  "DTALTERACAO",
  "CDCADASTRO",
  "CDALTERACAO",
  "FGACTIVE",
  "DHMAINTENANCE",
  "SGUSER",
  "SERVERORIG"
) VALUES
  (26,  'Retido - Posto Fiscal/Polícia',     '26', 'P', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (58,  'Parada - Manutenção',               '99', 'P', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (103, 'Viagem - Início',                   '99', 'T', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (104, 'Viagem - Reinício',                 '99', 'T', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (105, 'Parada - Alimentação/Banheiro',     '99', 'P', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (106, 'Parada - Abastecimento',            '99', 'P', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (107, 'Parada - Descanso/Pernoite',        '99', 'P', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (109, 'Carga - Início',                    '99', 'C', 2, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (110, 'Carga - Fim',                       '99', 'C', 3, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (111, 'Descarga - Fim',                    '99', 'D', 3, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (151, 'Carga - Chegada',                   '99', 'C', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (159, 'Descarga - Chegada',                '99', 'D', 1, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  (192, 'Descarga - Início',                 '99', 'D', 2, '2026-12-03 11:32:07.190', NULL, NULL, NULL, NULL, NULL, NULL, NULL)
ON CONFLICT ("CDTIPOOCORRENCIA") DO UPDATE SET
  "DSTIPOOCORRENCIA" = EXCLUDED."DSTIPOOCORRENCIA",
  "CDEDIPADRAO"       = EXCLUDED."CDEDIPADRAO",
  "FGSITUACAO"        = EXCLUDED."FGSITUACAO",
  "SEQ"               = EXCLUDED."SEQ",
  "DTCADASTRO"        = EXCLUDED."DTCADASTRO";

-- (Opcional) Limpar histórico de macros – DESCOMENTAR se quiser usar
-- TRUNCATE TABLE "VIAGEMOCORRENCIA" RESTART IDENTITY;

-- ---------------------------------------------------------------------------
-- 7) CONFIGURACAO / menu Configurações
-- ---------------------------------------------------------------------------

-- Chaves de contexto (país, idioma, moeda, timezone)
INSERT INTO "CONFIGURACAO" ("CHAVE", "VALOR", "DESCRICAO", "DHMAINTENANCE")
VALUES
  ('pais_padrao',     'BR',    'País padrão da instalação (BR, PY, AR, UY...)',           CURRENT_TIMESTAMP),
  ('idioma_padrao',   'pt-BR', 'Locale padrão (pt-BR, es-PY, es-AR...)',                 CURRENT_TIMESTAMP),
  ('moeda_padrao',    'BRL',   'Moeda padrão (BRL, PYG, ARS, UYU...)',                   CURRENT_TIMESTAMP),
  ('tipo_doc_fisica', 'CPF',   'Tipo de documento pessoa física (CPF, CI, DNI...)',      CURRENT_TIMESTAMP),
  ('tipo_doc_juridica','CNPJ', 'Tipo de documento pessoa jurídica (CNPJ, RUC, CUIT...)', CURRENT_TIMESTAMP),
  ('timezone',        'America/Sao_Paulo', 'Fuso horário IANA (ex.: America/Sao_Paulo, America/Asuncion)', CURRENT_TIMESTAMP)
ON CONFLICT ("CHAVE") DO NOTHING;

-- Apontar para APIs oficiais (Nominatim / OSRM)
UPDATE "CONFIGURACAO" SET "VALOR" = 'https://nominatim.openstreetmap.org', "DHMAINTENANCE" = CURRENT_TIMESTAMP WHERE "CHAVE" = 'nominatim_server';
UPDATE "CONFIGURACAO" SET "VALOR" = 'https://router.project-osrm.org/route/v1/driving-hgv', "DHMAINTENANCE" = CURRENT_TIMESTAMP WHERE "CHAVE" = 'router_server';

-- Módulo Configurações no menu
INSERT INTO "TIPOATIVIDADE" (
  "CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "DSPROGRAMA", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG", "FGGRUPO"
) VALUES (
  50, '9.4.Configurações', 'gerenciar-configuracoes', 'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'System'
) ON CONFLICT ("CDTIPOATIVIDADE") DO UPDATE SET
  "DSTIPOATIVIDADE" = EXCLUDED."DSTIPOATIVIDADE",
  "DSPROGRAMA"      = EXCLUDED."DSPROGRAMA",
  "FGACTIVE"        = EXCLUDED."FGACTIVE",
  "DHMAINTENANCE"   = CURRENT_TIMESTAMP;

INSERT INTO "USUARIOATIVIDADE" ("SGUSUARIO", "CDTIPOATIVIDADE", "DHMAINTENANCE", "SGUSER", "SERVERORIG")
SELECT 'admin', 50, CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas'
WHERE EXISTS (SELECT 1 FROM "USUARIO" WHERE "SGUSUARIO" = 'admin')
  AND NOT EXISTS (SELECT 1 FROM "USUARIOATIVIDADE" WHERE "SGUSUARIO" = 'admin' AND "CDTIPOATIVIDADE" = 50);

-- ---------------------------------------------------------------------------
-- 8) MOTIVOREABERTURA / MOTIVORECUSA (dados base)
-- ---------------------------------------------------------------------------

INSERT INTO "MOTIVOREABERTURA" (
  "CDMOTIVO", "DSMOTIVO", "FGACTIVE", "DHINCLUSAO", "SGUSERINCLUSAO", "DHMAINTENANCE", "SGUSER", "SERVERORIG"
)
VALUES
  (1, 'Motorista Desistiu da Carga', 'A', '2025-11-28 12:23:55.567', 'SYSTEM', NULL, NULL, 'AppDVcargas'),
  (2, 'Necessidade de Mais Convocações', 'A', '2025-11-28 12:23:55.723', 'SYSTEM', NULL, NULL, 'AppDVcargas')
ON CONFLICT ("CDMOTIVO") DO UPDATE SET
  "DSMOTIVO"       = EXCLUDED."DSMOTIVO",
  "FGACTIVE"       = EXCLUDED."FGACTIVE",
  "DHINCLUSAO"     = EXCLUDED."DHINCLUSAO",
  "SGUSERINCLUSAO" = EXCLUDED."SGUSERINCLUSAO",
  "SERVERORIG"     = EXCLUDED."SERVERORIG";

SELECT setval(pg_get_serial_sequence('"MOTIVOREABERTURA"', 'CDMOTIVO'),
              COALESCE((SELECT MAX("CDMOTIVO") FROM "MOTIVOREABERTURA"), 1));

INSERT INTO "MOTIVORECUSA" (
  "CDMOTIVO", "DSMOTIVO", "FGACTIVE", "DHINCLUSAO", "SGUSERINCLUSAO", "DHMAINTENANCE", "SGUSER", "SERVERORIG"
)
VALUES
  (1, 'Destino',              'A', '2025-11-28 10:32:38.150', 'SYSTEM', NULL, NULL, 'AppDVcargas'),
  (2, 'Prazo de Pagamento',   'A', '2025-11-28 10:32:38.150', 'SYSTEM', NULL, NULL, 'AppDVcargas'),
  (3, 'Valor do Frete',       'A', '2025-11-28 10:32:38.150', 'SYSTEM', NULL, NULL, 'AppDVcargas'),
  (4, 'Peso da Carga',        'A', '2025-11-28 10:32:38.150', 'SYSTEM', NULL, NULL, 'AppDVcargas'),
  (5, 'Disponibilidade',      'A', '2025-11-28 10:32:38.160', 'SYSTEM', NULL, NULL, 'AppDVcargas')
ON CONFLICT ("CDMOTIVO") DO UPDATE SET
  "DSMOTIVO"       = EXCLUDED."DSMOTIVO",
  "FGACTIVE"       = EXCLUDED."FGACTIVE",
  "DHINCLUSAO"     = EXCLUDED."DHINCLUSAO",
  "SGUSERINCLUSAO" = EXCLUDED."SGUSERINCLUSAO",
  "SERVERORIG"     = EXCLUDED."SERVERORIG";

SELECT setval(pg_get_serial_sequence('"MOTIVORECUSA"', 'CDMOTIVO'),
              COALESCE((SELECT MAX("CDMOTIVO") FROM "MOTIVORECUSA"), 1));

-- ---------------------------------------------------------------------------
-- 9) Usuário SYSTEM (opcional) e correção do admin
-- ---------------------------------------------------------------------------

INSERT INTO "USUARIO" (
  "SGUSUARIO",
  "CDCADASTRO",
  "NMUSUARIO",
  "ENDEMAIL",
  "SENHA",
  "FGACTIVE"
)
SELECT
  'SYSTEM',
  (SELECT "CDCADASTRO" FROM "CADASTROGERAL" ORDER BY "CDCADASTRO" LIMIT 1),
  'Sistema',
  'system@local',
  '$2b$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  'S'
WHERE NOT EXISTS (SELECT 1 FROM "USUARIO" WHERE "SGUSUARIO" = 'SYSTEM')
  AND EXISTS (SELECT 1 FROM "CADASTROGERAL" LIMIT 1);

UPDATE "USUARIO" u
SET "CDCADASTRO" = sub."CDCADASTRO"
FROM (
  SELECT "CDCADASTRO" FROM "CADASTROGERAL" ORDER BY "CDCADASTRO" LIMIT 1
) sub
WHERE u."SGUSUARIO" = 'admin'
  AND u."CDCADASTRO" IS NULL
  AND EXISTS (SELECT 1 FROM "CADASTROGERAL" LIMIT 1);

