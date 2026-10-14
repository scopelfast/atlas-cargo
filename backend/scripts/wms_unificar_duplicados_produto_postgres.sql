-- WMS — Identificar e unificar produtos duplicados (mesmo SKU lógico, CODIGO diferente).
--
-- Causa típica: import XML com código só dígitos (6031021420) + import OL com máscara (6.03.10.214.20).
-- O índice único usa LOWER(TRIM(CODIGO)) literal → os dois coexistem até unificar.
--
-- O script:
--   1) Lista grupos duplicados (sempre).
--   2) Se v_executar = true: mantém 1 cadastro, reponta FKs, EXCLUI os demais (DELETE).
--
-- Depois rode: adicionar_wms_produto_dono_indice_chave_sku_postgres.sql (trava no banco).
--
-- Regra do cadastro mantido (melhor pontuação):
--   • Código com máscara (contém ponto)
--   • ORIGEM_CADASTRO: IMPORT_OL > IMPORT_XML_PRODUTO > outros
--   • Mais vínculos em WMS_PRODUTO_OPERACIONAL e WMS_MOVIMENTO_ESTOQUE
--   • DH_MAINTENANCE mais recente, depois maior CD_PRODUTO
--
-- Antes: backup ou homologação. Tenant/dono ajustáveis abaixo.
--
-- Uso pgAdmin: execute o arquivo INTEIRO (Query Tool). Comandos \echo são só do psql — não use no pgAdmin.
--   1) Revise os SELECTs (seções 1 e 2). 2) executar=true no bloco de parâmetros. 3) Execute de novo.

-- === WMS — Unificar duplicados de produto (SKU) ===

-- ---------- parâmetros ----------
DO $$
BEGIN
  PERFORM set_config('wms.unificar.tenant', 'default', true);
  PERFORM set_config('wms.unificar.cd_dono', '', true);  -- '' = TODOS os donos (1 e 2); ou '2' só Nutriville
  PERFORM set_config('wms.unificar.executar', 'false', true);  -- SOMENTE LISTA! Para EXCLUIR no banco use: wms_unificar_duplicados_produto_APLICAR_postgres.sql
END $$;

-- ---------- funções auxiliares (idempotentes) ----------
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

-- --- 1) Grupos duplicados (mesma chave de dígitos) ---

