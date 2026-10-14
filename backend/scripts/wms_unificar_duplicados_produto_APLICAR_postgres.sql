-- WMS — APLICAR unificação de duplicados (EXCLUI registros duplicados no banco).
-- pgAdmin: execute ESTE arquivo inteiro (F5). Não é só leitura.
--
-- Pré-requisito: funções wms_* (rode antes wms_unificar_duplicados_produto_postgres.sql
-- até o CREATE FUNCTION, ou execute este arquivo que recria as funções).
--
-- Depois: adicionar_wms_produto_dono_indice_chave_sku_postgres.sql

CREATE OR REPLACE FUNCTION wms_aplicar_mascara_codigo(p_valor text, p_mascara text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  m text;
  src text;
  out text := '';
  i int;
  ch text;
  p int := 1;
  c text;
  ok boolean;
BEGIN
  m := upper(trim(coalesce(p_mascara, '')));
  IF m = '' THEN
    RETURN trim(coalesce(p_valor, ''));
  END IF;
  src := upper(regexp_replace(coalesce(p_valor, ''), '[^0-9A-Z]', '', 'g'));
  IF src = '' THEN
    RETURN trim(coalesce(p_valor, ''));
  END IF;
  FOR i IN 1..length(m) LOOP
    ch := substr(m, i, 1);
    IF ch IN ('0', 'A', 'X') THEN
      ok := false;
      WHILE p <= length(src) AND NOT ok LOOP
        c := substr(src, p, 1);
        p := p + 1;
        ok := (ch = '0' AND c ~ '[0-9]') OR (ch = 'A' AND c ~ '[A-Z]') OR (ch = 'X' AND c ~ '[0-9A-Z]');
        IF ok THEN
          out := out || c;
        END IF;
      END LOOP;
    ELSE
      out := out || ch;
    END IF;
  END LOOP;
  RETURN out;
END;
$$;

CREATE OR REPLACE FUNCTION wms_codigo_produto_chave(p_codigo text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(trim(coalesce(p_codigo, '')), '[^0-9A-Za-z]', '', 'g'));
$$;

DO $$
DECLARE
  dup_row RECORD;
  v_tenant text := 'default';
  v_cd_dono integer := NULL;
  n_op integer := 0;
  n_tmp integer := 0;
  n_mov integer := 0;
  n_inv integer := 0;
  n_res integer := 0;
  n_dep integer := 0;
  n_excluidos integer := 0;
  n_codigo integer := 0;
  n_pares integer := 0;
BEGIN
  RAISE NOTICE '>>> APLICANDO exclusão de duplicados tenant=% dono=%', v_tenant, COALESCE(v_cd_dono::text, 'TODOS');

  CREATE TEMP TABLE wms_dup_map (
    cd_manter integer NOT NULL,
    cd_remover integer NOT NULL,
    cd_dono integer NOT NULL,
    codigo_canon text NOT NULL,
    chave text NOT NULL,
    PRIMARY KEY (cd_remover)
  ) ON COMMIT DROP;

  INSERT INTO wms_dup_map (cd_manter, cd_remover, cd_dono, codigo_canon, chave)
  WITH prod AS (
    SELECT
      p."CD_PRODUTO",
      p."CD_DONO",
      wms_codigo_produto_chave(p."CODIGO") AS chave,
      wms_aplicar_mascara_codigo(p."CODIGO", d."MASCARA_CODIGO_PRODUTO") AS codigo_canon,
      ROW_NUMBER() OVER (
        PARTITION BY p."TENANT_ID", p."CD_DONO", wms_codigo_produto_chave(p."CODIGO")
        ORDER BY
          (CASE WHEN COALESCE(p."FGACTIVE", 'S') = 'S' THEN 0 ELSE 1 END),
          (CASE WHEN p."CODIGO" ~ '\.' THEN 0 ELSE 1 END),
          (CASE COALESCE(p."ORIGEM_CADASTRO", '')
            WHEN 'IMPORT_OL' THEN 0
            WHEN 'IMPORT_XML_PRODUTO' THEN 1
            ELSE 2 END),
          (SELECT COUNT(*) FROM "WMS_PRODUTO_OPERACIONAL" o
            WHERE o."CD_PRODUTO" = p."CD_PRODUTO" AND o."TENANT_ID" = p."TENANT_ID") DESC,
          (SELECT COUNT(*) FROM "WMS_MOVIMENTO_ESTOQUE" m
            WHERE m."CD_PRODUTO" = p."CD_PRODUTO" AND m."TENANT_ID" = p."TENANT_ID") DESC,
          p."DH_MAINTENANCE" DESC NULLS LAST,
          p."CD_PRODUTO" DESC
      ) AS rn
    FROM "WMS_PRODUTO_DONO" p
    JOIN "WMS_DONO_ESTOQUE" d
      ON d."CD_DONO" = p."CD_DONO" AND d."TENANT_ID" = p."TENANT_ID"
    WHERE p."TENANT_ID" = v_tenant
      AND wms_codigo_produto_chave(p."CODIGO") <> ''
      AND (v_cd_dono IS NULL OR p."CD_DONO" = v_cd_dono)
  ),
  keepers AS (SELECT * FROM prod WHERE rn = 1),
  removers AS (SELECT * FROM prod WHERE rn > 1)
  SELECT kpr."CD_PRODUTO", rem."CD_PRODUTO", kpr."CD_DONO", kpr.codigo_canon, kpr.chave
    FROM removers rem
    JOIN keepers kpr ON kpr."CD_DONO" = rem."CD_DONO" AND kpr.chave = rem.chave;

  GET DIAGNOSTICS n_pares = ROW_COUNT;
  RAISE NOTICE 'Pares a unificar (duplicado será EXCLUÍDO): %', n_pares;

  IF n_pares = 0 THEN
    RAISE NOTICE 'Nenhum duplicado. Banco já limpo ou tenant/dono diferente.';
    RETURN;
  END IF;

  FOR dup_row IN
    SELECT m.cd_remover, m.cd_manter, m.codigo_canon
      FROM wms_dup_map m
     ORDER BY m.cd_remover
  LOOP
    RAISE NOTICE '  EXCLUIR #%, manter #% (codigo %)', dup_row.cd_remover, dup_row.cd_manter, dup_row.codigo_canon;
  END LOOP;

  DELETE FROM "WMS_PRODUTO_OPERACIONAL" o
   USING wms_dup_map m
   WHERE o."CD_PRODUTO" = m.cd_remover
     AND o."TENANT_ID" = v_tenant
     AND EXISTS (
       SELECT 1 FROM "WMS_PRODUTO_OPERACIONAL" k
        WHERE k."TENANT_ID" = o."TENANT_ID"
          AND k."CD_DONO" = o."CD_DONO"
          AND k."CD_PRODUTO" = m.cd_manter
          AND lower(trim(k."CODIGO_OPERACIONAL")) = lower(trim(o."CODIGO_OPERACIONAL"))
     );
  GET DIAGNOSTICS n_op = ROW_COUNT;

  UPDATE "WMS_PRODUTO_OPERACIONAL" o
     SET "CD_PRODUTO" = m.cd_manter,
         "CODIGO_ESTOQUE" = m.codigo_canon,
         "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
         "SG_USER" = 'unificar_dup_produto'
    FROM wms_dup_map m
   WHERE o."CD_PRODUTO" = m.cd_remover AND o."TENANT_ID" = v_tenant;
  GET DIAGNOSTICS n_tmp = ROW_COUNT;
  n_op := n_op + n_tmp;

  UPDATE "WMS_MOVIMENTO_ESTOQUE" x
     SET "CD_PRODUTO" = m.cd_manter
    FROM wms_dup_map m
   WHERE x."CD_PRODUTO" = m.cd_remover AND x."TENANT_ID" = v_tenant;
  GET DIAGNOSTICS n_mov = ROW_COUNT;

  DELETE FROM "WMS_INVENTARIO_LINHA" il
   USING wms_dup_map m
   WHERE il."CD_PRODUTO" = m.cd_remover
     AND EXISTS (
       SELECT 1 FROM "WMS_INVENTARIO_LINHA" k
        WHERE k."CD_INVENTARIO" = il."CD_INVENTARIO" AND k."CD_PRODUTO" = m.cd_manter
     );
  UPDATE "WMS_INVENTARIO_LINHA" il
     SET "CD_PRODUTO" = m.cd_manter, "CODIGO_PRODUTO" = m.codigo_canon
    FROM wms_dup_map m
   WHERE il."CD_PRODUTO" = m.cd_remover;
  GET DIAGNOSTICS n_inv = ROW_COUNT;

  DELETE FROM "WMS_RESERVA_ESTOQUE_OPL" r
   USING wms_dup_map m
   WHERE r."CD_PRODUTO" = m.cd_remover AND r."TENANT_ID" = v_tenant
     AND EXISTS (
       SELECT 1 FROM "WMS_RESERVA_ESTOQUE_OPL" k
        WHERE k."TENANT_ID" = r."TENANT_ID"
          AND k."CD_OPL_ARQUIVO" = r."CD_OPL_ARQUIVO"
          AND k."CD_PRODUTO" = m.cd_manter
     );
  UPDATE "WMS_RESERVA_ESTOQUE_OPL" r
     SET "CD_PRODUTO" = m.cd_manter
    FROM wms_dup_map m
   WHERE r."CD_PRODUTO" = m.cd_remover AND r."TENANT_ID" = v_tenant;
  GET DIAGNOSTICS n_res = ROW_COUNT;

  UPDATE "WMS_DEPARA_PRODUTO" dp
     SET "CODIGO_INTERNO" = m.codigo_canon,
         "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
         "SG_USER" = 'unificar_dup_produto'
    FROM wms_dup_map m
   WHERE dp."TENANT_ID" = v_tenant
     AND dp."CD_DONO" = m.cd_dono
     AND lower(regexp_replace(trim(dp."CODIGO_INTERNO"), '[^0-9A-Za-z]', '', 'g')) = m.chave;
  GET DIAGNOSTICS n_dep = ROW_COUNT;

  UPDATE "WMS_PRODUTO_DONO" p
     SET "CODIGO" = m.codigo_canon,
         "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
         "SG_USER" = 'unificar_dup_produto'
    FROM wms_dup_map m
   WHERE p."CD_PRODUTO" = m.cd_manter AND p."TENANT_ID" = v_tenant
     AND lower(trim(p."CODIGO")) <> lower(trim(m.codigo_canon));
  GET DIAGNOSTICS n_codigo = ROW_COUNT;

  DELETE FROM "WMS_PRODUTO_DONO" p
    USING wms_dup_map m
   WHERE p."CD_PRODUTO" = m.cd_remover AND p."TENANT_ID" = v_tenant;
  GET DIAGNOSTICS n_excluidos = ROW_COUNT;

  RAISE NOTICE '>>> CONCLUÍDO. Produtos EXCLUÍDOS do banco: % (esperado %)', n_excluidos, n_pares;
  RAISE NOTICE '    Operacional/Mov/Inv/Res/Dep/Cod: % / % / % / % / % / %',
    n_op, n_mov, n_inv, n_res, n_dep, n_codigo;
END $$;

-- Conferência: deve retornar 0 linhas
SELECT p."CD_DONO", wms_codigo_produto_chave(p."CODIGO") AS chave, COUNT(*) AS qtd
  FROM "WMS_PRODUTO_DONO" p
 WHERE p."TENANT_ID" = 'default'
 GROUP BY p."CD_DONO", wms_codigo_produto_chave(p."CODIGO")
HAVING COUNT(*) > 1;

-- Farinha Rosca: só deve existir #2100
SELECT "CD_PRODUTO", "CODIGO", "NOME", "FGACTIVE"
  FROM "WMS_PRODUTO_DONO"
 WHERE "TENANT_ID" = 'default' AND "CD_DONO" = 2
   AND wms_codigo_produto_chave("CODIGO") = wms_codigo_produto_chave('6.03.10.214.20');
