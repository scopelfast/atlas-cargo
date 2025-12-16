/*
=============================================================================
Script: Inserir Posições GPS de Teste
Descrição: Insere posições GPS de exemplo para testar o rastreamento
Data: 2025-01-27
=============================================================================
*/

USE [DIVULGACARGA_PRD]
GO

-- Verificar se a tabela existe
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'VIAGEM_RASTREAMENTO')
BEGIN
    PRINT '❌ Tabela VIAGEM_RASTREAMENTO não existe!';
    PRINT 'Execute primeiro: backend/scripts/criar_tabelas_app_motorista.sql';
    RETURN;
END
GO

-- ========================================
-- CONFIGURAÇÃO
-- ========================================
DECLARE @IDVIAGEM DECIMAL(15,0) = 82911;  -- ID da viagem
DECLARE @CDMOTORISTA DECIMAL(15,0) = 9436;  -- Código do motorista (Mauricio)

-- Verificar se a viagem existe
IF NOT EXISTS (SELECT 1 FROM [dbo].[VIAGEMMESTRE] WHERE IDVIAGEM = @IDVIAGEM)
BEGIN
    PRINT '❌ Viagem ' + CAST(@IDVIAGEM AS VARCHAR) + ' não encontrada!';
    PRINT 'Ajuste o @IDVIAGEM no script.';
    RETURN;
END

-- Verificar se o motorista existe
IF NOT EXISTS (SELECT 1 FROM [dbo].[CADASTROGERAL] WHERE CDCADASTRO = @CDMOTORISTA)
BEGIN
    PRINT '❌ Motorista ' + CAST(@CDMOTORISTA AS VARCHAR) + ' não encontrado!';
    PRINT 'Ajuste o @CDMOTORISTA no script.';
    RETURN;
END

-- Verificar se o motorista está na viagem
IF NOT EXISTS (SELECT 1 FROM [dbo].[VIAGEMMOTORISTA] WHERE IDVIAGEM = @IDVIAGEM AND CDMOTORISTA = @CDMOTORISTA)
BEGIN
    PRINT '⚠️  Motorista não está cadastrado na viagem.';
    PRINT 'Deseja adicionar? (Execute manualmente se necessário)';
    -- Não adicionar automaticamente para não modificar dados sem permissão
END

PRINT '✅ Viagem e motorista encontrados!';
PRINT '';

-- ========================================
-- LIMPAR POSIÇÕES EXISTENTES (OPCIONAL)
-- ========================================
-- Descomente para limpar posições antigas antes de inserir
/*
DELETE FROM [dbo].[VIAGEM_RASTREAMENTO]
WHERE IDVIAGEM = @IDVIAGEM AND CDCADASTRO = @CDMOTORISTA;
PRINT '🗑️  Posições antigas removidas.';
*/

-- ========================================
-- INSERIR POSIÇÕES DE TESTE
-- ========================================
-- Rota de exemplo: Curitiba -> São Paulo (via BR-116)
-- Coordenadas reais da rodovia

PRINT '📍 Inserindo posições de teste...';
PRINT '';

-- Posição 1: Curitiba (Início)
INSERT INTO [dbo].[VIAGEM_RASTREAMENTO] (
    IDVIAGEM, CDCADASTRO, LATITUDE, LONGITUDE, VELOCIDADE, PRECISAO, 
    DHREGISTRO, TIPO, FONTE
)
VALUES (
    @IDVIAGEM, @CDMOTORISTA, -25.428472, -49.273391, 0, 10,
    DATEADD(MINUTE, -120, GETDATE()), 'A', 'APP'
);

-- Posição 2: Saída de Curitiba
INSERT INTO [dbo].[VIAGEM_RASTREAMENTO] (
    IDVIAGEM, CDCADASTRO, LATITUDE, LONGITUDE, VELOCIDADE, PRECISAO, 
    DHREGISTRO, TIPO, FONTE
)
VALUES (
    @IDVIAGEM, @CDMOTORISTA, -25.450000, -49.300000, 45, 15,
    DATEADD(MINUTE, -115, GETDATE()), 'A', 'APP'
);

-- Posição 3: Em trânsito
INSERT INTO [dbo].[VIAGEM_RASTREAMENTO] (
    IDVIAGEM, CDCADASTRO, LATITUDE, LONGITUDE, VELOCIDADE, PRECISAO, 
    DHREGISTRO, TIPO, FONTE
)
VALUES (
    @IDVIAGEM, @CDMOTORISTA, -25.500000, -49.350000, 80, 12,
    DATEADD(MINUTE, -110, GETDATE()), 'A', 'APP'
);