WITH cfg AS (
  SELECT
    current_setting('wms.unificar.tenant', true) AS tenant,
    NULLIF(trim(current_setting('wms.unificar.cd_dono', true)), '')::integer AS cd_dono
),
prod AS (
  SELECT
    p."CD_PRODUTO",
    p."CD_DONO",
    d."NOME" AS nm_dono,
    p."CODIGO",
    wms_codigo_produto_chave(p."CODIGO") AS chave,
    wms_aplicar_mascara_codigo(p."CODIGO", d."MASCARA_CODIGO_PRODUTO") AS codigo_canon,
    p."NOME",
    p."ORIGEM_CADASTRO",
    p."DH_MAINTENANCE",
    COALESCE(op.qtd_op, 0) AS qtd_operacional,
    COALESCE(mv.qtd_mov, 0) AS qtd_movimento,
    ROW_NUMBER() OVER (
      PARTITION BY p."TENANT_ID", p."CD_DONO", wms_codigo_produto_chave(p."CODIGO")
      ORDER BY
        (CASE WHEN COALESCE(p."FGACTIVE", 'S') = 'S' THEN 0 ELSE 1 END),
        (CASE WHEN p."CODIGO" ~ '\.' THEN 0 ELSE 1 END),
        (CASE COALESCE(p."ORIGEM_CADASTRO", '')
          WHEN 'IMPORT_OL' THEN 0
          WHEN 'IMPORT_XML_PRODUTO' THEN 1
          ELSE 2 END),
        COALESCE(op.qtd_op, 0) DESC,
        COALESCE(mv.qtd_mov, 0) DESC,
        p."DH_MAINTENANCE" DESC NULLS LAST,
        p."CD_PRODUTO" DESC
    ) AS rn
  FROM "WMS_PRODUTO_DONO" p
  JOIN "WMS_DONO_ESTOQUE" d
    ON d."CD_DONO" = p."CD_DONO" AND d."TENANT_ID" = p."TENANT_ID"
  CROSS JOIN cfg c
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS qtd_op
      FROM "WMS_PRODUTO_OPERACIONAL" o
     WHERE o."CD_PRODUTO" = p."CD_PRODUTO"
       AND o."TENANT_ID" = p."TENANT_ID"
  ) op ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS qtd_mov
      FROM "WMS_MOVIMENTO_ESTOQUE" m
     WHERE m."CD_PRODUTO" = p."CD_PRODUTO"
       AND m."TENANT_ID" = p."TENANT_ID"
  ) mv ON true
  WHERE p."TENANT_ID" = c.tenant
    AND wms_codigo_produto_chave(p."CODIGO") <> ''
    AND (c.cd_dono IS NULL OR p."CD_DONO" = c.cd_dono)
),
grupos_dup AS (
  SELECT chave, "CD_DONO", nm_dono, COUNT(*) AS qtd
    FROM prod
   GROUP BY chave, "CD_DONO", nm_dono
  HAVING COUNT(*) > 1
)
SELECT
  g."CD_DONO",
  g.nm_dono,
  g.chave,
  g.qtd AS registros_no_grupo,
  string_agg(
    p.rn::text || '=' ||
    CASE WHEN p.rn = 1 THEN 'MANTER ' ELSE 'EXCLUIR ' END ||
    '#' || p."CD_PRODUTO"::text || ' "' || p."CODIGO" || '" (' ||
    COALESCE(p."ORIGEM_CADASTRO", '?') || ')',
    ' | ' ORDER BY p.rn
  ) AS plano
FROM grupos_dup g
JOIN prod p ON p.chave = g.chave AND p."CD_DONO" = g."CD_DONO"
GROUP BY g."CD_DONO", g.nm_dono, g.chave, g.qtd
ORDER BY g.qtd DESC, g."CD_DONO", g.chave;

-- --- 2) Detalhe linha a linha (MANTER = rn 1) ---

WITH cfg AS (
  SELECT
    current_setting('wms.unificar.tenant', true) AS tenant,
    NULLIF(trim(current_setting('wms.unificar.cd_dono', true)), '')::integer AS cd_dono
),
prod AS (
  SELECT
    p."CD_PRODUTO",
    p."CD_DONO",
    d."NOME" AS nm_dono,
    p."CODIGO",
    wms_codigo_produto_chave(p."CODIGO") AS chave,
    wms_aplicar_mascara_codigo(p."CODIGO", d."MASCARA_CODIGO_PRODUTO") AS codigo_canon,
    p."NOME",
    p."ORIGEM_CADASTRO",
    p."FGACTIVE",
    ROW_NUMBER() OVER (
      PARTITION BY p."TENANT_ID", p."CD_DONO", wms_codigo_produto_chave(p."CODIGO")
      ORDER BY
        (CASE WHEN COALESCE(p."FGACTIVE", 'S') = 'S' THEN 0 ELSE 1 END),
        (CASE WHEN p."CODIGO" ~ '\.' THEN 0 ELSE 1 END),
        (CASE COALESCE(p."ORIGEM_CADASTRO", '')
          WHEN 'IMPORT_OL' THEN 0
          WHEN 'IMPORT_XML_PRODUTO' THEN 1
          ELSE 2 END),
        p."DH_MAINTENANCE" DESC NULLS LAST,
        p."CD_PRODUTO" DESC
    ) AS rn
  FROM "WMS_PRODUTO_DONO" p
  JOIN "WMS_DONO_ESTOQUE" d
    ON d."CD_DONO" = p."CD_DONO" AND d."TENANT_ID" = p."TENANT_ID"
  CROSS JOIN cfg c
  WHERE p."TENANT_ID" = c.tenant
    AND wms_codigo_produto_chave(p."CODIGO") <> ''
    AND (c.cd_dono IS NULL OR p."CD_DONO" = c.cd_dono)
)
SELECT
  p."CD_DONO",
  p.nm_dono,
  p.chave,
  p.rn,
  CASE WHEN p.rn = 1 THEN 'MANTER' ELSE 'EXCLUIR' END AS acao,
  p."CD_PRODUTO",
  p."CODIGO",
  p.codigo_canon,
  p."NOME",
  p."ORIGEM_CADASTRO",
  p."FGACTIVE"
