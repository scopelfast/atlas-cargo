-- =============================================================================
-- ATLAS_CARGO_PRD - Dados iniciais (espelhando SQL Server para admin funcional)
-- Execute DEPOIS do script_db_postgres.sql
-- Gera: usuário admin, TIPOATIVIDADE (mesmos IDs do SQL), USUARIOATIVIDADE,
--       USUARIOEMPRESA, USUARIOFILIAL, EMPRESA e FILIAL mínimos
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. USUÁRIO (login)
-- -----------------------------------------------------------------------------
-- Login: admin  |  Senha: admin  (troque após o primeiro acesso!)

INSERT INTO "USUARIO" (
  "SGUSUARIO", "NMUSUARIO", "ENDEMAIL", "CDCADASTRO", "SENHA", "FGACTIVE",
  "DHMAINTENANCE", "SGUSER", "SERVERORIG"
) VALUES (
  'admin', 'Administrador Master', 'admin@atlascargo.local', NULL, 'admin', 'S',
  CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas'
) ON CONFLICT ("SGUSUARIO") DO UPDATE SET
  "NMUSUARIO" = EXCLUDED."NMUSUARIO",
  "FGACTIVE" = EXCLUDED."FGACTIVE",
  "DHMAINTENANCE" = EXCLUDED."DHMAINTENANCE";

-- -----------------------------------------------------------------------------
-- 2. CADASTRO GERAL (mínimo para FILIAL.CDCADASTRO)
-- -----------------------------------------------------------------------------
INSERT INTO "CADASTROGERAL" (
  "CDCADASTRO", "CGCCPF", "RZSOCIAL", "ENDERECO", "NRENDERECO", "BAIRRO", "NRCELULAR", "FGACTIVE", "DHMAINTENANCE", "SERVERORIG"
) VALUES (
  1, '00000000000001', 'Cadastro Sistema', 'N/A', 0, 'N/A', 0, 'S', CURRENT_TIMESTAMP, 'AppDVcargas'
) ON CONFLICT ("CDCADASTRO") DO NOTHING;

-- -----------------------------------------------------------------------------
-- 3. EMPRESA (mínima para admin ter empresa 1)
-- -----------------------------------------------------------------------------
INSERT INTO "EMPRESA" (
  "CDEMPRESA", "RZSOCIAL", "NMREDUZIDO", "CGCMATRIZ", "IMAGEMLOGO", "FGACTIVE",
  "DHMAINTENANCE", "SGUSER", "SERVERORIG"
) VALUES (
  1, 'Integra Brasil Transportes', 'INTEGRA', 9395767000131, NULL, 'A',
  CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas'
) ON CONFLICT ("CDEMPRESA") DO UPDATE SET
  "RZSOCIAL" = EXCLUDED."RZSOCIAL",
  "NMREDUZIDO" = EXCLUDED."NMREDUZIDO",
  "FGACTIVE" = EXCLUDED."FGACTIVE";

