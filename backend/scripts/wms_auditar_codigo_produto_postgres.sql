-- WMS — Auditoria: códigos de produto com e sem máscara (por dono).
-- Somente leitura. Executar antes de wms_normalizar_codigo_produto_postgres.sql
--
-- Uso: psql ... -f backend/scripts/wms_auditar_codigo_produto_postgres.sql

-- Função de máscara (idempotente; compartilhada com script de normalização)
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

-- 1) Resumo por dono: com ponto, só dígitos, duplicatas lógicas
SELECT
  p."CD_DONO",
  d."NOME" AS dono,
  NULLIF(trim(d."MASCARA_CODIGO_PRODUTO"), '') AS mascara,
  COUNT(*) AS total_produtos,
  COUNT(*) FILTER (WHERE p."CODIGO" ~ '\.') AS com_ponto,
  COUNT(*) FILTER (WHERE p."CODIGO" !~ '\.' AND p."CODIGO" ~ '^[0-9]+$') AS so_digitos,
  COUNT(*) FILTER (WHERE COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'S') AS ref_fornecedor
FROM "WMS_PRODUTO_DONO" p
JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = p."CD_DONO" AND d."TENANT_ID" = p."TENANT_ID"
WHERE p."TENANT_ID" = 'default'
  AND COALESCE(p."FGACTIVE", 'S') = 'S'
GROUP BY p."CD_DONO", d."NOME", d."MASCARA_CODIGO_PRODUTO"
ORDER BY p."CD_DONO";

-- 2) Duplicatas lógicas (mesma chave, mesmo dono) — exige decisão manual se qtd > 1
SELECT
  p."CD_DONO",
  d."NOME" AS dono,
  wms_codigo_produto_chave(p."CODIGO") AS chave,
  COUNT(*) AS qtd,
  string_agg(
    p."CD_PRODUTO"::text || ':' || p."CODIGO" || ' (' || COALESCE(p."ORIGEM_CADASTRO", '?') || ')',
    ' | ' ORDER BY (CASE WHEN p."CODIGO" ~ '\.' THEN 0 ELSE 1 END), p."CD_PRODUTO"
  ) AS cadastros
FROM "WMS_PRODUTO_DONO" p
JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = p."CD_DONO" AND d."TENANT_ID" = p."TENANT_ID"
WHERE p."TENANT_ID" = 'default'
  AND COALESCE(p."FGACTIVE", 'S') = 'S'
GROUP BY p."CD_DONO", d."NOME", wms_codigo_produto_chave(p."CODIGO")
HAVING COUNT(*) > 1
ORDER BY qtd DESC, p."CD_DONO", chave;

-- 3) Pode normalizar sozinho (sem conflito): código sem máscara → formato do dono
WITH base AS (
  SELECT
    p."CD_PRODUTO",
    p."CD_DONO",
    d."NOME" AS dono,
    p."CODIGO" AS codigo_atual,
    NULLIF(trim(d."MASCARA_CODIGO_PRODUTO"), '') AS mascara,
    wms_aplicar_mascara_codigo(p."CODIGO", d."MASCARA_CODIGO_PRODUTO") AS codigo_sugerido
  FROM "WMS_PRODUTO_DONO" p
  JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = p."CD_DONO" AND d."TENANT_ID" = p."TENANT_ID"
  WHERE p."TENANT_ID" = 'default'
    AND COALESCE(p."FGACTIVE", 'S') = 'S'
    AND NULLIF(trim(d."MASCARA_CODIGO_PRODUTO"), '') IS NOT NULL
)
SELECT b.*
FROM base b
WHERE lower(trim(b.codigo_atual)) <> lower(trim(b.codigo_sugerido))
  AND NOT EXISTS (
    SELECT 1
    FROM "WMS_PRODUTO_DONO" o
    WHERE o."TENANT_ID" = 'default'
      AND o."CD_DONO" = b."CD_DONO"
      AND o."CD_PRODUTO" <> b."CD_PRODUTO"
      AND lower(trim(o."CODIGO")) = lower(trim(b.codigo_sugerido))
      AND COALESCE(o."FGACTIVE", 'S') = 'S'
  )
ORDER BY b."CD_DONO", b.codigo_atual;

-- 4) Conflito: normalizar geraria SKU duplicado (resolver antes do UPDATE em massa)
WITH base AS (
  SELECT
    p."CD_PRODUTO",
    p."CD_DONO",
    d."NOME" AS dono,
    p."CODIGO" AS codigo_atual,
    wms_aplicar_mascara_codigo(p."CODIGO", d."MASCARA_CODIGO_PRODUTO") AS codigo_sugerido
  FROM "WMS_PRODUTO_DONO" p
  JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = p."CD_DONO" AND d."TENANT_ID" = p."TENANT_ID"
  WHERE p."TENANT_ID" = 'default'
    AND COALESCE(p."FGACTIVE", 'S') = 'S'
    AND NULLIF(trim(d."MASCARA_CODIGO_PRODUTO"), '') IS NOT NULL
)
SELECT b.*
FROM base b
WHERE lower(trim(b.codigo_atual)) <> lower(trim(b.codigo_sugerido))
  AND EXISTS (
    SELECT 1
    FROM "WMS_PRODUTO_DONO" o
    WHERE o."TENANT_ID" = 'default'
      AND o."CD_DONO" = b."CD_DONO"
      AND o."CD_PRODUTO" <> b."CD_PRODUTO"
      AND lower(trim(o."CODIGO")) = lower(trim(b.codigo_sugerido))
      AND COALESCE(o."FGACTIVE", 'S') = 'S'
  )
ORDER BY b."CD_DONO", wms_codigo_produto_chave(b.codigo_atual);
