-- ============================================
-- Arquivo de Inicialização - Gerenciar Equipamentos
-- ============================================
-- Este arquivo é executado automaticamente ao abrir o módulo "Gerenciar Equipamentos"
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
EXEC [dbo].[SP_INTGRACAO_CLASSEFROTA]; -- OK
EXEC [dbo].[SP_INTGRACAO_TIPOEQUIPAMENTO]; -- OK
EXEC [dbo].[SP_INTGRACAO_GRUPOEQUIPAMENTO]; -- OK
EXEC [dbo].[SP_INTGRACAO_MARCAEQUIPAMENTO]; -- OK
EXEC [dbo].[SP_INTGRACAO_MODELOEQUIPAMENTO]; -- OK
EXEC [dbo].[SP_INTGRACAO_EQUIPAMENTO]; -- OK
GO

PRINT '';
PRINT '========================================';
PRINT 'SINCRONIZAÇÃO CONCLUÍDA COM SUCESSO!';
PRINT '========================================';
GO