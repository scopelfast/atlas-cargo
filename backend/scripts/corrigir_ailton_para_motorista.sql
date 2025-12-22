-- Script para Corrigir AILTON APARECIDO DE LIMA (CPF: 2570426954)
-- Alterar tipo de cadastro de "Transportador" para "Motorista"

DECLARE @CDCADASTRO INT = 76679; -- Código do cadastro mostrado na tela
DECLARE @CPF VARCHAR(14) = '2570426954';

PRINT '==========================================';
PRINT '🔧 CORRIGINDO CADASTRO PARA MOTORISTA';
PRINT '==========================================';
PRINT '';
PRINT 'CPF: ' + @CPF;
PRINT 'Código: ' + CAST(@CDCADASTRO AS VARCHAR);
PRINT '';

-- Verificar dados atuais
PRINT '📋 DADOS ATUAIS:';
SELECT 
    CDCADASTRO,
    CGCCPF,
    RZSOCIAL,
    FGTIPOCADASTRO,
    FGACTIVE
FROM [dbo].[CADASTROGERAL]
WHERE CDCADASTRO = @CDCADASTRO;

PRINT '';

-- Atualizar tipo de cadastro para Motorista
BEGIN TRANSACTION;

BEGIN TRY
    -- 1. Alterar tipo de cadastro
    UPDATE [dbo].[CADASTROGERAL]
    SET FGTIPOCADASTRO = 'M'
    WHERE CDCADASTRO = @CDCADASTRO;
    
    PRINT '✅ Tipo de cadastro alterado para "M" (Motorista)';
    
    -- 2. Verificar/Criar registro em MOTORISTA_COMPLEMENTO
    IF NOT EXISTS (SELECT 1 FROM [dbo].[MOTORISTA_COMPLEMENTO] WHERE CDCADASTRO = @CDCADASTRO)
    BEGIN
        INSERT INTO [dbo].[MOTORISTA_COMPLEMENTO] (
            CDCADASTRO,
            STATUSAPROVACAO,
            DH_CRIACAO
        )
        VALUES (
            @CDCADASTRO,
            'A', -- Aprovado
            GETDATE()
        );
        PRINT '✅ Registro criado em MOTORISTA_COMPLEMENTO (Status: Aprovado)';
    END
    ELSE
    BEGIN
        -- Garantir que está aprovado
        UPDATE [dbo].[MOTORISTA_COMPLEMENTO]
        SET STATUSAPROVACAO = 'A'
        WHERE CDCADASTRO = @CDCADASTRO;
        PRINT '✅ STATUSAPROVACAO atualizado para "A" (Aprovado)';
    END
    
    COMMIT TRANSACTION;
    
    PRINT '';
    PRINT '==========================================';
    PRINT '✅ CORREÇÃO CONCLUÍDA!';
    PRINT '==========================================';
    PRINT '';
    PRINT 'O motorista AILTON APARECIDO DE LIMA agora pode fazer login!';
    PRINT '';
    
END TRY
BEGIN CATCH
    ROLLBACK TRANSACTION;
    PRINT '❌ ERRO:';
    PRINT ERROR_MESSAGE();
END CATCH

-- Mostrar dados finais
PRINT '';
PRINT '📋 DADOS FINAIS:';
SELECT 
    cg.CDCADASTRO AS 'ID',
    cg.CGCCPF AS 'CPF',
    cg.RZSOCIAL AS 'Nome',
    cg.FGTIPOCADASTRO AS 'Tipo',
    cg.FGACTIVE AS 'Ativo',
    mc.STATUSAPROVACAO AS 'Aprovação',
    CASE WHEN mc.SENHA IS NULL THEN 'SEM SENHA' ELSE 'COM SENHA' END AS 'Senha'
FROM [dbo].[CADASTROGERAL] cg
LEFT JOIN [dbo].[MOTORISTA_COMPLEMENTO] mc ON cg.CDCADASTRO = mc.CDCADASTRO
WHERE cg.CDCADASTRO = @CDCADASTRO;

PRINT '';
PRINT '💡 NOTA: Se o motorista não tiver senha definida, qualquer senha funcionará no login.';
PRINT '';
