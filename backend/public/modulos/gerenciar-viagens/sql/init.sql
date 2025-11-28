-- ============================================
-- Arquivo de Inicialização - Gerenciar Viagens
-- ============================================
-- Este arquivo é executado automaticamente ao abrir o módulo "Gerenciar Viagens"
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
EXEC [dbo].[SP_INTGRACAO_TIPOVIAGEM]; -- OK
EXEC [dbo].[SP_INTGRACAO_SITUACAOVIAGEM]; -- OK
EXEC [dbo].[SP_INTGRACAO_CLASSEFROTA]; -- OK
EXEC [dbo].[SP_INTGRACAO_TRANSPORTADOR]; -- OK
EXEC [dbo].[SP_INTGRACAO_CONTRATADOR]; -- OK
EXEC [dbo].[SP_INTGRACAO_ROTEIRO]; -- OK
EXEC [dbo].[SP_INTGRACAO_ROTEIROPONTOS]; -- OK
EXEC [dbo].[SP_INTGRACAO_VIAGEMMESTRE]; -- OK
EXEC [dbo].[SP_INTGRACAO_TIPOEQUIPAMENTO]; -- OK
EXEC [dbo].[SP_INTGRACAO_GRUPOEQUIPAMENTO]; -- OK
EXEC [dbo].[SP_INTGRACAO_MARCAEQUIPAMENTO]; -- OK
EXEC [dbo].[SP_INTGRACAO_MODELOEQUIPAMENTO]; -- OK
EXEC [dbo].[SP_INTGRACAO_EQUIPAMENTO]; -- OK
EXEC [dbo].[SP_INTGRACAO_VIAGEMVEICULO]; -- OK   
EXEC [dbo].[SP_INTGRACAO_MOTORISTA_COM_TRANSPORTADOR]; -- OK
EXEC [dbo].[SP_ATUALIZACAO_VIAGEMMESTRE]; -- OK
EXEC [dbo].[SP_INTGRACAO_VIAGEMMOTORISTA]; -- OK
EXEC [dbo].[SP_INTGRACAO_VIAGEMVEICULO]; -- OK
EXEC [dbo].[SP_DESATIVAR_VIAGENS_COM_MOTORISTA]; -- OK
EXEC [dbo].[SP_DESATIVAR_VIAGENS_COM_VEICULO]; -- OK
GO

PRINT '';
PRINT '========================================';
PRINT 'SINCRONIZAÇÃO CONCLUÍDA COM SUCESSO!';
PRINT '========================================';
GO
