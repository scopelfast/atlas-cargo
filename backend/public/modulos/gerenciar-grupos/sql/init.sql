-- ============================================
-- Arquivo de Inicialização - Gerenciar grupos de equipamento
-- ============================================
-- Este arquivo é executado automaticamente ao abrir o módulo "Gerenciar grupos de equipamento"
-- VOCÊ PODE EDITAR ESTE ARQUIVO LIVREMENTE
-- ============================================
-- 
-- OTIMIZAÇÃO: Este script agora usa uma stored procedure para melhor performance
-- A procedure executa tudo diretamente no SQL Server, evitando timeouts
--
-- ============================================

PRINT '';
PRINT 'Executando sincronização via stored procedure...';
PRINT '';

-- ============================================
-- Executar Sincronização via Stored Procedure
-- ============================================
EXEC [dbo].[SP_INTGRACAO_GRUPOEQUIPAMENTO]; -- OK
GO

PRINT '';
PRINT '========================================';
PRINT 'SINCRONIZAÇÃO CONCLUÍDA COM SUCESSO!';
PRINT '========================================';
GO
