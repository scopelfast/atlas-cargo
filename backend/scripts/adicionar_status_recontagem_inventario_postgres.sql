    -- ============================================================================
    -- Fase 3b do inventário cíclico: status por SKU + recontagem + tolerância.
    --
    -- Adiciona:
    --   1. Coluna NU_PCT_TOLERANCIA_CICLICO em WMS_DONO_ESTOQUE (default por dono).
    --   2. Coluna PCT_TOLERANCIA em WMS_INVENTARIO (override por inventário).
    --   3. Colunas ST_LINHA, FG_RECONTAGEM, NU_RECONTAGENS, SG_APROVADOR, DH_APROVACAO
    --      em WMS_INVENTARIO_LINHA.
    --
    -- Idempotente. PostgreSQL. Pode rodar várias vezes sem efeito colateral.
    -- ============================================================================

    -- 1. Tolerância default por dono ----------------------------------------------
    ALTER TABLE "WMS_DONO_ESTOQUE"
      ADD COLUMN IF NOT EXISTS "NU_PCT_TOLERANCIA_CICLICO" NUMERIC(6, 3) NOT NULL DEFAULT 0;

    COMMENT ON COLUMN "WMS_DONO_ESTOQUE"."NU_PCT_TOLERANCIA_CICLICO" IS
      'Tolerância percentual default para inventário cíclico (ex.: 1 = 1%). |contado - sistema| / sistema acima deste valor marca a linha como DIVERGENTE e exige recontagem ou aprovação supervisor.';

    -- 2. Override por inventário ---------------------------------------------------
    ALTER TABLE "WMS_INVENTARIO"
      ADD COLUMN IF NOT EXISTS "PCT_TOLERANCIA" NUMERIC(6, 3);

    COMMENT ON COLUMN "WMS_INVENTARIO"."PCT_TOLERANCIA" IS
      'Tolerância (%) específica deste inventário. Se NULL, usa NU_PCT_TOLERANCIA_CICLICO do dono.';

    -- 3. Status por linha e auditoria ---------------------------------------------
    ALTER TABLE "WMS_INVENTARIO_LINHA"
      ADD COLUMN IF NOT EXISTS "ST_LINHA" VARCHAR(20) NOT NULL DEFAULT 'PENDENTE';

    ALTER TABLE "WMS_INVENTARIO_LINHA"
      ADD COLUMN IF NOT EXISTS "FG_RECONTAGEM" CHAR(1) NOT NULL DEFAULT 'N';

    ALTER TABLE "WMS_INVENTARIO_LINHA"
      ADD COLUMN IF NOT EXISTS "NU_RECONTAGENS" INTEGER NOT NULL DEFAULT 0;

    ALTER TABLE "WMS_INVENTARIO_LINHA"
      ADD COLUMN IF NOT EXISTS "SG_APROVADOR" VARCHAR(64);

    ALTER TABLE "WMS_INVENTARIO_LINHA"
      ADD COLUMN IF NOT EXISTS "DH_APROVACAO" TIMESTAMPTZ;

    COMMENT ON COLUMN "WMS_INVENTARIO_LINHA"."ST_LINHA" IS
      'Status da linha: PENDENTE (não contado), CONTADO (qtd informada e dentro da tolerância), DIVERGENTE (acima da tolerância — pendente decisão), RECONTAR (marcado para recontagem), APROVADO (supervisor aceitou a divergência).';

    COMMENT ON COLUMN "WMS_INVENTARIO_LINHA"."FG_RECONTAGEM" IS
      'S = linha veio de uma recontagem (substituiu uma anterior). N = primeira contagem.';

    COMMENT ON COLUMN "WMS_INVENTARIO_LINHA"."NU_RECONTAGENS" IS
      'Quantas vezes esta linha foi recontada (incrementa a cada substituição via fluxo de recontagem).';

    -- Garantia: CHECK do ST_LINHA --------------------------------------------------
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'ck_wms_inv_lin_st'
           AND conrelid = '"WMS_INVENTARIO_LINHA"'::regclass
      ) THEN
        ALTER TABLE "WMS_INVENTARIO_LINHA" DROP CONSTRAINT ck_wms_inv_lin_st;
      END IF;

      ALTER TABLE "WMS_INVENTARIO_LINHA"
        ADD CONSTRAINT ck_wms_inv_lin_st
        CHECK ("ST_LINHA" IN ('PENDENTE', 'CONTADO', 'DIVERGENTE', 'RECONTAR', 'APROVADO'));
    END $$;

    -- Índice de apoio ao painel de pendências por inventário ----------------------
    CREATE INDEX IF NOT EXISTS idx_wms_inv_lin_st
      ON "WMS_INVENTARIO_LINHA" ("CD_INVENTARIO", "ST_LINHA");
