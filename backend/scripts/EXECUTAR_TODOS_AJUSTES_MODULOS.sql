-- Script Master: Executar todos os ajustes para módulos separados
-- Data: 2025-01-15
-- IMPORTANTE: Execute este script para aplicar todas as alterações

USE [DIVULGACARGA_PRD]
GO

PRINT '========================================';
PRINT '🚀 Iniciando ajustes para módulos separados';
PRINT '========================================';
PRINT '';

-- 1. Ajustar tabela ALERTS
PRINT '📋 1/4 - Ajustando tabela ALERTS...';
PRINT '';
:r ajustar_tabela_alerts_para_modulo.sql
GO

-- 2. Ajustar tabela MESSAGES
PRINT '';
PRINT '📋 2/4 - Ajustando tabela MESSAGES...';
PRINT '';
:r ajustar_tabela_messages_para_modulo.sql
GO

-- 3. Ajustar tabela SOS_ALERTS
PRINT '';
PRINT '📋 3/4 - Ajustando tabela SOS_ALERTS...';
PRINT '';
:r ajustar_tabela_sos_alerts_para_modulo.sql
GO

-- 4. Criar tabela RANKING_DATA
PRINT '';
PRINT '📋 4/4 - Criando tabela RANKING_DATA...';
PRINT '';
:r criar_tabela_ranking_data.sql
GO

PRINT '';
PRINT '========================================';
PRINT '✅ Todos os ajustes foram concluídos!';
PRINT '========================================';
PRINT '';
PRINT '📝 Próximos passos:';
PRINT '   1. Verificar se todas as tabelas foram criadas/ajustadas';
PRINT '   2. Testar queries nas novas tabelas';
PRINT '   3. Iniciar desenvolvimento do backend (controllers)';
PRINT '';
