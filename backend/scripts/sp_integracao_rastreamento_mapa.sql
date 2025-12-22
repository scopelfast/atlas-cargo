-- ============================================
-- STORED PROCEDURE: SP_INTGRACAO_RASTREAMENTO_MAPA
-- Descrição: Integra a última posição de cada viagem do INTEGRA_PRD para DIVULGACARGA_PRD
-- ============================================

USE [DIVULGACARGA_PRD]
GO

IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SP_INTGRACAO_RASTREAMENTO_MAPA]') AND type in (N'P', N'PC'))
BEGIN
    DROP PROCEDURE [dbo].[SP_INTGRACAO_RASTREAMENTO_MAPA]
    PRINT '✅ Procedure antiga removida'
END
GO

CREATE PROCEDURE [dbo].[SP_INTGRACAO_RASTREAMENTO_MAPA]
AS
BEGIN
    SET NOCOUNT ON;
    
    BEGIN TRY
        -- CTE para pegar a última posição de cada IDVIAGEM
        WITH UltimaPosicao AS (
            SELECT 
                R.IDVIAGEM,
                R.SEQUENCIA,
                R.DSPOSICAO,
                CAST(R.LATITUDE AS DECIMAL(10,8)) AS LATITUDE,
                CAST(R.LONGITUDE AS DECIMAL(11,8)) AS LONGITUDE,
                R.FGORIGEM,
                R.FGSTATUS,
                R.DHMAINTENANCE,
                R.SGUSER,
                R.SERVERORIG,
                R.DHPOSICAO,
                ROW_NUMBER() OVER (
                    PARTITION BY R.IDVIAGEM 
                    ORDER BY R.SEQUENCIA DESC, R.DHPOSICAO DESC
                ) AS rn
            FROM INTEGRA_PRD.dbo.VIAGEMRASTREAMENTO R
            INNER JOIN dbo.VIAGEMMESTRE VM 
                ON R.IDVIAGEM = VM.IDVIAGEM
            WHERE VM.CDSITUACAOVIAGEM > 1 
                AND VM.CDSITUACAOVIAGEM < 14
                AND R.LATITUDE IS NOT NULL
                AND R.LONGITUDE IS NOT NULL
                AND R.DHPOSICAO IS NOT NULL
        )
        -- MERGE para inserir/atualizar sem duplicar
        MERGE dbo.VIAGEMRASTREAMENTO AS dest
        USING (
            SELECT
                u.IDVIAGEM,
                0 AS CDCADASTRO,
                u.LATITUDE,
                u.LONGITUDE,
                NULL AS VELOCIDADE,
                NULL AS PRECISAO,
                NULL AS BATERIA,
                u.DHPOSICAO AS DHREGISTRO,
                NULL AS TIPO,
                NULL AS FONTE,
                NULL AS VERSAOAPP,
                NULL AS ALTITUDE,
                u.FGSTATUS,
                NULL AS DIRECAO,
                NULL AS FGACTIVE,
                ISNULL(u.DHMAINTENANCE, GETDATE()) AS DHMAINTENANCE,
                ISNULL(u.SGUSER, 'INTEGRA_PRD') AS SGUSER,
                ISNULL(u.SERVERORIG, 'INTEGRA_PRD') AS SERVERORIG,
                u.SEQUENCIA,
                u.DSPOSICAO,
                u.FGORIGEM,
                u.DHPOSICAO
            FROM UltimaPosicao u
            WHERE u.rn = 1
        ) AS src
        ON dest.IDVIAGEM = src.IDVIAGEM
           AND dest.SEQUENCIA = src.SEQUENCIA
        WHEN NOT MATCHED THEN
            INSERT (
                IDVIAGEM,
                CDCADASTRO,
                LATITUDE,
                LONGITUDE,
                VELOCIDADE,
                PRECISAO,
                BATERIA,
                DHREGISTRO,
                TIPO,
                FONTE,
                VERSAOAPP,
                ALTITUDE,
                FGSTATUS,
                DIRECAO,
                FGACTIVE,
                DHMAINTENANCE,
                SGUSER,
                SERVERORIG,
                SEQUENCIA,
                DSPOSICAO,
                FGORIGEM,
                DHPOSICAO
            )
            VALUES (
                src.IDVIAGEM,
                src.CDCADASTRO,
                src.LATITUDE,
                src.LONGITUDE,
                src.VELOCIDADE,
                src.PRECISAO,
                src.BATERIA,
                src.DHREGISTRO,
                src.TIPO,
                src.FONTE,
                src.VERSAOAPP,
                src.ALTITUDE,
                src.FGSTATUS,
                src.DIRECAO,
                src.FGACTIVE,
                src.DHMAINTENANCE,
                src.SGUSER,
                src.SERVERORIG,
                src.SEQUENCIA,
                src.DSPOSICAO,
                src.FGORIGEM,
                src.DHPOSICAO
            )
        WHEN MATCHED AND (
            src.DHPOSICAO > dest.DHPOSICAO
            OR (src.DHPOSICAO = dest.DHPOSICAO AND src.DHMAINTENANCE > dest.DHMAINTENANCE)
        ) THEN
            UPDATE SET
                dest.DSPOSICAO = src.DSPOSICAO,
                dest.LATITUDE = src.LATITUDE,
                dest.LONGITUDE = src.LONGITUDE,
                dest.ALTITUDE = src.ALTITUDE,
                dest.VELOCIDADE = src.VELOCIDADE,
                dest.DIRECAO = src.DIRECAO,
                dest.PRECISAO = src.PRECISAO,
                dest.BATERIA = src.BATERIA,
                dest.FGORIGEM = src.FGORIGEM,
                dest.FGSTATUS = src.FGSTATUS,
                dest.DHPOSICAO = src.DHPOSICAO,
                dest.DHREGISTRO = src.DHREGISTRO,
                dest.DHMAINTENANCE = src.DHMAINTENANCE,
                dest.SGUSER = src.SGUSER,
                dest.SERVERORIG = src.SERVERORIG;

        DECLARE @RegistrosProcessados INT = @@ROWCOUNT;
        
        PRINT CONCAT('✅ Integração concluída. ', @RegistrosProcessados, ' registro(s) processado(s).');
        
    END TRY
    BEGIN CATCH
        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrorNumber INT = ERROR_NUMBER();
        
        IF @ErrorNumber = 2627 OR @ErrorNumber = 2601
        BEGIN
            PRINT '⚠️  Alguns registros já existem (erro esperado).';
        END
        ELSE
        BEGIN
            PRINT CONCAT('❌ Erro: ', @ErrorMessage);
            THROW;
        END
    END CATCH
END
GO

PRINT '✅ Stored Procedure SP_INTGRACAO_RASTREAMENTO_MAPA criada com sucesso!'
GO

