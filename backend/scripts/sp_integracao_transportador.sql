-- ============================================
-- Stored Procedure: sp_integracao_transportador
-- ============================================
-- Descrição: Sincroniza dados de transportadores (Tipo T) do INTEGRA_PRD para ATLAS_CARGO_PRD
-- 
-- Lógica:
-- 1. Identifica transportadores ativos (com viagens nos últimos 7 dias)
-- 2. Identifica transportadores rastreados (com equipamentos rastreados nos últimos 90 dias)
-- 3. Sincroniza dados do CADASTROGERAL com tipo 'T' (Transportador)
-- 4. Atualiza flag FGRASTREADO baseado em equipamentos rastreados
--
-- Autor: Atlas Cargo
-- Data: 2026-11-25
-- ============================================

USE [ATLAS_CARGO_PRD];
GO

-- Remover procedure se já existir
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[sp_integracao_transportador]') AND type in (N'P', N'PC'))
    DROP PROCEDURE [dbo].[sp_integracao_transportador];
GO

CREATE PROCEDURE [dbo].[sp_integracao_transportador]
AS
BEGIN
    SET NOCOUNT ON;
    
    BEGIN TRY
        BEGIN TRANSACTION;
        
        -- ============================================
        -- Passo 1: Criar tabela temporária com os dados da fonte
        -- ============================================
        
        IF OBJECT_ID('tempdb..#SourceData') IS NOT NULL
            DROP TABLE #SourceData;
        
        WITH TransportadoresAtivos AS (
            -- Transportadores que têm viagens ativas nos últimos 7 dias
            SELECT DISTINCT M.CDTRANSPORTADOR
            FROM [INTEGRA_PRD].[dbo].[VIAGEMMESTRE] VM
            INNER JOIN [INTEGRA_PRD].[dbo].[VIAGEMMOTORISTA] MV ON VM.IDVIAGEM = MV.IDVIAGEM
            INNER JOIN [INTEGRA_PRD].[dbo].[MOTORISTA] M        ON MV.CDMOTORISTA = M.CDMOTORISTA
            WHERE VM.CDSITUACAOVIAGEM = 1
              AND VM.DHINCLUSAO > DATEADD(DAY, -7, GETDATE())
              AND M.CDTRANSPORTADOR IS NOT NULL
        ),
        TransportadoresRastreados AS (
            -- Transportadores que têm equipamentos rastreados nos últimos 90 dias
            SELECT DISTINCT M.CDTRANSPORTADOR
            FROM [INTEGRA_PRD].[dbo].[VIAGEMMESTRE] VM
            INNER JOIN [INTEGRA_PRD].[dbo].[VIAGEMMOTORISTA] MV         ON VM.IDVIAGEM = MV.IDVIAGEM
            INNER JOIN [INTEGRA_PRD].[dbo].[MOTORISTA] M                ON MV.CDMOTORISTA = M.CDMOTORISTA
            INNER JOIN [INTEGRA_PRD].[dbo].[VIAGEMVEICULO] VV           ON VM.IDVIAGEM = VV.IDVIAGEM
            INNER JOIN [INTEGRA_PRD].[dbo].[EQUIPAMENTORASTREAMENTO] ER ON VV.IDEQUIPAMENTO = ER.IDEQUIPAMENTO
            WHERE M.CDTRANSPORTADOR IN (SELECT CDTRANSPORTADOR FROM TransportadoresAtivos)
              AND ER.SGUSER = 'RASTER'
              AND ER.DHEVENTO >= CAST(DATEADD(DAY, -90, GETDATE()) AS DATE)
              AND VM.DHINCLUSAO > DATEADD(DAY, -7, GETDATE())
              AND M.CDTRANSPORTADOR IS NOT NULL
        )
        SELECT 
            C.CDCADASTRO,
            C.CGCCPF,
            C.RZSOCIAL,
            C.NMFANTASIA,
            C.FGFISICAJURIDICA,
            C.CEP,
            C.CDCIDADE,
            C.ENDERECO,
            C.NRENDERECO,
            C.COMPLEND,
            C.BAIRRO,
            C.NRCELULAR,
            C.ENDEMAIL,
            C.LATITUDE,
            C.LONGITUDE,
            ISNULL(C.FGACTIVE, 'A') AS FGACTIVE,
            'T' AS FGTIPOCADASTRO,
            ISNULL(C.DHMAINTENANCE, GETDATE()) AS DHMAINTENANCE,
            ISNULL(C.SGUSER, 'SYSTEM') AS SGUSER,
            ISNULL(C.SERVERORIG, 'AppDVcargas') AS SERVERORIG,
            CAST(NULL AS INT) AS CDTRANSPORTADOR,
            CASE 
                WHEN TR.CDTRANSPORTADOR IS NOT NULL THEN 'S'
                ELSE 'N'
            END AS FGRASTREADO
        INTO #SourceData
        FROM [INTEGRA_PRD].[dbo].[CADASTROGERAL] C
        INNER JOIN TransportadoresAtivos TA     ON C.CDCADASTRO = TA.CDTRANSPORTADOR
        LEFT JOIN TransportadoresRastreados TR  ON C.CDCADASTRO = TR.CDTRANSPORTADOR
        WHERE C.CDCADASTRO IS NOT NULL
          AND C.RZSOCIAL IS NOT NULL;
        
        -- ============================================
        -- Passo 2: MERGE na tabela do banco ATLAS_CARGO_PRD
        -- ============================================
        
        MERGE INTO [dbo].[CADASTROGERAL] AS TARGET
        USING #SourceData AS SOURCE
            ON TARGET.CDCADASTRO = SOURCE.CDCADASTRO
        WHEN MATCHED THEN
            UPDATE SET
                CGCCPF           = SOURCE.CGCCPF,
                RZSOCIAL         = SOURCE.RZSOCIAL,
                NMFANTASIA       = SOURCE.NMFANTASIA,
                FGFISICAJURIDICA = SOURCE.FGFISICAJURIDICA,
                CEP              = SOURCE.CEP,
                CDCIDADE         = SOURCE.CDCIDADE,
                ENDERECO         = SOURCE.ENDERECO,
                NRENDERECO       = SOURCE.NRENDERECO,
                COMPLEND         = SOURCE.COMPLEND,
                BAIRRO           = SOURCE.BAIRRO,
                NRCELULAR        = SOURCE.NRCELULAR,
                ENDEMAIL         = SOURCE.ENDEMAIL,
                LATITUDE         = SOURCE.LATITUDE,
                LONGITUDE        = SOURCE.LONGITUDE,
                FGACTIVE         = SOURCE.FGACTIVE,
                FGTIPOCADASTRO   = SOURCE.FGTIPOCADASTRO,
                DHMAINTENANCE    = SOURCE.DHMAINTENANCE,
                SGUSER           = SOURCE.SGUSER,
                SERVERORIG       = SOURCE.SERVERORIG,
                CDTRANSPORTADOR  = SOURCE.CDTRANSPORTADOR,
                FGRASTREADO      = SOURCE.FGRASTREADO
        WHEN NOT MATCHED BY TARGET THEN
            INSERT (
                CDCADASTRO, CGCCPF, RZSOCIAL, NMFANTASIA, FGFISICAJURIDICA, CEP, CDCIDADE,
                ENDERECO, NRENDERECO, COMPLEND, BAIRRO, NRCELULAR, ENDEMAIL, LATITUDE,
                LONGITUDE, FGACTIVE, FGTIPOCADASTRO, DHMAINTENANCE, SGUSER, SERVERORIG,
                CDTRANSPORTADOR, FGRASTREADO
            )
            VALUES (
                SOURCE.CDCADASTRO, SOURCE.CGCCPF, SOURCE.RZSOCIAL, SOURCE.NMFANTASIA,
                SOURCE.FGFISICAJURIDICA, SOURCE.CEP, SOURCE.CDCIDADE, SOURCE.ENDERECO,
                SOURCE.NRENDERECO, SOURCE.COMPLEND, SOURCE.BAIRRO, SOURCE.NRCELULAR,
                SOURCE.ENDEMAIL, SOURCE.LATITUDE, SOURCE.LONGITUDE, SOURCE.FGACTIVE,
                SOURCE.FGTIPOCADASTRO, SOURCE.DHMAINTENANCE, SOURCE.SGUSER, SOURCE.SERVERORIG,
                SOURCE.CDTRANSPORTADOR, SOURCE.FGRASTREADO
            );
        
        -- Limpeza da tabela temporária
        DROP TABLE #SourceData;
        
        COMMIT TRANSACTION;
        
        SELECT 
            'SUCCESS' AS Status,
            'Transportadores sincronizados com sucesso!' AS Mensagem,
            @@ROWCOUNT AS RegistrosAfetados;
            
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0
            ROLLBACK TRANSACTION;
        
        -- Limpeza em caso de erro
        IF OBJECT_ID('tempdb..#SourceData') IS NOT NULL
            DROP TABLE #SourceData;
        
        SELECT 
            'ERROR' AS Status,
            ERROR_MESSAGE() AS Mensagem,
            ERROR_NUMBER() AS NumeroErro,
            ERROR_LINE() AS LinhaErro;
    END CATCH
END;
GO

PRINT 'Stored Procedure sp_integracao_transportador criada com sucesso!';
GO

