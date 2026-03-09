-- ============================================
-- Script para corrigir programas dos módulos no menu
-- ============================================
-- Data: 2026-01-18
-- IMPORTANTE: Execute este script no banco de dados ATLAS_CARGO_PRD
--
-- Este script atualiza o campo DSPROGRAMA dos módulos antigos que estão NULL ou vazios.
-- Os programas são baseados nos nomes dos diretórios em backend/public/modulos/

USE [ATLAS_CARGO_PRD]
GO

PRINT '========================================';
PRINT '🔧 Corrigindo programas dos módulos';
PRINT '========================================';
PRINT '';

-- Mapeamento de módulos conhecidos
-- Formato: CDTIPOATIVIDADE -> DSPROGRAMA (nome do diretório)

-- 1. Gerenciar Viagens
IF EXISTS (SELECT 1 FROM [dbo].[TIPOATIVIDADE] WHERE CDTIPOATIVIDADE = 3 AND (DSPROGRAMA IS NULL OR DSPROGRAMA = ''))
BEGIN
    UPDATE [dbo].[TIPOATIVIDADE]
    SET DSPROGRAMA = 'gerenciar-viagens',
        DHMAINTENANCE = GETDATE()
    WHERE CDTIPOATIVIDADE = 3
      AND (DSPROGRAMA IS NULL OR DSPROGRAMA = '');
    PRINT '✅ Corrigido: 3.0.Viagem → gerenciar-viagens';
END
GO

-- 2. Gerenciar Roteiros
IF EXISTS (SELECT 1 FROM [dbo].[TIPOATIVIDADE] WHERE CDTIPOATIVIDADE = 34 AND (DSPROGRAMA IS NULL OR DSPROGRAMA = ''))
BEGIN
    UPDATE [dbo].[TIPOATIVIDADE]
    SET DSPROGRAMA = 'gerenciar-roteiros',
        DHMAINTENANCE = GETDATE()
    WHERE CDTIPOATIVIDADE = 34
      AND (DSPROGRAMA IS NULL OR DSPROGRAMA = '');
    PRINT '✅ Corrigido: 3.4.Roteiro → gerenciar-roteiros';
END
GO

-- 3. Relatório Convocações
IF EXISTS (SELECT 1 FROM [dbo].[TIPOATIVIDADE] WHERE CDTIPOATIVIDADE = 33 AND (DSPROGRAMA IS NULL OR DSPROGRAMA = ''))
BEGIN
    UPDATE [dbo].[TIPOATIVIDADE]
    SET DSPROGRAMA = 'relatorio-convocacoes',
        DHMAINTENANCE = GETDATE()
    WHERE CDTIPOATIVIDADE = 33
      AND (DSPROGRAMA IS NULL OR DSPROGRAMA = '');
    PRINT '✅ Corrigido: 3.5.Convocações → relatorio-convocacoes';
END
GO

-- 4. Gerenciar Usuários
IF EXISTS (SELECT 1 FROM [dbo].[TIPOATIVIDADE] WHERE CDTIPOATIVIDADE = 40 AND DSTIPOATIVIDADE LIKE '%Usuário%' AND (DSPROGRAMA IS NULL OR DSPROGRAMA = ''))
BEGIN
    UPDATE [dbo].[TIPOATIVIDADE]
    SET DSPROGRAMA = 'gerenciar-usuarios',
        DHMAINTENANCE = GETDATE()
    WHERE CDTIPOATIVIDADE = 40
      AND DSTIPOATIVIDADE LIKE '%Usuário%'
      AND (DSPROGRAMA IS NULL OR DSPROGRAMA = '');
    PRINT '✅ Corrigido: 4.0.Usuário → gerenciar-usuarios';
END
GO

-- 5. Gerenciar Cadastro Geral
IF EXISTS (SELECT 1 FROM [dbo].[TIPOATIVIDADE] WHERE CDTIPOATIVIDADE = 1 AND (DSPROGRAMA IS NULL OR DSPROGRAMA = ''))
BEGIN
    UPDATE [dbo].[TIPOATIVIDADE]
    SET DSPROGRAMA = 'gerenciar-cadastro-geral',
        DHMAINTENANCE = GETDATE()
    WHERE CDTIPOATIVIDADE = 1
      AND (DSPROGRAMA IS NULL OR DSPROGRAMA = '');
    PRINT '✅ Corrigido: 1.0.Cadastro Geral → gerenciar-cadastro-geral';
END
GO

