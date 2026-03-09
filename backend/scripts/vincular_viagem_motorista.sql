-- ============================================================
-- Vincular viagem ao motorista (VIAGEMMOTORISTA)
-- ============================================================
-- O dashboard "Viagens em Andamento" só mostra viagens que tenham
-- um registro em VIAGEMMOTORISTA ligando IDVIAGEM ao CDMOTORISTA.
-- Se a viagem existe em VIAGEMMESTRE mas não aparece no app,
-- execute este script para criar o vínculo.
--
-- Uso:
--   1. Ajuste @IDVIAGEM (ex.: 1) e o CPF do motorista abaixo.
--   2. Execute no banco (PostgreSQL ou SQL Server).
-- ============================================================

-- PostgreSQL:
INSERT INTO "VIAGEMMOTORISTA" ("IDVIAGEM", "CDMOTORISTA", "DHMAINTENANCE", "SGUSER", "SERVERORIG")
SELECT 
  1 AS "IDVIAGEM",
  c."CDCADASTRO" AS "CDMOTORISTA",
  CURRENT_TIMESTAMP,
  'app-motorista',
  'AppDVcargas'
FROM "CADASTROGERAL" c
WHERE REPLACE(REPLACE(REPLACE(COALESCE(c."CGCCPF", c."CPF", '')::TEXT, '.', ''), '-', ''), '/', '') = '05253663932'
  AND (c."FGMOTORISTA" = 'S' OR c."FGTIPOCADASTRO" = 'M')
  AND NOT EXISTS (
    SELECT 1 FROM "VIAGEMMOTORISTA" vm 
    WHERE vm."IDVIAGEM" = 1 AND vm."CDMOTORISTA" = c."CDCADASTRO"
  );

-- Se o CPF no seu banco tiver outro formato, use uma das variantes abaixo
-- (descomente e ajuste o valor):
/*
-- Por CPF com máscara:
WHERE TRIM(c."CGCCPF") = '052.536.639-32'

-- Por CDCADASTRO conhecido (troque 12345 pelo código do motorista Juliana):
INSERT INTO "VIAGEMMOTORISTA" ("IDVIAGEM", "CDMOTORISTA", "DHMAINTENANCE", "SGUSER", "SERVERORIG")
VALUES (1, 12345, CURRENT_TIMESTAMP, 'app-motorista', 'AppDVcargas')
ON CONFLICT ("IDVIAGEM", "CDMOTORISTA") DO NOTHING;
*/
