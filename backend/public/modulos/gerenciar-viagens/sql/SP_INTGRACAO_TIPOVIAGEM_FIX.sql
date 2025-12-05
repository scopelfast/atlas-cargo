-- ============================================
-- Correção da Stored Procedure SP_INTGRACAO_TIPOVIAGEM
-- ============================================
-- Problema: Erro de truncamento quando DSTIPOVIAGEM > 40 caracteres
-- Solução: Truncar explicitamente o campo antes de inserir
-- ============================================

/*

USE [DIVULGACARGA_PRD]
GO

SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

ALTER PROCEDURE [dbo].[SP_INTGRACAO_TIPOVIAGEM]
AS
BEGIN
    SET NOCOUNT ON;

    -- Executa o MERGE para inserir novos tipos de viagem
    -- CORREÇÃO: Truncar DSTIPOVIAGEM para 40 caracteres (tamanho do campo na tabela destino)
    MERGE INTO [DIVULGACARGA_PRD].[dbo].[TIPOVIAGEM] AS TARGET
    USING (
        SELECT DISTINCT
            CDTIPOVIAGEM,
            -- Truncar DSTIPOVIAGEM para 40 caracteres (tamanho máximo do campo)
            LEFT(LTRIM(RTRIM(ISNULL(DSTIPOVIAGEM, ''))), 40) AS DSTIPOVIAGEM,
            'A' AS FGACTIVE,
            ISNULL(DHMAINTENANCE, GETDATE()) AS DHMAINTENANCE,
            -- Truncar SGUSER para 50 caracteres (tamanho máximo do campo)
            LEFT(LTRIM(RTRIM(ISNULL(SGUSER, 'SYSTEM'))), 50) AS SGUSER,
            -- Truncar SERVERORIG para 50 caracteres (tamanho máximo do campo)
            LEFT(LTRIM(RTRIM(ISNULL(SERVERORIG, 'AppDVcargas'))), 50) AS SERVERORIG
        FROM [INTEGRA_PRD].[dbo].[TIPOVIAGEM]
        WHERE CDTIPOVIAGEM IS NOT NULL
          AND DSTIPOVIAGEM IS NOT NULL
    ) AS SOURCE
    ON TARGET.CDTIPOVIAGEM = SOURCE.CDTIPOVIAGEM
    WHEN NOT MATCHED BY TARGET THEN
        INSERT (
            CDTIPOVIAGEM,
            DSTIPOVIAGEM,
            FGACTIVE,
            DHMAINTENANCE,
            SGUSER,
            SERVERORIG
        )
        VALUES (
            SOURCE.CDTIPOVIAGEM,
            SOURCE.DSTIPOVIAGEM,
            SOURCE.FGACTIVE,
            SOURCE.DHMAINTENANCE,
            SOURCE.SGUSER,
            SOURCE.SERVERORIG
        );

    PRINT 'Carga de tipos de viagem concluída com sucesso.';
END;
GO

*/