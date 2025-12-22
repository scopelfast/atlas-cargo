-- Script para Corrigir Tipo de Cadastro de Transportador para Motorista
-- Use este script quando o motorista estiver cadastrado como "Transportador" mas precisa fazer login como "Motorista"

-- ==========================================
-- INSTRUÇÕES:
-- ==========================================
-- 1. Substitua '2570426954' pelo CPF do motorista
-- 2. Execute o script
-- 3. Verifique se o motorista consegue fazer login

DECLARE @CPF VARCHAR(14) = '2570426954'; -- ⚠️ ALTERE AQUI (com ou sem formatação)
DECLARE @CPF_LIMPO VARCHAR(14) = REPLACE(REPLACE(REPLACE(@CPF, '.', ''), '-', ''), ' ', '');
DECLARE @CPF_COM_ZERO VARCHAR(14);
DECLARE @CPF_SEM_ZERO VARCHAR(14);
DECLARE @CDCADASTRO INT;

-- Normalizar CPF
IF LEN(@CPF_LIMPO) = 10
    SET @CPF_COM_ZERO = '0' + @CPF_LIMPO;
ELSE IF LEN(@CPF_LIMPO) = 11
    SET @CPF_COM_ZERO = @CPF_LIMPO;
ELSE
BEGIN
    PRINT '❌ ERRO: CPF deve ter 10 ou 11 dígitos';
    RETURN;
END

SET @CPF_SEM_ZERO = CASE 
    WHEN @CPF_COM_ZERO LIKE '0%' THEN SUBSTRING(@CPF_COM_ZERO, 2, LEN(@CPF_COM_ZERO))
    ELSE @CPF_COM_ZERO
END;

PRINT '==========================================';
PRINT '🔧 CORRIGINDO TIPO DE CADASTRO';
PRINT '==========================================';
PRINT '';
PRINT 'CPF: ' + @CPF_BUSCA;
PRINT 'CPF com zero: ' + @CPF_COM_ZERO;
PRINT 'CPF sem zero: ' + @CPF_SEM_ZERO;
PRINT '';

-- Buscar o código do cadastro
SELECT @CDCADASTRO = CDCADASTRO
FROM [dbo].[CADASTROGERAL]
WHERE CGCCPF = @CPF_COM_ZERO OR CGCCPF = @CPF_SEM_ZERO;

IF @CDCADASTRO IS NULL
BEGIN
    PRINT '❌ ERRO: Cadastro não encontrado!';
    PRINT 'Verifique o CPF informado.';
    RETURN;
END

PRINT '✅ Cadastro encontrado: ' + CAST(@CDCADASTRO AS VARCHAR);
PRINT '';

-- Verificar tipo atual
DECLARE @TIPO_ATUAL VARCHAR(1);
SELECT @TIPO_ATUAL = FGTIPOCADASTRO
FROM [dbo].[CADASTROGERAL]
WHERE CDCADASTRO = @CDCADASTRO;

PRINT 'Tipo atual: ' + ISNULL(@TIPO_ATUAL, 'NULL');
PRINT '';

IF @TIPO_ATUAL = 'M'
BEGIN
    PRINT '✅ Tipo de cadastro já está como "M" (Motorista)';
    PRINT 'Não é necessário alterar.';
    RETURN;
END

-- Atualizar tipo de cadastro para Motorista
BEGIN TRANSACTION;

BEGIN TRY
    UPDATE [dbo].[CADASTROGERAL]
    SET FGTIPOCADASTRO = 'M'
    WHERE CDCADASTRO = @CDCADASTRO;
    
    PRINT '✅ Tipo de cadastro alterado para "M" (Motorista)';
    PRINT '';
    
    -- Verificar se existe registro em MOTORISTA_COMPLEMENTO
    DECLARE @TEM_COMPLEMENTO BIT;
    SELECT @TEM_COMPLEMENTO = CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END
    FROM [dbo].[MOTORISTA_COMPLEMENTO]
    WHERE CDCADASTRO = @CDCADASTRO;
    
    IF @TEM_COMPLEMENTO = 0
    BEGIN
        PRINT '⚠️ AVISO: Não existe registro em MOTORISTA_COMPLEMENTO';
        PRINT 'Criando registro básico...';
        PRINT '';
        
        -- Criar registro básico em MOTORISTA_COMPLEMENTO
        INSERT INTO [dbo].[MOTORISTA_COMPLEMENTO] (
            CDCADASTRO,
            STATUSAPROVACAO,
            DH_CRIACAO
        )
        VALUES (
            @CDCADASTRO,
            'A', -- Aprovado por padrão
            GETDATE()
        );
        
        PRINT '✅ Registro criado em MOTORISTA_COMPLEMENTO';
        PRINT '   STATUSAPROVACAO = A (Aprovado)';
        PRINT '';
    END
    ELSE
    BEGIN
        PRINT '✅ Registro já existe em MOTORISTA_COMPLEMENTO';
        PRINT '';
        
        -- Garantir que está aprovado
        UPDATE [dbo].[MOTORISTA_COMPLEMENTO]
        SET STATUSAPROVACAO = 'A'
        WHERE CDCADASTRO = @CDCADASTRO
          AND (STATUSAPROVACAO IS NULL OR STATUSAPROVACAO != 'A');
        
        IF @@ROWCOUNT > 0
        BEGIN
            PRINT '✅ STATUSAPROVACAO atualizado para "A" (Aprovado)';
        END
    END
    
    COMMIT TRANSACTION;
    
    PRINT '==========================================';
    PRINT '✅ CORREÇÃO CONCLUÍDA COM SUCESSO!';
    PRINT '==========================================';
    PRINT '';
    PRINT 'O motorista agora pode fazer login!';
    PRINT '';
    PRINT 'Verificações finais:';
    PRINT '  - Tipo Cadastro: M (Motorista) ✅';
    PRINT '  - Status Ativo: A (Ativo) ✅';
    PRINT '  - Status Aprovação: A (Aprovado) ✅';
    PRINT '';
    
END TRY
BEGIN CATCH
    ROLLBACK TRANSACTION;
    PRINT '❌ ERRO ao corrigir:';
    PRINT ERROR_MESSAGE();
    PRINT '';
    PRINT 'Nenhuma alteração foi feita.';
END CATCH

-- Mostrar dados finais
PRINT '';
PRINT '==========================================';
PRINT '📋 DADOS FINAIS DO CADASTRO';
PRINT '==========================================';
PRINT '';

SELECT 
    cg.CDCADASTRO AS 'ID',
    cg.CGCCPF AS 'CPF',
    cg.RZSOCIAL AS 'Nome',
    cg.FGTIPOCADASTRO AS 'Tipo Cadastro',
    cg.FGACTIVE AS 'Status Ativo',
    mc.STATUSAPROVACAO AS 'Status Aprovação',
    CASE 
        WHEN mc.SENHA IS NULL THEN '⚠️ SEM SENHA (aceita qualquer senha)'
        ELSE '✅ COM SENHA'
    END AS 'Senha'
FROM [dbo].[CADASTROGERAL] cg
LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
WHERE cg.CDCADASTRO = @CDCADASTRO;

PRINT '';
PRINT '==========================================';
PRINT '';
