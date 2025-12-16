/*
=============================================================================
Script: Verificar Motorista por Código ou CPF
Descrição: Busca motorista pelo código (CDCADASTRO) ou CPF
Data: 2025-01-27
=============================================================================
*/

USE [DIVULGACARGA_PRD]
GO

-- ========================================
-- OPÇÃO 1: Buscar por Código (CDCADASTRO)
-- ========================================
DECLARE @CODIGO DECIMAL(15,0) = 9436;

SELECT 
    cg.CDCADASTRO AS CODIGO,
    cg.RZSOCIAL AS NOME,
    cg.CGCCPF AS CPF,
    cg.NRCELULAR AS CELULAR,
    cg.ENDEMAIL AS EMAIL,
    cg.FGTIPOCADASTRO AS TIPO_CADASTRO,
    CASE cg.FGTIPOCADASTRO
        WHEN 'M' THEN '✅ Motorista'
        WHEN 'T' THEN 'Transportador'
        WHEN 'A' THEN 'Agente'
        ELSE cg.FGTIPOCADASTRO
    END AS TIPO,
    cg.FGACTIVE AS STATUS,
    CASE cg.FGACTIVE
        WHEN 'A' THEN '✅ Ativo'
        WHEN 'I' THEN '❌ Inativo'
        ELSE cg.FGACTIVE
    END AS STATUS_DESC,
    c.NMCIDADE AS CIDADE,
    c.ESTADO,
    mc.STATUSAPROVACAO AS APROVACAO,
    CASE mc.STATUSAPROVACAO
        WHEN 'A' THEN '✅ Aprovado'
        WHEN 'P' THEN '⏳ Pendente'
        WHEN 'R' THEN '❌ Rejeitado'
        ELSE ISNULL(mc.STATUSAPROVACAO, 'Sem registro')
    END AS APROVACAO_DESC,
    CASE 
        WHEN mc.SENHA IS NULL THEN '❌ Sem senha (aceita qualquer senha)'
        WHEN mc.SENHA LIKE '$2%' THEN '✅ Senha hasheada (bcrypt)'
        ELSE '⚠️ Senha em texto puro'
    END AS STATUS_SENHA
FROM [dbo].[CADASTROGERAL] cg
LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
LEFT JOIN [dbo].[CIDADE] c ON cg.CDCIDADE = c.CDCIDADE
WHERE cg.CDCADASTRO = @CODIGO;
GO

-- ========================================
-- OPÇÃO 2: Buscar por CPF (com ou sem zeros à esquerda)
-- ========================================
DECLARE @CPF VARCHAR(14) = '2100610066';  -- CPF sem formatação

-- Tentar com zeros à esquerda
SELECT 
    cg.CDCADASTRO AS CODIGO,
    cg.RZSOCIAL AS NOME,
    cg.CGCCPF AS CPF,
    cg.NRCELULAR AS CELULAR,
    cg.ENDEMAIL AS EMAIL,
    cg.FGTIPOCADASTRO AS TIPO_CADASTRO,
    CASE cg.FGTIPOCADASTRO
        WHEN 'M' THEN '✅ Motorista'
        WHEN 'T' THEN 'Transportador'
        WHEN 'A' THEN 'Agente'
        ELSE cg.FGTIPOCADASTRO
    END AS TIPO,
    cg.FGACTIVE AS STATUS,
    CASE cg.FGACTIVE
        WHEN 'A' THEN '✅ Ativo'
        WHEN 'I' THEN '❌ Inativo'
        ELSE cg.FGACTIVE
    END AS STATUS_DESC,
    c.NMCIDADE AS CIDADE,
    c.ESTADO,
    mc.STATUSAPROVACAO AS APROVACAO,
    CASE mc.STATUSAPROVACAO
        WHEN 'A' THEN '✅ Aprovado'
        WHEN 'P' THEN '⏳ Pendente'
        WHEN 'R' THEN '❌ Rejeitado'
        ELSE ISNULL(mc.STATUSAPROVACAO, 'Sem registro')
    END AS APROVACAO_DESC,
    CASE 
        WHEN mc.SENHA IS NULL THEN '❌ Sem senha (aceita qualquer senha)'
        WHEN mc.SENHA LIKE '$2%' THEN '✅ Senha hasheada (bcrypt)'
        ELSE '⚠️ Senha em texto puro'
    END AS STATUS_SENHA
FROM [dbo].[CADASTROGERAL] cg
LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
LEFT JOIN [dbo].[CIDADE] c ON cg.CDCIDADE = c.CDCIDADE
WHERE cg.CGCCPF = @CPF
   OR cg.CGCCPF = RIGHT('00000000000' + @CPF, 11)  -- Com zeros à esquerda
   OR cg.CGCCPF = LTRIM(STR(CAST(@CPF AS BIGINT), 11));  -- Com zeros à esquerda (numérico)
GO

-- ========================================
-- OPÇÃO 3: Buscar por Nome (parcial)
-- ========================================
DECLARE @NOME VARCHAR(100) = 'Mauricio%';

SELECT 
    cg.CDCADASTRO AS CODIGO,
    cg.RZSOCIAL AS NOME,
    cg.CGCCPF AS CPF,
    cg.NRCELULAR AS CELULAR,
    cg.ENDEMAIL AS EMAIL,
    cg.FGTIPOCADASTRO AS TIPO_CADASTRO,
    cg.FGACTIVE AS STATUS,
    c.NMCIDADE AS CIDADE,
    c.ESTADO
FROM [dbo].[CADASTROGERAL] cg
LEFT JOIN [dbo].[CIDADE] c ON cg.CDCIDADE = c.CDCIDADE
WHERE cg.RZSOCIAL LIKE @NOME
ORDER BY cg.RZSOCIAL;
GO

PRINT '';
PRINT '=========================================';
PRINT '  ✅ CONSULTA CONCLUÍDA!';
PRINT '=========================================';
PRINT '';
PRINT '📋 Para acessar o sistema:';
PRINT '   1. Se o motorista estiver ativo e aprovado, pode fazer login';
PRINT '   2. Use o CPF como usuário';
PRINT '   3. Se não tiver senha, use qualquer senha';
PRINT '   4. URL: http://localhost:3000/motorista/';
PRINT '';

