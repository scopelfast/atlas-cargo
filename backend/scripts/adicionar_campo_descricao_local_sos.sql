-- Script para adicionar campo de descrição/detalhes do local na tabela SOS_ALERTS
-- Data: 2025-01-18
-- IMPORTANTE: Execute este script no banco de dados DIVULGACARGA_PRD

USE [DIVULGACARGA_PRD]
GO

-- Adicionar campo LOCATION_DESCRIPTION (se não existir)
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[SOS_ALERTS]') 
    AND name = 'LOCATION_DESCRIPTION'
)
BEGIN
    ALTER TABLE [dbo].[SOS_ALERTS]
    ADD LOCATION_DESCRIPTION NVARCHAR(500) NULL;
    
    PRINT '✅ Campo LOCATION_DESCRIPTION adicionado à tabela SOS_ALERTS';
END
ELSE
BEGIN
    PRINT 'ℹ️ Campo LOCATION_DESCRIPTION já existe na tabela SOS_ALERTS';
END
GO

PRINT '';
PRINT '========================================';
PRINT '✅ Script concluído!';
PRINT '========================================';
PRINT '';
PRINT '📋 O campo LOCATION_DESCRIPTION permite adicionar uma descrição textual';
PRINT '   do local além das coordenadas GPS (latitude/longitude).';
PRINT '   Exemplo: "Rodovia BR-101, km 245, próximo ao posto de gasolina"';
PRINT '';
