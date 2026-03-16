-- Adicionar coluna SGPAIS (sigla do país: BR, PY, AR, UY) na tabela PAIS se não existir.
-- Necessário para que os combos de país (Cadastro Geral, Locais preferidos) usem a tabela PAIS
-- e armazenem o valor correto (sigla) nas colunas PAIS, PAIS_DESTINO_PREF, etc.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'PAIS' AND column_name = 'SGPAIS'
  ) THEN
    ALTER TABLE "PAIS" ADD COLUMN "SGPAIS" VARCHAR(3) NULL;
    COMMENT ON COLUMN "PAIS"."SGPAIS" IS 'Sigla do país (BR, PY, AR, UY) para uso em combos e colunas VARCHAR(2).';
  END IF;
END $$;

-- Atualizar registros conhecidos quando SGPAIS estiver vazio (ajuste conforme seus dados)
UPDATE "PAIS" SET "SGPAIS" = 'BR' WHERE UPPER(TRIM("DSPAIS")) LIKE '%RASIL%' AND (TRIM(COALESCE("SGPAIS", '')) = '');
UPDATE "PAIS" SET "SGPAIS" = 'PY' WHERE UPPER(TRIM("DSPAIS")) LIKE '%ARAGUAI%' AND (TRIM(COALESCE("SGPAIS", '')) = '');
UPDATE "PAIS" SET "SGPAIS" = 'AR' WHERE UPPER(TRIM("DSPAIS")) LIKE '%RGENTINA%' AND (TRIM(COALESCE("SGPAIS", '')) = '');
UPDATE "PAIS" SET "SGPAIS" = 'UY' WHERE UPPER(TRIM("DSPAIS")) LIKE '%URUGUAI%' AND (TRIM(COALESCE("SGPAIS", '')) = '');
