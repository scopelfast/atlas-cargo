-- ============================================
-- Script para criar alertas SOS de teste
-- Módulo: SOS
-- ============================================
-- Data: 2025-01-18
-- IMPORTANTE: Execute este script no banco de dados DIVULGACARGA_PRD
--
-- Este script cria alertas SOS de exemplo para testar o módulo SOS.
-- Os alertas são criados com diferentes status e localizações GPS.
--
-- ⚠️ ATENÇÃO: Este script cria dados de teste. Use apenas em ambiente de desenvolvimento/teste.
--
-- 📋 PRÉ-REQUISITOS:
--   1. Execute primeiro: ajustar_tabela_sos_alerts_para_modulo.sql (se ainda não executou)
--   2. Certifique-se de que existem motoristas cadastrados (FGTIPOCADASTRO = 'M')
--   3. Viagens são opcionais (os SOS podem ser criados sem viagem associada)

USE [DIVULGACARGA_PRD]
GO

PRINT '========================================';
PRINT '🚨 Criando alertas SOS de teste';
PRINT '========================================';
PRINT '';

-- Criar tabela temporária global que persiste entre batches
IF OBJECT_ID('tempdb..##DadosTesteSOS') IS NOT NULL DROP TABLE ##DadosTesteSOS;

CREATE TABLE ##DadosTesteSOS (
    idViagem DECIMAL(15, 0) NULL,
    cdMotorista DECIMAL(15, 0) NOT NULL,
    nomeMotorista NVARCHAR(255) NULL
);

-- Buscar motorista válido (tipo 'M')
DECLARE @motoristaTeste DECIMAL(15, 0);
DECLARE @nomeMotorista NVARCHAR(255);

-- OPÇÃO 1: Usar motorista fixo conhecido (9436)
-- Descomente a linha abaixo para usar um motorista específico:
-- SET @motoristaTeste = 9436;

-- OPÇÃO 2: Buscar automaticamente (padrão)
-- Tentar buscar motorista com FGTIPOCADASTRO = 'M'
IF @motoristaTeste IS NULL
BEGIN
    SELECT TOP 1 
        @motoristaTeste = CDCADASTRO,
        @nomeMotorista = RZSOCIAL
    FROM [dbo].[CADASTROGERAL]
    WHERE FGTIPOCADASTRO = 'M'
      AND (FGACTIVE = 'S' OR FGACTIVE IS NULL OR FGACTIVE = 'A')
      AND CDCADASTRO IS NOT NULL
    ORDER BY CDCADASTRO DESC;
END

-- Se não encontrou, tentar buscar qualquer cadastro ativo (sem filtro de tipo)
IF @motoristaTeste IS NULL
BEGIN
    PRINT '⚠️ AVISO: Nenhum motorista com FGTIPOCADASTRO = ''M'' encontrado.';
    PRINT '   Buscando qualquer cadastro ativo...';
    
    SELECT TOP 1 
        @motoristaTeste = CDCADASTRO,
        @nomeMotorista = RZSOCIAL
    FROM [dbo].[CADASTROGERAL]
    WHERE (FGACTIVE = 'S' OR FGACTIVE IS NULL OR FGACTIVE = 'A' OR FGACTIVE = '')
      AND CDCADASTRO IS NOT NULL
    ORDER BY CDCADASTRO DESC;
END

-- Se ainda não encontrou, tentar buscar QUALQUER cadastro (sem filtro de ativo)
IF @motoristaTeste IS NULL
BEGIN
    PRINT '⚠️ AVISO: Nenhum cadastro ativo encontrado.';
    PRINT '   Buscando qualquer cadastro...';
    
    SELECT TOP 1 
        @motoristaTeste = CDCADASTRO,
        @nomeMotorista = RZSOCIAL
    FROM [dbo].[CADASTROGERAL]
    WHERE CDCADASTRO IS NOT NULL
    ORDER BY CDCADASTRO DESC;
END

-- Se ainda não encontrou, usar motorista fixo conhecido (9436)
IF @motoristaTeste IS NULL
BEGIN
    PRINT '⚠️ AVISO: Nenhum cadastro encontrado automaticamente.';
    PRINT '   Usando motorista fixo: 9436';
    SET @motoristaTeste = 9436;
    
    -- Buscar nome do motorista
    SELECT @nomeMotorista = RZSOCIAL
    FROM [dbo].[CADASTROGERAL]
    WHERE CDCADASTRO = @motoristaTeste;
END

-- Validar se o motorista existe
IF NOT EXISTS (SELECT 1 FROM [dbo].[CADASTROGERAL] WHERE CDCADASTRO = @motoristaTeste)
BEGIN
    PRINT '❌ ERRO: Motorista ' + CAST(@motoristaTeste AS VARCHAR) + ' não encontrado no sistema.';
    PRINT '   Verifique se o CDCADASTRO está correto.';
    RETURN;
