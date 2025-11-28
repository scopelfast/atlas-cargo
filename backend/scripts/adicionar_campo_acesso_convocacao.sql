-- Script para adicionar campo DHACESSO à tabela CONVOCACAO
-- Database: DIVULGACARGA_PRD
-- Data: 2025-11-21

USE [DIVULGACARGA_PRD];
GO

-- Adicionar coluna DHACESSO (Data/Hora do primeiro acesso do motorista ao link)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE Name = N'DHACESSO' AND Object_ID = Object_ID(N'dbo.CONVOCACAO'))
BEGIN
    ALTER TABLE [dbo].[CONVOCACAO]
    ADD DHACESSO DATETIME NULL;
    PRINT 'Coluna DHACESSO adicionada à tabela CONVOCACAO.';
END
ELSE
BEGIN
    PRINT 'Coluna DHACESSO já existe na tabela CONVOCACAO.';
END
GO

PRINT 'Script de adição da coluna DHACESSO à tabela CONVOCACAO executado com sucesso!';
GO
