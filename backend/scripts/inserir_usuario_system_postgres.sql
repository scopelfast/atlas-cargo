-- Inserir usuário SYSTEM na tabela USUARIO (PostgreSQL)
-- OBS: O sistema não usa mais o usuário SYSTEM. Todas as gravações exigem usuário logado (401 se não houver).
-- Este script é opcional/legado (ex.: se alguma FK ou processo externo ainda referenciar SYSTEM).

INSERT INTO "USUARIO" (
  "SGUSUARIO",
  "CDCADASTRO",
  "NMUSUARIO",
  "ENDEMAIL",
  "SENHA",
  "FGACTIVE"
)
SELECT
  'SYSTEM',
  (SELECT "CDCADASTRO" FROM "CADASTROGERAL" ORDER BY "CDCADASTRO" LIMIT 1),
  'Sistema',
  'system@local',
  '$2b$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  'S'
WHERE NOT EXISTS (SELECT 1 FROM "USUARIO" WHERE "SGUSUARIO" = 'SYSTEM')
  AND EXISTS (SELECT 1 FROM "CADASTROGERAL" LIMIT 1);
