-- ============================================
-- Script para criar alertas de teste
-- Módulo: Alertas
-- ============================================
-- Data: 2025-01-18
-- IMPORTANTE: Execute este script no banco de dados DIVULGACARGA_PRD
--
-- Este script cria alertas de exemplo para testar o módulo Alertas.
-- Os alertas são criados com diferentes status, tipos e prioridades.
--
-- ⚠️ ATENÇÃO: Este script cria dados de teste. Use apenas em ambiente de desenvolvimento/teste.

USE [DIVULGACARGA_PRD]
GO

PRINT '========================================';
PRINT '🧪 Criando alertas de teste';
PRINT '========================================';
PRINT '';

-- Usar IDVIAGEM fixo para testes: 82992
-- Criar tabela temporária global que persiste entre batches
IF OBJECT_ID('tempdb..##DadosTesteAlertas') IS NOT NULL DROP TABLE ##DadosTesteAlertas;

CREATE TABLE ##DadosTesteAlertas (
    idViagem DECIMAL(15, 0) NOT NULL,
    cdMotorista DECIMAL(15, 0) NULL
);

-- IDVIAGEM fixo para testes
DECLARE @viagemTeste DECIMAL(15, 0) = 82992;
DECLARE @motoristaTeste DECIMAL(15, 0);

-- Verificar se a viagem existe
IF NOT EXISTS (SELECT 1 FROM [dbo].[VIAGEMMESTRE] WHERE IDVIAGEM = @viagemTeste)
BEGIN
    PRINT '⚠️ AVISO: Viagem ' + CAST(@viagemTeste AS VARCHAR) + ' não encontrada no sistema.';
    PRINT '   O script continuará, mas pode haver erro de foreign key.';
END
ELSE
BEGIN
    PRINT '✅ Viagem de teste encontrada: ' + CAST(@viagemTeste AS VARCHAR);
END

-- Buscar motorista associado à viagem
SELECT TOP 1 @motoristaTeste = CDCADASTRO_MOTORISTA 
FROM [dbo].[CONVOCACAO] 
WHERE IDVIAGEM = @viagemTeste 
ORDER BY DHRESPOSTA DESC;

IF @motoristaTeste IS NOT NULL
    PRINT '✅ Motorista encontrado: ' + CAST(@motoristaTeste AS VARCHAR);
ELSE
    PRINT 'ℹ️ Nenhum motorista encontrado para esta viagem.';

-- Inserir na tabela temporária global
INSERT INTO ##DadosTesteAlertas (idViagem, cdMotorista) 
VALUES (@viagemTeste, @motoristaTeste);

PRINT '';

GO

-- ============================================
-- 1. ALERTA DE ATRASO (Urgente)
-- ============================================
PRINT '📋 1/5 - Criando alerta de ATRASO (Urgente)...';

IF NOT EXISTS (SELECT 1 FROM [dbo].[ALERTS] WHERE TYPE = 'ATRASO' AND PRIORIDADE = 'Urgente' AND STATUS = 'Pendente')
BEGIN
    DECLARE @idViagem1 DECIMAL(15, 0);
    DECLARE @cdMotorista1 DECIMAL(15, 0);
    
    SELECT @idViagem1 = idViagem, @cdMotorista1 = cdMotorista FROM ##DadosTesteAlertas;
    
    INSERT INTO [dbo].[ALERTS] (
        IDVIAGEM,
        CDMOTORISTA,
        TYPE,
        MESSAGE,
        SEVERITY,
        PRIORIDADE,
        STATUS,
        DETAILS,
        CREATED_AT,
        RESOLVED
    ) VALUES (
        @idViagem1,
        @cdMotorista1,
        'ATRASO',
        'Atraso crítico detectado: Viagem com mais de 2 horas de atraso no ETA',
        'high',
        'Urgente',
        'Pendente',
        '{"atrasoMinutos": 125, "etaOriginal": "2025-01-18T14:00:00", "etaAtual": "2025-01-18T16:05:00"}',
        DATEADD(HOUR, -1, GETDATE()),
        0
    );
    PRINT '   ✅ Alerta de ATRASO criado';
