/*
=============================================================================
Script: Verificar Tabela VIAGEM_RASTREAMENTO
Descrição: Verifica se a tabela existe e mostra sua estrutura
Data: 2025-01-27
=============================================================================
*/

USE [DIVULGACARGA_PRD]
GO

-- Verificar se a tabela existe
IF EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VIAGEM_RASTREAMENTO')
BEGIN
    PRINT '✅ Tabela VIAGEM_RASTREAMENTO existe!';
    PRINT '';
    
    -- Mostrar estrutura da tabela
    PRINT '📋 Estrutura da tabela:';
    SELECT 
        COLUMN_NAME AS Coluna,
        DATA_TYPE AS Tipo,
        CHARACTER_MAXIMUM_LENGTH AS Tamanho,
        IS_NULLABLE AS Permite_Null,
        COLUMN_DEFAULT AS Valor_Padrao
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo' 
      AND TABLE_NAME = 'VIAGEM_RASTREAMENTO'
    ORDER BY ORDINAL_POSITION;
    
    PRINT '';
    
    -- Verificar se tem dados
    DECLARE @TotalRegistros INT;
    SELECT @TotalRegistros = COUNT(*) FROM [dbo].[VIAGEM_RASTREAMENTO];
    PRINT '📊 Total de registros: ' + CAST(@TotalRegistros AS VARCHAR);
    
    -- Mostrar algumas posições de exemplo
    IF @TotalRegistros > 0
    BEGIN
        PRINT '';
        PRINT '📍 Exemplos de posições (últimas 5):';
        SELECT TOP 5
            IDRASTREAMENTO,
            IDVIAGEM,
            CDCADASTRO,
            LATITUDE,
            LONGITUDE,
            VELOCIDADE,
            DHREGISTRO
        FROM [dbo].[VIAGEM_RASTREAMENTO]
        ORDER BY DHREGISTRO DESC;
    END
    
    -- Verificar se há posições para a viagem 82911
    DECLARE @PosicoesViagem INT;
    SELECT @PosicoesViagem = COUNT(*) 
    FROM [dbo].[VIAGEM_RASTREAMENTO]
    WHERE IDVIAGEM = 82911;
    
    PRINT '';
    PRINT '🔍 Posições para viagem 82911: ' + CAST(@PosicoesViagem AS VARCHAR);
    
    IF @PosicoesViagem > 0
    BEGIN
        SELECT 
            IDRASTREAMENTO,
            IDVIAGEM,
            CDCADASTRO,
            LATITUDE,
            LONGITUDE,
            VELOCIDADE,
            DHREGISTRO
        FROM [dbo].[VIAGEM_RASTREAMENTO]
        WHERE IDVIAGEM = 82911
        ORDER BY DHREGISTRO DESC;
    END
END
ELSE
BEGIN
    PRINT '❌ Tabela VIAGEM_RASTREAMENTO NÃO existe!';
    PRINT '';
    PRINT '💡 Para criar a tabela, execute:';
    PRINT '   backend/scripts/criar_tabelas_app_motorista.sql';
    PRINT '';
    PRINT 'Ou execute diretamente:';
    PRINT '';
    PRINT 'CREATE TABLE [dbo].[VIAGEM_RASTREAMENTO] (';
    PRINT '    IDRASTREAMENTO BIGINT IDENTITY(1,1) PRIMARY KEY,';
    PRINT '    IDVIAGEM DECIMAL(15,0) NOT NULL,';
    PRINT '    CDCADASTRO DECIMAL(15,0) NOT NULL,';
    PRINT '    LATITUDE DECIMAL(10,8) NOT NULL,';
    PRINT '    LONGITUDE DECIMAL(11,8) NOT NULL,';
    PRINT '    VELOCIDADE DECIMAL(5,2),';
    PRINT '    PRECISAO INT,';
    PRINT '    BATERIA INT,';
    PRINT '    DHREGISTRO DATETIME NOT NULL DEFAULT GETDATE(),';
    PRINT '    TIPO CHAR(1) DEFAULT ''A'',';
    PRINT '    FONTE VARCHAR(20) DEFAULT ''APP''';
    PRINT ');';
END
GO

