-- Script para adicionar campo RESUMOROTA na tabela ROTEIRO
-- Este campo armazenará o resumo da rota (rodovias, estados, cidades) 
-- para evitar processamento toda vez que o mapa é aberto

USE [Atlas Cargo]
GO

-- Verificar se o campo já existe
IF NOT EXISTS (
    SELECT 1 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_NAME = 'ROTEIRO' 
      AND COLUMN_NAME = 'RESUMOROTA'
)
BEGIN
    -- Adicionar campo RESUMOROTA (VARCHAR(MAX) para armazenar texto longo)
    ALTER TABLE [dbo].[ROTEIRO]
    ADD RESUMOROTA VARCHAR(MAX) NULL;
    
    PRINT 'Campo RESUMOROTA adicionado com sucesso na tabela ROTEIRO';
END
ELSE
BEGIN
    PRINT 'Campo RESUMOROTA já existe na tabela ROTEIRO';
END
GO

