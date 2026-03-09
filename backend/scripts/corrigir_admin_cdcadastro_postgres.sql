-- Corrigir usuário admin (e outros) com CDCADASTRO NULL
-- Execute no PostgreSQL quando o login retornar "Dados do usuário incompletos".
-- Opção 1: Vincular admin ao primeiro cadastro existente em CADASTROGERAL
UPDATE "USUARIO" u
SET "CDCADASTRO" = sub."CDCADASTRO"
FROM (
  SELECT "CDCADASTRO" FROM "CADASTROGERAL" ORDER BY "CDCADASTRO" LIMIT 1
) sub
WHERE u."SGUSUARIO" = 'admin'
  AND u."CDCADASTRO" IS NULL
  AND EXISTS (SELECT 1 FROM "CADASTROGERAL" LIMIT 1);

-- Verificar resultado
SELECT "SGUSUARIO", "CDCADASTRO", "NMUSUARIO" FROM "USUARIO" WHERE "SGUSUARIO" = 'admin';