-- Posição 4: Em trânsito
INSERT INTO [dbo].[VIAGEM_RASTREAMENTO] (
    IDVIAGEM, CDCADASTRO, LATITUDE, LONGITUDE, VELOCIDADE, PRECISAO, 
    DHREGISTRO, TIPO, FONTE
)
VALUES (
    @IDVIAGEM, @CDMOTORISTA, -25.550000, -49.400000, 85, 10,
    DATEADD(MINUTE, -105, GETDATE()), 'A', 'APP'
);

-- Posição 5: Em trânsito
INSERT INTO [dbo].[VIAGEM_RASTREAMENTO] (
    IDVIAGEM, CDCADASTRO, LATITUDE, LONGITUDE, VELOCIDADE, PRECISAO, 
    DHREGISTRO, TIPO, FONTE
)
VALUES (
    @IDVIAGEM, @CDMOTORISTA, -25.600000, -49.450000, 90, 8,
    DATEADD(MINUTE, -100, GETDATE()), 'A', 'APP'
);

-- Posição 6: Em trânsito
INSERT INTO [dbo].[VIAGEM_RASTREAMENTO] (
    IDVIAGEM, CDCADASTRO, LATITUDE, LONGITUDE, VELOCIDADE, PRECISAO, 
    DHREGISTRO, TIPO, FONTE
)
VALUES (
    @IDVIAGEM, @CDMOTORISTA, -25.650000, -49.500000, 75, 10,
    DATEADD(MINUTE, -95, GETDATE()), 'A', 'APP'
);

-- Posição 7: Em trânsito
INSERT INTO [dbo].[VIAGEM_RASTREAMENTO] (
    IDVIAGEM, CDCADASTRO, LATITUDE, LONGITUDE, VELOCIDADE, PRECISAO, 
    DHREGISTRO, TIPO, FONTE
)
VALUES (
    @IDVIAGEM, @CDMOTORISTA, -25.700000, -49.550000, 88, 9,
    DATEADD(MINUTE, -90, GETDATE()), 'A', 'APP'
);

-- Posição 8: Em trânsito
INSERT INTO [dbo].[VIAGEM_RASTREAMENTO] (
    IDVIAGEM, CDCADASTRO, LATITUDE, LONGITUDE, VELOCIDADE, PRECISAO, 
    DHREGISTRO, TIPO, FONTE
)
VALUES (
    @IDVIAGEM, @CDMOTORISTA, -25.750000, -49.600000, 82, 11,
    DATEADD(MINUTE, -85, GETDATE()), 'A', 'APP'
);

-- Posição 9: Em trânsito
INSERT INTO [dbo].[VIAGEM_RASTREAMENTO] (
    IDVIAGEM, CDCADASTRO, LATITUDE, LONGITUDE, VELOCIDADE, PRECISAO, 
    DHREGISTRO, TIPO, FONTE
)
VALUES (
    @IDVIAGEM, @CDMOTORISTA, -25.800000, -49.650000, 78, 10,
    DATEADD(MINUTE, -80, GETDATE()), 'A', 'APP'
);

-- Posição 10: Última posição (Fim)
INSERT INTO [dbo].[VIAGEM_RASTREAMENTO] (
    IDVIAGEM, CDCADASTRO, LATITUDE, LONGITUDE, VELOCIDADE, PRECISAO, 
    DHREGISTRO, TIPO, FONTE
)
VALUES (
    @IDVIAGEM, @CDMOTORISTA, -25.850000, -49.700000, 0, 8,
    DATEADD(MINUTE, -75, GETDATE()), 'A', 'APP'
);

PRINT '✅ 10 posições de teste inseridas!';
PRINT '';

-- Verificar posições inseridas
SELECT 
    COUNT(*) AS TOTAL_POSICOES,
    MIN(DHREGISTRO) AS PRIMEIRA_POSICAO,
    MAX(DHREGISTRO) AS ULTIMA_POSICAO
FROM [dbo].[VIAGEM_RASTREAMENTO]
WHERE IDVIAGEM = @IDVIAGEM AND CDCADASTRO = @CDMOTORISTA;

PRINT '';
PRINT '=========================================';
PRINT '  ✅ POSIÇÕES DE TESTE INSERIDAS!';
PRINT '=========================================';
PRINT '';
PRINT '📋 Próximos passos:';
PRINT '   1. Acesse a aba "📍 Rastreamento" no sistema';
PRINT '   2. Selecione a viagem ' + CAST(@IDVIAGEM AS VARCHAR);
PRINT '   3. Visualize o traçado da rota no mapa';
PRINT '';

