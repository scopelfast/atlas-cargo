-- Licença SaaS: módulos habilitados por tenant (JSON em CONFIGURACAO).
-- Requer PK ("TENANT_ID","CHAVE") — ver configuracao_pk_composta_tenant_postgres.sql
--
-- Chaves JSON: alertas, ranking, sos, chat, mapa_viagem (boolean).
-- Ausência da linha ou chave omitida = tratado como true (compatível com instalações antigas).

INSERT INTO "CONFIGURACAO" ("TENANT_ID", "CHAVE", "VALOR", "DESCRICAO")
VALUES (
  'default',
  'SAAS_MODULOS_JSON',
  '{"alertas":true,"ranking":true,"sos":true,"chat":true,"mapa_viagem":true}',
  'SaaS: módulos do contrato por tenant. false = API retorna 403 nas rotas do módulo.'
)
ON CONFLICT ("TENANT_ID", "CHAVE") DO NOTHING;
