-- ============================================
-- Script para testar geração de alertas
-- Módulo: Alertas
-- ============================================
-- Data: 2026-01-18
-- IMPORTANTE: Execute este script no banco de dados ATLAS_CARGO_PRD
--
-- Este script ajuda a preparar dados para testar a geração automática de alertas.
-- Ele cria cenários de teste para cada tipo de alerta.
--
-- ⚠️ ATENÇÃO: Este script cria/modifica dados de teste. Use apenas em ambiente de desenvolvimento/teste.

USE [ATLAS_CARGO_PRD]
GO

PRINT '========================================';
PRINT '🧪 Preparando dados para teste de alertas';
PRINT '========================================';
PRINT '';

-- ============================================
-- 1. VERIFICAR VIAGEM DE TESTE
-- ============================================
DECLARE @idViagemTeste DECIMAL(15, 0) = 83173; -- Use a viagem que você quer testar

PRINT '📋 Verificando viagem de teste: ' + CAST(@idViagemTeste AS VARCHAR);
PRINT '';

-- Verificar se viagem existe e está ativa
IF NOT EXISTS (
  SELECT 1 
  FROM [dbo].[VIAGEMMESTRE] v
  INNER JOIN [dbo].[SITUACAOVIAGEM] s ON v.CDSITUACAOVIAGEM = s.CDSITUACAOVIAGEM
  WHERE v.IDVIAGEM = @idViagemTeste
    AND (UPPER(s.DSSITUACAOVIAGEM) LIKE '%ANDAMENTO%' 
      OR UPPER(s.DSSITUACAOVIAGEM) LIKE '%CONFIRMADA%')
    AND v.FGACTIVE = 'A'
)
BEGIN
  PRINT '⚠️ AVISO: Viagem ' + CAST(@idViagemTeste AS VARCHAR) + ' não está ativa ou não existe.';
  PRINT '   Verifique se a viagem tem status "Em Andamento" ou "Confirmada".';
  PRINT '';
END
ELSE
BEGIN
  PRINT '✅ Viagem encontrada e ativa';
  PRINT '';
END

-- ============================================
-- 2. CENÁRIO 1: PARADA PROLONGADA
-- ============================================
PRINT '📋 CENÁRIO 1: Parada Prolongada';
PRINT '   Para testar: Insira posições GPS com velocidade < 5 km/h há 30+ minutos';
PRINT '';

-- Verificar últimas posições
SELECT 
  COUNT(*) as total_posicoes,
  AVG(VELOCIDADE) as velocidade_media,
  MIN(DHREGISTRO) as primeira_posicao,
  MAX(DHREGISTRO) as ultima_posicao,
  DATEDIFF(MINUTE, MIN(DHREGISTRO), MAX(DHREGISTRO)) as minutos_entre_posicoes
FROM [dbo].[VIAGEMRASTREAMENTO]
WHERE IDVIAGEM = @idViagemTeste
  AND DHREGISTRO >= DATEADD(MINUTE, -60, GETDATE())
  AND VELOCIDADE < 5;
GO

-- ============================================
-- 3. CENÁRIO 2: ATRASO
-- ============================================
PRINT '📋 CENÁRIO 2: Atraso no ETA';
PRINT '   Para testar: Configure DTPREVFINAL próximo e posição GPS distante do destino';
PRINT '';

-- Verificar prazo de entrega
SELECT 
  IDVIAGEM,
  DTPREVFINAL as prazo_entrega,
  DATEDIFF(MINUTE, GETDATE(), DTPREVFINAL) as minutos_ate_prazo,
  IDROTEIRO
FROM [dbo].[VIAGEMMESTRE]
WHERE IDVIAGEM = @idViagemTeste;
GO

-- Verificar última posição GPS
SELECT TOP 1
  LATITUDE,
  LONGITUDE,
  VELOCIDADE,
  DHREGISTRO,
  DATEDIFF(MINUTE, DHREGISTRO, GETDATE()) as minutos_atras
FROM [dbo].[VIAGEMRASTREAMENTO]
WHERE IDVIAGEM = @idViagemTeste
ORDER BY DHREGISTRO DESC;
GO

-- ============================================
-- 4. CENÁRIO 3: OFFLINE
-- ============================================
PRINT '📋 CENÁRIO 3: Motorista Offline';
PRINT '   Para testar: Não insira posições GPS por 90+ minutos';
PRINT '';

-- Verificar última atualização GPS
SELECT 
  MAX(DHREGISTRO) as ultima_atualizacao,
  DATEDIFF(MINUTE, MAX(DHREGISTRO), GETDATE()) as minutos_offline
FROM [dbo].[VIAGEMRASTREAMENTO]
WHERE IDVIAGEM = @idViagemTeste;
GO

-- ============================================
-- 5. CENÁRIO 4: DESVIO DE ROTA
-- ============================================
PRINT '📋 CENÁRIO 4: Desvio de Rota';
PRINT '   Para testar: Insira posição GPS a mais de 500m da rota planejada';
PRINT '';

-- Verificar pontos do roteiro
SELECT 
  COUNT(*) as total_pontos_rota,
  MIN(LATITUDE) as lat_min,
  MAX(LATITUDE) as lat_max,
  MIN(LONGITUDE) as lon_min,
  MAX(LONGITUDE) as lon_max
FROM [dbo].[ROTEIROPONTOS] rp
INNER JOIN [dbo].[VIAGEMMESTRE] v ON rp.IDROTEIRO = v.IDROTEIRO
WHERE v.IDVIAGEM = @idViagemTeste
  AND rp.LATITUDE IS NOT NULL
  AND rp.LONGITUDE IS NOT NULL;
GO

-- ============================================
-- 6. VERIFICAR ALERTAS EXISTENTES
-- ============================================
PRINT '';
PRINT '========================================';
PRINT '📊 Alertas Existentes para esta Viagem';
PRINT '========================================';

SELECT 
  ID,
  TYPE,
  MESSAGE,
  SEVERITY,
  STATUS,
  PRIORIDADE,
  CREATED_AT,
  CASE WHEN RESOLVED = 1 THEN 'Resolvido' ELSE 'Ativo' END as situacao
FROM [dbo].[ALERTS]
WHERE IDVIAGEM = @idViagemTeste
ORDER BY CREATED_AT DESC;
GO

-- ============================================
-- 7. INSTRUÇÕES PARA TESTE MANUAL
-- ============================================
PRINT '';
PRINT '========================================';
PRINT '📝 Como Testar Manualmente';
PRINT '========================================';
PRINT '';
PRINT '1. Via API (Recomendado):';
PRINT '   POST http://localhost:3000/api/alertas/verificar/' + CAST(@idViagemTeste AS VARCHAR);
PRINT '   Headers: Authorization: Bearer SEU_TOKEN';
PRINT '';
PRINT '2. Aguardar Job Automático:';
PRINT '   O job roda a cada 5 minutos automaticamente';
PRINT '   Verifique os logs do servidor Node.js';
PRINT '';
PRINT '3. Verificar Resultado:';
PRINT '   SELECT * FROM [dbo].[ALERTS] WHERE IDVIAGEM = ' + CAST(@idViagemTeste AS VARCHAR);
PRINT '';
PRINT '========================================';
PRINT '✅ Script concluído!';
PRINT '========================================';
GO
