-- Limpeza segura da importacao de enderecos de entrega (POSTGRES)
-- Estrategia: INATIVAR (FGACTIVE='I'), nao deletar.
-- Versao pre-filtrada para o caso reportado:
--   TENANT_ID = 'default'
--   Escopo principal = pontos iniciando com "MANA DO BRASIL"
-- Observacao: esta versao NAO depende de horario/SGUSER.

BEGIN;

WITH filtros AS (
  SELECT
    'default'::varchar AS tenant_id,
    'MANA DO BRASIL%'::varchar AS ponto_like
)
-- 1) PREVIEW: veja o que sera inativado
SELECT
  e."CD_ENDERECO_ENTREGA",
  e."TENANT_ID",
  e."CD_CLIENTE",
  cg."CGCCPF",
  cg."RZSOCIAL",
  e."DS_PONTO_ENTREGA",
  e."UF_ENTREGA",
  e."NM_MUNICIPIO",
  e."DH_INCLUSAO",
  e."SGUSER",
  e."FGACTIVE"
FROM "CADASTRO_ENDERECO_ENTREGA" e
LEFT JOIN "CADASTROGERAL" cg
  ON cg."CDCADASTRO" = e."CD_CLIENTE"
 AND cg."TENANT_ID" = e."TENANT_ID"
CROSS JOIN filtros f
WHERE e."TENANT_ID" = f.tenant_id
  AND e."FGACTIVE" = 'A'
  AND UPPER(COALESCE(e."DS_PONTO_ENTREGA", '')) LIKE UPPER(f.ponto_like)
  -- Opcional: restringir por cliente especifico
  -- AND e."CD_CLIENTE" = 12345
ORDER BY e."DH_INCLUSAO" DESC;

-- 2) EXECUCAO: inativa os registros filtrados
UPDATE "CADASTRO_ENDERECO_ENTREGA" e
SET
  "FGACTIVE" = 'I',
  "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
  "SGUSER" = 'SCRIPT_LIMPEZA'
FROM filtros f
WHERE e."TENANT_ID" = f.tenant_id
  AND e."FGACTIVE" = 'A'
  AND UPPER(COALESCE(e."DS_PONTO_ENTREGA", '')) LIKE UPPER(f.ponto_like)
  -- AND e."CD_CLIENTE" = 12345
;

-- 3) CONFERENCIA
SELECT
  COUNT(*) AS total_inativados
FROM "CADASTRO_ENDERECO_ENTREGA" e
WHERE e."TENANT_ID" = 'default'
  AND e."FGACTIVE" = 'I'
  AND e."DH_MAINTENANCE" >= (CURRENT_TIMESTAMP - INTERVAL '5 minutes');

COMMIT;

-- ROLLBACK manual (se precisar reverter depois):
-- UPDATE "CADASTRO_ENDERECO_ENTREGA"
--    SET "FGACTIVE" = 'A', "DH_MAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SCRIPT_RESTORE'
--  WHERE "TENANT_ID" = 'default'
--    AND "FGACTIVE" = 'I'
--    AND "DH_MAINTENANCE" >= (CURRENT_TIMESTAMP - INTERVAL '5 minutes');
