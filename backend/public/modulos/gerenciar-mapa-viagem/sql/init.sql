-- ============================================
-- INTEGRAÇÃO DE RASTREAMENTO - INTEGRA_PRD para DIVULGACARGA_PRD
-- Módulo: Mapa de Viagem
-- Descrição: Executa a stored procedure para integrar as últimas posições
-- ============================================
-- NOTA: Este script é executado via node-mssql, que não suporta GO

SET NOCOUNT ON;

-- Verificar se a stored procedure existe
IF NOT EXISTS (SELECT 1 FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[SP_INTGRACAO_RASTREAMENTO_MAPA]') AND type in (N'P', N'PC'))
BEGIN
    PRINT '⚠️  Stored Procedure SP_INTGRACAO_RASTREAMENTO_MAPA não encontrada.';
    PRINT '    Execute o script: backend/scripts/sp_integracao_rastreamento_mapa.sql';
    RETURN;
END

-- Executar a stored procedure
EXEC [dbo].[SP_INTGRACAO_RASTREAMENTO_MAPA];

PRINT '✅ Integração de rastreamento finalizada.';
