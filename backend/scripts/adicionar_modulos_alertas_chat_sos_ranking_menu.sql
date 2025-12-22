-- ============================================
-- Script para adicionar novos módulos ao menu
-- Alertas | Chat | SOS | Ranking
-- ============================================
-- Data: 2025-01-18
-- Autor: Sistema DivulgaCarga
-- IMPORTANTE: Execute este script no banco de dados DIVULGACARGA_PRD
--
-- Este script adiciona os 4 novos módulos ao menu do sistema:
-- 1. Alertas (CDTIPOATIVIDADE = 40) - /modulos/alertas/index.html
-- 2. Chat (CDTIPOATIVIDADE = 41) - /modulos/chat/index.html
-- 3. SOS (CDTIPOATIVIDADE = 42) - /modulos/sos/index.html
-- 4. Ranking (CDTIPOATIVIDADE = 43) - /modulos/ranking/index.html
--
-- O script também concede permissão ao usuário 'Admin' para acessar os módulos.
-- Para dar permissão a outros usuários, execute os comandos no final do script.
--
-- IMPORTANTE: Este script é seguro e pode ser executado múltiplas vezes (idempotente)

USE [DIVULGACARGA_PRD]
GO

PRINT '========================================';
PRINT '🚀 Adicionando novos módulos ao menu';
PRINT '========================================';
PRINT '';

-- ============================================
-- 1. ADICIONAR MÓDULO: ALERTAS
-- ============================================
PRINT '📋 1/4 - Adicionando módulo Alertas...';

IF NOT EXISTS (SELECT 1 FROM [dbo].[TIPOATIVIDADE] WHERE CDTIPOATIVIDADE = 40)
BEGIN
    INSERT INTO [dbo].[TIPOATIVIDADE] (
        CDTIPOATIVIDADE,
        DSTIPOATIVIDADE,
        FGACTIVE,
        DHMAINTENANCE,
        SGUSER,
        SERVERORIG,
        DSPROGRAMA
    ) VALUES (
        40,                              -- CDTIPOATIVIDADE
        '4.0.Alertas',                   -- DSTIPOATIVIDADE
        'S',                             -- FGACTIVE (Ativo)
        SYSUTCDATETIME(),                -- DHMAINTENANCE
        'SYSTEM',                        -- SGUSER
        'AppDVcargas',                  -- SERVERORIG
        'alertas'                        -- DSPROGRAMA (caminho: /modulos/alertas/index.html)
    );
    
    PRINT '   ✅ Módulo "Alertas" adicionado (CDTIPOATIVIDADE = 40)';
END
ELSE
BEGIN
    UPDATE [dbo].[TIPOATIVIDADE]
    SET DSTIPOATIVIDADE = '4.0.Alertas',
        DSPROGRAMA = 'alertas',
        FGACTIVE = 'S',
        DHMAINTENANCE = SYSUTCDATETIME(),
        SGUSER = 'SYSTEM',
        SERVERORIG = 'AppDVcargas'
    WHERE CDTIPOATIVIDADE = 40;
    
    PRINT '   ℹ️ Módulo "Alertas" já existe, atualizado (CDTIPOATIVIDADE = 40)';
END
GO

-- ============================================
-- 2. ADICIONAR MÓDULO: CHAT
-- ============================================
PRINT '📋 2/4 - Adicionando módulo Chat...';

IF NOT EXISTS (SELECT 1 FROM [dbo].[TIPOATIVIDADE] WHERE CDTIPOATIVIDADE = 41)
BEGIN
    INSERT INTO [dbo].[TIPOATIVIDADE] (
        CDTIPOATIVIDADE,
        DSTIPOATIVIDADE,
        FGACTIVE,
        DHMAINTENANCE,
        SGUSER,
        SERVERORIG,
        DSPROGRAMA
    ) VALUES (
        41,                              -- CDTIPOATIVIDADE
        '4.1.Chat',                      -- DSTIPOATIVIDADE
        'S',                             -- FGACTIVE (Ativo)
        SYSUTCDATETIME(),                -- DHMAINTENANCE
        'SYSTEM',                        -- SGUSER
        'AppDVcargas',                  -- SERVERORIG
        'chat'                           -- DSPROGRAMA (caminho: /modulos/chat/index.html)
    );
    
    PRINT '   ✅ Módulo "Chat" adicionado (CDTIPOATIVIDADE = 41)';
