-- Idempotente: no máximo 1 componente por (contrato, grupo, tipo).
-- Tipos diferentes no mesmo grupo continuam válidos e somam no cálculo.
-- Rode em atlas_cargo_prd (ou o banco alvo) antes de publicar contrato com a regra nova.

-- Remove duplicatas antigas mantendo a de menor ID (ordem de inclusão)
DELETE FROM "FIN_CONTRATO_COMPONENTE" c
 WHERE EXISTS (
   SELECT 1
     FROM "FIN_CONTRATO_COMPONENTE" d
    WHERE d."ID_CONTRATO" = c."ID_CONTRATO"
      AND d."GRUPO" = c."GRUPO"
      AND d."TIPO" = c."TIPO"
      AND d."ID" < c."ID"
 );

CREATE UNIQUE INDEX IF NOT EXISTS "UK_FIN_COMP_CONTRATO_GRUPO_TIPO"
  ON "FIN_CONTRATO_COMPONENTE" ("ID_CONTRATO", "GRUPO", "TIPO");
