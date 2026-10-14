-- WMS — Políticas de validade / relatório de vencimento no DONO do estoque (PostgreSQL).
-- Idempotente: ADD COLUMN IF NOT EXISTS.
-- Relacionado: docs/WMS_ESTRATEGIA_INVENTARIO_ALERTAS_DASHBOARDS.md

ALTER TABLE "WMS_DONO_ESTOQUE"
  ADD COLUMN IF NOT EXISTS "NU_DIAS_REL_VENCIMENTO" INTEGER NOT NULL DEFAULT 60;

ALTER TABLE "WMS_DONO_ESTOQUE"
  ADD COLUMN IF NOT EXISTS "NU_DIAS_MIN_VALID_RECEB" INTEGER NOT NULL DEFAULT 90;

-- Garantir limites sanos (apenas se as colunas existirem e ainda não houver constraint com esse nome)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_wms_dono_rel_vencimento'
  ) THEN
    ALTER TABLE "WMS_DONO_ESTOQUE"
      ADD CONSTRAINT chk_wms_dono_rel_vencimento
      CHECK ("NU_DIAS_REL_VENCIMENTO" >= 1 AND "NU_DIAS_REL_VENCIMENTO" <= 1095);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_wms_dono_min_valid_receb'
  ) THEN
    ALTER TABLE "WMS_DONO_ESTOQUE"
      ADD CONSTRAINT chk_wms_dono_min_valid_receb
      CHECK ("NU_DIAS_MIN_VALID_RECEB" >= 1 AND "NU_DIAS_MIN_VALID_RECEB" <= 1095);
  END IF;
END $$;

COMMENT ON COLUMN "WMS_DONO_ESTOQUE"."NU_DIAS_REL_VENCIMENTO" IS 'Relatório diário ao dono: produtos com validade nos próximos N dias.';
COMMENT ON COLUMN "WMS_DONO_ESTOQUE"."NU_DIAS_MIN_VALID_RECEB" IS 'Recebimento: validade mínima (dias a partir de hoje) para aceitar mercadoria; exceções via fluxo de liberação (futuro).';
