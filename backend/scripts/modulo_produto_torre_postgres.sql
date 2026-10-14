-- Módulos de produto (venda multi-produto) + vínculo com TIPOATIVIDADE (menu).
-- PostgreSQL. Rode após backups. Compatível com instalações existentes.

-- Catálogo de produtos / módulos (ex.: Torre Logística; futuros módulos = novas linhas)
CREATE TABLE IF NOT EXISTS "MODULO_PRODUTO" (
  "CD_MODULO" smallint NOT NULL PRIMARY KEY,
  "CODIGO" varchar(40) NOT NULL,
  "NOME" varchar(120) NOT NULL,
  "DESCRICAO" varchar(500) NULL,
  "ORDEM" smallint NOT NULL DEFAULT 1,
  "FGACTIVE" char(1) NOT NULL DEFAULT 'S',
  CONSTRAINT "UK_MODULO_PRODUTO_CODIGO" UNIQUE ("CODIGO")
);

INSERT INTO "MODULO_PRODUTO" ("CD_MODULO", "CODIGO", "NOME", "DESCRICAO", "ORDEM", "FGACTIVE")
SELECT 1, 'divulga_cargas_torre', 'Torre Logística',
  'Operação: viagens, mapa, cadastros, chat, alertas e SOS.', 1, 'S'
WHERE NOT EXISTS (SELECT 1 FROM "MODULO_PRODUTO" WHERE "CODIGO" = 'divulga_cargas_torre');

-- Alinhar ao catálogo SaaS (ex.: módulo "estoque") — mesmo CODIGO que SAAS_MODULO.CODIGO
INSERT INTO "MODULO_PRODUTO" ("CD_MODULO", "CODIGO", "NOME", "DESCRICAO", "ORDEM", "FGACTIVE")
SELECT (SELECT COALESCE(MAX(m."CD_MODULO"), 0) + 1 FROM "MODULO_PRODUTO" m),
  'estoque', 'Gestão de Estoque', 'Módulo de estoque / WMS.', 2, 'S'
WHERE NOT EXISTS (SELECT 1 FROM "MODULO_PRODUTO" WHERE "CODIGO" = 'estoque');

-- Vínculo: cada função de menu (tipo de atividade) pertence a um módulo de produto
ALTER TABLE "TIPOATIVIDADE" ADD COLUMN IF NOT EXISTS "CD_MODULO_PRODUTO" smallint NULL;

UPDATE "TIPOATIVIDADE" t
SET "CD_MODULO_PRODUTO" = (SELECT m."CD_MODULO" FROM "MODULO_PRODUTO" m WHERE m."CODIGO" = 'divulga_cargas_torre' LIMIT 1)
WHERE t."CD_MODULO_PRODUTO" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FK_TIPOATIVIDADE_MODULO_PRODUTO'
  ) THEN
    ALTER TABLE "TIPOATIVIDADE"
      ADD CONSTRAINT "FK_TIPOATIVIDADE_MODULO_PRODUTO"
      FOREIGN KEY ("CD_MODULO_PRODUTO") REFERENCES "MODULO_PRODUTO" ("CD_MODULO");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "IX_TIPOATIVIDADE_MODULO" ON "TIPOATIVIDADE" ("CD_MODULO_PRODUTO");
