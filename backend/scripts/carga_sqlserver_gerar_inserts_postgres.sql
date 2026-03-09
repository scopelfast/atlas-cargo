-- =============================================================================
-- Script SQL SERVER: Gerar INSERTs para PostgreSQL (PAIS, ESTADO, MESOREGIAO, MICROREGIAO, CIDADE, REGIAOCIDADE, REGIAOFISCAL)
-- Como usar:
-- 1. No SSMS: Query -> Results to -> Results to Text (Ctrl+T). Max length 8192 ou maior.
-- 2. Execute cada bloco (um por tabela) e copie o resultado.
-- 3. No PostgreSQL: rode primeiro carga_postgres_limpar_tabelas_geograficas.sql
-- 4. Cole e execute os INSERTs no PostgreSQL na ordem: PAIS, ESTADO, REGIAOFISCAL, MESOREGIAO, MICROREGIAO, CIDADE, REGIAOCIDADE
-- =============================================================================

-- Função auxiliar: escapa string para literal PostgreSQL (NULL vira NULL, senão 'valor' com ' escapado)
-- Em cada SELECT usamos expressão por coluna.

-- ========== 1. PAIS ==========
SELECT 'INSERT INTO "PAIS" ("CDPAIS","DSPAIS","SGPAIS","CDBACEN","FGACTIVE","DHMAINTENANCE","SGUSER","OBJECTVERSION","SERVERORIG","DHCTRLREPLIC") VALUES ('
  + CAST(CDPAIS AS VARCHAR(20)) + ','
  + ISNULL('''' + REPLACE(CAST(DSPAIS AS VARCHAR(40)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(SGPAIS AS VARCHAR(3)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL(CAST(CDBACEN AS VARCHAR(20)), 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(FGACTIVE AS VARCHAR(1)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + CONVERT(VARCHAR(23), DHMAINTENANCE, 121) + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(SGUSER AS VARCHAR(50)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(OBJECTVERSION AS VARCHAR(20)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(SERVERORIG AS VARCHAR(50)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + CONVERT(VARCHAR(23), DHCTRLREPLIC, 121) + '''', 'NULL')
  + ');'
FROM PAIS;

-- ========== 2. ESTADO ==========
SELECT 'INSERT INTO "ESTADO" ("CDPAIS","ESTADO","NMESTADO","CDUF","CDREGIAOFISCAL","ALIMPOSTOFCP","FGACTIVE","DHMAINTENANCE","SGUSER","OBJECTVERSION","SERVERORIG","DHCTRLREPLIC") VALUES ('
  + CAST(CDPAIS AS VARCHAR(20)) + ','
  + '''' + REPLACE(CAST(ESTADO AS VARCHAR(3)), '''', '''''') + ''','
  + '''' + REPLACE(CAST(NMESTADO AS VARCHAR(40)), '''', '''''') + ''','
  + CAST(CDUF AS VARCHAR(20)) + ','
  + ISNULL(CAST(CDREGIAOFISCAL AS VARCHAR(20)), 'NULL') + ','
  + ISNULL(CAST(ALIMPOSTOFCP AS VARCHAR(30)), 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(FGACTIVE AS VARCHAR(1)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + CONVERT(VARCHAR(23), DHMAINTENANCE, 121) + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(SGUSER AS VARCHAR(50)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(OBJECTVERSION AS VARCHAR(20)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(SERVERORIG AS VARCHAR(50)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + CONVERT(VARCHAR(23), DHCTRLREPLIC, 121) + '''', 'NULL')
  + ');'
FROM ESTADO;

-- ========== 3. REGIAOFISCAL (antes de CIDADE, pois CIDADE pode referenciar) ==========
SELECT 'INSERT INTO "REGIAOFISCAL" ("CDREGIAOFISCAL","DSREGIAOFISCAL","MENSAGEM","FGCOMPLEMENTO","FGACTIVE","DHMAINTENANCE","SGUSER","OBJECTVERSION","SERVERORIG","DHCTRLREPLIC") VALUES ('
  + CAST(CDREGIAOFISCAL AS VARCHAR(20)) + ','
  + '''' + REPLACE(CAST(DSREGIAOFISCAL AS VARCHAR(40)), '''', '''''') + ''','
  + ISNULL('''' + REPLACE(CAST(MENSAGEM AS VARCHAR(100)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(FGCOMPLEMENTO AS VARCHAR(1)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(FGACTIVE AS VARCHAR(1)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + CONVERT(VARCHAR(23), DHMAINTENANCE, 121) + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(SGUSER AS VARCHAR(50)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(OBJECTVERSION AS VARCHAR(20)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(SERVERORIG AS VARCHAR(50)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + CONVERT(VARCHAR(23), DHCTRLREPLIC, 121) + '''', 'NULL')
  + ');'
FROM REGIAOFISCAL;

-- ========== 4. MESOREGIAO ==========
SELECT 'INSERT INTO "MESOREGIAO" ("CDUF","CDMESOREGIAO","DSMESOREGIAO","FGACTIVE","DHMAINTENANCE","SGUSER","OBJECTVERSION","SERVERORIG","DHCTRLREPLIC") VALUES ('
  + CAST(CDUF AS VARCHAR(20)) + ','
  + CAST(CDMESOREGIAO AS VARCHAR(20)) + ','
  + '''' + REPLACE(CAST(DSMESOREGIAO AS VARCHAR(40)), '''', '''''') + ''','
  + ISNULL('''' + REPLACE(CAST(FGACTIVE AS VARCHAR(1)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + CONVERT(VARCHAR(23), DHMAINTENANCE, 121) + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(SGUSER AS VARCHAR(50)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(OBJECTVERSION AS VARCHAR(20)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(SERVERORIG AS VARCHAR(50)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + CONVERT(VARCHAR(23), DHCTRLREPLIC, 121) + '''', 'NULL')
  + ');'
FROM MESOREGIAO;

-- ========== 5. MICROREGIAO ==========
SELECT 'INSERT INTO "MICROREGIAO" ("CDUF","CDMICROREGIAO","DSMICROREGIAO","FGACTIVE","DHMAINTENANCE","SGUSER","OBJECTVERSION","SERVERORIG","DHCTRLREPLIC") VALUES ('
  + CAST(CDUF AS VARCHAR(20)) + ','
  + CAST(CDMICROREGIAO AS VARCHAR(20)) + ','
  + '''' + REPLACE(CAST(DSMICROREGIAO AS VARCHAR(40)), '''', '''''') + ''','
  + ISNULL('''' + REPLACE(CAST(FGACTIVE AS VARCHAR(1)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + CONVERT(VARCHAR(23), DHMAINTENANCE, 121) + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(SGUSER AS VARCHAR(50)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(OBJECTVERSION AS VARCHAR(20)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(SERVERORIG AS VARCHAR(50)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + CONVERT(VARCHAR(23), DHCTRLREPLIC, 121) + '''', 'NULL')
  + ');'
FROM MICROREGIAO;

-- ========== 6. CIDADE ==========
SELECT 'INSERT INTO "CIDADE" ("CDCIDADE","ESTADO","NMCIDADE","FGACTIVE","DHMAINTENANCE","SGUSER","SERVERORIG","CDPAIS","CDUF","CDMUNICIPIO","CDAREADDD","CDMICROREGIAO","CDMESOREGIAO","CDREGIAOFISCAL") VALUES ('
  + CAST(CDCIDADE AS VARCHAR(20)) + ','
  + '''' + REPLACE(CAST(ESTADO AS VARCHAR(3)), '''', '''''') + ''','
  + '''' + REPLACE(CAST(NMCIDADE AS VARCHAR(40)), '''', '''''') + ''','
  + ISNULL('''' + REPLACE(CAST(FGACTIVE AS VARCHAR(1)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + CONVERT(VARCHAR(23), DHMAINTENANCE, 121) + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(SGUSER AS VARCHAR(50)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(SERVERORIG AS VARCHAR(50)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL(CAST(CDPAIS AS VARCHAR(20)), 'NULL') + ','
  + CAST(CDUF AS VARCHAR(20)) + ','
  + CAST(CDMUNICIPIO AS VARCHAR(20)) + ','
  + ISNULL(CAST(CDAREADDD AS VARCHAR(20)), 'NULL') + ','
  + ISNULL(CAST(CDMICROREGIAO AS VARCHAR(20)), 'NULL') + ','
  + ISNULL(CAST(CDMESOREGIAO AS VARCHAR(20)), 'NULL') + ','
  + ISNULL(CAST(CDREGIAOFISCAL AS VARCHAR(20)), 'NULL')
  + ');'
FROM CIDADE;

-- ========== 7. REGIAOCIDADE ==========
SELECT 'INSERT INTO "REGIAOCIDADE" ("IDREGIAOATENDIMENTO","CDCIDADE","BAIRRO","DHMAINTENANCE","SGUSER","OBJECTVERSION","SERVERORIG","DHCTRLREPLIC") VALUES ('
  + '''' + REPLACE(CAST(IDREGIAOATENDIMENTO AS VARCHAR(10)), '''', '''''') + ''','
  + CAST(CDCIDADE AS VARCHAR(20)) + ','
  + '''' + REPLACE(CAST(BAIRRO AS VARCHAR(40)), '''', '''''') + ''','
  + ISNULL('''' + CONVERT(VARCHAR(23), DHMAINTENANCE, 121) + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(SGUSER AS VARCHAR(50)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(OBJECTVERSION AS VARCHAR(20)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + REPLACE(CAST(SERVERORIG AS VARCHAR(50)), '''', '''''') + '''', 'NULL') + ','
  + ISNULL('''' + CONVERT(VARCHAR(23), DHCTRLREPLIC, 121) + '''', 'NULL')
  + ');'
FROM REGIAOCIDADE;