END

-- Buscar nome se ainda não foi encontrado
IF @nomeMotorista IS NULL
BEGIN
    SELECT @nomeMotorista = RZSOCIAL
    FROM [dbo].[CADASTROGERAL]
    WHERE CDCADASTRO = @motoristaTeste;
END

PRINT '✅ Motorista de teste encontrado: ' + CAST(@motoristaTeste AS VARCHAR) + ' - ' + ISNULL(@nomeMotorista, 'Sem nome');

-- Buscar viagem válida (opcional)
DECLARE @viagemTeste DECIMAL(15, 0);

SELECT TOP 1 @viagemTeste = IDVIAGEM
FROM [dbo].[VIAGEMMESTRE]
WHERE FGACTIVE = 'S'
ORDER BY IDVIAGEM DESC;

IF @viagemTeste IS NOT NULL
BEGIN
    PRINT '✅ Viagem de teste encontrada: ' + CAST(@viagemTeste AS VARCHAR);
END
ELSE
BEGIN
    PRINT '⚠️ AVISO: Nenhuma viagem encontrada. Os alertas SOS serão criados sem IDVIAGEM.';
END

-- Inserir dados na tabela temporária
INSERT INTO ##DadosTesteSOS (idViagem, cdMotorista, nomeMotorista)
VALUES (@viagemTeste, @motoristaTeste, @nomeMotorista);

GO

-- ============================================
-- Criar alertas SOS de teste
-- ============================================

PRINT '';
PRINT '📝 Criando alertas SOS...';
PRINT '';

-- 1. SOS ATIVO (sem leitura) - Recente
DECLARE @idViagem DECIMAL(15, 0);
DECLARE @cdMotorista DECIMAL(15, 0);

SELECT TOP 1 
    @idViagem = idViagem,
    @cdMotorista = cdMotorista
FROM ##DadosTesteSOS;

IF @cdMotorista IS NULL
BEGIN
    PRINT '❌ ERRO: Dados de teste não encontrados na tabela temporária.';
    RETURN;
END

DECLARE @locationPoint NVARCHAR(100) = 'POINT(-46.633309 -23.550520)'; -- São Paulo, SP

INSERT INTO [dbo].[SOS_ALERTS] (
    CDMOTORISTA,
    CDVIAGEM,
    LATITUDE,
    LONGITUDE,
    LOCATION,
    STATUS,
    PRIORITY,
    MESSAGE,
    CREATED_AT,
    SYNCED
)
VALUES (
    @cdMotorista,
    @idViagem,
    -23.550520,
    -46.633309,
    geography::STPointFromText(@locationPoint, 4326),
    'active',
    'critical',
    'Motorista acionou botão de emergência. Necessita assistência imediata.',
    DATEADD(MINUTE, -15, SYSUTCDATETIME()),
    1
);

PRINT '✅ 1/5 - SOS ATIVO criado (há 15 minutos)';

GO

-- 2. SOS ATIVO (já lido) - Mais recente
DECLARE @idViagem DECIMAL(15, 0);
DECLARE @cdMotorista DECIMAL(15, 0);

SELECT TOP 1 
    @idViagem = idViagem,
    @cdMotorista = cdMotorista
FROM ##DadosTesteSOS;

IF @cdMotorista IS NULL
BEGIN
    PRINT '❌ ERRO: Dados de teste não encontrados na tabela temporária.';
    RETURN;
END

DECLARE @locationPoint NVARCHAR(100) = 'POINT(-43.172896 -22.906847)'; -- Rio de Janeiro, RJ

-- Buscar ID de um usuário admin para marcar como lido
DECLARE @idUsuarioLeu DECIMAL(15, 0);
SELECT TOP 1 @idUsuarioLeu = CDCADASTRO
FROM [dbo].[CADASTROGERAL]
WHERE FGTIPOCADASTRO = 'U' OR FGTIPOCADASTRO IS NULL
ORDER BY CDCADASTRO DESC;

INSERT INTO [dbo].[SOS_ALERTS] (
    CDMOTORISTA,
    CDVIAGEM,
    LATITUDE,
    LONGITUDE,
    LOCATION,
    STATUS,
    PRIORITY,
    MESSAGE,
    CREATED_AT,
    ID_USUARIO_LEU,
    DH_LEITURA,
    SYNCED
)
VALUES (
    @cdMotorista,
    @idViagem,
    -22.906847,
    -43.172896,
    geography::STPointFromText(@locationPoint, 4326),
    'active',
    'critical',
    'Emergência: Veículo com problema mecânico. Motorista aguardando socorro.',
    DATEADD(MINUTE, -5, SYSUTCDATETIME()),
    @idUsuarioLeu,
    DATEADD(MINUTE, -3, SYSUTCDATETIME()),
    1
);

