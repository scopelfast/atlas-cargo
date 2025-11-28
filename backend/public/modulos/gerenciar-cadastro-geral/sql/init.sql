-- ============================================
-- Arquivo de Inicialização - Gerenciar cadastro geral
-- ============================================
-- Este arquivo é executado automaticamente ao abrir o módulo "Gerenciar cadastro geral"
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
EXEC [dbo].[SP_INTGRACAO_TRANSPORTADOR]; -- OK
EXEC [dbo].[SP_INTGRACAO_CONTRATADOR]; -- OK
EXEC [dbo].[SP_INTGRACAO_MOTORISTA_COM_TRANSPORTADOR]; -- OK
EXEC [dbo].[SP_INTGRACAO_CLASSEFROTA_CG]; -- OK
EXEC [dbo].[SP_INTGRACAO_ADMINISTRADOR_SISTEMA]; -- OK
GO

PRINT '';
PRINT '========================================';
PRINT 'SINCRONIZAÇÃO CONCLUÍDA COM SUCESSO!';
PRINT '========================================';
GO
