-- =============================================================================
-- SCRIPT: Exportar MESOREGIAO, MICROREGIAO, REGIAOATENDIMENTO, REGIAOCIDADE, REGIAOFISCAL
--          do SQL Server para PostgreSQL
-- =============================================================================
-- PASSO 1: Execute este script no SQL Server Management Studio (banco de origem).
-- PASSO 2: No SSMS, menu Query > Results To > Results to Text (Ctrl+T).
-- PASSO 3: Execute cada bloco SELECT abaixo (um por tabela).
-- PASSO 4: Copie o resultado de cada query e execute no pgAdmin (banco atlas_cargo_prd).
--
-- Ordem recomendada no PostgreSQL (por dependências):
--   1) REGIAOFISCAL  2) MESOREGIAO  3) MICROREGIAO  4) REGIAOATENDIMENTO  5) REGIAOCIDADE
-- (REGIAOCIDADE referencia REGIAOATENDIMENTO e CIDADE; carregue CIDADE antes se necessário.)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) REGIAOFISCAL
-- -----------------------------------------------------------------------------
SELECT
  'INSERT INTO "REGIAOFISCAL" ("CDREGIAOFISCAL", "DSREGIAOFISCAL", "MENSAGEM", "FGCOMPLEMENTO", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "OBJECTVERSION", "SERVERORIG", "DHCTRLREPLIC") VALUES ('
  + CAST([CDREGIAOFISCAL] AS VARCHAR(10)) + ', '
  + '''' + REPLACE(RTRIM([DSREGIAOFISCAL]), '''', '''''') + ''', '
  + CASE WHEN [MENSAGEM] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([MENSAGEM]), '''', '''''') + '''' END + ', '
  + CASE WHEN [FGCOMPLEMENTO] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([FGCOMPLEMENTO]), '''', '''''') + '''' END + ', '
  + CASE WHEN [FGACTIVE] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([FGACTIVE]), '''', '''''') + '''' END + ', '
  + CASE WHEN [DHMAINTENANCE] IS NULL THEN 'NULL' ELSE '''' + CONVERT(VARCHAR(23), [DHMAINTENANCE], 120) + '''' END + ', '
  + CASE WHEN [SGUSER] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([SGUSER]), '''', '''''') + '''' END + ', '
  + CASE WHEN [OBJECTVERSION] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([OBJECTVERSION]), '''', '''''') + '''' END + ', '
  + CASE WHEN [SERVERORIG] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([SERVERORIG]), '''', '''''') + '''' END + ', '
  + CASE WHEN [DHCTRLREPLIC] IS NULL THEN 'NULL' ELSE '''' + CONVERT(VARCHAR(23), [DHCTRLREPLIC], 120) + '''' END
  + ') ON CONFLICT ("CDREGIAOFISCAL") DO NOTHING;'
FROM [dbo].[REGIAOFISCAL]
ORDER BY [CDREGIAOFISCAL];

-- -----------------------------------------------------------------------------
-- 2) MESOREGIAO
-- -----------------------------------------------------------------------------
SELECT
  'INSERT INTO "MESOREGIAO" ("CDUF", "CDMESOREGIAO", "DSMESOREGIAO", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "OBJECTVERSION", "SERVERORIG", "DHCTRLREPLIC") VALUES ('
  + CAST([CDUF] AS VARCHAR(10)) + ', '
  + CAST([CDMESOREGIAO] AS VARCHAR(10)) + ', '
  + '''' + REPLACE(RTRIM([DSMESOREGIAO]), '''', '''''') + ''', '
  + CASE WHEN [FGACTIVE] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([FGACTIVE]), '''', '''''') + '''' END + ', '
  + CASE WHEN [DHMAINTENANCE] IS NULL THEN 'NULL' ELSE '''' + CONVERT(VARCHAR(23), [DHMAINTENANCE], 120) + '''' END + ', '
  + CASE WHEN [SGUSER] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([SGUSER]), '''', '''''') + '''' END + ', '
  + CASE WHEN [OBJECTVERSION] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([OBJECTVERSION]), '''', '''''') + '''' END + ', '
  + CASE WHEN [SERVERORIG] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([SERVERORIG]), '''', '''''') + '''' END + ', '
  + CASE WHEN [DHCTRLREPLIC] IS NULL THEN 'NULL' ELSE '''' + CONVERT(VARCHAR(23), [DHCTRLREPLIC], 120) + '''' END
  + ') ON CONFLICT ("CDUF", "CDMESOREGIAO") DO NOTHING;'
FROM [dbo].[MESOREGIAO]
ORDER BY [CDUF], [CDMESOREGIAO];