-- 6. Gerenciar Equipamentos
IF EXISTS (SELECT 1 FROM [dbo].[TIPOATIVIDADE] WHERE CDTIPOATIVIDADE = 2 AND (DSPROGRAMA IS NULL OR DSPROGRAMA = ''))
BEGIN
    UPDATE [dbo].[TIPOATIVIDADE]
    SET DSPROGRAMA = 'gerenciar-equipamentos',
        DHMAINTENANCE = GETDATE()
    WHERE CDTIPOATIVIDADE = 2
      AND (DSPROGRAMA IS NULL OR DSPROGRAMA = '');
    PRINT '✅ Corrigido: 2.0.Equipamento → gerenciar-equipamentos';
END
GO

-- 7. Gerenciar Cidades
IF EXISTS (SELECT 1 FROM [dbo].[TIPOATIVIDADE] WHERE DSTIPOATIVIDADE LIKE '%Cidade%' AND (DSPROGRAMA IS NULL OR DSPROGRAMA = ''))
BEGIN
    UPDATE [dbo].[TIPOATIVIDADE]
    SET DSPROGRAMA = 'gerenciar-cidades',
        DHMAINTENANCE = GETDATE()
    WHERE DSTIPOATIVIDADE LIKE '%Cidade%'
      AND (DSPROGRAMA IS NULL OR DSPROGRAMA = '');
    PRINT '✅ Corrigido: Cidades → gerenciar-cidades';
END
GO

-- 8. Gerenciar Empresas
IF EXISTS (SELECT 1 FROM [dbo].[TIPOATIVIDADE] WHERE DSTIPOATIVIDADE LIKE '%Empresa%' AND (DSPROGRAMA IS NULL OR DSPROGRAMA = ''))
BEGIN
    UPDATE [dbo].[TIPOATIVIDADE]
    SET DSPROGRAMA = 'gerenciar-empresas',
        DHMAINTENANCE = GETDATE()
    WHERE DSTIPOATIVIDADE LIKE '%Empresa%'
      AND (DSPROGRAMA IS NULL OR DSPROGRAMA = '');
    PRINT '✅ Corrigido: Empresas → gerenciar-empresas';
END
GO

-- 9. Gerenciar Filiais
IF EXISTS (SELECT 1 FROM [dbo].[TIPOATIVIDADE] WHERE DSTIPOATIVIDADE LIKE '%Filial%' AND (DSPROGRAMA IS NULL OR DSPROGRAMA = ''))
BEGIN
    UPDATE [dbo].[TIPOATIVIDADE]
    SET DSPROGRAMA = 'gerenciar-filiais',
        DHMAINTENANCE = GETDATE()
    WHERE DSTIPOATIVIDADE LIKE '%Filial%'
      AND (DSPROGRAMA IS NULL OR DSPROGRAMA = '');
    PRINT '✅ Corrigido: Filiais → gerenciar-filiais';
END
GO

-- 10. Gerenciar Tipos de Atividade
IF EXISTS (SELECT 1 FROM [dbo].[TIPOATIVIDADE] WHERE DSTIPOATIVIDADE LIKE '%Tipo%Atividade%' AND (DSPROGRAMA IS NULL OR DSPROGRAMA = ''))
BEGIN
    UPDATE [dbo].[TIPOATIVIDADE]
    SET DSPROGRAMA = 'gerenciar-tipos-atividade',
        DHMAINTENANCE = GETDATE()
    WHERE DSTIPOATIVIDADE LIKE '%Tipo%Atividade%'
      AND (DSPROGRAMA IS NULL OR DSPROGRAMA = '');
    PRINT '✅ Corrigido: Tipos de Atividade → gerenciar-tipos-atividade';
END
GO

PRINT '';
PRINT '========================================';
PRINT '✅ Verificação final';
PRINT '========================================';

-- Verificar módulos ainda sem programa
SELECT 
    CDTIPOATIVIDADE AS 'ID',
    DSTIPOATIVIDADE AS 'Nome',
    DSPROGRAMA AS 'Programa',
    CASE 
        WHEN DSPROGRAMA IS NULL OR DSPROGRAMA = '' THEN '❌ SEM PROGRAMA'
        ELSE '✅ OK'
    END AS 'Status'
FROM [dbo].[TIPOATIVIDADE]
WHERE FGACTIVE = 'S'
  AND (DSPROGRAMA IS NULL OR DSPROGRAMA = '')
ORDER BY CDTIPOATIVIDADE;
GO

PRINT '';
PRINT '========================================';
PRINT '✅ Script concluído!';
PRINT '========================================';
PRINT '';
PRINT '📝 Se ainda houver módulos sem programa, atualize manualmente:';
PRINT '   UPDATE TIPOATIVIDADE SET DSPROGRAMA = ''nome-do-diretorio'' WHERE CDTIPOATIVIDADE = X;';
PRINT '';
GO