END
ELSE
BEGIN
    UPDATE [dbo].[TIPOATIVIDADE]
    SET DSTIPOATIVIDADE = '4.1.Chat',
        DSPROGRAMA = 'chat',
        FGACTIVE = 'S',
        DHMAINTENANCE = SYSUTCDATETIME(),
        SGUSER = 'SYSTEM',
        SERVERORIG = 'AppDVcargas'
    WHERE CDTIPOATIVIDADE = 41;
    
    PRINT '   ℹ️ Módulo "Chat" já existe, atualizado (CDTIPOATIVIDADE = 41)';
END
GO

-- ============================================
-- 3. ADICIONAR MÓDULO: SOS
-- ============================================
PRINT '📋 3/4 - Adicionando módulo SOS...';

IF NOT EXISTS (SELECT 1 FROM [dbo].[TIPOATIVIDADE] WHERE CDTIPOATIVIDADE = 42)
BEGIN
    INSERT INTO [dbo].[TIPOATIVIDADE] (
        CDTIPOATIVIDADE,
        DSTIPOATIVIDADE,
        FGACTIVE,
        DHMAINTENANCE,
        SGUSER,
        SERVERORIG,
        DSPROGRAMA
    ) VALUES (
        42,                              -- CDTIPOATIVIDADE
        '4.2.SOS',                       -- DSTIPOATIVIDADE
        'S',                             -- FGACTIVE (Ativo)
        SYSUTCDATETIME(),                -- DHMAINTENANCE
        'SYSTEM',                        -- SGUSER
        'AppDVcargas',                  -- SERVERORIG
        'sos'                            -- DSPROGRAMA (caminho: /modulos/sos/index.html)
    );
    
    PRINT '   ✅ Módulo "SOS" adicionado (CDTIPOATIVIDADE = 42)';
END
ELSE
BEGIN
    UPDATE [dbo].[TIPOATIVIDADE]
    SET DSTIPOATIVIDADE = '4.2.SOS',
        DSPROGRAMA = 'sos',
        FGACTIVE = 'S',
        DHMAINTENANCE = SYSUTCDATETIME(),
        SGUSER = 'SYSTEM',
        SERVERORIG = 'AppDVcargas'
    WHERE CDTIPOATIVIDADE = 42;
    
    PRINT '   ℹ️ Módulo "SOS" já existe, atualizado (CDTIPOATIVIDADE = 42)';
END
GO

-- ============================================
-- 4. ADICIONAR MÓDULO: RANKING
-- ============================================
PRINT '📋 4/4 - Adicionando módulo Ranking...';

IF NOT EXISTS (SELECT 1 FROM [dbo].[TIPOATIVIDADE] WHERE CDTIPOATIVIDADE = 43)
BEGIN
    INSERT INTO [dbo].[TIPOATIVIDADE] (
        CDTIPOATIVIDADE,
        DSTIPOATIVIDADE,
        FGACTIVE,
        DHMAINTENANCE,
        SGUSER,
        SERVERORIG,
        DSPROGRAMA
    ) VALUES (
        43,                              -- CDTIPOATIVIDADE
        '4.3.Ranking',                   -- DSTIPOATIVIDADE
        'S',                             -- FGACTIVE (Ativo)
        SYSUTCDATETIME(),                -- DHMAINTENANCE
        'SYSTEM',                        -- SGUSER
        'AppDVcargas',                  -- SERVERORIG
        'ranking'                        -- DSPROGRAMA (caminho: /modulos/ranking/index.html)
    );
    
    PRINT '   ✅ Módulo "Ranking" adicionado (CDTIPOATIVIDADE = 43)';
END
ELSE
BEGIN
    UPDATE [dbo].[TIPOATIVIDADE]
    SET DSTIPOATIVIDADE = '4.3.Ranking',
        DSPROGRAMA = 'ranking',
        FGACTIVE = 'S',
        DHMAINTENANCE = SYSUTCDATETIME(),
        SGUSER = 'SYSTEM',
        SERVERORIG = 'AppDVcargas'
    WHERE CDTIPOATIVIDADE = 43;
    
    PRINT '   ℹ️ Módulo "Ranking" já existe, atualizado (CDTIPOATIVIDADE = 43)';
