-- =============================================================================
-- ATLAS_CARGO_PRD - Dados iniciais (espelhando SQL Server para admin funcional)
-- Execute DEPOIS do script_db_postgres.sql
-- Gera: usuário admin, USUARIOEMPRESA, USUARIOFILIAL, EMPRESA e FILIAL mínimos.
-- O menu (TIPOATIVIDADE e acessos do admin) vem do dump ou de
-- backend/scripts/menu_do_banco_local_postgres.sql. Não regravar aqui.
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
-- 5 e 6. MENU — coração do painel
-- TIPOATIVIDADE + USUARIOATIVIDADE do admin (os 47 tipos da tela).
-- Não fica mais uma lista curta aqui: ela regravava o menu e escondia
-- Campanha, Estoque, Tenants e Disparo WhatsApp.
-- Banco novo: o dump backups/atlas_cargo_prd_20261125.dump já traz esses 47.
-- Banco que já existe: rodar backend/scripts/menu_do_banco_local_postgres.sql
-- -----------------------------------------------------------------------------

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
