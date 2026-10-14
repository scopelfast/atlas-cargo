-- Nome: backfill_criar_equipamento_vinculo_placas_motorista_postgres.sql
-- Objetivo: para placas já em MOTORISTA_VEICULO (aprovadas, sem CDEQUIPAMENTO) e SEM equipamento
--           correspondente no tenant, INSERT em EQUIPAMENTO (padrão aprovação: T / carroceria 10)
--           e UPDATE do vínculo. Se o equipamento já existir pela placa, só faz o UPDATE do vínculo.
--
-- Ajuste os 3 parâmetros no DECLARE antes de executar o bloco DO.

DO $$
DECLARE
  p_tenant       varchar(64) := 'default';     -- TENANT_ID do cadastro / equipamento
  p_cdcadastro   numeric := 16;                -- CDCADASTRO do motorista (ex.: código na tela)
  p_placas       text[] := ARRAY['DSA9876', 'ASD1234'];
  p              text;
  v_placa_n      text;
  v_idmv         integer;
  v_cd_classe_mv int;
  v_ideq         numeric;
  v_novo_id      numeric;
  v_cd_tipo      int;
  v_cd_marca     int;
  v_cd_classe    int;
  v_fgr          varchar(1);
  v_rz           text;
  v_desc         varchar(240);
  v_sg           varchar(50) := 'backfill_criar_equip_placas';
  v_criados      int := 0;
  v_vinculados   int := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MOTORISTA_VEICULO' AND column_name = 'CDEQUIPAMENTO'
  ) THEN
    RAISE EXCEPTION 'Coluna MOTORISTA_VEICULO.CDEQUIPAMENTO inexistente.';
  END IF;

  SELECT TRIM(COALESCE(cg."RZSOCIAL", '')),
         CASE WHEN UPPER(TRIM(COALESCE(cg."FGRASTREADO"::text, 'N'))) = 'S' THEN 'S' ELSE 'N' END
    INTO v_rz, v_fgr
  FROM "CADASTROGERAL" cg
  WHERE cg."CDCADASTRO" = p_cdcadastro::numeric
  LIMIT 1;

  IF NOT EXISTS (SELECT 1 FROM "CADASTROGERAL" WHERE "CDCADASTRO" = p_cdcadastro::numeric) THEN
    RAISE EXCEPTION 'Cadastro % não encontrado.', p_cdcadastro;
  END IF;

  SELECT t."CDTIPOEQUIPAMENTO"
    INTO v_cd_tipo
  FROM "TIPOEQUIPAMENTO" t
  WHERE (t."TENANT_ID" = p_tenant OR t."TENANT_ID" = 'default')
    AND (t."FGACTIVE" IN ('A', 'S') OR t."FGACTIVE" IS NULL)
  ORDER BY t."CDTIPOEQUIPAMENTO" ASC
  LIMIT 1;

  SELECT m."CDMARCAEQUIPAMENTO"
    INTO v_cd_marca
  FROM "MARCAEQUIPAMENTO" m
  WHERE (m."TENANT_ID" = p_tenant OR m."TENANT_ID" = 'default')
    AND (m."FGACTIVE" IN ('A', 'S') OR m."FGACTIVE" IS NULL)
  ORDER BY m."CDMARCAEQUIPAMENTO" ASC
  LIMIT 1;

  IF v_cd_tipo IS NULL OR v_cd_marca IS NULL THEN
    RAISE EXCEPTION 'Cadastre ao menos um Tipo e uma Marca de equipamento no tenant %.', p_tenant;
  END IF;

  FOREACH p IN ARRAY p_placas
  LOOP
    v_placa_n := UPPER(REGEXP_REPLACE(TRIM(p), '[^A-Z0-9]', '', 'gi'));
    IF length(v_placa_n) < 7 THEN
      RAISE NOTICE 'Ignorada (placa curta): %', p;
      CONTINUE;
    END IF;

    SELECT mv."IDVEICULOMOTORISTA", mv."CDCLASSEFROTA"
      INTO v_idmv, v_cd_classe_mv
    FROM "MOTORISTA_VEICULO" mv
    INNER JOIN "CADASTROGERAL" cg ON cg."CDCADASTRO" = mv."CDCADASTRO"
    WHERE mv."CDCADASTRO" = p_cdcadastro::numeric
      AND COALESCE(NULLIF(TRIM(BOTH FROM mv."TENANT_ID"::text), ''), NULLIF(TRIM(BOTH FROM cg."TENANT_ID"::text), ''), 'default') = p_tenant
      AND COALESCE(mv."FGACTIVE", 'S') = 'S'
      AND UPPER(COALESCE(mv."STATUSAPROVACAO"::text, '')) = 'A'
      AND mv."CDEQUIPAMENTO" IS NULL
      AND COALESCE(NULLIF(TRIM(BOTH FROM mv."PLACA_NORMALIZADA"::text), ''),
            UPPER(REGEXP_REPLACE(COALESCE(mv."PLACA", ''), '[^A-Z0-9]', '', 'gi'))) = v_placa_n
    ORDER BY mv."IDVEICULOMOTORISTA" DESC
    LIMIT 1;

    IF v_idmv IS NULL THEN
      RAISE NOTICE 'MOTORISTA_VEICULO não encontrado (cad %, tenant %, placa %).', p_cdcadastro, p_tenant, v_placa_n;
      CONTINUE;
    END IF;

    SELECT e."IDEQUIPAMENTO"
      INTO v_ideq
    FROM "EQUIPAMENTO" e
    WHERE e."TENANT_ID" = p_tenant
      AND (e."FGACTIVE" IN ('A', 'S') OR e."FGACTIVE" IS NULL)
      AND UPPER(REGEXP_REPLACE(COALESCE(e."REFEQUIPAMENTO", ''), '[^A-Z0-9]', '', 'gi')) = v_placa_n
    ORDER BY e."IDEQUIPAMENTO" ASC
    LIMIT 1;

    IF v_ideq IS NULL THEN
      v_cd_classe := NULL;
      IF v_cd_classe_mv IS NOT NULL AND EXISTS (
        SELECT 1 FROM "CLASSEFROTA" c
        WHERE c."CDCLASSEFROTA" = v_cd_classe_mv::int
          AND (c."TENANT_ID" = p_tenant OR c."TENANT_ID" = 'default' OR c."TENANT_ID" IS NULL)
      ) THEN
        v_cd_classe := v_cd_classe_mv::int;
      END IF;

      SELECT COALESCE(MAX("IDEQUIPAMENTO"), 0) + 1 INTO v_novo_id FROM "EQUIPAMENTO";

      v_desc := LEFT('App motorista — ' || COALESCE(NULLIF(v_rz, ''), '?') || ' — ' || v_placa_n, 240);

      INSERT INTO "EQUIPAMENTO" (
        "IDEQUIPAMENTO", "REFEQUIPAMENTO", "DSEQUIPAMENTO", "CDGRUPOEQUIPAMENTO",
        "CDTIPOEQUIPAMENTO", "CDMARCAEQUIPAMENTO", "CDMODELOEQUIPAMENTO", "CDCLASSEFROTA",
        "FGTIPOATUACAO", "FGTIPOCARROCERIA", "NREIXOS", "CAPACIDCARGA", "ANOFABRICA",
        "ALTURA", "LARGURA", "COMPRIMENTO", "MTCUBICO", "FGRASTREADO", "FGACTIVE",
        "DHMAINTENANCE", "SGUSER", "SERVERORIG", "TENANT_ID"
      ) VALUES (
        v_novo_id, v_placa_n, v_desc, NULL,
        v_cd_tipo,
        v_cd_marca, NULL, v_cd_classe,
        'T', '10', NULL, NULL, NULL,
        NULL, NULL, NULL, NULL, v_fgr, 'A',
        CURRENT_TIMESTAMP, v_sg, 'BackfillPlacasMotorista', p_tenant
      );

      v_ideq := v_novo_id;
      v_criados := v_criados + 1;
      RAISE NOTICE 'Equipamento criado IDEQUIPAMENTO=% placa=%', v_ideq, v_placa_n;
    ELSE
      RAISE NOTICE 'Equipamento existente IDEQUIPAMENTO=% placa=%', v_ideq, v_placa_n;
    END IF;

    UPDATE "MOTORISTA_VEICULO" mv
    SET "CDEQUIPAMENTO" = v_ideq,
        "DHMAINTENANCE" = CURRENT_TIMESTAMP,
        "SGUSER" = CASE
          WHEN mv."SGUSER" IS NULL OR TRIM(BOTH FROM mv."SGUSER"::text) = '' THEN v_sg
          ELSE LEFT(TRIM(BOTH FROM mv."SGUSER"::text) || '|' || v_sg, 50)
        END
    WHERE mv."IDVEICULOMOTORISTA" = v_idmv;

    v_vinculados := v_vinculados + 1;
  END LOOP;

  RAISE NOTICE 'Concluído: % equipamento(s) criado(s), % vínculo(s) MOTORISTA_VEICULO atualizado(s).', v_criados, v_vinculados;
END $$;
