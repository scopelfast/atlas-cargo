/*
=============================================================================
Script: Criar MOTORISTA_COMPLEMENTO para Mauricio Ferreira Peixoto
Código: 9436 | CPF: 2100610066
Data: 2025-01-27
=============================================================================
*/

USE [DIVULGACARGA_PRD]
GO

-- Verificar se já existe
IF EXISTS (
    SELECT 1 FROM [dbo].[MOTORISTA_COMPLEMENTO] 
    WHERE CDCADASTRO = 9436
)
BEGIN
    PRINT '✅ Registro em MOTORISTA_COMPLEMENTO já existe para o código 9436';
    
    -- Verificar status
    SELECT 
        CDCADASTRO,
        STATUSAPROVACAO,
        CASE STATUSAPROVACAO
            WHEN 'A' THEN '✅ Aprovado'
            WHEN 'P' THEN '⏳ Pendente'
            WHEN 'R' THEN '❌ Rejeitado'
            ELSE '❓ Desconhecido'
        END AS STATUS
    FROM [dbo].[MOTORISTA_COMPLEMENTO]
    WHERE CDCADASTRO = 9436;
END
ELSE
BEGIN
    -- Criar registro
    INSERT INTO [dbo].[MOTORISTA_COMPLEMENTO] (
        CDCADASTRO,
        STATUSAPROVACAO,
        DHCADASTRO
    )
    VALUES (
        9436,  -- Código do motorista
        'A',   -- Aprovado
        GETDATE()
    );
    
    PRINT '✅ Registro em MOTORISTA_COMPLEMENTO criado com sucesso!';
    PRINT '   Código: 9436';
    PRINT '   Status: Aprovado (A)';
END
GO

-- Verificar dados completos do motorista
SELECT 
    cg.CDCADASTRO AS CODIGO,
    cg.RZSOCIAL AS NOME,
    cg.CGCCPF AS CPF,
    cg.FGTIPOCADASTRO AS TIPO,
    cg.FGACTIVE AS STATUS,
    mc.STATUSAPROVACAO AS APROVACAO,
    CASE 
        WHEN mc.SENHA IS NULL THEN '❌ Sem senha (aceita qualquer senha)'
        WHEN mc.SENHA LIKE '$2%' THEN '✅ Senha hasheada (bcrypt)'
        ELSE '⚠️ Senha em texto puro'
    END AS STATUS_SENHA
FROM [dbo].[CADASTROGERAL] cg
LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
WHERE cg.CDCADASTRO = 9436;
GO

PRINT '';
PRINT '=========================================';
PRINT '  ✅ PROCESSO CONCLUÍDO!';
PRINT '=========================================';
PRINT '';
PRINT '📋 Para acessar o sistema:';
PRINT '   1. URL: http://localhost:3000/motorista/';
PRINT '   2. CPF: 2100610066 (ou 02100610066)';
PRINT '   3. Senha: Qualquer senha (ex: 123456)';
PRINT '';

