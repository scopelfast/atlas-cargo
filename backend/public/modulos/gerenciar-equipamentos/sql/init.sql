-- ============================================
-- Executar Sincronização via Stored Procedure
-- ============================================
EXEC [dbo].[SP_INTGRACAO_CLASSEFROTA]; -- OK
EXEC [dbo].[SP_INTGRACAO_TIPOEQUIPAMENTO]; -- OK
EXEC [dbo].[SP_INTGRACAO_GRUPOEQUIPAMENTO]; -- OK
EXEC [dbo].[SP_INTGRACAO_MARCAEQUIPAMENTO]; -- OK
EXEC [dbo].[SP_INTGRACAO_MODELOEQUIPAMENTO]; -- OK
EXEC [dbo].[SP_INTGRACAO_EQUIPAMENTO]; -- OK
EXEC [dbo].[SP_INTGRACAO_TIPOVALIDADE]; -- OK
EXEC [dbo].[SP_INTGRACAO_VALIDADE]; -- OK
GO