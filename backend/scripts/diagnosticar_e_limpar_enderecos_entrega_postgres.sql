-- Diagnostico + limpeza segura de enderecos de entrega (POSTGRES)
-- Use em 2 etapas:
--   1) Rode os SELECTs de diagnostico e copie os IDs corretos.
--   2) Preencha a lista ids_alvo no UPDATE e execute a limpeza.

BEGIN;

-- =========================================================
-- ETAPA 1: DIAGNOSTICO (somente leitura)
-- =========================================================

-- 1) Ultimos 300 registros (ativos e inativos), para achar padrao real.
SELECT
  e."CD_ENDERECO_ENTREGA",
  e."TENANT_ID",
  e."FGACTIVE",
  e."DS_PONTO_ENTREGA",
  e."UF_ENTREGA",
  e."NM_MUNICIPIO",
  e."DH_INCLUSAO",
  e."DH_MAINTENANCE",
  e."SGUSER",
  e."CD_CLIENTE",
  cg."RZSOCIAL"
FROM "CADASTRO_ENDERECO_ENTREGA" e
LEFT JOIN "CADASTROGERAL" cg
  ON cg."TENANT_ID" = e."TENANT_ID"
 AND cg."CDCADASTRO" = e."CD_CLIENTE"
ORDER BY e."CD_ENDERECO_ENTREGA" DESC
LIMIT 300;

-- 2) Top prefixes (primeiros 25 chars) para descobrir o texto exato.
SELECT
  e."TENANT_ID",
  LEFT(UPPER(COALESCE(e."DS_PONTO_ENTREGA", '')), 25) AS prefixo,
  COUNT(*) AS qtd
FROM "CADASTRO_ENDERECO_ENTREGA" e
GROUP BY e."TENANT_ID", LEFT(UPPER(COALESCE(e."DS_PONTO_ENTREGA", '')), 25)
ORDER BY qtd DESC
LIMIT 100;

-- 3) Busca flexivel por "MANA" em ponto ou razao social.
SELECT
  e."CD_ENDERECO_ENTREGA",
  e."TENANT_ID",
  e."FGACTIVE",
  e."DS_PONTO_ENTREGA",
  e."DH_INCLUSAO",
  e."SGUSER",
  cg."RZSOCIAL"
FROM "CADASTRO_ENDERECO_ENTREGA" e
LEFT JOIN "CADASTROGERAL" cg
  ON cg."TENANT_ID" = e."TENANT_ID"
 AND cg."CDCADASTRO" = e."CD_CLIENTE"
WHERE
  UPPER(COALESCE(e."DS_PONTO_ENTREGA", '')) LIKE '%MANA%'
  OR UPPER(COALESCE(cg."RZSOCIAL", '')) LIKE '%MANA%'
ORDER BY e."CD_ENDERECO_ENTREGA" DESC
LIMIT 500;

-- =========================================================
-- ETAPA 2: LIMPEZA CIRURGICA POR IDS
-- =========================================================
-- Cole os IDs confirmados no array abaixo (exemplo: ARRAY[123,124,130]).
-- Se deixar vazio (ARRAY[]), nao limpa nada.

WITH ids_alvo AS (
  SELECT UNNEST(ARRAY[]::int[]) AS id
)
UPDATE "CADASTRO_ENDERECO_ENTREGA" e
SET
  "FGACTIVE" = 'I',
  "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
  "SGUSER" = 'SCRIPT_LIMPEZA_IDS'
FROM ids_alvo a
WHERE e."CD_ENDERECO_ENTREGA" = a.id
  AND e."FGACTIVE" = 'A';

-- Conferencia dos IDs inativados nos ultimos 5 minutos:
SELECT
  e."CD_ENDERECO_ENTREGA",
  e."TENANT_ID",
  e."FGACTIVE",
  e."DS_PONTO_ENTREGA",
  e."DH_MAINTENANCE",
  e."SGUSER"
FROM "CADASTRO_ENDERECO_ENTREGA" e
WHERE e."FGACTIVE" = 'I'
  AND e."SGUSER" = 'SCRIPT_LIMPEZA_IDS'
  AND e."DH_MAINTENANCE" >= (CURRENT_TIMESTAMP - INTERVAL '5 minutes')
ORDER BY e."CD_ENDERECO_ENTREGA" DESC;

COMMIT;

-- ROLLBACK manual dos IDs (se necessario):
-- WITH ids_alvo AS (SELECT UNNEST(ARRAY[123,124]::int[]) AS id)
-- UPDATE "CADASTRO_ENDERECO_ENTREGA" e
-- SET "FGACTIVE" = 'A', "DH_MAINTENANCE" = CURRENT_TIMESTAMP, "SGUSER" = 'SCRIPT_RESTORE_IDS'
-- FROM ids_alvo a
-- WHERE e."CD_ENDERECO_ENTREGA" = a.id;
