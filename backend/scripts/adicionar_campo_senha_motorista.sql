/*
=============================================================================
Script: Adicionar Campo SENHA na Tabela MOTORISTA_COMPLEMENTO
Descrição: Adiciona campo para armazenar senha hasheada dos motoristas
Data: 2026-01-27
Autor: Atlas Cargo

IMPORTANTE: Este script adiciona o campo SENHA na tabela MOTORISTA_COMPLEMENTO
=============================================================================
*/

USE [ATLAS_CARGO_PRD]
GO

-- Verificar se a coluna já existe
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID('dbo.MOTORISTA_COMPLEMENTO') 
    AND name = 'SENHA'
)
BEGIN
    -- Adicionar coluna SENHA (VARCHAR para armazenar hash bcrypt)
    ALTER TABLE [dbo].[MOTORISTA_COMPLEMENTO]
    ADD SENHA VARCHAR(255) NULL;  -- NULL permite motoristas sem senha ainda
    
    PRINT '✅ Coluna SENHA adicionada com sucesso na tabela MOTORISTA_COMPLEMENTO!';
END
ELSE
BEGIN
    PRINT '⚠️  Coluna SENHA já existe na tabela MOTORISTA_COMPLEMENTO.';
END
GO

-- ========================================
-- Exemplo: Definir senha para um motorista específico
-- ========================================
/*
-- IMPORTANTE: Use o script Node.js para gerar o hash bcrypt da senha
-- O hash bcrypt tem formato: $2a$10$... (60 caracteres)

-- Exemplo de como atualizar a senha de um motorista:
-- 1. Primeiro, gere o hash usando o script: node backend/utils/hash.js
-- 2. Depois, execute o UPDATE abaixo com o hash gerado

UPDATE [dbo].[MOTORISTA_COMPLEMENTO]
SET SENHA = '$2a$10$SEU_HASH_AQUI'  -- Substitua pelo hash gerado
WHERE CDCADASTRO = 35174;  -- Substitua pelo CDCADASTRO do motorista

-- Verificar se foi atualizado:
SELECT 
    cg.CDCADASTRO,
    cg.RZSOCIAL,
    cg.CGCCPF,
    mc.SENHA,
    CASE 
        WHEN mc.SENHA IS NULL THEN 'Sem senha definida'
        WHEN mc.SENHA LIKE '$2%' THEN 'Senha hasheada (bcrypt)'
        ELSE 'Senha em texto puro (migrar!)'
    END AS STATUS_SENHA
FROM [dbo].[CADASTROGERAL] cg
LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
WHERE cg.FGTIPOCADASTRO = 'M'
  AND cg.FGACTIVE = 'A';
*/
GO

PRINT '';
PRINT '=========================================';
PRINT '  ✅ CAMPO SENHA ADICIONADO!';
PRINT '=========================================';
PRINT '';
PRINT 'Próximos passos:';
PRINT '  1. Use o script Node.js para gerar hash: node backend/utils/hash.js';
PRINT '  2. Atualize a senha dos motoristas usando UPDATE';
PRINT '  3. Ative a validação de senha no controller';
PRINT '';

