-- Script: adicionar_tenant_id_fase2_postgres.sql
-- Objetivo: Fase 2 multi-tenant — coluna "TENANT_ID" (VARCHAR 64, NOT NULL, default 'default') nas tabelas
--           de negócio compartilhadas no mesmo banco. Dados legados recebem 'default' (alinhar com DEFAULT_TENANT_ID no .env).
-- Executar no pgAdmin: banco atlas_cargo_prd, Query Tool. Idempotente (pode rodar mais de uma vez).
-- Referência: docs/PLANO_SAAS_MULTITENANT_SEGURANCA.md
--
-- Observação: UNIQUE/FK globais (ex.: CGCCPF em CADASTROGERAL) podem precisar incluir TENANT_ID em fase futura.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'ALERT_CONFIG',
    'CONFIGURACAO',
    'ALERTS',
    'ALERT_HISTORY',
    'CADASTROGERAL',
    'CLASSEFROTA_CG',
    'CONTROLEVALIDADE',
    'TIPOVALIDADE',
    'CONVERSAS',
    'CONVOCACAO',
    'DELIVERY_PROOFS',
    'DRIVER_REPUTATION',
    'EMPRESA',
    'FILIAL',
    'EQUIPAMENTO',
    'FEEDBACK',
    'HISTORICOREABERTURA',
    'LOG_ENVIO_WHATSAPP',
    'LOGSWEBHOOKMETA',
    'MESSAGES',
    'MOTORISTA_COMPLEMENTO',
    'MOTORISTA_VEICULO',
    'MOTORISTAEQUIPAMENTO',
    'MOTORISTARASTREAMENTO',
    'RANKING_DATA',
    'ROTEIRO',
    'ROTEIRO_CG',
    'ROTEIROPONTOS',
    'SOS_ALERTS',
    'SOS_HISTORY',
    'TIPOATIVIDADE',
    'USUARIO',
    'USUARIOATIVIDADE',
    'USUARIOEMPRESA',
    'USUARIOFILIAL',
    'USUARIOLOGACAO',
    'USUARIOLOGACESSO',
    'VIAGEM_RASTREAMENTO',
    'VIAGEMCHAT',
    'VIAGEMCOMPROVANTE',
    'VIAGEMEVENTO',
    'VIAGEMMESTRE',
    'VIAGEMMOTORISTA',
    'VIAGEMOCORRENCIA',
    'VIAGEMRASTREAMENTO',
    'VIAGEMRASTREAMENTO_INVALIDOS',
    'VIAGEMVEICULO'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_attribute a
      INNER JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      INNER JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname = t
        AND a.attname = 'TENANT_ID'
        AND a.attnum > 0
        AND NOT a.attisdropped
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD COLUMN "TENANT_ID" VARCHAR(64) NOT NULL DEFAULT %L',
        t,
        'default'
      );
    END IF;
  END LOOP;
END $$;

-- Índices para filtros frequentes (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_viagemmestre_tenant ON "VIAGEMMESTRE" ("TENANT_ID");
CREATE INDEX IF NOT EXISTS idx_viagemmestre_tenant_id ON "VIAGEMMESTRE" ("TENANT_ID", "IDVIAGEM");
CREATE INDEX IF NOT EXISTS idx_convocacao_tenant_viagem ON "CONVOCACAO" ("TENANT_ID", "IDVIAGEM");
CREATE INDEX IF NOT EXISTS idx_cadastrogeral_tenant ON "CADASTROGERAL" ("TENANT_ID");
CREATE INDEX IF NOT EXISTS idx_messages_tenant_viagem ON "MESSAGES" ("TENANT_ID", "IDVIAGEM");