PRINT '✅ 2/5 - SOS ATIVO (lido) criado (há 5 minutos)';

GO

-- 3. SOS RESOLVIDO - Com tempo de resposta
DECLARE @idViagem DECIMAL(15, 0);
DECLARE @cdMotorista DECIMAL(15, 0);

SELECT TOP 1 
    @idViagem = idViagem,
    @cdMotorista = cdMotorista
FROM ##DadosTesteSOS;

IF @cdMotorista IS NULL
BEGIN
    PRINT '❌ ERRO: Dados de teste não encontrados na tabela temporária.';
    RETURN;
END

DECLARE @locationPoint NVARCHAR(100) = 'POINT(-38.481277 -12.971598)'; -- Salvador, BA

DECLARE @idUsuarioResolveu DECIMAL(15, 0);
SELECT TOP 1 @idUsuarioResolveu = CDCADASTRO
FROM [dbo].[CADASTROGERAL]
WHERE FGTIPOCADASTRO = 'U' OR FGTIPOCADASTRO IS NULL
ORDER BY CDCADASTRO DESC;

DECLARE @createdAt DATETIME2 = DATEADD(HOUR, -2, SYSUTCDATETIME());
DECLARE @resolvedAt DATETIME2 = DATEADD(HOUR, -1, SYSUTCDATETIME());
DECLARE @tempoResposta INT = DATEDIFF(MINUTE, @createdAt, @resolvedAt);

INSERT INTO [dbo].[SOS_ALERTS] (
    CDMOTORISTA,
    CDVIAGEM,
    LATITUDE,
    LONGITUDE,
    LOCATION,
    STATUS,
    PRIORITY,
    MESSAGE,
    CREATED_AT,
    RESOLVED_AT,
    RESOLVED_BY,
    RESOLUTION_NOTES,
    TEMPO_RESPOSTA,
    SYNCED
)
VALUES (
    @cdMotorista,
    @idViagem,
    -12.971598,
    -38.481277,
    geography::STPointFromText(@locationPoint, 4326),
    'resolved',
    'critical',
    'Emergência: Acidente sem vítimas. Veículo danificado.',
    @createdAt,
    @resolvedAt,
    @idUsuarioResolveu,
    'SOS resolvido: Equipe de suporte acionada. Motorista assistido e veículo rebocado.',
    @tempoResposta,
    1
);

PRINT '✅ 3/5 - SOS RESOLVIDO criado (resolvido há 1 hora, tempo de resposta: ' + CAST(@tempoResposta AS VARCHAR) + ' minutos)';

GO

-- 4. SOS RESOLVIDO - Resolvido rapidamente
DECLARE @idViagem DECIMAL(15, 0);
DECLARE @cdMotorista DECIMAL(15, 0);

SELECT TOP 1 
    @idViagem = idViagem,
    @cdMotorista = cdMotorista
FROM ##DadosTesteSOS;

IF @cdMotorista IS NULL
BEGIN
    PRINT '❌ ERRO: Dados de teste não encontrados na tabela temporária.';
    RETURN;
END

DECLARE @locationPoint NVARCHAR(100) = 'POINT(-49.273587 -25.428356)'; -- Curitiba, PR

DECLARE @idUsuarioResolveu DECIMAL(15, 0);
SELECT TOP 1 @idUsuarioResolveu = CDCADASTRO
FROM [dbo].[CADASTROGERAL]
WHERE FGTIPOCADASTRO = 'U' OR FGTIPOCADASTRO IS NULL
ORDER BY CDCADASTRO DESC;

DECLARE @createdAt DATETIME2 = DATEADD(DAY, -1, SYSUTCDATETIME());
DECLARE @resolvedAt DATETIME2 = DATEADD(DAY, -1, DATEADD(MINUTE, 12, SYSUTCDATETIME()));
DECLARE @tempoResposta INT = DATEDIFF(MINUTE, @createdAt, @resolvedAt);

INSERT INTO [dbo].[SOS_ALERTS] (
    CDMOTORISTA,
    CDVIAGEM,
    LATITUDE,
    LONGITUDE,
    LOCATION,
    STATUS,
    PRIORITY,
    MESSAGE,
    CREATED_AT,
    RESOLVED_AT,
    RESOLVED_BY,
    RESOLUTION_NOTES,
    TEMPO_RESPOSTA,
    SYNCED
)
VALUES (
    @cdMotorista,
    @idViagem,
    -25.428356,
    -49.273587,
    geography::STPointFromText(@locationPoint, 4326),
    'resolved',
    'critical',
    'Emergência: Motorista relatou assalto. Polícia acionada.',
    @createdAt,
    @resolvedAt,
    @idUsuarioResolveu,
    'SOS resolvido: Motorista seguro. Polícia no local. Carga verificada.',
    @tempoResposta,
    1
);

