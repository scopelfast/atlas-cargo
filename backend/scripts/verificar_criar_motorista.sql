/*
=============================================================================
Script: Verificar e Criar/Ativar Motorista
Descrição: Verifica se motorista existe e cria/ativa se necessário
Data: 2025-01-27
Autor: Sistema DivulgaCarga
=============================================================================
*/

USE [DIVULGACARGA_PRD]
GO

-- ========================================
-- 1. VERIFICAR MOTORISTA
-- ========================================
DECLARE @CPF VARCHAR(14) = '02100610066';  -- CPF sem formatação
DECLARE @CDCADASTRO DECIMAL(15,0);

-- Buscar motorista
SELECT 
    @CDCADASTRO = CDCADASTRO,
    RZSOCIAL,
    CGCCPF,
    FGTIPOCADASTRO,
    FGACTIVE,
    NRCELULAR,
    ENDEMAIL
FROM [dbo].[CADASTROGERAL]
WHERE CGCCPF = @CPF;

-- Mostrar resultado
IF @CDCADASTRO IS NOT NULL
BEGIN
    PRINT '✅ Motorista encontrado!';
    PRINT 'ID: ' + CAST(@CDCADASTRO AS VARCHAR);
    
    -- Verificar se é motorista
    IF EXISTS (
        SELECT 1 FROM [dbo].[CADASTROGERAL] 
        WHERE CDCADASTRO = @CDCADASTRO 
        AND FGTIPOCADASTRO = 'M'
    )
    BEGIN
        PRINT '✅ Tipo: Motorista (M)';
    END
    ELSE
    BEGIN
        PRINT '⚠️  Tipo: ' + ISNULL((SELECT FGTIPOCADASTRO FROM [dbo].[CADASTROGERAL WHERE CDCADASTRO = @CDCADASTRO), 'NULL');
        PRINT '⚠️  PRECISA CORRIGIR: Atualizar FGTIPOCADASTRO para ''M''';
    END
    
    -- Verificar se está ativo
    IF EXISTS (
        SELECT 1 FROM [dbo].[CADASTROGERAL] 
        WHERE CDCADASTRO = @CDCADASTRO 
        AND FGACTIVE = 'A'
    )
    BEGIN
        PRINT '✅ Status: Ativo (A)';
    END
    ELSE
    BEGIN
        PRINT '⚠️  Status: ' + ISNULL((SELECT FGACTIVE FROM [dbo].[CADASTROGERAL] WHERE CDCADASTRO = @CDCADASTRO), 'NULL');
        PRINT '⚠️  PRECISA CORRIGIR: Atualizar FGACTIVE para ''A''';
    END
    
    -- Verificar se tem registro em MOTORISTA_COMPLEMENTO
    IF EXISTS (
        SELECT 1 FROM [dbo].[MOTORISTA_COMPLEMENTO] 
        WHERE CDCADASTRO = @CDCADASTRO
    )
    BEGIN
        PRINT '✅ Tem registro em MOTORISTA_COMPLEMENTO';
    END
    ELSE
    BEGIN
        PRINT '⚠️  Não tem registro em MOTORISTA_COMPLEMENTO';
        PRINT '⚠️  PRECISA CRIAR: Registro em MOTORISTA_COMPLEMENTO';
    END
END
ELSE
BEGIN
    PRINT '❌ Motorista NÃO encontrado com CPF: ' + @CPF;
    PRINT '';
    PRINT '📋 Para criar o motorista, execute:';
    PRINT '   - Use o sistema web de cadastro';
    PRINT '   - Ou execute o script de criação manual abaixo';
END
GO

-- ========================================
-- 2. CORRIGIR MOTORISTA EXISTENTE
-- ========================================
/*
-- DESCOMENTE E AJUSTE OS VALORES CONFORME NECESSÁRIO

DECLARE @CPF VARCHAR(14) = '02100610066';
DECLARE @CDCADASTRO DECIMAL(15,0);

SELECT @CDCADASTRO = CDCADASTRO
FROM [dbo].[CADASTROGERAL]
WHERE CGCCPF = @CPF;

IF @CDCADASTRO IS NOT NULL
BEGIN
    -- Corrigir tipo para Motorista
    UPDATE [dbo].[CADASTROGERAL]
    SET FGTIPOCADASTRO = 'M',
        FGACTIVE = 'A',
        DHMAINTENANCE = GETDATE()
    WHERE CDCADASTRO = @CDCADASTRO
      AND (FGTIPOCADASTRO != 'M' OR FGACTIVE != 'A');
    
    PRINT '✅ Tipo e status atualizados!';
    
    -- Criar registro em MOTORISTA_COMPLEMENTO se não existir
    IF NOT EXISTS (
        SELECT 1 FROM [dbo].[MOTORISTA_COMPLEMENTO] 
        WHERE CDCADASTRO = @CDCADASTRO
    )
    BEGIN
        INSERT INTO [dbo].[MOTORISTA_COMPLEMENTO] (
            CDCADASTRO,
            STATUSAPROVACAO,
            DHCADASTRO
        )
        VALUES (
            @CDCADASTRO,
            'A',  -- Aprovado
            GETDATE()
        );
        
        PRINT '✅ Registro em MOTORISTA_COMPLEMENTO criado!';
    END
    ELSE
    BEGIN
        PRINT '✅ Registro em MOTORISTA_COMPLEMENTO já existe';
    END
END
ELSE
BEGIN
    PRINT '❌ Motorista não encontrado. Não é possível corrigir.';
END
*/
GO

-- ========================================
-- 3. CRIAR MOTORISTA NOVO (MANUAL)
-- ========================================
/*
-- DESCOMENTE E AJUSTE OS VALORES CONFORME NECESSÁRIO

DECLARE @CPF VARCHAR(14) = '02100610066';
DECLARE @NOME VARCHAR(100) = 'NOME DO MOTORISTA';
DECLARE @CELULAR VARCHAR(20) = '41999999999';
DECLARE @EMAIL VARCHAR(100) = 'motorista@email.com';
DECLARE @CDCIDADE INT = 1;  -- Ajuste para a cidade correta
DECLARE @CDCADASTRO DECIMAL(15,0);

-- Verificar se já existe
IF EXISTS (SELECT 1 FROM [dbo].[CADASTROGERAL] WHERE CGCCPF = @CPF)
BEGIN
    PRINT '⚠️  Já existe cadastro com este CPF!';
    SELECT @CDCADASTRO = CDCADASTRO FROM [dbo].[CADASTROGERAL] WHERE CGCCPF = @CPF;
    PRINT 'ID: ' + CAST(@CDCADASTRO AS VARCHAR);
END
ELSE
BEGIN
    -- Inserir em CADASTROGERAL
    INSERT INTO [dbo].[CADASTROGERAL] (
        CGCCPF,
        RZSOCIAL,
        NRCELULAR,
        ENDEMAIL,
        FGTIPOCADASTRO,
        FGACTIVE,
        CDCIDADE,
        DHCADASTRO
    )
    VALUES (
        @CPF,
        @NOME,
        @CELULAR,
        @EMAIL,
        'M',  -- Motorista
        'A',  -- Ativo
        @CDCIDADE,
        GETDATE()
    );
    
    SET @CDCADASTRO = SCOPE_IDENTITY();
    
    PRINT '✅ Motorista criado! ID: ' + CAST(@CDCADASTRO AS VARCHAR);
    
    -- Criar registro em MOTORISTA_COMPLEMENTO
    INSERT INTO [dbo].[MOTORISTA_COMPLEMENTO] (
        CDCADASTRO,
        STATUSAPROVACAO,
        DHCADASTRO
    )
    VALUES (
        @CDCADASTRO,
        'A',  -- Aprovado
        GETDATE()
    );
    
    PRINT '✅ Registro em MOTORISTA_COMPLEMENTO criado!';
END
*/
GO

PRINT '';
PRINT '=========================================';
PRINT '  ✅ VERIFICAÇÃO CONCLUÍDA!';
PRINT '=========================================';
PRINT '';
PRINT '📋 Próximos passos:';
PRINT '  1. Verifique os resultados acima';
PRINT '  2. Se necessário, descomente e execute a seção 2 (Corrigir)';
PRINT '  3. Se o motorista não existe, descomente e execute a seção 3 (Criar)';
PRINT '  4. Depois, defina uma senha usando:';
PRINT '     node backend/scripts/definir_senha_motorista.js 02100610066 senha123';
PRINT '';