END
GO

-- ============================================
-- 5. DAR PERMISSÃO PARA USUÁRIO ADMIN
-- ============================================
PRINT '';
PRINT '🔐 Concedendo permissões para usuário Admin...';

-- Alertas (40)
IF NOT EXISTS (SELECT 1 FROM [dbo].[USUARIOATIVIDADE] WHERE SGUSUARIO = 'Admin' AND CDTIPOATIVIDADE = 40)
BEGIN
    INSERT INTO [dbo].[USUARIOATIVIDADE] (
        SGUSUARIO,
        CDTIPOATIVIDADE,
        DHMAINTENANCE,
        SGUSER,
        SERVERORIG
    ) VALUES (
        'Admin',
        40,
        SYSUTCDATETIME(),
        'SYSTEM',
        'AppDVcargas'
    );
    PRINT '   ✅ Permissão "Alertas" concedida ao Admin';
END
ELSE
BEGIN
    PRINT '   ℹ️ Permissão "Alertas" já existe para Admin';
END
GO

-- Chat (41)
IF NOT EXISTS (SELECT 1 FROM [dbo].[USUARIOATIVIDADE] WHERE SGUSUARIO = 'Admin' AND CDTIPOATIVIDADE = 41)
BEGIN
    INSERT INTO [dbo].[USUARIOATIVIDADE] (
        SGUSUARIO,
        CDTIPOATIVIDADE,
        DHMAINTENANCE,
        SGUSER,
        SERVERORIG
    ) VALUES (
        'Admin',
        41,
        SYSUTCDATETIME(),
        'SYSTEM',
        'AppDVcargas'
    );
    PRINT '   ✅ Permissão "Chat" concedida ao Admin';
END
ELSE
BEGIN
    PRINT '   ℹ️ Permissão "Chat" já existe para Admin';
END
GO

-- SOS (42)
IF NOT EXISTS (SELECT 1 FROM [dbo].[USUARIOATIVIDADE] WHERE SGUSUARIO = 'Admin' AND CDTIPOATIVIDADE = 42)
BEGIN
    INSERT INTO [dbo].[USUARIOATIVIDADE] (
        SGUSUARIO,
        CDTIPOATIVIDADE,
        DHMAINTENANCE,
        SGUSER,
        SERVERORIG
    ) VALUES (
        'Admin',
        42,
        SYSUTCDATETIME(),
        'SYSTEM',
        'AppDVcargas'
    );
    PRINT '   ✅ Permissão "SOS" concedida ao Admin';
END
ELSE
BEGIN
    PRINT '   ℹ️ Permissão "SOS" já existe para Admin';
END
GO

-- Ranking (43)
IF NOT EXISTS (SELECT 1 FROM [dbo].[USUARIOATIVIDADE] WHERE SGUSUARIO = 'Admin' AND CDTIPOATIVIDADE = 43)
BEGIN
    INSERT INTO [dbo].[USUARIOATIVIDADE] (
        SGUSUARIO,
        CDTIPOATIVIDADE,
        DHMAINTENANCE,
        SGUSER,
        SERVERORIG
    ) VALUES (
        'Admin',
        43,
        SYSUTCDATETIME(),
        'SYSTEM',
        'AppDVcargas'
    );
    PRINT '   ✅ Permissão "Ranking" concedida ao Admin';
END
ELSE
BEGIN
    PRINT '   ℹ️ Permissão "Ranking" já existe para Admin';
END
GO

-- ============================================
-- 6. VERIFICAÇÃO FINAL
-- ============================================
PRINT '';
PRINT '========================================';
PRINT '✅ Verificação final dos módulos adicionados';
PRINT '========================================';

SELECT 
    CDTIPOATIVIDADE AS 'ID',
    DSTIPOATIVIDADE AS 'Nome',
    DSPROGRAMA AS 'Programa',
    FGACTIVE AS 'Ativo'
FROM [dbo].[TIPOATIVIDADE]
WHERE CDTIPOATIVIDADE IN (40, 41, 42, 43)
ORDER BY CDTIPOATIVIDADE;
GO

