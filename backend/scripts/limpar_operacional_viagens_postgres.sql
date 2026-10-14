-- =============================================================================
-- Limpeza operacional: viagens, convocações, rastreamento, chat, alertas, SOS
-- Banco: PostgreSQL (pgAdmin / psql)
-- Baseado em: script_db_postgres.sql (Atlas Cargo)
--
-- ⚠️  ATENÇÃO
--   • Faça BACKUP antes (pg_dump).
--   • NÃO apaga cadastros (motoristas, clientes, roteiros, equipamentos, usuários).
--   • NÃO apaga CONFIGURACAO, ALERT_CONFIG, TIPOOCORRENCIA, MOTIVORECUSA, etc.
--   • Após rodar, crie viagens novas do zero para testar.
--
-- Se alguma tabela não existir no seu banco, remova o nome da lista do TRUNCATE
-- ou comente e execute o restante.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- ORDEM LÓGICA (dependências) — o PostgreSQL resolve a ordem no TRUNCATE único
-- com CASCADE:
--
--   1) Filhos de ALERTS              → ALERT_HISTORY, ALERT_NOTIFICATION_LOG
--      (log WhatsApp Switch do módulo Alertas — tela “Logs de Notificação WhatsApp”)
--   2) Filhos de SOS_ALERTS          → SOS_HISTORY
--   3) Filhos de CONVERSAS / viagem  → MESSAGES (FK em CONVERSAS e VIAGEMMESTRE)
--   4) Filhos de CONVOCACAO          → FEEDBACK, LOG_ENVIO_WHATSAPP,
--                                      LOGSWEBHOOKMETA, HISTORICOREABERTURA
--   5) Dados ligados à viagem        → VIAGEMCHAT, VIAGEMCOMPROVANTE,
--                                      VIAGEMEVENTO, VIAGEM_RASTREAMENTO,
--                                      VIAGEMRASTREAMENTO, VIAGEMRASTREAMENTO_INVALIDOS,
--                                      VIAGEMOCORRENCIA (macros), DELIVERY_PROOFS,
--                                      ALERTS, SOS_ALERTS, CONVOCACAO, CONVERSAS
--   6) Associação viagem×motorista/veículo → VIAGEMMOTORISTA, VIAGEMVEICULO
--   7) Cabeçalho da viagem           → VIAGEMMESTRE
--   8) Campanhas de oportunidades    → OPORT_* (filhas antes do cabeçalho OPORT_CAMPANHA;
--      uma única vez — sem duplicar OPORT_CAMPANHA na lista)
--
-- ROTEIRO / ROTEIRO_CG / ROTEIROPONTOS: NÃO entram aqui (cadastro de rotas).
-- -----------------------------------------------------------------------------

BEGIN;

TRUNCATE TABLE
  "ALERT_HISTORY",
  "ALERT_NOTIFICATION_LOG",
  "ALERTS",
  "SOS_HISTORY",
  "SOS_ALERTS",
  "MESSAGES",
  "FEEDBACK",
  "LOG_ENVIO_WHATSAPP",
  "LOGSWEBHOOKMETA",
  "HISTORICOREABERTURA",
  "VIAGEMCHAT",
  "VIAGEMCOMPROVANTE",
  "VIAGEMEVENTO",
  "VIAGEM_RASTREAMENTO",
  "VIAGEMRASTREAMENTO",
  "VIAGEMRASTREAMENTO_INVALIDOS",
  "VIAGEMOCORRENCIA",
  "DELIVERY_PROOFS",
  "CONVOCACAO",
  "CONVERSAS",
  "VIAGEMMOTORISTA",
  "VIAGEMVEICULO",
  "VIAGEMMESTRE",
  "OPORT_CAMPANHA_EVENTO",
  "OPORT_CAMPANHA_CONVOCACAO",
  "OPORT_CAMPANHA_DEST",
  "OPORT_CAMPANHA_VIAGEM",
  "OPORT_CAMPANHA",
  "MOTORISTARASTREAMENTO"
RESTART IDENTITY CASCADE;

COMMIT;

-- =============================================================================
-- OPCIONAL — descomente se quiser zerar agregados que não são “por viagem”
-- mas costumam ir junto num reset de testes:
--
-- TRUNCATE TABLE "DRIVER_REPUTATION" RESTART IDENTITY CASCADE;
-- TRUNCATE TABLE "RANKING_DATA" RESTART IDENTITY CASCADE;
-- =============================================================================

-- =============================================================================
-- Campanhas (OPORT_*): já estão no bloco principal acima. Para preservar
-- campanhas ao só zerar viagens, remova do TRUNCATE as linhas OPORT_* (e rode
-- com cuidado: podem restar FKs para VIAGEMMESTRE apagado).
-- =============================================================================

-- =============================================================================
-- NÃO incluído (cadastros e parâmetros — não entram nesta limpeza operacional):
--   • ROTEIRO, ROTEIROPONTOS, ROTEIRO_CG — cadastro de rotas
--   • EQUIPAMENTO, CADASTROGERAL, TIPOVIAGEM, CLASSEFROTA, etc.
--   • USUARIOLOGACAO / USUARIOLOGACESSO — auditoria de acessos
--   • CONFIGURACAO, ALERT_CONFIG — parâmetros do sistema
--   • Tabelas WMS (cargas, NF-e, etc.) — só se quiser reset amplo; requer script à parte
-- =============================================================================
