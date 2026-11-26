-- Menu que o dashboard monta, copiado do banco local (TIPOATIVIDADE + acesso do admin).
-- PostgreSQL. Pode rodar de novo. Não mexe em viagem, senha, cadastro nem GPS.
-- Rode no atlas_cargo_prd. Depois saia do painel e entre de novo, com "Todos os Módulos".

ALTER TABLE "TIPOATIVIDADE" ADD COLUMN IF NOT EXISTS "FGGRUPO" varchar(50) NULL;
ALTER TABLE "TIPOATIVIDADE" ADD COLUMN IF NOT EXISTS "CODIGO_MODULO_LICENCA" varchar(40) NULL;
ALTER TABLE "TIPOATIVIDADE" ADD COLUMN IF NOT EXISTS "TENANT_ID" varchar(64) NULL;
ALTER TABLE "TIPOATIVIDADE" ADD COLUMN IF NOT EXISTS "CD_MODULO_PRODUTO" integer NULL;
ALTER TABLE "TIPOATIVIDADE" ALTER COLUMN "DSTIPOATIVIDADE" TYPE varchar(120);

INSERT INTO "MODULO_PRODUTO" ("CD_MODULO", "CODIGO", "NOME", "DESCRICAO", "ORDEM", "FGACTIVE")
SELECT (SELECT COALESCE(MAX(m."CD_MODULO"), 0) FROM "MODULO_PRODUTO" m) + ROW_NUMBER() OVER (ORDER BY v.ordem, v.codigo),
  v.codigo, v.nome, v.descricao, v.ordem, 'S'
FROM (VALUES
  ('divulga_cargas_torre', 'Torre Logística', 'Operação: viagens, mapa, cadastros, chat, alertas e SOS.', 1),
  ('divulga', 'Torre Logística', NULL::varchar, 1),
  ('estoque', 'Gestão de Estoque', NULL::varchar, 2),
  ('geral', 'Módulos Cadastro Básicos', NULL::varchar, 0)
) AS v(codigo, nome, descricao, ordem)
WHERE NOT EXISTS (SELECT 1 FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = v.codigo);

UPDATE "MODULO_PRODUTO" m
SET "NOME" = v.nome, "ORDEM" = v.ordem, "FGACTIVE" = 'S'
FROM (VALUES
  ('divulga_cargas_torre', 'Torre Logística', 1),
  ('divulga', 'Torre Logística', 1),
  ('estoque', 'Gestão de Estoque', 2),
  ('geral', 'Módulos Cadastro Básicos', 0)
) AS v(codigo, nome, ordem)
WHERE m."CODIGO" = v.codigo;

