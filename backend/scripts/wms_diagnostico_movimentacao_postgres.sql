-- ============================================================================
-- Diagnóstico: por que o relatório de Movimentação está mostrando pouca coisa?
--
-- Compara entradas (NF-e encerradas) × cargas expedidas × movimentos no ledger
-- nos últimos 90 dias, por dono. Se houver carga "EXPEDIDA" SEM movimento
-- "EXPEDICAO_SAIDA" no mesmo período, é falha de gravação (script para corrigir
-- listado no final).
--
-- Como rodar:
--   1. Conecte ao banco (pgAdmin).
--   2. Ajuste a linha "SET LOCAL my.tenant" abaixo com o TENANT_ID alvo.
--   3. Execute o bloco inteiro.
-- ============================================================================

\set ON_ERROR_STOP on

-- AJUSTE: troque pelo TENANT_ID que está em uso (ex.: 'default').
BEGIN;
SELECT set_config('my.tenant', 'default', true);
SELECT set_config('my.dias', '90', true);

-- ------------------ 1. Quantos recebimentos encerrados? ---------------------
SELECT
  '1. NF-e encerradas no período' AS bloco,
  e."CD_DONO",
  d."NOME" AS nm_dono,
  COUNT(*)                        AS qtd_nfe,
  MIN(COALESCE(e."DH_ENCERRAMENTO", e."DH_CONFERENCIA", e."DH_IMPORTACAO"))::date AS primeira,
  MAX(COALESCE(e."DH_ENCERRAMENTO", e."DH_CONFERENCIA", e."DH_IMPORTACAO"))::date AS ultima
FROM "WMS_NFE_ENTRADA" e
LEFT JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = e."CD_DONO" AND d."TENANT_ID" = e."TENANT_ID"
WHERE e."TENANT_ID" = current_setting('my.tenant')
  AND UPPER(TRIM(COALESCE(e."ST_RECEBIMENTO",''))) = 'ENCERRADA'
  AND COALESCE(e."DH_ENCERRAMENTO", e."DH_CONFERENCIA", e."DH_IMPORTACAO")
      >= NOW() - (current_setting('my.dias')::int || ' days')::interval
GROUP BY e."CD_DONO", d."NOME"
ORDER BY e."CD_DONO";

-- ------------------ 2. Quantas cargas EXPEDIDAS no período? -----------------
SELECT
  '2. Cargas EXPEDIDAS no período' AS bloco,
  c."CD_DONO",
  d."NOME" AS nm_dono,
  COUNT(*)            AS qtd_cargas,
  MIN(c."DH_EXPEDICAO")::date AS primeira_exp,
  MAX(c."DH_EXPEDICAO")::date AS ultima_exp
FROM "WMS_CARGA_PROGRAMADA" c
LEFT JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = c."CD_DONO" AND d."TENANT_ID" = c."TENANT_ID"
WHERE c."TENANT_ID" = current_setting('my.tenant')
  AND UPPER(TRIM(COALESCE(c."ST_CARGA",''))) = 'EXPEDIDA'
  AND c."DH_EXPEDICAO" >= NOW() - (current_setting('my.dias')::int || ' days')::interval
GROUP BY c."CD_DONO", d."NOME"
ORDER BY c."CD_DONO";

-- ------------------ 3. Movimentos no ledger no período ----------------------
SELECT
  '3. WMS_MOVIMENTO_ESTOQUE no período' AS bloco,
  m."CD_DONO",
  d."NOME" AS nm_dono,
  m."TP_MOVIMENTO",
  COUNT(*)            AS qtd_movs,
  SUM(m."QTD")::numeric AS soma_qtd,
  MIN(m."DH_REGISTRO")::date AS primeira,
  MAX(m."DH_REGISTRO")::date AS ultima
FROM "WMS_MOVIMENTO_ESTOQUE" m
LEFT JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = m."CD_DONO" AND d."TENANT_ID" = m."TENANT_ID"
WHERE m."TENANT_ID" = current_setting('my.tenant')
  AND m."DH_REGISTRO" >= NOW() - (current_setting('my.dias')::int || ' days')::interval
GROUP BY m."CD_DONO", d."NOME", m."TP_MOVIMENTO"
ORDER BY m."CD_DONO", m."TP_MOVIMENTO";

-- ------------------ 4. Cargas expedidas SEM movimento gerado ---------------
-- Detecta o problema mais comum: a expedição foi confirmada mas registrarSaidaExpedicaoCarga
-- não conseguiu gravar (schemaMissing, dono nulo, de-para sem código).
SELECT
  '4. Cargas EXPEDIDAS SEM EXPEDICAO_SAIDA' AS bloco,
  c."CD_CARGA",
  c."CD_DONO",
  c."DH_EXPEDICAO"::date AS dh_exp,
  c."NM_MOTORISTA",
  c."PLACA_VEICULO"
FROM "WMS_CARGA_PROGRAMADA" c
WHERE c."TENANT_ID" = current_setting('my.tenant')
  AND UPPER(TRIM(COALESCE(c."ST_CARGA",''))) = 'EXPEDIDA'
  AND c."DH_EXPEDICAO" >= NOW() - (current_setting('my.dias')::int || ' days')::interval
  AND NOT EXISTS (
    SELECT 1
      FROM "WMS_MOVIMENTO_ESTOQUE" m
     WHERE m."TENANT_ID" = c."TENANT_ID"
       AND m."CD_DONO"   = c."CD_DONO"
       AND m."REF_CD_CARGA" = c."CD_CARGA"
       AND m."TP_MOVIMENTO" = 'EXPEDICAO_SAIDA'
  )
ORDER BY c."DH_EXPEDICAO" DESC
LIMIT 200;

-- ------------------ 5. Existe a tabela WMS_MOVIMENTO_ESTOQUE? --------------
SELECT
  '5. Estrutura da tabela WMS_MOVIMENTO_ESTOQUE' AS bloco,
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'WMS_MOVIMENTO_ESTOQUE') AS tabela_existe,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'WMS_MOVIMENTO_ESTOQUE') AS colunas_total;

ROLLBACK;

-- ============================================================================
-- INTERPRETAÇÃO DOS RESULTADOS:
--
-- Bloco 1 com NF-e mas Bloco 3 vazio (ou só com ENTRADA): nenhuma expedição
-- foi confirmada. Solução: confirmar as cargas na tela "Expedição".
--
-- Bloco 2 com cargas expedidas e Bloco 4 listando elas: a expedição foi
-- confirmada, mas o ledger não gravou EXPEDICAO_SAIDA. Causas comuns:
--   - WMS_MOVIMENTO_ESTOQUE não existe (rode adicionar_wms_movimento_estoque_postgres.sql)
--   - CD_DONO ausente em WMS_CARGA_PROGRAMADA
--   - DE-PARA OPL não resolveu nenhum código (resolverProdutoEstoque retorna vazio)
-- Para reprocessar uma carga:
--   POST /api/wms/cargas/programadas/:cdCarga/revalidar  (re-valida; saída só na confirmação)
--
-- Bloco 5 com tabela_existe=false: rode backend/scripts/adicionar_wms_movimento_estoque_postgres.sql.
-- ============================================================================