-- -----------------------------------------------------------------------------
-- 3) MICROREGIAO
-- -----------------------------------------------------------------------------
SELECT
  'INSERT INTO "MICROREGIAO" ("CDUF", "CDMICROREGIAO", "DSMICROREGIAO", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "OBJECTVERSION", "SERVERORIG", "DHCTRLREPLIC") VALUES ('
  + CAST([CDUF] AS VARCHAR(10)) + ', '
  + CAST([CDMICROREGIAO] AS VARCHAR(10)) + ', '
  + '''' + REPLACE(RTRIM([DSMICROREGIAO]), '''', '''''') + ''', '
  + CASE WHEN [FGACTIVE] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([FGACTIVE]), '''', '''''') + '''' END + ', '
  + CASE WHEN [DHMAINTENANCE] IS NULL THEN 'NULL' ELSE '''' + CONVERT(VARCHAR(23), [DHMAINTENANCE], 120) + '''' END + ', '
  + CASE WHEN [SGUSER] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([SGUSER]), '''', '''''') + '''' END + ', '
  + CASE WHEN [OBJECTVERSION] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([OBJECTVERSION]), '''', '''''') + '''' END + ', '
  + CASE WHEN [SERVERORIG] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([SERVERORIG]), '''', '''''') + '''' END + ', '
  + CASE WHEN [DHCTRLREPLIC] IS NULL THEN 'NULL' ELSE '''' + CONVERT(VARCHAR(23), [DHCTRLREPLIC], 120) + '''' END
  + ') ON CONFLICT ("CDUF", "CDMICROREGIAO") DO NOTHING;'
FROM [dbo].[MICROREGIAO]
ORDER BY [CDUF], [CDMICROREGIAO];

-- -----------------------------------------------------------------------------
-- 4) REGIAOATENDIMENTO
-- -----------------------------------------------------------------------------
SELECT
  'INSERT INTO "REGIAOATENDIMENTO" ("IDREGIAOATENDIMENTO", "DSREGIAOATENDIMENTO", "SGUNIDADENEGOCIO", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "OBJECTVERSION", "SERVERORIG", "DHCTRLREPLIC", "SGUNIDADECOLETA", "SGUNIDADEENTREGA") VALUES ('
  + '''' + REPLACE(RTRIM([IDREGIAOATENDIMENTO]), '''', '''''') + ''', '
  + '''' + REPLACE(RTRIM([DSREGIAOATENDIMENTO]), '''', '''''') + ''', '
  + CASE WHEN [SGUNIDADENEGOCIO] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([SGUNIDADENEGOCIO]), '''', '''''') + '''' END + ', '
  + CASE WHEN [FGACTIVE] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([FGACTIVE]), '''', '''''') + '''' END + ', '
  + CASE WHEN [DHMAINTENANCE] IS NULL THEN 'NULL' ELSE '''' + CONVERT(VARCHAR(23), [DHMAINTENANCE], 120) + '''' END + ', '
  + CASE WHEN [SGUSER] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([SGUSER]), '''', '''''') + '''' END + ', '
  + CASE WHEN [OBJECTVERSION] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([OBJECTVERSION]), '''', '''''') + '''' END + ', '
  + CASE WHEN [SERVERORIG] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([SERVERORIG]), '''', '''''') + '''' END + ', '
  + CASE WHEN [DHCTRLREPLIC] IS NULL THEN 'NULL' ELSE '''' + CONVERT(VARCHAR(23), [DHCTRLREPLIC], 120) + '''' END + ', '
  + CASE WHEN [SGUNIDADECOLETA] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([SGUNIDADECOLETA]), '''', '''''') + '''' END + ', '
  + CASE WHEN [SGUNIDADEENTREGA] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([SGUNIDADEENTREGA]), '''', '''''') + '''' END
  + ') ON CONFLICT ("IDREGIAOATENDIMENTO") DO NOTHING;'
FROM [dbo].[REGIAOATENDIMENTO]
ORDER BY [IDREGIAOATENDIMENTO];

-- -----------------------------------------------------------------------------
-- 5) REGIAOCIDADE
-- -----------------------------------------------------------------------------
-- Depende de REGIAOATENDIMENTO e CIDADE já carregadas. Sem PK única no script;
-- se rodar duas vezes pode duplicar linhas. Para limpar antes: DELETE FROM "REGIAOCIDADE";
SELECT
  'INSERT INTO "REGIAOCIDADE" ("IDREGIAOATENDIMENTO", "CDCIDADE", "BAIRRO", "DHMAINTENANCE", "SGUSER", "OBJECTVERSION", "SERVERORIG", "DHCTRLREPLIC") VALUES ('
  + '''' + REPLACE(RTRIM([IDREGIAOATENDIMENTO]), '''', '''''') + ''', '
  + CAST([CDCIDADE] AS VARCHAR(20)) + ', '
  + '''' + REPLACE(RTRIM([BAIRRO]), '''', '''''') + ''', '
  + CASE WHEN [DHMAINTENANCE] IS NULL THEN 'NULL' ELSE '''' + CONVERT(VARCHAR(23), [DHMAINTENANCE], 120) + '''' END + ', '
  + CASE WHEN [SGUSER] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([SGUSER]), '''', '''''') + '''' END + ', '
  + CASE WHEN [OBJECTVERSION] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([OBJECTVERSION]), '''', '''''') + '''' END + ', '
  + CASE WHEN [SERVERORIG] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([SERVERORIG]), '''', '''''') + '''' END + ', '
  + CASE WHEN [DHCTRLREPLIC] IS NULL THEN 'NULL' ELSE '''' + CONVERT(VARCHAR(23), [DHCTRLREPLIC], 120) + '''' END
  + ');'
FROM [dbo].[REGIAOCIDADE]
ORDER BY [IDREGIAOATENDIMENTO], [CDCIDADE], [BAIRRO];
