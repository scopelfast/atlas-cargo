-- Script para verificar se motorista existe e está configurado corretamente
-- Execute este script no SQL Server para diagnosticar

USE [ATLAS_CARGO_PRD]
GO

-- ========================================
-- 1. VERIFICAR SE MOTORISTA EXISTE
-- ========================================

PRINT '========================================';
PRINT '  VERIFICANDO MOTORISTA';
PRINT '========================================';
PRINT '';

-- Substitua o CPF abaixo pelo CPF do motorista que está tentando logar
DECLARE @CPF VARCHAR(14) = '35534002859'; -- ← COLOQUE O CPF AQUI (sem pontos e traços)

PRINT 'Buscando CPF: ' + @CPF;
PRINT '';

SELECT 
    CDCADASTRO,
    RZSOCIAL,
    CGCCPF,
    FGTIPOCADASTRO,
    FGACTIVE,
    CASE FGTIPOCADASTRO
        WHEN 'M' THEN 'Motorista ✅'
        WHEN 'T' THEN 'Transportador'
        WHEN 'O' THEN 'Operador'
        WHEN 'A' THEN 'Agente'
        ELSE 'Outro: ' + FGTIPOCADASTRO
    END AS TIPO_DESCRICAO,
    CASE FGACTIVE
        WHEN 'A' THEN 'Ativo ✅'
        WHEN 'S' THEN 'Ativo (S) - PROBLEMA!'
        WHEN 'N' THEN 'Inativo ❌'
        ELSE 'Outro: ' + FGACTIVE
    END AS STATUS_DESCRICAO
FROM [dbo].[CADASTROGERAL]
WHERE CGCCPF = @CPF;

PRINT '';
PRINT '========================================';
PRINT '  CONDIÇÕES PARA LOGIN:';
PRINT '========================================';
PRINT '1. FGTIPOCADASTRO deve ser ''M'' (Motorista)';
PRINT '2. FGACTIVE deve ser ''A'' (Ativo)';
PRINT '3. CPF deve estar correto';
PRINT '';
PRINT 'Se alguma condição não for atendida, o login falha!';
PRINT '';

-- ========================================
-- 2. CORRIGIR SE NECESSÁRIO
-- ========================================

PRINT '========================================';
PRINT '  SCRIPTS DE CORREÇÃO (se necessário):';
PRINT '========================================';
PRINT '';
PRINT '-- Se FGTIPOCADASTRO não for ''M'':';
PRINT 'UPDATE CADASTROGERAL SET FGTIPOCADASTRO = ''M'' WHERE CGCCPF = ''' + @CPF + ''';';
PRINT '';
PRINT '-- Se FGACTIVE for ''S'' ao invés de ''A'':';
PRINT 'UPDATE CADASTROGERAL SET FGACTIVE = ''A'' WHERE CGCCPF = ''' + @CPF + ''';';
PRINT '';

GO