END
ELSE
BEGIN
    PRINT '   ℹ️ Alerta de ATRASO já existe';
END
GO

-- ============================================
-- 2. ALERTA DE PARADA (Alta)
-- ============================================
PRINT '📋 2/5 - Criando alerta de PARADA (Alta)...';

IF NOT EXISTS (SELECT 1 FROM [dbo].[ALERTS] WHERE TYPE = 'PARADA' AND PRIORIDADE = 'Alta' AND STATUS = 'Pendente')
BEGIN
    DECLARE @idViagem2 DECIMAL(15, 0);
    DECLARE @cdMotorista2 DECIMAL(15, 0);
    
    SELECT @idViagem2 = idViagem, @cdMotorista2 = cdMotorista FROM ##DadosTesteAlertas;
    
    INSERT INTO [dbo].[ALERTS] (
        IDVIAGEM,
        CDMOTORISTA,
        TYPE,
        MESSAGE,
        SEVERITY,
        PRIORIDADE,
        STATUS,
        DETAILS,
        CREATED_AT,
        RESOLVED
    ) VALUES (
        @idViagem2,
        @cdMotorista2,
        'PARADA',
        'Parada prolongada detectada: Motorista parado há 45 minutos',
        'medium',
        'Alta',
        'Pendente',
        '{"minutosParado": 45, "velocidadeMedia": 2.5, "ultimaPosicao": "2025-01-18T15:20:00"}',
        DATEADD(MINUTE, -30, GETDATE()),
        0
    );
    PRINT '   ✅ Alerta de PARADA criado';
END
ELSE
BEGIN
    PRINT '   ℹ️ Alerta de PARADA já existe';
END
GO

-- ============================================
-- 3. ALERTA OFFLINE (Normal)
-- ============================================
PRINT '📋 3/5 - Criando alerta de OFFLINE (Normal)...';

IF NOT EXISTS (SELECT 1 FROM [dbo].[ALERTS] WHERE TYPE = 'OFFLINE' AND PRIORIDADE = 'Normal' AND STATUS = 'Pendente')
BEGIN
    DECLARE @idViagem3 DECIMAL(15, 0);
    DECLARE @cdMotorista3 DECIMAL(15, 0);
    
    SELECT @idViagem3 = idViagem, @cdMotorista3 = cdMotorista FROM ##DadosTesteAlertas;
    
    INSERT INTO [dbo].[ALERTS] (
        IDVIAGEM,
        CDMOTORISTA,
        TYPE,
        MESSAGE,
        SEVERITY,
        PRIORIDADE,
        STATUS,
        DETAILS,
        CREATED_AT,
        RESOLVED
    ) VALUES (
        @idViagem3,
        @cdMotorista3,
        'OFFLINE',
        'Motorista offline: Sem atualização GPS há 95 minutos',
        'medium',
        'Normal',
        'Pendente',
        '{"minutosOffline": 95, "ultimaAtualizacao": "2025-01-18T13:45:00"}',
        DATEADD(MINUTE, -20, GETDATE()),
        0
    );
    PRINT '   ✅ Alerta de OFFLINE criado';
END
ELSE
BEGIN
    PRINT '   ℹ️ Alerta de OFFLINE já existe';
END
GO

-- ============================================
-- 4. ALERTA DE DESVIO (Alta) - Em Análise
-- ============================================
PRINT '📋 4/5 - Criando alerta de DESVIO (Alta - Em Análise)...';

