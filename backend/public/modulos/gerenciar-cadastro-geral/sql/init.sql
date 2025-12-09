-- ============================================
-- Executar Sincronização via Stored Procedure
-- ============================================
EXEC [dbo].[SP_INTGRACAO_MOTORISTA_COM_TRANSPORTADOR]; -- OK
EXEC [dbo].[SP_INTGRACAO_CONTRATADOR]; -- OK
EXEC [dbo].[SP_INTGRACAO_TRANSPORTADOR]; -- OK
EXEC [dbo].[SP_INTGRACAO_CLASSEFROTA_CG]; -- OK
EXEC [dbo].[SP_INTGRACAO_ADMINISTRADOR_SISTEMA]; -- OK
EXEC [dbo].[SP_INTGRACAO_TIPOVALIDADE]; -- OK
EXEC [dbo].[SP_INTGRACAO_VALIDADE]; -- OK
GO