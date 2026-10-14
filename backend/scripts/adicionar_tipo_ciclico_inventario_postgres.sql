-- ============================================================================
-- Adiciona o tipo CICLICO ao inventário WMS (Fase 3 do roadmap).
-- PostgreSQL, idempotente. Executar no banco depois de criar_wms_inventario_postgres.sql.
--
-- Inventário cíclico = contagem rotineira de pequenos lotes de SKUs sem parar o
-- armazém. Difere do GERAL: a lista de SKUs é gerada por critério (ABC, FEFO,
-- mais antigos sem contar, mais movimentados, aleatório, conservação) e cada
-- ciclo só ajusta os SKUs listados — política "MANTER" para os demais.
--
-- Ver docs/WMS_INVENTARIO_ORIENTACAO_PROCESSO.md (seção C).
-- ============================================================================

DO $$
BEGIN
  -- Remove a CHECK antiga se existir e recria com CICLICO.
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'ck_wms_inv_tp'
       AND conrelid = '"WMS_INVENTARIO"'::regclass
  ) THEN
    ALTER TABLE "WMS_INVENTARIO" DROP CONSTRAINT ck_wms_inv_tp;
  END IF;

  ALTER TABLE "WMS_INVENTARIO"
    ADD CONSTRAINT ck_wms_inv_tp
    CHECK ("TP_INVENTARIO" IN ('INICIAL', 'GERAL', 'CICLICO'));
END $$;

COMMENT ON CONSTRAINT ck_wms_inv_tp ON "WMS_INVENTARIO"
  IS 'Tipos: INICIAL (carga zero→saldo), GERAL (periódico), CICLICO (rotina por amostra/critério).';

-- Critério utilizado para gerar a lista do ciclo (apenas inventários CICLICO).
ALTER TABLE "WMS_INVENTARIO"
  ADD COLUMN IF NOT EXISTS "CRITERIO_CICLICO" VARCHAR(32);

COMMENT ON COLUMN "WMS_INVENTARIO"."CRITERIO_CICLICO" IS
  'Critério usado na geração da lista do ciclo (ex.: ABC, VENCIMENTO, MAIS_ANTIGOS, MAIS_MOVIMENTADOS, ALEATORIO, CONSERVACAO). Apenas para TP_INVENTARIO = CICLICO.';

-- Garantia idempotente: aceita 'CICLICO_GERADO' na ORIGEM da linha de inventário,
-- para distinguir linhas pré-populadas pelo gerador das importadas por CSV.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'ck_wms_inv_lin_origem'
       AND conrelid = '"WMS_INVENTARIO_LINHA"'::regclass
  ) THEN
    ALTER TABLE "WMS_INVENTARIO_LINHA" DROP CONSTRAINT ck_wms_inv_lin_origem;
  END IF;

  ALTER TABLE "WMS_INVENTARIO_LINHA"
    ADD CONSTRAINT ck_wms_inv_lin_origem
    CHECK ("ORIGEM" IN ('SNAPSHOT', 'IMPORT', 'NAO_CONTADO_ZERAR', 'MANUAL', 'CICLICO_GERADO'));
END $$;