FROM prod p
WHERE EXISTS (
  SELECT 1 FROM prod p2
   WHERE p2.chave = p.chave AND p2."CD_DONO" = p."CD_DONO"
   GROUP BY p2.chave, p2."CD_DONO"
  HAVING COUNT(*) > 1
)
ORDER BY p."CD_DONO", p.chave, p.rn;

-- ---------- 3) Correção (somente se wms.unificar.executar = true) ----------
DO $$
DECLARE
  v_tenant text := current_setting('wms.unificar.tenant', true);
  v_cd_dono integer := NULLIF(trim(current_setting('wms.unificar.cd_dono', true)), '')::integer;
  v_executar boolean := lower(coalesce(current_setting('wms.unificar.executar', true), 'false')) IN ('true', '1', 't', 'yes');
  n_op integer;
  n_tmp integer;
  n_mov integer;
  n_inv integer;
  n_res integer;
  n_dep integer;
  n_excluidos integer;
  n_codigo integer;
BEGIN
  IF NOT v_executar THEN
    RAISE NOTICE 'Modo SOMENTE LEITURA. Para aplicar: no bloco DO do início do arquivo, use PERFORM set_config(''wms.unificar.executar'', ''true'', true); e execute o script inteiro de novo.';
    RETURN;
  END IF;

  RAISE NOTICE 'Aplicando unificação (EXCLUI duplicados) tenant=% dono=% ...', v_tenant, COALESCE(v_cd_dono::text, 'TODOS');

  CREATE TEMP TABLE wms_dup_map (
    cd_manter integer NOT NULL,
    cd_remover integer NOT NULL,
    cd_dono integer NOT NULL,
    codigo_canon text NOT NULL,
    chave text NOT NULL,
    PRIMARY KEY (cd_remover)
  ) ON COMMIT DROP;

  INSERT INTO wms_dup_map (cd_manter, cd_remover, cd_dono, codigo_canon, chave)
  WITH cfg AS (
    SELECT v_tenant AS tenant, v_cd_dono AS cd_dono
  ),
  prod AS (
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
    CROSS JOIN cfg c
    WHERE p."TENANT_ID" = c.tenant
      AND wms_codigo_produto_chave(p."CODIGO") <> ''
      AND (c.cd_dono IS NULL OR p."CD_DONO" = c.cd_dono)
  ),
  keepers AS (
    SELECT * FROM prod WHERE rn = 1
  ),
  removers AS (
    SELECT * FROM prod WHERE rn > 1
  )
  SELECT kpr."CD_PRODUTO", rem."CD_PRODUTO", kpr."CD_DONO", kpr.codigo_canon, kpr.chave
    FROM removers rem
    JOIN keepers kpr
      ON kpr."CD_DONO" = rem."CD_DONO" AND kpr.chave = rem.chave;

  GET DIAGNOSTICS n_excluidos = ROW_COUNT;
  RAISE NOTICE 'Pares duplicado→mantido: %', n_excluidos;

  IF n_excluidos = 0 THEN
    RAISE NOTICE 'Nenhum duplicado encontrado. Nada a fazer.';
    RETURN;
  END IF;

  -- Operacional: apagar linhas do removido que colidiriam no mantido; resto reponta CD_PRODUTO
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
   WHERE o."CD_PRODUTO" = m.cd_remover
     AND o."TENANT_ID" = v_tenant;
  GET DIAGNOSTICS n_tmp = ROW_COUNT;
  n_op := n_op + n_tmp;

  UPDATE "WMS_MOVIMENTO_ESTOQUE" x
     SET "CD_PRODUTO" = m.cd_manter
    FROM wms_dup_map m
   WHERE x."CD_PRODUTO" = m.cd_remover
     AND x."TENANT_ID" = v_tenant;
  GET DIAGNOSTICS n_mov = ROW_COUNT;

  -- Inventário: se mesma contagem já existe no mantido, remove linha do duplicado; senão reponta
  DELETE FROM "WMS_INVENTARIO_LINHA" il
   USING wms_dup_map m
   WHERE il."CD_PRODUTO" = m.cd_remover
     AND EXISTS (
       SELECT 1 FROM "WMS_INVENTARIO_LINHA" k
        WHERE k."CD_INVENTARIO" = il."CD_INVENTARIO"
          AND k."CD_PRODUTO" = m.cd_manter
     );
  UPDATE "WMS_INVENTARIO_LINHA" il
     SET "CD_PRODUTO" = m.cd_manter,
         "CODIGO_PRODUTO" = m.codigo_canon
    FROM wms_dup_map m
   WHERE il."CD_PRODUTO" = m.cd_remover;
  GET DIAGNOSTICS n_inv = ROW_COUNT;

  DELETE FROM "WMS_RESERVA_ESTOQUE_OPL" r
   USING wms_dup_map m
   WHERE r."CD_PRODUTO" = m.cd_remover
     AND r."TENANT_ID" = v_tenant
     AND EXISTS (
       SELECT 1 FROM "WMS_RESERVA_ESTOQUE_OPL" k
        WHERE k."TENANT_ID" = r."TENANT_ID"
          AND k."CD_OPL_ARQUIVO" = r."CD_OPL_ARQUIVO"
          AND k."CD_PRODUTO" = m.cd_manter
     );
  UPDATE "WMS_RESERVA_ESTOQUE_OPL" r
     SET "CD_PRODUTO" = m.cd_manter
    FROM wms_dup_map m
   WHERE r."CD_PRODUTO" = m.cd_remover
     AND r."TENANT_ID" = v_tenant;
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
   WHERE p."CD_PRODUTO" = m.cd_manter
     AND p."TENANT_ID" = v_tenant
     AND lower(trim(p."CODIGO")) <> lower(trim(m.codigo_canon));
  GET DIAGNOSTICS n_codigo = ROW_COUNT;

  DELETE FROM "WMS_PRODUTO_DONO" p
    USING wms_dup_map m
   WHERE p."CD_PRODUTO" = m.cd_remover
     AND p."TENANT_ID" = v_tenant;
  GET DIAGNOSTICS n_excluidos = ROW_COUNT;

  RAISE NOTICE 'Operacional (del+upd): % | Movimentos: % | Inventário: % | Reserva OPL: % | De-para: % | Código canon no mantido: % | Produtos EXCLUÍDOS: %',
    n_op, n_mov, n_inv, n_res, n_dep, n_codigo, n_excluidos;
END $$;

-- --- 3) Conferência pós-execução (duplicatas restantes; deve ser 0 linhas) ---

WITH cfg AS (
  SELECT
    current_setting('wms.unificar.tenant', true) AS tenant,
    NULLIF(trim(current_setting('wms.unificar.cd_dono', true)), '')::integer AS cd_dono
)
SELECT p."CD_DONO", wms_codigo_produto_chave(p."CODIGO") AS chave, COUNT(*) AS qtd
  FROM "WMS_PRODUTO_DONO" p
  CROSS JOIN cfg c
 WHERE p."TENANT_ID" = c.tenant
   AND wms_codigo_produto_chave(p."CODIGO") <> ''
   AND (c.cd_dono IS NULL OR p."CD_DONO" = c.cd_dono)
 GROUP BY p."CD_DONO", wms_codigo_produto_chave(p."CODIGO")
HAVING COUNT(*) > 1;

-- Fim. Depois rode: adicionar_wms_produto_dono_indice_chave_sku_postgres.sql
-- (impede novo par com/sem ponto no mesmo dono).
