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
-- Usa CREATE OR ALTER para funcionar tanto se a procedure existir quanto se não existir
-- Alternativa: Se CREATE OR ALTER não funcionar, use ALTER PROCEDURE (se já existe) ou CREATE PROCEDURE (se não existe)
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SP_INTGRACAO_TIPOVALIDADE]') AND type in (N'P', N'PC'))
BEGIN
    -- Procedure existe, usar ALTER
    ALTER PROCEDURE [dbo].[SP_INTGRACAO_TIPOVALIDADE]
END
ELSE
BEGIN
    -- Procedure não existe, usar CREATE
    CREATE PROCEDURE [dbo].[SP_INTGRACAO_TIPOVALIDADE]
END
AS
BEGIN
    SET NOCOUNT ON;
    
    BEGIN TRY
        MERGE DIVULGACARGA_PRD.dbo.TIPOVALIDADE AS dest
        USING INTEGRA_PRD.dbo.TIPOVALIDADE AS src
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
        
        PRINT '❌ Erro na SP_INTGRACAO_TIPOVALIDADE:';
        PRINT '   Número: ' + CAST(@ErrorNumber AS VARCHAR(10));
        PRINT '   Severidade: ' + CAST(@ErrorSeverity AS VARCHAR(10));
        PRINT '   Estado: ' + CAST(@ErrorState AS VARCHAR(10));
        PRINT '   Mensagem: ' + @ErrorMessage;
        
        -- Re-lançar o erro para que seja capturado pelo Node.js
        RAISERROR(@ErrorMessage, @ErrorSeverity, @ErrorState);
    END CATCH
END;
GO

PRINT '✅ Procedure SP_INTGRACAO_TIPOVALIDADE criada com sucesso!';
GO

