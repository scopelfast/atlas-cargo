-- Painel SaaS (menu + API /api/saas/*): tipo de atividade com DSPROGRAMA = gerenciar-tenants-saas
-- PostgreSQL. Rode após backup. Idempotente (não duplica se o programa já existir).
--
-- Pré-requisitos:
--   - Tabela MODULO_PRODUTO e coluna TIPOATIVIDADE.CD_MODULO_PRODUTO (script modulo_produto_torre_postgres.sql)
--
-- Depois do INSERT:
--   1) Gerenciar Usuário: vincule o novo CDTIPOATIVIDADE ao usuário (USUARIOATIVIDADE), ou
--   2) INSERT manual em USUARIOATIVIDADE (SGUSUARIO, CDTIPOATIVIDADE).
--
-- Opcional: ajustar nome em tela em Gerenciar Tipos de Atividade — não altere DSPROGRAMA (deve permanecer gerenciar-tenants-saas).

INSERT INTO "TIPOATIVIDADE" (
  "CDTIPOATIVIDADE",
  "DSTIPOATIVIDADE",
  "DSPROGRAMA",
  "FGACTIVE",
  "FGGRUPO",
  "CD_MODULO_PRODUTO"
)
SELECT
  (SELECT COALESCE(MAX("CDTIPOATIVIDADE"), 0) + 1 FROM "TIPOATIVIDADE"),
  'Tenants e módulos (SaaS)',
  'gerenciar-tenants-saas',
  'S',
  'System',
  (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'divulga_cargas_torre' LIMIT 1)
WHERE NOT EXISTS (
  SELECT 1 FROM "TIPOATIVIDADE" t WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'gerenciar-tenants-saas'
);

-- Se o tipo foi criado manualmente sem módulo de produto, o menu filtrado por produto não mostra o item. Corrige:
UPDATE "TIPOATIVIDADE" t
SET "CD_MODULO_PRODUTO" = (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'divulga_cargas_torre' LIMIT 1)
WHERE TRIM(COALESCE(t."DSPROGRAMA", '')) = 'gerenciar-tenants-saas'
  AND t."CD_MODULO_PRODUTO" IS NULL;
