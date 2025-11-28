-- Script para adicionar o módulo "Gerenciar Usuários" ao menu
-- Execute este script no banco de dados SQL Server

-- ============================================================================
-- 1. Adicionar/Atualizar atividade na tabela TIPOATIVIDADE
-- ============================================================================

-- Verificar se já existe uma atividade para "Gerenciar Usuários" (CDTIPOATIVIDADE = 3)
-- Se existir, atualizar; se não existir, inserir

IF EXISTS (SELECT 1 FROM [dbo].[TIPOATIVIDADE] WHERE CDTIPOATIVIDADE = 3)
BEGIN
    -- Atualizar registro existente
    UPDATE [dbo].[TIPOATIVIDADE]
    SET 
        DSTIPOATIVIDADE = '9.1.Gerenciar Usuários',
        DSPROGRAMA = 'gerenciar-usuarios',
        FGACTIVE = 'S',
        DHMAINTENANCE = GETDATE(),
        SGUSER = 'SYSTEM',
        SERVERORIG = 'AppDVcargas'
    WHERE CDTIPOATIVIDADE = 3;
    
    PRINT '✓ Registro atualizado: 9.1.Gerenciar Usuários (CDTIPOATIVIDADE = 3)';
END
ELSE
BEGIN
    -- Inserir novo registro
    INSERT INTO [dbo].[TIPOATIVIDADE] (
        CDTIPOATIVIDADE,
        DSTIPOATIVIDADE,
        DSPROGRAMA,
        FGACTIVE,
        DHMAINTENANCE,
        SGUSER,
        SERVERORIG
    )
    VALUES (
        3,
        '9.1.Gerenciar Usuários',
        'gerenciar-usuarios',
        'S',
        GETDATE(),
        'SYSTEM',
        'AppDVcargas'
    );
    
    PRINT '✓ Registro inserido: 9.1.Gerenciar Usuários (CDTIPOATIVIDADE = 3)';
END
GO

-- ============================================================================
-- 2. Dar permissão a TODOS os usuários ativos (OPCIONAL)
-- ============================================================================
-- Descomente as linhas abaixo se quiser dar acesso a todos os usuários automaticamente

/*
INSERT INTO [dbo].[USUARIOATIVIDADE] (
    SGUSUARIO, 
    CDTIPOATIVIDADE, 
    DHMAINTENANCE, 
    SGUSER, 
    SERVERORIG
)
SELECT 
    SGUSUARIO, 
    3,  -- CDTIPOATIVIDADE para Gerenciar Usuários
    GETDATE(), 
    'SYSTEM', 
    'AppDVcargas'
FROM [dbo].[USUARIO]
WHERE FGACTIVE = 'S'
  AND NOT EXISTS (
      SELECT 1 FROM [dbo].[USUARIOATIVIDADE] 
      WHERE SGUSUARIO = [USUARIO].SGUSUARIO 
        AND CDTIPOATIVIDADE = 3
  );

PRINT '✓ Permissão concedida a todos os usuários ativos';
GO
*/

-- ============================================================================
-- 3. Verificar o resultado
-- ============================================================================

SELECT 
    CDTIPOATIVIDADE AS 'ID',
    DSTIPOATIVIDADE AS 'Nome',
    DSPROGRAMA AS 'Programa',
    FGACTIVE AS 'Ativo'
FROM [dbo].[TIPOATIVIDADE]
WHERE CDTIPOATIVIDADE = 3;
GO

PRINT '';
PRINT '═══════════════════════════════════════════════════════════════';
PRINT '✓ Módulo "Gerenciar Usuários" adicionado ao menu com sucesso!';
PRINT '═══════════════════════════════════════════════════════════════';
PRINT '';
PRINT '📌 IMPORTANTE:';
PRINT '   Para que o módulo apareça no menu de um usuário, ele precisa';
PRINT '   ter esta atividade associada na tabela USUARIOATIVIDADE.';
PRINT '';
PRINT '   Você pode dar permissão manualmente através do módulo';
PRINT '   "Gerenciar Usuários" > Aba "Acessos" > Seção "Atividades".';
PRINT '';
PRINT '   Ou execute o script comentado acima para dar acesso a todos.';
PRINT '';
GO

