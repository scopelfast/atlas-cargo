-- =============================================
-- Ajustar TIPOOCORRENCIA para códigos 1-14 (PostgreSQL)
-- Ordem: 1) Inserir/atualizar os 14 tipos  2) Migrar VIAGEMOCORRENCIA  3) Remover códigos antigos
-- Execute no banco Atlas Cargo (PostgreSQL).
-- =============================================

-- PASSO 1: Inserir/atualizar os 14 registros padronizados
-- (Se a tabela tiver colunas extras como DTCADASTRO, use NULL ou mantenha as atuais no DO UPDATE)
INSERT INTO "TIPOOCORRENCIA" (
  "CDTIPOOCORRENCIA",
  "DSTIPOOCORRENCIA",
  "CDEDIPADRAO",
  "FGSITUACAO",
  "SEQ"
) VALUES
  (1,  'Viagem - Início',                '99', 'T', 1),
  (2,  'Viagem - Fim',                   '99', 'F', 1),
  (3,  'Carga - Chegada',                '99', 'C', 1),
  (4,  'Carga - Início',                 '99', 'C', 2),
  (5,  'Carga - Fim',                    '99', 'C', 3),
  (6,  'Parada - Abastecimento',         '99', 'P', 1),
  (7,  'Parada - Alimentação/Banheiro',  '99', 'P', 1),
  (8,  'Parada - Manutenção',            '99', 'P', 1),
  (9,  'Retido - Posto Fiscal/Polícia',  '99', 'P', 1),
  (10, 'Parada - Descanso/Pernoite',     '99', 'P', 1),
  (11, 'Viagem - Reinício',              '99', 'T', 2),
  (12, 'Descarga - Chegada',             '99', 'D', 1),
  (13, 'Descarga - Início',              '99', 'D', 2),
  (14, 'Descarga - Fim',                '99', 'D', 3)
ON CONFLICT ("CDTIPOOCORRENCIA") DO UPDATE SET
  "DSTIPOOCORRENCIA" = EXCLUDED."DSTIPOOCORRENCIA",
  "CDEDIPADRAO"      = EXCLUDED."CDEDIPADRAO",
  "FGSITUACAO"       = EXCLUDED."FGSITUACAO",
  "SEQ"              = EXCLUDED."SEQ";

-- PASSO 2: Migrar VIAGEMOCORRENCIA (códigos antigos → 1-14)
-- Só executa se a tabela "VIAGEMOCORRENCIA" existir (evita erro em ambientes só com TIPOOCORRENCIA)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND LOWER(table_name) = 'viagemocorrencia'
  ) THEN
    UPDATE "VIAGEMOCORRENCIA" SET "CDTIPOOCORRENCIA" = 1  WHERE "CDTIPOOCORRENCIA" = 103;
    UPDATE "VIAGEMOCORRENCIA" SET "CDTIPOOCORRENCIA" = 11 WHERE "CDTIPOOCORRENCIA" = 104;
    UPDATE "VIAGEMOCORRENCIA" SET "CDTIPOOCORRENCIA" = 3  WHERE "CDTIPOOCORRENCIA" = 151;
    UPDATE "VIAGEMOCORRENCIA" SET "CDTIPOOCORRENCIA" = 4  WHERE "CDTIPOOCORRENCIA" = 109;
    UPDATE "VIAGEMOCORRENCIA" SET "CDTIPOOCORRENCIA" = 5  WHERE "CDTIPOOCORRENCIA" = 110;
    UPDATE "VIAGEMOCORRENCIA" SET "CDTIPOOCORRENCIA" = 12 WHERE "CDTIPOOCORRENCIA" = 159;
    UPDATE "VIAGEMOCORRENCIA" SET "CDTIPOOCORRENCIA" = 13 WHERE "CDTIPOOCORRENCIA" = 192;
    UPDATE "VIAGEMOCORRENCIA" SET "CDTIPOOCORRENCIA" = 14 WHERE "CDTIPOOCORRENCIA" = 111;
    UPDATE "VIAGEMOCORRENCIA" SET "CDTIPOOCORRENCIA" = 7  WHERE "CDTIPOOCORRENCIA" = 105;
    UPDATE "VIAGEMOCORRENCIA" SET "CDTIPOOCORRENCIA" = 6  WHERE "CDTIPOOCORRENCIA" = 106;
    UPDATE "VIAGEMOCORRENCIA" SET "CDTIPOOCORRENCIA" = 10 WHERE "CDTIPOOCORRENCIA" = 107;
    UPDATE "VIAGEMOCORRENCIA" SET "CDTIPOOCORRENCIA" = 9  WHERE "CDTIPOOCORRENCIA" = 26;
    UPDATE "VIAGEMOCORRENCIA" SET "CDTIPOOCORRENCIA" = 8  WHERE "CDTIPOOCORRENCIA" = 58;
  END IF;
END $$;

-- PASSO 3: Remover da TIPOOCORRENCIA os códigos antigos (deixar só 1 a 14)
DELETE FROM "TIPOOCORRENCIA"
WHERE "CDTIPOOCORRENCIA" NOT BETWEEN 1 AND 14;

-- Verificação (opcional)
-- SELECT "CDTIPOOCORRENCIA", "DSTIPOOCORRENCIA", "FGSITUACAO", "SEQ" FROM "TIPOOCORRENCIA" ORDER BY "CDTIPOOCORRENCIA";