INSERT INTO "TIPOATIVIDADE" (
  "CDTIPOATIVIDADE", "DSTIPOATIVIDADE", "FGACTIVE", "DSPROGRAMA", "FGGRUPO",
  "CD_MODULO_PRODUTO", "CODIGO_MODULO_LICENCA", "TENANT_ID"
)
SELECT v.id, v.nome, v.ativo, v.prog, v.grupo, m."CD_MODULO", v.licenca, 'default'
FROM (VALUES
  (1,  '1.0.Cadastro Geral', 'S', 'gerenciar-cadastro-geral', 'CADASTROS', 'geral', 'geral'),
  (2,  '1.4.Tipo Validade', 'S', 'gerenciar-tipos-validade', 'CADASTROS', 'divulga', 'geral'),
  (3,  '9.0.Usuário', 'S', 'gerenciar-usuarios', 'SISTEMA', 'geral', 'geral'),
  (4,  '4.6.Logs de Acesso', 'S', 'gerenciar-logs-acesso', 'GESTAO', 'geral', 'geral'),
  (5,  '9.1.Tipo Atividade', 'S', 'gerenciar-tipos-atividade', 'SISTEMA', 'geral', 'geral'),
  (6,  '9.4.Configurações', 'S', 'gerenciar-configuracoes', 'System', 'geral', 'geral'),
  (7,  '1.2.Mesoregião', 'S', 'gerenciar-mesorregiao', 'Cadastros', 'geral', 'geral'),
  (8,  '1.1.Estados', 'S', 'gerenciar-estados', 'Cadastros', 'geral', 'geral'),
  (9,  '3.4.Tipo Ocorrência', 'S', 'gerenciar-tipo-ocorrencia', 'Logística', 'divulga', 'geral'),
  (10, '2.1.Marca', 'S', 'gerenciar-marcas', 'EQUIPAMENTOS', 'divulga', 'geral'),
  (11, '2.2.Tipo', 'S', 'gerenciar-tipos-equipamento', 'EQUIPAMENTOS', 'divulga', 'geral'),
  (12, '2.3.Modelo', 'S', 'gerenciar-modelos-equipamento', 'EQUIPAMENTOS', 'divulga', 'geral'),
  (13, '2.4.Grupo', 'S', 'gerenciar-grupos', 'EQUIPAMENTOS', 'divulga', 'geral'),
  (14, '2.0.Veículos', 'S', 'gerenciar-equipamentos', 'EQUIPAMENTOS', 'divulga', 'geral'),
  (15, '5.1.Cadastros', 'S', 'estoque-cadastros-wms', 'WMS', 'estoque', 'estoque'),
  (18, '3.5.Campanha de Oportunidades', 'S', 'campanhas-oportunidades', 'Logística', 'divulga', 'divulga'),
  (20, '1.3.Cidade', 'S', 'gerenciar-cidades', 'CADASTROS', 'geral', 'geral'),
  (21, '3.1.Tipo Viagem', 'S', 'gerenciar-tipos-viagem', 'LOGISTICA', 'divulga', 'geral'),
  (22, '3.2.Situação', 'S', 'gerenciar-situacoes-viagem', 'LOGISTICA', 'divulga', 'geral'),
  (23, '2.5.Classe Frota', 'S', 'gerenciar-classes-frota', 'EQUIPAMENTOS', 'divulga', 'geral'),
  (24, '3.3.Roteiro', 'S', 'gerenciar-roteiros', 'LOGISTICA', 'divulga', 'geral'),
  (25, '3.0.Viagem', 'S', 'gerenciar-viagens', 'LOGISTICA', 'divulga', 'geral'),
  (30, '4.5.Mapa de Viagem', 'S', 'gerenciar-mapa-viagem', 'GESTAO', 'divulga', 'divulga'),
  (31, '9.2.Empresas', 'S', 'gerenciar-empresas', 'SISTEMA', 'geral', 'geral'),
  (32, '9.3.Filiais', 'S', 'gerenciar-filiais', 'SISTEMA', 'geral', 'geral'),
  (33, '4.0.Convocações', 'S', 'relatorio-convocacoes', 'GESTAO', 'divulga', 'divulga'),
  (40, '4.1.Alertas', 'S', 'alertas', 'GESTAO', 'divulga', 'geral'),
  (41, '4.2.Chat', 'S', 'chat', 'GESTAO', 'divulga', 'geral'),
  (42, '4.3.SOS', 'S', 'sos', 'GESTAO', 'divulga', 'divulga'),
  (43, '4.4.Ranking', 'S', 'ranking', 'GESTAO', 'divulga', 'divulga'),
  (44, '9.5.Tenants e módulos (SaaS)', 'S', 'gerenciar-tenants-saas', 'System', 'geral', 'geral'),
  (45, '9.6.Disparo WhatsApp (oportunidades)', 'S', 'gerenciar-disparo-whatsapp', 'SISTEMA', 'geral', 'geral'),
  (46, '5.0.Painel', 'S', 'estoque', 'WMS', 'estoque', 'estoque'),
  (47, '5.2.Recebimento', 'S', 'estoque-recebimento', 'WMS', 'estoque', 'estoque'),
  (48, '5.3.Separação', 'S', 'estoque-separacao', 'WMS', 'estoque', 'estoque'),
  (49, '5.4.Cargas', 'S', 'estoque-cargas', 'WMS', 'estoque', 'estoque'),
  (50, '5.5.Expedição', 'S', 'estoque-expedicao', 'WMS', 'estoque', 'estoque'),
  (51, '5.1.Cadastros', 'S', 'estoque-cadastros-wms', 'WMS', 'estoque', 'estoque'),
  (52, '5.6.Liberar Expedição', 'S', 'wms-expedicao-liberar-divergencia', 'SISTEMA', 'estoque', 'estoque'),
  (53, '5.7.Liberar Validade', 'S', 'wms-recebimento-liberar-validade-min', 'SISTEMA', 'estoque', 'estoque'),
  (54, '5.9.Relatórios', 'S', 'estoque-relatorios', 'WMS', 'estoque', 'estoque'),
  (55, '6.0.Inventário', 'S', 'estoque-inventario', 'WMS', 'estoque', 'estoque'),
  (56, 'Lib. picking OPL s/ cobertura', 'S', 'wms-separacao-liberar-cobertura-picking', 'SISTEMA', 'estoque', 'estoque'),
  (57, '6.1.Transferências', 'S', 'estoque-transferencias', 'WMS', 'estoque', 'estoque'),
  (58, '6.2.Valor Estoque', 'S', 'estoque-valor', 'WMS', 'estoque', 'estoque'),
  (59, '7.1.Cobrança', 'S', 'estoque-cobranca', 'WMS', 'estoque', 'estoque'),
  (60, '5.8.Baixas / Perdas', 'S', 'estoque-baixas', 'WMS', 'estoque', 'estoque')
) AS v(id, nome, ativo, prog, grupo, modulo, licenca)
LEFT JOIN "MODULO_PRODUTO" m ON m."CODIGO" = v.modulo
ON CONFLICT ("CDTIPOATIVIDADE") DO UPDATE SET
  "DSTIPOATIVIDADE" = EXCLUDED."DSTIPOATIVIDADE",
  "FGACTIVE" = EXCLUDED."FGACTIVE",
  "DSPROGRAMA" = EXCLUDED."DSPROGRAMA",
  "FGGRUPO" = EXCLUDED."FGGRUPO",
  "CD_MODULO_PRODUTO" = EXCLUDED."CD_MODULO_PRODUTO",
  "CODIGO_MODULO_LICENCA" = EXCLUDED."CODIGO_MODULO_LICENCA",
  "TENANT_ID" = EXCLUDED."TENANT_ID";

INSERT INTO "USUARIOATIVIDADE" ("SGUSUARIO", "CDTIPOATIVIDADE", "DHMAINTENANCE", "SGUSER", "SERVERORIG")
SELECT 'admin', v.id, CURRENT_TIMESTAMP, 'SYSTEM', 'menu-banco'
FROM (VALUES
  (1),(2),(3),(4),(5),(6),(7),(8),(9),(10),(11),(12),(13),(14),(15),(18),
  (20),(21),(22),(23),(24),(25),(30),(31),(32),(33),(40),(41),(42),(43),
  (44),(45),(46),(47),(48),(49),(50),(51),(52),(53),(54),(55),(56),(57),(58),(59),(60)
) AS v(id)
WHERE EXISTS (SELECT 1 FROM "USUARIO" u WHERE u."SGUSUARIO" = 'admin')
  AND EXISTS (SELECT 1 FROM "TIPOATIVIDADE" t WHERE t."CDTIPOATIVIDADE" = v.id)
ON CONFLICT ("SGUSUARIO", "CDTIPOATIVIDADE") DO NOTHING;
