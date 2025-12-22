-- Script de Diagnóstico: Login do Motorista
-- Este script ajuda a identificar problemas no login do motorista
-- Use este script para verificar se o motorista existe e está configurado corretamente

-- ==========================================
-- INSTRUÇÕES:
-- ==========================================
-- 1. Substitua 'SEU_CPF_AQUI' pelo CPF do motorista (com ou sem formatação)
-- 2. Execute o script
-- 3. Verifique os resultados abaixo

DECLARE @CPF_BUSCA VARCHAR(14) = 'SEU_CPF_AQUI'; -- ⚠️ ALTERE AQUI
DECLARE @CPF_LIMPO VARCHAR(14) = REPLACE(REPLACE(REPLACE(@CPF_BUSCA, '.', ''), '-', ''), ' ', '');
DECLARE @CPF_COM_ZERO VARCHAR(14);
DECLARE @CPF_SEM_ZERO VARCHAR(14);

-- Normalizar CPF
IF LEN(@CPF_LIMPO) = 10
    SET @CPF_COM_ZERO = '0' + @CPF_LIMPO;
ELSE IF LEN(@CPF_LIMPO) = 11
    SET @CPF_COM_ZERO = @CPF_LIMPO;
ELSE
BEGIN
    PRINT '❌ ERRO: CPF deve ter 10 ou 11 dígitos';
    PRINT 'CPF informado: ' + @CPF_BUSCA;
    PRINT 'CPF limpo: ' + @CPF_LIMPO;
    PRINT 'Tamanho: ' + CAST(LEN(@CPF_LIMPO) AS VARCHAR);
    RETURN;
END

SET @CPF_SEM_ZERO = CASE 
    WHEN @CPF_COM_ZERO LIKE '0%' THEN SUBSTRING(@CPF_COM_ZERO, 2, LEN(@CPF_COM_ZERO))
    ELSE @CPF_COM_ZERO
END;

PRINT '==========================================';
PRINT '🔍 DIAGNÓSTICO DE LOGIN DO MOTORISTA';
PRINT '==========================================';
PRINT '';
PRINT 'CPF informado: ' + @CPF_BUSCA;
PRINT 'CPF limpo: ' + @CPF_LIMPO;
PRINT 'CPF com zero: ' + @CPF_COM_ZERO;
PRINT 'CPF sem zero: ' + @CPF_SEM_ZERO;
PRINT '';

-- ==========================================
-- 1. VERIFICAR SE O MOTORISTA EXISTE
-- ==========================================
PRINT '1️⃣ VERIFICANDO SE O MOTORISTA EXISTE...';
PRINT '';

SELECT 
    cg.CDCADASTRO AS 'ID',
    cg.CGCCPF AS 'CPF',
    cg.RZSOCIAL AS 'Nome',
    cg.FGTIPOCADASTRO AS 'Tipo Cadastro',
    cg.FGACTIVE AS 'Status Ativo',
    CASE 
        WHEN cg.FGACTIVE = 'A' THEN '✅ ATIVO'
        WHEN cg.FGACTIVE = 'I' THEN '❌ INATIVO'
        ELSE '❓ DESCONHECIDO'
    END AS 'Status',
    mc.STATUSAPROVACAO AS 'Aprovação',
    CASE 
        WHEN mc.STATUSAPROVACAO = 'A' THEN '✅ APROVADO'
        WHEN mc.STATUSAPROVACAO = 'P' THEN '⏳ PENDENTE'
        WHEN mc.STATUSAPROVACAO = 'R' THEN '❌ REJEITADO'
        WHEN mc.STATUSAPROVACAO IS NULL THEN '⚠️ SEM STATUS'
        ELSE '❓ DESCONHECIDO'
    END AS 'Status Aprovação',
    CASE 
        WHEN mc.SENHA IS NULL THEN '⚠️ SEM SENHA (aceita qualquer senha)'
        WHEN mc.SENHA = '' THEN '⚠️ SENHA VAZIA (aceita qualquer senha)'
        ELSE '✅ SENHA DEFINIDA'
    END AS 'Senha',
    mc.NRCNH AS 'CNH',
    mc.CATEGORIACNH AS 'Categoria CNH'
FROM [dbo].[CADASTROGERAL] cg
LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
WHERE (cg.CGCCPF = @CPF_COM_ZERO OR cg.CGCCPF = @CPF_SEM_ZERO);

DECLARE @MOTORISTA_ENCONTRADO INT;
SELECT @MOTORISTA_ENCONTRADO = COUNT(*)
FROM [dbo].[CADASTROGERAL] cg
WHERE (cg.CGCCPF = @CPF_COM_ZERO OR cg.CGCCPF = @CPF_SEM_ZERO);

IF @MOTORISTA_ENCONTRADO = 0
BEGIN
    PRINT '';
    PRINT '❌ PROBLEMA ENCONTRADO: Motorista NÃO encontrado no banco de dados!';
    PRINT '';
    PRINT 'Possíveis causas:';
    PRINT '  1. CPF digitado incorretamente';
    PRINT '  2. Motorista não está cadastrado no sistema';
    PRINT '  3. CPF está em formato diferente no banco';
    PRINT '';
    PRINT '💡 SOLUÇÃO: Verifique o CPF ou cadastre o motorista primeiro.';
    RETURN;
END

PRINT '';
PRINT '✅ Motorista encontrado!';
PRINT '';

-- ==========================================
-- 2. VERIFICAR CONDIÇÕES PARA LOGIN
-- ==========================================
PRINT '2️⃣ VERIFICANDO CONDIÇÕES PARA LOGIN...';
PRINT '';

