-- =============================================================================
-- SCRIPT: Exportar CIDADE do SQL Server para PostgreSQL
-- =============================================================================
-- PASSO 1: Execute este script no SQL Server Management Studio (banco de origem).
-- PASSO 2: No SSMS, menu Query > Results To > Results to Text (Ctrl+T).
-- PASSO 3: Execute a query abaixo (a segunda, a que começa com SELECT).
-- PASSO 4: Copie TODA a coluna de resultado (são linhas de INSERT).
-- PASSO 5: Cole no pgAdmin (Query Tool do banco atlas_cargo_prd) e execute.
--
-- Opcional: adicione no início do resultado a linha:
--   DELETE FROM "CIDADE";
-- se quiser limpar a tabela antes (cuidado com FKs: ROTEIRO, CADASTROGERAL, etc.).
-- Para apenas adicionar sem apagar, use ON CONFLICT no PostgreSQL (incluído no script gerado).
-- =============================================================================

-- Query para gerar os INSERTs (rode esta no SQL Server e use o resultado no PostgreSQL):
SELECT
  'INSERT INTO "CIDADE" ("CDCIDADE", "ESTADO", "NMCIDADE", "FGACTIVE", "DHMAINTENANCE", "SGUSER", "SERVERORIG", "CDPAIS", "CDUF", "CDMUNICIPIO", "CDAREADDD", "CDMICROREGIAO", "CDMESOREGIAO", "CDREGIAOFISCAL") VALUES ('
  + CAST([CDCIDADE] AS VARCHAR(20)) + ', '
  + '''' + REPLACE(RTRIM([ESTADO]), '''', '''''') + ''', '
  + '''' + REPLACE(RTRIM([NMCIDADE]), '''', '''''') + ''', '
  + CASE WHEN [FGACTIVE] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([FGACTIVE]), '''', '''''') + '''' END + ', '
  + CASE WHEN [DHMAINTENANCE] IS NULL THEN 'NULL' ELSE '''' + CONVERT(VARCHAR(23), [DHMAINTENANCE], 120) + '''' END + ', '
  + CASE WHEN [SGUSER] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM([SGUSER]), '''', '''''') + '''' END + ', '
  + CASE WHEN [SERVERORIG] IS NULL THEN 'NULL' ELSE '''' + REPLACE(RTRIM(ISNULL([SERVERORIG], 'AppDVcargas')), '''', '''''') + '''' END + ', '
  + CASE WHEN [CDPAIS] IS NULL THEN 'NULL' ELSE CAST([CDPAIS] AS VARCHAR(10)) END + ', '
  + CAST([CDUF] AS VARCHAR(10)) + ', '
  + CAST([CDMUNICIPIO] AS VARCHAR(20)) + ', '
  + CASE WHEN [CDAREADDD] IS NULL THEN 'NULL' ELSE CAST([CDAREADDD] AS VARCHAR(10)) END + ', '
  + CASE WHEN [CDMICROREGIAO] IS NULL THEN 'NULL' ELSE CAST([CDMICROREGIAO] AS VARCHAR(10)) END + ', '
  + CASE WHEN [CDMESOREGIAO] IS NULL THEN 'NULL' ELSE CAST([CDMESOREGIAO] AS VARCHAR(10)) END + ', '
  + CASE WHEN [CDREGIAOFISCAL] IS NULL THEN 'NULL' ELSE CAST([CDREGIAOFISCAL] AS VARCHAR(10)) END
  + ') ON CONFLICT ("CDCIDADE") DO NOTHING;'
FROM [dbo].[CIDADE]
ORDER BY [ESTADO], [NMCIDADE];

-- =============================================================================
-- REGIAOCIDADE: exportar do SQL Server para PostgreSQL
-- =============================================================================
-- Rode a query abaixo no SQL Server (Results to Text), copie o resultado
-- e execute no pgAdmin (banco atlas_cargo_prd).
-- Execute primeiro o script de CIDADE se REGIAOCIDADE referenciar CDCIDADE.
-- =============================================================================

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
