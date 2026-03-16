-- Adicionar coluna DDI na tabela PAIS (PostgreSQL).
-- Tudo que for país/DDI deve vir da tabela; este script cria a coluna e popula.
-- Novos países (ex.: Portugal) podem ser inseridos na PAIS com DDI preenchido.

ALTER TABLE "PAIS"
  ADD COLUMN IF NOT EXISTS "DDI" VARCHAR(5);

COMMENT ON COLUMN "PAIS"."DDI" IS 'Código telefônico internacional (ex.: 55, 595, 351).';

-- Popular DDI para os países já existentes (não sobrescreve se já tiver valor)
UPDATE "PAIS" SET "DDI" = '55'   WHERE "CDPAIS" = 1    AND (TRIM(COALESCE("DDI", '')) = '');
UPDATE "PAIS" SET "DDI" = '54'   WHERE "CDPAIS" = 639  AND (TRIM(COALESCE("DDI", '')) = '');
UPDATE "PAIS" SET "DDI" = '595'  WHERE "CDPAIS" = 5860 AND (TRIM(COALESCE("DDI", '')) = '');
UPDATE "PAIS" SET "DDI" = '598'  WHERE "CDPAIS" = 8451 AND (TRIM(COALESCE("DDI", '')) = '');

-- Opcional: inserir Portugal (PT) se quiser usar no cadastro; senão pode adicionar depois pela aplicação.
-- INSERT INTO "PAIS" ("CDPAIS", "DSPAIS", "SGPAIS", "DDI", "FGACTIVE", "DHMAINTENANCE", "SGUSER")
-- SELECT 351, 'Portugal', 'PT', '351', 'A', CURRENT_TIMESTAMP, 'SYSTEM'
-- WHERE NOT EXISTS (SELECT 1 FROM "PAIS" WHERE "SGPAIS" = 'PT' OR "CDPAIS" = 351);