IF NOT EXISTS (SELECT 1 FROM [dbo].[ALERTS] WHERE TYPE = 'DESVIO' AND STATUS = 'Em Análise')
BEGIN
    DECLARE @idViagem4 DECIMAL(15, 0);
    DECLARE @cdMotorista4 DECIMAL(15, 0);
    DECLARE @idAlertaDesvio INT;
    DECLARE @idUsuarioAdmin DECIMAL(15, 0);
    
    SELECT @idViagem4 = idViagem, @cdMotorista4 = cdMotorista FROM ##DadosTesteAlertas;
    SELECT TOP 1 @idUsuarioAdmin = CDCADASTRO 
    FROM [dbo].[CADASTROGERAL] 
    WHERE RZSOCIAL LIKE '%Admin%' OR RZSOCIAL LIKE '%admin%'
    ORDER BY CDCADASTRO;
    
    INSERT INTO [dbo].[ALERTS] (
        IDVIAGEM,
        CDMOTORISTA,
        TYPE,
        MESSAGE,
        SEVERITY,
        PRIORIDADE,
        STATUS,
        DETAILS,
        CREATED_AT,
        RESOLVED,
        ID_USUARIO_LEU,
        DH_LEITURA
    ) VALUES (
        @idViagem4,
        @cdMotorista4,
        'DESVIO',
        'Desvio de rota detectado: Motorista a 850m da rota planejada',
        'medium',
        'Alta',
        'Em Análise',
        '{"distanciaDesvio": 850, "rotaPlanejada": "Rota A", "posicaoAtual": "Lat: -23.5, Lng: -46.6"}',
        DATEADD(HOUR, -2, GETDATE()),
        0,
        @idUsuarioAdmin,
        DATEADD(HOUR, -1, GETDATE())
    );
    
    SET @idAlertaDesvio = SCOPE_IDENTITY();
    
    -- Criar histórico de leitura
    IF @idAlertaDesvio IS NOT NULL AND @idUsuarioAdmin IS NOT NULL
    BEGIN
        INSERT INTO [dbo].[ALERT_HISTORY] (
            ID_ALERT,
            ID_USUARIO,
            ACAO,
            STATUS_ANTERIOR,
            STATUS_NOVO,
            OBSERVACOES,
            DH_ACAO
        ) VALUES (
            @idAlertaDesvio,
            @idUsuarioAdmin,
            'LEU',
            'Pendente',
            'Em Análise',
            'Alerta visualizado e em análise',
            DATEADD(HOUR, -1, GETDATE())
        );
    END
    
    PRINT '   ✅ Alerta de DESVIO criado (Em Análise)';
END
ELSE
BEGIN
    PRINT '   ℹ️ Alerta de DESVIO já existe';
END
GO

-- ============================================
-- 5. ALERTA TRATADO (Exemplo)
-- ============================================
PRINT '📋 5/5 - Criando alerta TRATADO (exemplo)...';

