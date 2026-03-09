-- =============================================
-- Script: Adicionar campo FGGRUPO na tabela TIPOATIVIDADE
-- Descrição: Adiciona campo para categorização do menu
-- Data: 2026-01-09
-- =============================================

-- =============================================
-- PARTE 1: Criar campo FGGRUPO (se não existir)
-- =============================================
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[TIPOATIVIDADE]') 
    AND name = 'FGGRUPO'
)
BEGIN
    -- Adicionar campo FGGRUPO
    ALTER TABLE [dbo].[TIPOATIVIDADE]
    ADD FGGRUPO VARCHAR(50) NULL;
    
    PRINT '✅ Campo FGGRUPO adicionado com sucesso!';
END
ELSE
BEGIN
    PRINT '⚠️ Campo FGGRUPO já existe na tabela TIPOATIVIDADE.';
END
GO

-- =============================================
-- PARTE 2: Atualizar valores de FGGRUPO
-- =============================================
-- Verificar se o campo existe antes de atualizar
IF EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID(N'[dbo].[TIPOATIVIDADE]') 
    AND name = 'FGGRUPO'
)
BEGIN
    PRINT '📝 Atualizando valores de FGGRUPO baseado na numeração...';
    
    -- Atualizar grupos baseado na numeração atual
    UPDATE [dbo].[TIPOATIVIDADE]
    SET FGGRUPO = 'CADASTROS'
    WHERE (FGGRUPO IS NULL OR FGGRUPO = '')
      AND (DSTIPOATIVIDADE LIKE '1.%' OR DSTIPOATIVIDADE LIKE '1.0%' OR DSTIPOATIVIDADE LIKE '1.1%' OR DSTIPOATIVIDADE LIKE '1.2%');
    
    UPDATE [dbo].[TIPOATIVIDADE]
    SET FGGRUPO = 'EQUIPAMENTOS'
    WHERE (FGGRUPO IS NULL OR FGGRUPO = '')
      AND (DSTIPOATIVIDADE LIKE '2.%' OR DSTIPOATIVIDADE LIKE '2.0%' OR DSTIPOATIVIDADE LIKE '2.1%' OR DSTIPOATIVIDADE LIKE '2.2%' OR DSTIPOATIVIDADE LIKE '2.3%' OR DSTIPOATIVIDADE LIKE '2.4%');
    
    UPDATE [dbo].[TIPOATIVIDADE]
    SET FGGRUPO = 'VIAGENS & LOGÍSTICA'
    WHERE (FGGRUPO IS NULL OR FGGRUPO = '')
      AND (DSTIPOATIVIDADE LIKE '3.%' OR DSTIPOATIVIDADE LIKE '3.0%' OR DSTIPOATIVIDADE LIKE '3.1%' OR DSTIPOATIVIDADE LIKE '3.2%' OR DSTIPOATIVIDADE LIKE '3.3%' OR DSTIPOATIVIDADE LIKE '3.4%' OR DSTIPOATIVIDADE LIKE '3.5%');
    
    UPDATE [dbo].[TIPOATIVIDADE]
    SET FGGRUPO = 'GESTÃO & ADMINISTRAÇÃO'
    WHERE (FGGRUPO IS NULL OR FGGRUPO = '')
      AND (DSTIPOATIVIDADE LIKE '4.%' OR DSTIPOATIVIDADE LIKE '4.0%' OR DSTIPOATIVIDADE LIKE '4.1%' OR DSTIPOATIVIDADE LIKE '4.2%' OR DSTIPOATIVIDADE LIKE '4.3%');
    
    -- Itens que não se encaixam nos padrões acima ficam como 'OUTROS'
    UPDATE [dbo].[TIPOATIVIDADE]
    SET FGGRUPO = 'OUTROS'
    WHERE FGGRUPO IS NULL OR FGGRUPO = '';
    
    PRINT '✅ Valores padrão de FGGRUPO atualizados baseado na numeração!';
    PRINT '⚠️ IMPORTANTE: Revise e ajuste manualmente os valores de FGGRUPO conforme necessário!';
END
ELSE
BEGIN
    PRINT '❌ ERRO: Campo FGGRUPO não foi criado!';
END
GO

-- Verificar resultado (usando FOR XML PATH para compatibilidade com SQL Server antigo)
SELECT 
    FGGRUPO,
    COUNT(*) AS Total,
    STUFF((
        SELECT ', ' + DSTIPOATIVIDADE
        FROM [dbo].[TIPOATIVIDADE] T2
        WHERE T2.FGGRUPO = T1.FGGRUPO
          AND T2.FGACTIVE = 'S'
        FOR XML PATH(''), TYPE
    ).value('.', 'NVARCHAR(MAX)'), 1, 2, '') AS Itens
FROM [dbo].[TIPOATIVIDADE] T1
WHERE FGACTIVE = 'S'
GROUP BY FGGRUPO
ORDER BY FGGRUPO;

PRINT '';
PRINT '✅ Script executado com sucesso!';
PRINT '📝 Próximos passos:';
PRINT '   1. Revise os grupos atribuídos acima';
PRINT '   2. Ajuste manualmente os grupos que não estão corretos';
PRINT '   3. Para novos itens, defina o FGGRUPO no cadastro';
GO
