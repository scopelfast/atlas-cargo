-- Nome: backfill_motorista_veiculo_cdequipamento_por_placa_postgres.sql
-- Objetivo: preencher MOTORISTA_VEICULO.CDEQUIPAMENTO (IDEQUIPAMENTO em EQUIPAMENTO) quando ainda NULL,
--           casando placa normalizada com REFEQUIPAMENTO do equipamento ativo do mesmo tenant.
-- Uso: executar no pgAdmin após conferir o PREVIEW. Não apaga dados; só atualiza linhas elegíveis.
--
-- Elegível: FGACTIVE = S, STATUSAPROVACAO = A (ou legado tratado como A), CDEQUIPAMENTO IS NULL,
--           placa normalizada com comprimento >= 7, existe EQUIPAMENTO ativo no tenant com mesma placa.
-- Empate: vários EQUIPAMENTO com a mesma placa no tenant → escolhe-se o menor IDEQUIPAMENTO.

-- =============================================================================
-- 0) CONFIGURAÇÃO (edite antes de rodar o bloco DO na seção 2)
-- =============================================================================
-- p_tenant: NULL = todos os tenants; ou texto exato do TENANT_ID (ex.: 'default').
-- p_cdcadastro: NULL = todos os motoristas; ou CDCADASTRO numérico para limitar a um cadastro.

-- =============================================================================
-- 1) PREVIEW — rode só isto primeiro e confira as linhas (id mv, placa, ideq)
-- =============================================================================
SELECT
  mv."IDVEICULOMOTORISTA",
  mv."CDCADASTRO",
  mv."TENANT_ID" AS mv_tenant,
  COALESCE(NULLIF(TRIM(BOTH FROM mv."TENANT_ID"::text), ''), NULLIF(TRIM(BOTH FROM cg."TENANT_ID"::text), ''), 'default') AS tenant_efetivo,
  COALESCE(NULLIF(TRIM(BOTH FROM mv."PLACA_NORMALIZADA"::text), ''), UPPER(REGEXP_REPLACE(COALESCE(mv."PLACA", ''), '[^A-Z0-9]', '', 'gi'))) AS placa_n,
  e."IDEQUIPAMENTO" AS idequipamento_escolhido,
  e."REFEQUIPAMENTO" AS ref_equipamento
FROM "MOTORISTA_VEICULO" mv
INNER JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = mv."CDCADASTRO"
INNER JOIN "EQUIPAMENTO" e
  ON e."TENANT_ID" = COALESCE(NULLIF(TRIM(BOTH FROM mv."TENANT_ID"::text), ''), NULLIF(TRIM(BOTH FROM cg."TENANT_ID"::text), ''), 'default')
 AND (e."FGACTIVE" IN ('A', 'S') OR e."FGACTIVE" IS NULL)
 AND UPPER(REGEXP_REPLACE(COALESCE(e."REFEQUIPAMENTO", ''), '[^A-Z0-9]', '', 'gi'))
     = COALESCE(NULLIF(TRIM(BOTH FROM mv."PLACA_NORMALIZADA"::text), ''), UPPER(REGEXP_REPLACE(COALESCE(mv."PLACA", ''), '[^A-Z0-9]', '', 'gi')))
WHERE COALESCE(mv."FGACTIVE", 'S') = 'S'
  AND COALESCE(mv."STATUSAPROVACAO", 'P') IN ('A')
  AND mv."CDEQUIPAMENTO" IS NULL
  AND LENGTH(COALESCE(NULLIF(TRIM(BOTH FROM mv."PLACA_NORMALIZADA"::text), ''), UPPER(REGEXP_REPLACE(COALESCE(mv."PLACA", ''), '[^A-Z0-9]', '', 'gi')))) >= 7
  AND e."IDEQUIPAMENTO" = (
    SELECT e2."IDEQUIPAMENTO"
    FROM "EQUIPAMENTO" e2
    WHERE e2."TENANT_ID" = COALESCE(NULLIF(TRIM(BOTH FROM mv."TENANT_ID"::text), ''), NULLIF(TRIM(BOTH FROM cg."TENANT_ID"::text), ''), 'default')
      AND (e2."FGACTIVE" IN ('A', 'S') OR e2."FGACTIVE" IS NULL)
      AND UPPER(REGEXP_REPLACE(COALESCE(e2."REFEQUIPAMENTO", ''), '[^A-Z0-9]', '', 'gi'))
          = COALESCE(NULLIF(TRIM(BOTH FROM mv."PLACA_NORMALIZADA"::text), ''), UPPER(REGEXP_REPLACE(COALESCE(mv."PLACA", ''), '[^A-Z0-9]', '', 'gi')))
    ORDER BY e2."IDEQUIPAMENTO" ASC
    LIMIT 1
  )