IF NOT EXISTS (SELECT 1 FROM [dbo].[ALERTS] WHERE STATUS = 'Tratado' AND TYPE = 'ATRASO')
BEGIN
    DECLARE @idViagem5 DECIMAL(15, 0);
    DECLARE @cdMotorista5 DECIMAL(15, 0);
    DECLARE @idAlertaTratado INT;
    DECLARE @idUsuarioAdmin5 DECIMAL(15, 0);
    
    SELECT @idViagem5 = idViagem, @cdMotorista5 = cdMotorista FROM ##DadosTesteAlertas;
    SELECT TOP 1 @idUsuarioAdmin5 = CDCADASTRO 
    FROM [dbo].[CADASTROGERAL] 
    WHERE RZSOCIAL LIKE '%Admin%' OR RZSOCIAL LIKE '%admin%'
    ORDER BY CDCADASTRO;
    
    INSERT INTO [dbo].[ALERTS] (
        IDVIAGEM,
        CDMOTORISTA,
        TYPE,
        MESSAGE,
        SEVERITY,
        PRIORIDADE,
        STATUS,
        DETAILS,
        CREATED_AT,
        RESOLVED,
        ID_USUARIO_LEU,
        DH_LEITURA,
        ID_USUARIO_TRATOU,
        DH_TRATAMENTO,
        OBSERVACOES
    ) VALUES (
        @idViagem5,
        @cdMotorista5,
        'ATRASO',
        'Atraso detectado: Viagem com 1 hora de atraso (RESOLVIDO)',
        'medium',
        'Normal',
        'Tratado',
        '{"atrasoMinutos": 60, "resolvido": true}',
        DATEADD(DAY, -1, GETDATE()),
        1,
        @idUsuarioAdmin5,
        DATEADD(DAY, -1, DATEADD(HOUR, 1, GETDATE())),
        @idUsuarioAdmin5,
        DATEADD(DAY, -1, DATEADD(HOUR, 2, GETDATE())),
        'Atraso resolvido após contato com motorista. Viagem retomada normalmente.'
    );
    
    SET @idAlertaTratado = SCOPE_IDENTITY();
    
    -- Criar histórico completo
    IF @idAlertaTratado IS NOT NULL AND @idUsuarioAdmin5 IS NOT NULL
    BEGIN
        INSERT INTO [dbo].[ALERT_HISTORY] (
            ID_ALERT,
            ID_USUARIO,
            ACAO,
            STATUS_ANTERIOR,
            STATUS_NOVO,
            OBSERVACOES,
            DH_ACAO
        ) VALUES 
        (
            @idAlertaTratado,
            @idUsuarioAdmin5,
            'LEU',
            NULL,
            'Pendente',
            'Alerta visualizado',
            DATEADD(DAY, -1, DATEADD(HOUR, 1, GETDATE()))
        ),
        (
            @idAlertaTratado,
            @idUsuarioAdmin5,
            'TRATOU',
            'Pendente',
            'Tratado',
            'Atraso resolvido após contato com motorista',
            DATEADD(DAY, -1, DATEADD(HOUR, 2, GETDATE()))
        );
    END
    
    PRINT '   ✅ Alerta TRATADO criado (exemplo)';
END
ELSE
BEGIN
    PRINT '   ℹ️ Alerta TRATADO já existe';
END
GO

-- Limpar tabela temporária
IF OBJECT_ID('tempdb..##DadosTesteAlertas') IS NOT NULL DROP TABLE ##DadosTesteAlertas;
GO

-- ============================================
-- VERIFICAÇÃO FINAL
-- ============================================
PRINT '';
PRINT '========================================';
PRINT '✅ Verificação dos alertas criados';
PRINT '========================================';

SELECT 
    COUNT(*) as TotalAlertas,
    SUM(CASE WHEN STATUS = 'Pendente' THEN 1 ELSE 0 END) as Pendentes,
    SUM(CASE WHEN STATUS = 'Em Análise' THEN 1 ELSE 0 END) as EmAnalise,
    SUM(CASE WHEN STATUS = 'Tratado' THEN 1 ELSE 0 END) as Tratados,
    SUM(CASE WHEN PRIORIDADE = 'Urgente' THEN 1 ELSE 0 END) as Urgentes,
    SUM(CASE WHEN PRIORIDADE = 'Alta' THEN 1 ELSE 0 END) as Alta,
    SUM(CASE WHEN PRIORIDADE = 'Normal' THEN 1 ELSE 0 END) as Normal
FROM [dbo].[ALERTS];
GO

PRINT '';
PRINT '========================================';
PRINT '✅ Script concluído!';
PRINT '========================================';
PRINT '';
PRINT '📝 Próximos passos:';
PRINT '   1. Acesse o módulo Alertas no sistema';
PRINT '   2. Verifique se os alertas aparecem na lista';
PRINT '   3. Teste as funcionalidades conforme o guia de testes';
PRINT '';
PRINT '📋 Alertas criados:';
PRINT '   - 1x ATRASO (Urgente, Pendente)';
PRINT '   - 1x PARADA (Alta, Pendente)';
PRINT '   - 1x OFFLINE (Normal, Pendente)';
PRINT '   - 1x DESVIO (Alta, Em Análise)';
PRINT '   - 1x ATRASO (Normal, Tratado)';
PRINT '';
GO