DECLARE @FGACTIVE VARCHAR(1);
DECLARE @FGTIPOCADASTRO VARCHAR(1);
DECLARE @STATUSAPROVACAO VARCHAR(1);
DECLARE @TEM_SENHA BIT;

SELECT 
    @FGACTIVE = cg.FGACTIVE,
    @FGTIPOCADASTRO = cg.FGTIPOCADASTRO,
    @STATUSAPROVACAO = mc.STATUSAPROVACAO,
    @TEM_SENHA = CASE WHEN mc.SENHA IS NULL OR mc.SENHA = '' THEN 0 ELSE 1 END
FROM [dbo].[CADASTROGERAL] cg
LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
WHERE (cg.CGCCPF = @CPF_COM_ZERO OR cg.CGCCPF = @CPF_SEM_ZERO);

-- Verificar Tipo de Cadastro
IF @FGTIPOCADASTRO != 'M'
BEGIN
    PRINT '❌ PROBLEMA: Tipo de cadastro não é "M" (Motorista)';
    PRINT '   Tipo atual: ' + ISNULL(@FGTIPOCADASTRO, 'NULL');
    PRINT '   Tipo necessário: M';
    PRINT '';
END
ELSE
BEGIN
    PRINT '✅ Tipo de cadastro: M (Motorista)';
END

-- Verificar Status Ativo
IF @FGACTIVE != 'A'
BEGIN
    PRINT '❌ PROBLEMA: Motorista está INATIVO';
    PRINT '   Status atual: ' + ISNULL(@FGACTIVE, 'NULL');
    PRINT '   Status necessário: A (Ativo)';
    PRINT '';
    PRINT '💡 SOLUÇÃO: Ative o motorista no cadastro.';
    PRINT '   UPDATE CADASTROGERAL SET FGACTIVE = ''A'' WHERE CGCCPF IN (@CPF_COM_ZERO, @CPF_SEM_ZERO);';
    PRINT '';
END
ELSE
BEGIN
    PRINT '✅ Status: Ativo (A)';
END

-- Verificar Aprovação
IF @STATUSAPROVACAO IS NULL
BEGIN
    PRINT '⚠️ AVISO: Status de aprovação é NULL';
    PRINT '   O sistema pode aceitar ou rejeitar o login dependendo da implementação.';
    PRINT '';
END
ELSE IF @STATUSAPROVACAO = 'R'
BEGIN
    PRINT '❌ PROBLEMA: Cadastro foi REJEITADO';
    PRINT '   O motorista não pode fazer login.';
    PRINT '';
    PRINT '💡 SOLUÇÃO: Aprove o cadastro do motorista.';
    PRINT '   UPDATE MOTORISTA_COMPLEMENTO SET STATUSAPROVACAO = ''A'' WHERE CDCADASTRO = (SELECT CDCADASTRO FROM CADASTROGERAL WHERE CGCCPF IN (@CPF_COM_ZERO, @CPF_SEM_ZERO));';
    PRINT '';
END
ELSE IF @STATUSAPROVACAO = 'P'
BEGIN
    PRINT '❌ PROBLEMA: Cadastro está PENDENTE de aprovação';
    PRINT '   O motorista não pode fazer login até ser aprovado.';
    PRINT '';
    PRINT '💡 SOLUÇÃO: Aprove o cadastro do motorista.';
    PRINT '   UPDATE MOTORISTA_COMPLEMENTO SET STATUSAPROVACAO = ''A'' WHERE CDCADASTRO = (SELECT CDCADASTRO FROM CADASTROGERAL WHERE CGCCPF IN (@CPF_COM_ZERO, @CPF_SEM_ZERO));';
    PRINT '';
END
ELSE IF @STATUSAPROVACAO = 'A'
BEGIN
    PRINT '✅ Status de aprovação: Aprovado (A)';
END

-- Verificar Senha
IF @TEM_SENHA = 0
BEGIN
    PRINT '⚠️ AVISO: Motorista não tem senha definida';
    PRINT '   O sistema aceitará qualquer senha (modo desenvolvimento).';
    PRINT '';
    PRINT '💡 RECOMENDAÇÃO: Defina uma senha para o motorista.';
    PRINT '   Use o script: definir_senha_motorista.js';
    PRINT '';
END
ELSE
BEGIN
    PRINT '✅ Senha: Definida';
    PRINT '   Se o login falhar, a senha pode estar incorreta.';
    PRINT '';
END

-- ==========================================
-- 3. RESUMO E RECOMENDAÇÕES
-- ==========================================
PRINT '';
PRINT '==========================================';
PRINT '📋 RESUMO';
PRINT '==========================================';
PRINT '';

IF @FGTIPOCADASTRO = 'M' AND @FGACTIVE = 'A' AND (@STATUSAPROVACAO = 'A' OR @STATUSAPROVACAO IS NULL)
BEGIN
    PRINT '✅ Motorista está configurado corretamente para fazer login!';
    PRINT '';
    PRINT 'Se ainda assim o login falhar, verifique:';
    PRINT '  1. A senha está correta (se tiver senha definida)';
    PRINT '  2. O servidor está rodando (http://localhost:3000)';
    PRINT '  3. O JWT_SECRET está configurado no arquivo .env';
    PRINT '  4. Verifique os logs do servidor para mais detalhes';
END
ELSE
BEGIN
    PRINT '❌ Motorista NÃO está configurado corretamente para fazer login.';
    PRINT '';
    PRINT 'Corrija os problemas acima e tente novamente.';
END

PRINT '';
PRINT '==========================================';
PRINT '';
