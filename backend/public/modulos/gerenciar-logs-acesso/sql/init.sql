-- init.sql para Logs de Acesso
-- Este arquivo pode ser usado para inicializar dados ou criar índices se necessário

-- Verificar se as tabelas existem
IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[USUARIOLOGACESSO]') AND type in (N'U'))
BEGIN
    PRINT '✅ Tabela USUARIOLOGACESSO existe.';
END
ELSE
BEGIN
    PRINT '⚠️ Tabela USUARIOLOGACESSO não encontrada.';
END

IF EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[USUARIOLOGACAO]') AND type in (N'U'))
BEGIN
    PRINT '✅ Tabela USUARIOLOGACAO existe.';
END
ELSE
BEGIN
    PRINT '⚠️ Tabela USUARIOLOGACAO não encontrada.';
END

