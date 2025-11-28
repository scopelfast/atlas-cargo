-- Script para adicionar campos de geolocalização à tabela CONVOCACAO
-- Database: DIVULGACARGA_PRD
-- Data: 2025-11-23
-- Descrição: Adiciona campos LATITUDE e LONGITUDE para rastrear a localização do motorista
--            quando ele acessa, aceita ou rejeita uma convocação

USE [DIVULGACARGA_PRD];
GO

-- Adicionar coluna LATITUDE (localização do motorista ao acessar/responder)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE Name = N'LATITUDE' AND Object_ID = Object_ID(N'dbo.CONVOCACAO'))
BEGIN
    ALTER TABLE [dbo].[CONVOCACAO]
    ADD LATITUDE FLOAT NULL;
    PRINT 'Coluna LATITUDE adicionada à tabela CONVOCACAO.';
END
ELSE
BEGIN
    PRINT 'Coluna LATITUDE já existe na tabela CONVOCACAO.';
END
GO

-- Adicionar coluna LONGITUDE (localização do motorista ao acessar/responder)
IF NOT EXISTS (SELECT * FROM sys.columns WHERE Name = N'LONGITUDE' AND Object_ID = Object_ID(N'dbo.CONVOCACAO'))
BEGIN
    ALTER TABLE [dbo].[CONVOCACAO]
    ADD LONGITUDE FLOAT NULL;
    PRINT 'Coluna LONGITUDE adicionada à tabela CONVOCACAO.';
END
ELSE
BEGIN
    PRINT 'Coluna LONGITUDE já existe na tabela CONVOCACAO.';
END
GO

PRINT 'Script de adição das colunas de geolocalização à tabela CONVOCACAO executado com sucesso!';
GO