ORDER BY mv."CDCADASTRO", mv."IDVEICULOMOTORISTA";

-- =============================================================================
-- 2) APLICAR BACKFILL (transação + aviso com contagem)
-- =============================================================================
-- Ajuste p_tenant e p_cdcadastro no DECLARE abaixo, depois execute o bloco inteiro.
DO $$
DECLARE
  p_tenant text := NULL;           -- ex.: 'default' ou o tenant real; NULL = todos
  p_cdcadastro numeric := NULL;    -- ex.: 12345 para um motorista só; NULL = todos
  v_atualizados int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_VEICULO' AND column_name = 'CDEQUIPAMENTO'
  ) THEN
    RAISE EXCEPTION 'Coluna MOTORISTA_VEICULO.CDEQUIPAMENTO inexistente. Execute adicionar_motorista_veiculo_aprovacao_tenant_postgres.sql antes.';
  END IF;

  UPDATE "MOTORISTA_VEICULO" mv
  SET
    "CDEQUIPAMENTO" = chosen.ideq,
    "DHMAINTENANCE" = CURRENT_TIMESTAMP,
    "SGUSER" = CASE
      WHEN mv."SGUSER" IS NULL OR TRIM(BOTH FROM mv."SGUSER"::text) = '' THEN 'backfill_placa_equip'
      ELSE SUBSTRING(TRIM(BOTH FROM mv."SGUSER"::text) || '|backfill_placa_equip', 1, 50)
    END
  FROM (
    SELECT DISTINCT ON (mv2."IDVEICULOMOTORISTA")
      mv2."IDVEICULOMOTORISTA" AS idmv,
      e."IDEQUIPAMENTO" AS ideq
    FROM "MOTORISTA_VEICULO" mv2
    INNER JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = mv2."CDCADASTRO"
    INNER JOIN "EQUIPAMENTO" e
      ON e."TENANT_ID" = COALESCE(NULLIF(TRIM(BOTH FROM mv2."TENANT_ID"::text), ''), NULLIF(TRIM(BOTH FROM cg."TENANT_ID"::text), ''), 'default')
     AND (e."FGACTIVE" IN ('A', 'S') OR e."FGACTIVE" IS NULL)
     AND UPPER(REGEXP_REPLACE(COALESCE(e."REFEQUIPAMENTO", ''), '[^A-Z0-9]', '', 'gi'))
         = COALESCE(NULLIF(TRIM(BOTH FROM mv2."PLACA_NORMALIZADA"::text), ''), UPPER(REGEXP_REPLACE(COALESCE(mv2."PLACA", ''), '[^A-Z0-9]', '', 'gi')))
    WHERE COALESCE(mv2."FGACTIVE", 'S') = 'S'
      AND COALESCE(mv2."STATUSAPROVACAO", 'P') IN ('A')
      AND mv2."CDEQUIPAMENTO" IS NULL
      AND LENGTH(COALESCE(NULLIF(TRIM(BOTH FROM mv2."PLACA_NORMALIZADA"::text), ''), UPPER(REGEXP_REPLACE(COALESCE(mv2."PLACA", ''), '[^A-Z0-9]', '', 'gi')))) >= 7
      AND (p_tenant IS NULL OR COALESCE(NULLIF(TRIM(BOTH FROM mv2."TENANT_ID"::text), ''), NULLIF(TRIM(BOTH FROM cg."TENANT_ID"::text), ''), 'default') = p_tenant)
      AND (p_cdcadastro IS NULL OR mv2."CDCADASTRO" = p_cdcadastro)
    ORDER BY mv2."IDVEICULOMOTORISTA", e."IDEQUIPAMENTO" ASC
  ) AS chosen
  WHERE mv."IDVEICULOMOTORISTA" = chosen.idmv;

  GET DIAGNOSTICS v_atualizados = ROW_COUNT;
  RAISE NOTICE 'Backfill MOTORISTA_VEICULO.CDEQUIPAMENTO: % linha(s) atualizada(s).', v_atualizados;
END $$;