-- ============================================
-- 7. OPCIONAL: Dar permissão a TODOS os usuários ativos
-- ============================================
-- Descomente o bloco abaixo se desejar conceder acesso a todos os usuários ativos
/*
PRINT '';
PRINT '🔐 Concedendo permissões para TODOS os usuários ativos...';

-- Alertas (40)
INSERT INTO [dbo].[USUARIOATIVIDADE] (SGUSUARIO, CDTIPOATIVIDADE, DHMAINTENANCE, SGUSER, SERVERORIG)
SELECT U.SGUSUARIO, 40, SYSUTCDATETIME(), 'SYSTEM', 'AppDVcargas'
FROM [dbo].[USUARIO] U
WHERE U.FGACTIVE = 'S'
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[USUARIOATIVIDADE] UA
    WHERE UA.SGUSUARIO = U.SGUSUARIO AND UA.CDTIPOATIVIDADE = 40
  );
PRINT '   ✅ Permissão "Alertas" concedida a todos os usuários ativos';

-- Chat (41)
INSERT INTO [dbo].[USUARIOATIVIDADE] (SGUSUARIO, CDTIPOATIVIDADE, DHMAINTENANCE, SGUSER, SERVERORIG)
SELECT U.SGUSUARIO, 41, SYSUTCDATETIME(), 'SYSTEM', 'AppDVcargas'
FROM [dbo].[USUARIO] U
WHERE U.FGACTIVE = 'S'
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[USUARIOATIVIDADE] UA
    WHERE UA.SGUSUARIO = U.SGUSUARIO AND UA.CDTIPOATIVIDADE = 41
  );
PRINT '   ✅ Permissão "Chat" concedida a todos os usuários ativos';

-- SOS (42)
INSERT INTO [dbo].[USUARIOATIVIDADE] (SGUSUARIO, CDTIPOATIVIDADE, DHMAINTENANCE, SGUSER, SERVERORIG)
SELECT U.SGUSUARIO, 42, SYSUTCDATETIME(), 'SYSTEM', 'AppDVcargas'
FROM [dbo].[USUARIO] U
WHERE U.FGACTIVE = 'S'
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[USUARIOATIVIDADE] UA
    WHERE UA.SGUSUARIO = U.SGUSUARIO AND UA.CDTIPOATIVIDADE = 42
  );
PRINT '   ✅ Permissão "SOS" concedida a todos os usuários ativos';

-- Ranking (43)
INSERT INTO [dbo].[USUARIOATIVIDADE] (SGUSUARIO, CDTIPOATIVIDADE, DHMAINTENANCE, SGUSER, SERVERORIG)
SELECT U.SGUSUARIO, 43, SYSUTCDATETIME(), 'SYSTEM', 'AppDVcargas'
FROM [dbo].[USUARIO] U
WHERE U.FGACTIVE = 'S'
  AND NOT EXISTS (
    SELECT 1 FROM [dbo].[USUARIOATIVIDADE] UA
    WHERE UA.SGUSUARIO = U.SGUSUARIO AND UA.CDTIPOATIVIDADE = 43
  );
PRINT '   ✅ Permissão "Ranking" concedida a todos os usuários ativos';
GO
*/

PRINT '';
PRINT '========================================';
PRINT '✅ Script concluído com sucesso!';
PRINT '========================================';
PRINT '';
PRINT '📝 Próximos passos:';
PRINT '   1. Verificar se os módulos aparecem no menu do usuário Admin';
PRINT '   2. Para dar permissão a outros usuários, execute:';
PRINT '      INSERT INTO USUARIOATIVIDADE (SGUSUARIO, CDTIPOATIVIDADE, DHMAINTENANCE, SGUSER, SERVERORIG)';
PRINT '      VALUES (''NOME_USUARIO'', 40, GETDATE(), ''SYSTEM'', ''AppDVcargas'');';
PRINT '      -- Repita para 41 (Chat), 42 (SOS), 43 (Ranking) conforme necessário';
PRINT '';
PRINT '   3. Para dar permissão a TODOS os usuários, descomente a seção 7 do script';
PRINT '';
PRINT '📋 Módulos adicionados:';
PRINT '   - 40: 4.0.Alertas → /modulos/alertas/index.html';
PRINT '   - 41: 4.1.Chat → /modulos/chat/index.html';
PRINT '   - 42: 4.2.SOS → /modulos/sos/index.html';
PRINT '   - 43: 4.3.Ranking → /modulos/ranking/index.html';
PRINT '';
GO