PRINT '✅ 4/5 - SOS RESOLVIDO criado (resolvido há 1 dia, tempo de resposta: ' + CAST(@tempoResposta AS VARCHAR) + ' minutos)';

GO

-- 5. SOS CANCELADO - Falso alarme
DECLARE @idViagem DECIMAL(15, 0);
DECLARE @cdMotorista DECIMAL(15, 0);

SELECT TOP 1 
    @idViagem = idViagem,
    @cdMotorista = cdMotorista
FROM ##DadosTesteSOS;

IF @cdMotorista IS NULL
BEGIN
    PRINT '❌ ERRO: Dados de teste não encontrados na tabela temporária.';
    RETURN;
END

DECLARE @locationPoint NVARCHAR(100) = 'POINT(-43.937775 -19.916681)'; -- Belo Horizonte, MG

DECLARE @idUsuarioCancelou DECIMAL(15, 0);
SELECT TOP 1 @idUsuarioCancelou = CDCADASTRO
FROM [dbo].[CADASTROGERAL]
WHERE FGTIPOCADASTRO = 'U' OR FGTIPOCADASTRO IS NULL
ORDER BY CDCADASTRO DESC;

INSERT INTO [dbo].[SOS_ALERTS] (
    CDMOTORISTA,
    CDVIAGEM,
    LATITUDE,
    LONGITUDE,
    LOCATION,
    STATUS,
    PRIORITY,
    MESSAGE,
    CREATED_AT,
    RESOLVED_AT,
    RESOLVED_BY,
    RESOLUTION_NOTES,
    SYNCED
)
VALUES (
    @cdMotorista,
    @idViagem,
    -19.916681,
    -43.937775,
    geography::STPointFromText(@locationPoint, 4326),
    'cancelled',
    'critical',
    'Emergência acionada acidentalmente pelo motorista.',
    DATEADD(HOUR, -6, SYSUTCDATETIME()),
    DATEADD(HOUR, -5, SYSUTCDATETIME()),
    @idUsuarioCancelou,
    'SOS cancelado: Falso alarme. Motorista confirmou que acionou por engano.',
    1
);

PRINT '✅ 5/5 - SOS CANCELADO criado (cancelado há 5 horas)';

GO

-- ============================================
-- Verificação dos SOS criados
-- ============================================

PRINT '';
PRINT '========================================';
PRINT '✅ Verificação dos SOS criados';
PRINT '========================================';

SELECT 
    ID,
    CDMOTORISTA,
    CDVIAGEM,
    STATUS,
    PRIORITY,
    MESSAGE,
    CREATED_AT,
    RESOLVED_AT,
    TEMPO_RESPOSTA,
    CASE 
        WHEN STATUS = 'active' AND ID_USUARIO_LEU IS NULL THEN 'Ativo (não lido)'
        WHEN STATUS = 'active' AND ID_USUARIO_LEU IS NOT NULL THEN 'Ativo (lido)'
        WHEN STATUS = 'resolved' THEN 'Resolvido'
        WHEN STATUS = 'cancelled' THEN 'Cancelado'
        ELSE STATUS
    END AS STATUS_DESCRICAO
FROM [dbo].[SOS_ALERTS]
WHERE CDMOTORISTA = (SELECT TOP 1 cdMotorista FROM ##DadosTesteSOS)
ORDER BY CREATED_AT DESC;

PRINT '';
PRINT '========================================';
PRINT '✅ Script concluído!';
PRINT '========================================';
PRINT '';
PRINT '📋 Próximos passos:';
PRINT '   1. Acesse o módulo SOS no sistema';
PRINT '   2. Verifique se os alertas aparecem na lista';
PRINT '   3. Teste as funcionalidades conforme o guia de testes';
PRINT '';
PRINT '📊 Resumo dos SOS criados:';
PRINT '   - 2x SOS Ativos (1 não lido, 1 lido)';
PRINT '   - 2x SOS Resolvidos (com tempo de resposta)';
PRINT '   - 1x SOS Cancelado';
PRINT '';
PRINT 'Horário de conclusão: ' + CONVERT(VARCHAR, SYSUTCDATETIME(), 120);

-- Limpar tabela temporária
IF OBJECT_ID('tempdb..##DadosTesteSOS') IS NOT NULL DROP TABLE ##DadosTesteSOS;

GO