-- -----------------------------------------------------------------------------
-- 4. FILIAL (mínimas para admin: 1, 3, 4, 5, 6, 9)
-- -----------------------------------------------------------------------------
INSERT INTO "FILIAL" (
  "CDEMPRESA", "CDFILIAL", "NMFANTASIA", "SGFILIAL", "CGC", "CDCADASTRO",
  "FGPARCEIRO", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG"
) VALUES
  (1, 1, '01 - CWB - Curitiba',     'CWB',  9395767000131, 1, 'N', 'A', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas'),
  (1, 3, '03 - SPO - Itapevi',      'SPO',  9395767000301, 1, 'N', 'A', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas'),
  (1, 4, '04 - RCF - Jaboatão',     'RCF',  9395767000484, 1, 'N', 'A', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas'),
  (1, 5, '05 - CTG - Contagem',     'CTG',  9395767000565, 1, 'N', 'A', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas'),
  (1, 6, '06 - CRC - Cariacica',    'CRC',  9395767000646, 1, 'N', 'A', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas'),
  (1, 9, '09 - POA - Canoas-RS',    'POA',  9395767000727, 1, 'N', 'A', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas')
ON CONFLICT ("CDEMPRESA", "CDFILIAL") DO UPDATE SET
  "NMFANTASIA" = EXCLUDED."NMFANTASIA",
  "SGFILIAL" = EXCLUDED."SGFILIAL",
  "FGACTIVE" = EXCLUDED."FGACTIVE";

-- -----------------------------------------------------------------------------
-- 5. MENU (TIPOATIVIDADE) – mesmos IDs e rótulos do SQL Server
-- -----------------------------------------------------------------------------
INSERT INTO "TIPOATIVIDADE" (
  "CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG", "DSPROGRAMA", "FGGRUPO"
) VALUES
  (1,  '1.0.Cadastro Geral',     'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-cadastro-geral',  'Cadastros'),
  (2,  '1.2.Tipo Validade',      'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-tipos-validade', 'Cadastros'),
  (3,  '9.0.Usuário',            'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-usuarios',         'System'),
  (4,  '4.6.Logs de Acesso',     'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-logs-acesso',    'Gestão'),
  (5,  '9.1.Tipo Atividade',      'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-tipos-atividade','System'),
  (10, '2.1.Marca',              'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-marcas',           'Equipamentos'),
  (11, '2.2.Tipo',               'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-tipos-equipamento','Equipamentos'),
  (12, '2.3.Modelo',             'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-modelos-equipamento','Equipamentos'),
  (13, '2.4.Grupo',              'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-grupos',          'Equipamentos'),
  (14, '2.0.Veículos',           'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-equipamentos',    'Equipamentos'),
  (20, '1.1.Cidade',             'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-cidades',         'Cadastros'),
  (21, '3.1.Tipo',               'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-tipos-viagem',   'Logística'),
  (22, '3.2.Situação',           'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-situacoes-viagem','Logística'),
  (23, '2.5.Classe Frota',        'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-classes-frota',  'Equipamentos'),
  (24, '3.3.Roteiro',            'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-roteiros',        'Logística'),
  (25, '3.0.Viagem',             'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-viagens',         'Logística'),
  (30, '4.5.Mapa de Viagem',      'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-mapa-viagem',    'Gestão'),
  (31, '9.2.Empresas',           'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-empresas',       'System'),
  (32, '9.3.Filiais',            'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-filiais',         'System'),
  (33, '4.0.Convocações',        'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'relatorio-convocacoes',     'Gestão'),
  (40, '4.1.Alertas',            'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'alertas',                   'Gestão'),
  (41, '4.2.Chat',               'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'chat',                      'Gestão'),
  (42, '4.3.SOS',                'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'sos',                        'Gestão'),
  (43, '4.4.Ranking',            'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'ranking',                   'Gestão'),
  (50, '9.4.Configurações',      'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas', 'gerenciar-configuracoes',   'System')
ON CONFLICT ("CDTIPOATIVIDADE") DO UPDATE SET
  "DSTIPOATIVIDADE" = EXCLUDED."DSTIPOATIVIDADE",
  "DSPROGRAMA"      = EXCLUDED."DSPROGRAMA",
  "FGGRUPO"         = EXCLUDED."FGGRUPO",
  "FGACTIVE"        = EXCLUDED."FGACTIVE",
  "DHMAINTENANCE"   = EXCLUDED."DHMAINTENANCE";

-- Corrigir FGGRUPO em todos os registros (evita grupos "1", "4" no menu)
UPDATE "TIPOATIVIDADE" SET "FGGRUPO" = CASE
  WHEN "CDTIPOATIVIDADE" IN (1, 2, 20) THEN 'Cadastros'
  WHEN "CDTIPOATIVIDADE" IN (3, 5, 31, 32, 50) THEN 'System'
  WHEN "CDTIPOATIVIDADE" IN (4, 30, 33, 40, 41, 42, 43) THEN 'Gestão'
  WHEN "CDTIPOATIVIDADE" IN (10, 11, 12, 13, 14, 23) THEN 'Equipamentos'
  WHEN "CDTIPOATIVIDADE" IN (21, 22, 24, 25) THEN 'Logística'
  ELSE COALESCE(NULLIF(TRIM("FGGRUPO"), ''), 'OUTROS')
END;

-- -----------------------------------------------------------------------------
-- 6. PERMISSÕES MENU (USUARIOATIVIDADE) – admin com as mesmas do SQL Server
-- -----------------------------------------------------------------------------
INSERT INTO "USUARIOATIVIDADE" ("SGUSUARIO", "CDTIPOATIVIDADE", "DHMAINTENANCE", "SGUSER", "SERVERORIG")
SELECT 'admin', n, CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas'
FROM (VALUES (1),(2),(3),(4),(5),(10),(11),(12),(13),(14),(20),(21),(22),(23),(24),(25),(30),(31),(32),(33),(40),(41),(42),(43),(50)) AS t(n)
ON CONFLICT ("SGUSUARIO", "CDTIPOATIVIDADE") DO NOTHING;

-- -----------------------------------------------------------------------------
-- 7. EMPRESA do admin (USUARIOEMPRESA)
-- -----------------------------------------------------------------------------
INSERT INTO "USUARIOEMPRESA" ("SGUSUARIO", "CDEMPRESA", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG")
VALUES ('admin', 1, 'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas')
ON CONFLICT ("SGUSUARIO", "CDEMPRESA") DO NOTHING;

-- -----------------------------------------------------------------------------
-- 8. FILIAIS do admin (USUARIOFILIAL) – 1, 3, 4, 5, 6, 9
-- -----------------------------------------------------------------------------
INSERT INTO "USUARIOFILIAL" ("SGUSUARIO", "CDEMPRESA", "CDFILIAL", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG")
VALUES
  ('admin', 1, 1, 'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas'),
  ('admin', 1, 3, 'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas'),
  ('admin', 1, 4, 'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas'),
  ('admin', 1, 5, 'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas'),
  ('admin', 1, 6, 'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas'),
  ('admin', 1, 9, 'S', CURRENT_TIMESTAMP, 'SYSTEM', 'AppDVcargas')
ON CONFLICT ("SGUSUARIO", "CDEMPRESA", "CDFILIAL") DO NOTHING;

-- -----------------------------------------------------------------------------
-- 9. PAÍS (Brasil – necessário para combo de país/cidade)
-- -----------------------------------------------------------------------------
INSERT INTO "PAIS" (
  "CDPAIS", "DSPAIS", "SGPAIS", "CDBACEN", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "OBJECTVERSION", "SERVERORIG", "DHCTRLREPLIC"
) VALUES (
  1, 'Brasil', 'BR', 1058, 'A', '2012-02-11 11:58:40.240', 'carga', NULL, NULL, NULL
) ON CONFLICT ("CDPAIS") DO UPDATE SET
  "DSPAIS" = EXCLUDED."DSPAIS",
  "SGPAIS" = EXCLUDED."SGPAIS",
  "CDBACEN" = EXCLUDED."CDBACEN",
  "FGACTIVE" = EXCLUDED."FGACTIVE",
  "DHMAINTENANCE" = EXCLUDED."DHMAINTENANCE",
  "SGUSER" = EXCLUDED."SGUSER";

-- -----------------------------------------------------------------------------
-- 10. CIDADES (seed mínimo para combo no Cadastro Geral – PR, SP, RS)
-- -----------------------------------------------------------------------------
INSERT INTO "CIDADE" (
  "CDCIDADE", "ESTADO", "NMCIDADE", "FGACTIVE", "CDUF", "CDMUNICIPIO", "DHMAINTENANCE", "SERVERORIG"
) VALUES
  (4106902, 'PR', 'Curitiba',     'A', 41, 4106902, CURRENT_TIMESTAMP, 'AppDVcargas'),
  (4113700, 'PR', 'Londrina',     'A', 41, 4113700, CURRENT_TIMESTAMP, 'AppDVcargas'),
  (4115200, 'PR', 'Maringá',      'A', 41, 4115200, CURRENT_TIMESTAMP, 'AppDVcargas'),
  (4119905, 'PR', 'Ponta Grossa', 'A', 41, 4119905, CURRENT_TIMESTAMP, 'AppDVcargas'),
  (4124053, 'PR', 'Cascavel',     'A', 41, 4124053, CURRENT_TIMESTAMP, 'AppDVcargas'),
  (4125506, 'PR', 'Castro',       'A', 41, 4125506, CURRENT_TIMESTAMP, 'AppDVcargas'),
  (4100103, 'PR', 'Abatiá',       'A', 41, 4100103, CURRENT_TIMESTAMP, 'AppDVcargas'),
  (3550308, 'SP', 'São Paulo',    'A', 35, 3550308, CURRENT_TIMESTAMP, 'AppDVcargas'),
  (3509502, 'SP', 'Campinas',    'A', 35, 3509502, CURRENT_TIMESTAMP, 'AppDVcargas'),
  (4314902, 'RS', 'Porto Alegre','A', 43, 4314902, CURRENT_TIMESTAMP, 'AppDVcargas'),
  (4304606, 'RS', 'Caxias do Sul','A', 43, 4304606, CURRENT_TIMESTAMP, 'AppDVcargas')
ON CONFLICT ("CDCIDADE") DO NOTHING;

-- -----------------------------------------------------------------------------
-- Pronto. Acesse com:
--   Login: admin
--   Senha: admin
-- Troque a senha no primeiro acesso (Alterar Senha na tela de login).
-- =============================================================================
