-- WMS — Normalizar CODIGO em WMS_PRODUTO_DONO conforme MASCARA_CODIGO_PRODUTO do dono.
--
-- O que faz:
--   • Atualiza linhas SEM conflito (ex.: 2010583301 → 2.01.05.833.01) quando o dono tem máscara.
--   • NÃO une dois CD_PRODUTO duplicados (isso exige script/manual com movimentos).
--
-- Antes: rode wms_auditar_codigo_produto_postgres.sql e revise a seção "conflito".
-- Homologação primeiro. Backup recomendado.
--
-- Uso:
--   psql ... -f backend/scripts/wms_normalizar_codigo_produto_postgres.sql

\echo '=== WMS normalizar CODIGO produto (tenant default) ==='

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

BEGIN;

WITH candidatos AS (
  SELECT
    p."CD_PRODUTO",
    p."CD_DONO",
    p."CODIGO" AS codigo_antigo,
    wms_aplicar_mascara_codigo(p."CODIGO", d."MASCARA_CODIGO_PRODUTO") AS codigo_novo
  FROM "WMS_PRODUTO_DONO" p
  JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = p."CD_DONO" AND d."TENANT_ID" = p."TENANT_ID"
  WHERE p."TENANT_ID" = 'default'
    AND COALESCE(p."FGACTIVE", 'S') = 'S'
    AND NULLIF(trim(d."MASCARA_CODIGO_PRODUTO"), '') IS NOT NULL
),
ok AS (
  SELECT c.*
  FROM candidatos c
  WHERE lower(trim(c.codigo_antigo)) <> lower(trim(c.codigo_novo))
    AND trim(c.codigo_novo) <> ''
    AND NOT EXISTS (
      SELECT 1
      FROM "WMS_PRODUTO_DONO" o
      WHERE o."TENANT_ID" = 'default'
        AND o."CD_DONO" = c."CD_DONO"
        AND o."CD_PRODUTO" <> c."CD_PRODUTO"
        AND lower(trim(o."CODIGO")) = lower(trim(c.codigo_novo))
        AND COALESCE(o."FGACTIVE", 'S') = 'S'
    )
),
upd_prod AS (
  UPDATE "WMS_PRODUTO_DONO" p
     SET "CODIGO" = o.codigo_novo,
         "DH_MAINTENANCE" = CURRENT_TIMESTAMP,
         "SG_USER" = COALESCE(p."SG_USER", 'normalizar_codigo')
    FROM ok o
   WHERE p."CD_PRODUTO" = o."CD_PRODUTO"
  RETURNING p."CD_PRODUTO", p."CD_DONO", o.codigo_antigo, p."CODIGO" AS codigo_novo
),
upd_depara AS (
  UPDATE "WMS_DEPARA_PRODUTO" dp
     SET "CODIGO_INTERNO" = o.codigo_novo,
         "DH_MAINTENANCE" = CURRENT_TIMESTAMP
    FROM ok o
   WHERE dp."TENANT_ID" = 'default'
     AND dp."CD_DONO" = o."CD_DONO"
     AND lower(trim(dp."CODIGO_INTERNO")) = lower(trim(o.codigo_antigo))
  RETURNING dp."CD_DEPARA"
)
SELECT
  (SELECT COUNT(*) FROM upd_prod) AS produtos_atualizados,
  (SELECT COUNT(*) FROM upd_depara) AS depara_atualizados;

COMMIT;

\echo 'Concluído. Rode novamente wms_auditar_codigo_produto_postgres.sql para ver duplicatas restantes.'
