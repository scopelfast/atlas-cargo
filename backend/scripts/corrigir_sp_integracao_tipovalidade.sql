-- ============================================
-- Script para Corrigir SP_INTGRACAO_TIPOVALIDADE
-- ============================================
-- Este script recria a stored procedure SP_INTGRACAO_TIPOVALIDADE
-- para garantir que não há problemas de sintaxe ou variáveis não definidas
-- 
-- Versão testada e funcionando: 15/12/2025
-- ============================================

USE [DIVULGACARGA_PRD]
GO

SET ANSI_NULLS ON
GO

SET QUOTED_IDENTIFIER ON
GO

-- Criar ou alterar a procedure
-- Versão testada e funcionando (15/12/2025)
-- Remove a procedure se existir e cria novamente
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SP_INTGRACAO_TIPOVALIDADE]') AND type in (N'P', N'PC'))
BEGIN
    DROP PROCEDURE [dbo].[SP_INTGRACAO_TIPOVALIDADE];
    PRINT '✅ Procedure SP_INTGRACAO_TIPOVALIDADE existente removida.';
END
GO

-- Criar a procedure
CREATE PROCEDURE [dbo].[SP_INTGRACAO_TIPOVALIDADE]
AS
BEGIN
    SET NOCOUNT ON;
    
    BEGIN TRY
        MERGE DIVULGACARGA_PRD.dbo.TIPOVALIDADE AS dest
        USING (
            SELECT 
                CDTIPOVALIDADE,
                -- Truncar DSTIPOVALIDADE para 40 caracteres (tamanho da coluna)
                LEFT(LTRIM(RTRIM(ISNULL(DSTIPOVALIDADE, ''))), 40) AS DSTIPOVALIDADE,
                -- Garantir que campos char(1) tenham apenas 1 caractere
                LEFT(LTRIM(RTRIM(ISNULL(FGVEICULO, ''))), 1) AS FGVEICULO,
                LEFT(LTRIM(RTRIM(ISNULL(FGMOTORISTA, ''))), 1) AS FGMOTORISTA,
                LEFT(LTRIM(RTRIM(ISNULL(FGTRANSPORTADOR, ''))), 1) AS FGTRANSPORTADOR,
                LEFT(LTRIM(RTRIM(ISNULL(FGCLIENTE, ''))), 1) AS FGCLIENTE,
                LEFT(LTRIM(RTRIM(ISNULL(FGFORNECEDOR, ''))), 1) AS FGFORNECEDOR,
                LEFT(LTRIM(RTRIM(ISNULL(FGEXIGECERTIFICADORA, ''))), 1) AS FGEXIGECERTIFICADORA,
                DHMAINTENANCE,
                -- Truncar SGUSER para 50 caracteres
                LEFT(LTRIM(RTRIM(ISNULL(SGUSER, ''))), 50) AS SGUSER,
                -- Truncar SERVERORIG para 50 caracteres
                LEFT(LTRIM(RTRIM(ISNULL(SERVERORIG, ''))), 50) AS SERVERORIG
            FROM INTEGRA_PRD.dbo.TIPOVALIDADE
        ) AS src
            ON dest.CDTIPOVALIDADE = src.CDTIPOVALIDADE
        WHEN MATCHED THEN
            UPDATE SET
                dest.DSTIPOVALIDADE = src.DSTIPOVALIDADE,
                dest.FGVEICULO = src.FGVEICULO,
                dest.FGMOTORISTA = src.FGMOTORISTA,
                dest.FGTRANSPORTADOR = src.FGTRANSPORTADOR,
                dest.FGCLIENTE = src.FGCLIENTE,
                dest.FGFORNECEDOR = src.FGFORNECEDOR,
                dest.FGEXIGECERTIFICADORA = src.FGEXIGECERTIFICADORA,
                dest.DHMAINTENANCE = src.DHMAINTENANCE,
                dest.SGUSER = src.SGUSER,
                dest.SERVERORIG = src.SERVERORIG
        WHEN NOT MATCHED THEN
            INSERT (
                CDTIPOVALIDADE,
                DSTIPOVALIDADE,
                FGVEICULO,
                FGMOTORISTA,
                FGTRANSPORTADOR,
                FGCLIENTE,
                FGFORNECEDOR,
                FGEXIGECERTIFICADORA,
                DHMAINTENANCE,
                SGUSER,
                SERVERORIG
            )
            VALUES (
                src.CDTIPOVALIDADE,
                src.DSTIPOVALIDADE,
                src.FGVEICULO,
                src.FGMOTORISTA,
                src.FGTRANSPORTADOR,
                src.FGCLIENTE,
                src.FGFORNECEDOR,
                src.FGEXIGECERTIFICADORA,
                src.DHMAINTENANCE,
                src.SGUSER,
                src.SERVERORIG
            );
        
        PRINT '✅ SP_INTGRACAO_TIPOVALIDADE executada com sucesso.';
    END TRY
    BEGIN CATCH
        DECLARE @ErrorMessage NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrorNumber INT = ERROR_NUMBER();
        DECLARE @ErrorSeverity INT = ERROR_SEVERITY();
        DECLARE @ErrorState INT = ERROR_STATE();
        
        -- Usar CONVERT com tamanho explícito para evitar overflow
        PRINT '❌ Erro na SP_INTGRACAO_TIPOVALIDADE:';
        PRINT '   Número: ' + CONVERT(VARCHAR(10), @ErrorNumber);
        PRINT '   Severidade: ' + CONVERT(VARCHAR(10), @ErrorSeverity);
        PRINT '   Estado: ' + CONVERT(VARCHAR(10), @ErrorState);
        PRINT '   Mensagem: ' + @ErrorMessage;
        
        -- Re-lançar o erro para que seja capturado pelo Node.js
        RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
    END CATCH
END;
GO

PRINT '✅ Procedure SP_INTGRACAO_TIPOVALIDADE criada com sucesso!';
GO

