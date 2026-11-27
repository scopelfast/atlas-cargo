-- =============================================================================
-- Atlas Pay P0.2 — collation / opclass domínio / FK PG14+ / triggers / funções
-- PostgreSQL 14+. Idempotente. Transação única.
-- NÃO ativa FG_REGRA_ATIVA. NÃO altera dados. NÃO concede atlas_fin_manutencao.
-- Docs: docs/PLANO_MIGRACAO_P0_ATLAS_PAY.md | docs/RELATORIO_REVISAO_P0_2_ATLAS_PAY.md
-- NÃO EXECUTAR sem autorização expressa + diagnósticos GO.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Role: criar só se ausente; se existir, validar atributos (sem ALTER automático)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM pg_roles WHERE rolname = 'atlas_fin_manutencao';
  IF NOT FOUND THEN
    CREATE ROLE atlas_fin_manutencao
      NOINHERIT
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION
      NOBYPASSRLS;
    RETURN;
  END IF;

  IF r.rolcanlogin
     OR r.rolinherit
     OR r.rolsuper
     OR r.rolcreatedb
     OR r.rolcreaterole
     OR r.rolreplication
     OR r.rolbypassrls
  THEN
    RAISE EXCEPTION
      'P0: role atlas_fin_manutencao existe com atributos incompatíveis (login=% inherit=% super=% createdb=% createrole=% replication=% bypassrls=%). Corrija manualmente; o script não altera a role.',
      r.rolcanlogin, r.rolinherit, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.fin_p0_regclass(p_schema text, p_rel text)
RETURNS regclass
LANGUAGE plpgsql
STABLE
AS $f$
DECLARE
  v regclass;
BEGIN
  SELECT c.oid::regclass INTO v
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = p_schema AND c.relname = p_rel AND c.relkind IN ('r', 'p');
  IF v IS NULL THEN
    RAISE EXCEPTION 'P0: relação %.% não encontrada', p_schema, p_rel;
  END IF;
  RETURN v;
END;
$f$;

CREATE OR REPLACE FUNCTION pg_temp.fin_p0_attnums(p_rel regclass, p_cols text[])
RETURNS smallint[]
LANGUAGE plpgsql
STABLE
AS $f$
DECLARE
  v_out smallint[] := '{}';
  v_col text;
  v_att smallint;
BEGIN
  FOREACH v_col IN ARRAY p_cols LOOP
    SELECT a.attnum INTO v_att
      FROM pg_attribute a
     WHERE a.attrelid = p_rel
       AND a.attname = v_col
       AND a.attnum > 0
       AND NOT a.attisdropped;
    IF v_att IS NULL THEN
      RAISE EXCEPTION 'P0: coluna %.% inexistente', p_rel, v_col;
    END IF;
    v_out := v_out || v_att;
  END LOOP;
  RETURN v_out;
END;
$f$;

-- Remove espaços fora de literais '...' (respeita '' escapado).
-- NÃO aplica lower(): 'BRL' ≠ 'brl'.
CREATE OR REPLACE FUNCTION pg_temp.fin_p0_strip_ws_outside_literals(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $f$
DECLARE
  s text;
  i int := 1;
  n int;
  ch text;
  in_str boolean := false;
  out_t text := '';
BEGIN
  -- NULL in → NULL out (índice sem predicado: '' IS DISTINCT FROM NULL quebrava idempotência)
  IF p IS NULL THEN
    RETURN NULL;
  END IF;
  s := p;
  n := length(s);
  WHILE i <= n LOOP
    ch := substr(s, i, 1);
    IF in_str THEN
      out_t := out_t || ch;
      IF ch = '''' THEN
        IF i < n AND substr(s, i + 1, 1) = '''' THEN
          out_t := out_t || '''';
          i := i + 2;
          CONTINUE;
        ELSE
          in_str := false;
        END IF;
      END IF;
      i := i + 1;
    ELSE
      IF ch = '''' THEN
        in_str := true;
        out_t := out_t || ch;
        i := i + 1;
      ELSIF ch ~ '\s' THEN
        i := i + 1;
      ELSE
        out_t := out_t || ch;
        i := i + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN out_t;
END;
$f$;

-- Extrai exatamente n posições de int2vector / oidvector (subscritos SQL 0 .. n-1).
CREATE OR REPLACE FUNCTION pg_temp.fin_p0_int2vector_prefix(p int2vector, p_n int)
RETURNS smallint[]
LANGUAGE plpgsql
STABLE
AS $f$
DECLARE
  v smallint[] := '{}';
  i int;
BEGIN
  IF p_n IS NULL OR p_n < 0 THEN
    RAISE EXCEPTION 'P0: indnkeyatts inválido (%)', p_n;
  END IF;
  IF p_n = 0 THEN
    RETURN v;
  END IF;
  FOR i IN 0 .. (p_n - 1) LOOP
    v := v || (p[i])::smallint;
  END LOOP;
  RETURN v;
END;
$f$;

CREATE OR REPLACE FUNCTION pg_temp.fin_p0_oidvector_prefix(p oidvector, p_n int)
RETURNS oid[]
LANGUAGE plpgsql
STABLE
AS $f$
DECLARE
  v oid[] := '{}';
  i int;
BEGIN
  IF p_n IS NULL OR p_n < 0 THEN
    RAISE EXCEPTION 'P0: indnkeyatts inválido (%)', p_n;
  END IF;
  IF p_n = 0 THEN
    RETURN v;
  END IF;
  FOR i IN 0 .. (p_n - 1) LOOP
    v := v || (p[i])::oid;
  END LOOP;
  RETURN v;
END;
$f$;

-- Opções de índice: ASC NULLS LAST=0; DESC NULLS FIRST=3 (padrão do CREATE … DESC).
CREATE OR REPLACE FUNCTION pg_temp.fin_p0_expected_indoptions(
  p_ncols int,
  p_desc_cols text[],
  p_cols text[]
) RETURNS smallint[]
LANGUAGE plpgsql
IMMUTABLE
AS $f$
DECLARE
  v smallint[] := '{}';
  i int;
  v_col text;
BEGIN
  FOR i IN 1 .. p_ncols LOOP
    v_col := p_cols[i];
    IF p_desc_cols IS NOT NULL AND v_col = ANY (p_desc_cols) THEN
      v := v || 3::smallint; -- DESC | NULLS FIRST
    ELSE
      v := v || 0::smallint; -- ASC NULLS LAST
    END IF;
  END LOOP;
  RETURN v;
END;
$f$;

-- Resolve domínio → tipo base (recursivo).
CREATE OR REPLACE FUNCTION pg_temp.fin_p0_base_type(p_typid oid)
RETURNS oid
LANGUAGE plpgsql
STABLE
AS $f$
DECLARE
  v_typtype "char";
  v_base oid;
BEGIN
  LOOP
    SELECT t.typtype, t.typbasetype INTO v_typtype, v_base
      FROM pg_type t WHERE t.oid = p_typid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'P0: tipo OID % inexistente', p_typid;
    END IF;
    IF v_typtype = 'd' THEN
      p_typid := v_base;
    ELSE
      RETURN p_typid;
    END IF;
  END LOOP;
END;
$f$;

-- Opclass btree default do tipo base (domínios incluídos).
-- varchar/bpchar etc. usam text_ops (opcintype=text) via coerção binária — igual GetDefaultOpClass do PG.
CREATE OR REPLACE FUNCTION pg_temp.fin_p0_default_opclass(p_typid oid)
RETURNS oid
LANGUAGE plpgsql
STABLE
AS $f$
DECLARE
  v_base oid := pg_temp.fin_p0_base_type(p_typid);
  v_opc oid;
BEGIN
  -- Espelha GetDefaultOpClass: exact match, depois coerção binária para tipo
  -- preferido da categoria (varchar → text_ops, não bpchar_ops).
  SELECT opc.oid INTO v_opc
    FROM pg_opclass opc
    JOIN pg_am am ON am.oid = opc.opcmethod
    JOIN pg_type t ON t.oid = opc.opcintype
   WHERE am.amname = 'btree'
     AND opc.opcdefault
     AND (
       opc.opcintype = v_base
       OR EXISTS (
         SELECT 1
           FROM pg_cast ca
          WHERE ca.castsource = v_base
            AND ca.casttarget = opc.opcintype
            AND ca.castmethod = 'b'
            AND ca.castcontext IN ('i', 'a')
       )
     )
   ORDER BY
     CASE WHEN opc.opcintype = v_base THEN 0 ELSE 1 END,
     CASE WHEN t.typispreferred THEN 0 ELSE 1 END,
     opc.oid
   LIMIT 1;
  IF v_opc IS NULL THEN
    RAISE EXCEPTION 'P0: sem opclass btree default para tipo base % (origem %)', v_base, p_typid;
  END IF;
  RETURN v_opc;
END;
$f$;

-- Collation esperada no índice sem cláusula COLLATE:
-- tipo não colacionável → 0; senão attcollation da coluna (não assumir zero em text/varchar).
CREATE OR REPLACE FUNCTION pg_temp.fin_p0_expected_collation(p_rel regclass, p_col text)
RETURNS oid
LANGUAGE plpgsql
STABLE
AS $f$
DECLARE
  v_typcoll oid;
  v_attcoll oid;
BEGIN
  SELECT t.typcollation, a.attcollation
    INTO v_typcoll, v_attcoll
    FROM pg_attribute a
    JOIN pg_type t ON t.oid = a.atttypid
   WHERE a.attrelid = p_rel
     AND a.attname = p_col
     AND a.attnum > 0
     AND NOT a.attisdropped;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P0: coluna %.% inexistente (collation)', p_rel, p_col;
  END IF;
  IF v_typcoll = 0 THEN
    RETURN 0;
  END IF;
  RETURN v_attcoll;
END;
$f$;

-- ---------------------------------------------------------------------------
-- CHECK
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.fin_p0_ensure_check(
  p_schema text,
  p_rel text,
  p_con text,
  p_check_body text
) RETURNS void
LANGUAGE plpgsql
AS $f$
DECLARE
  v_rel regclass := pg_temp.fin_p0_regclass(p_schema, p_rel);
  v_oid oid;
  v_rel_found regclass;
  v_validated boolean;
  v_expr_exist text;
  v_expr_want text;
  v_probe text := format('_fin_p0_ck_%s', substr(md5(p_schema || '.' || p_rel || '.' || p_con), 1, 12));
BEGIN
  SELECT c.oid, c.conrelid::regclass, c.convalidated
    INTO v_oid, v_rel_found, v_validated
    FROM pg_constraint c
   WHERE c.conname = p_con
     AND c.contype = 'c'
     AND c.connamespace = (SELECT oid FROM pg_namespace WHERE nspname = p_schema);

  IF v_oid IS NOT NULL THEN
    IF v_rel_found IS DISTINCT FROM v_rel THEN
      RAISE EXCEPTION 'P0: CHECK % já existe em % (esperado %)', p_con, v_rel_found, v_rel;
    END IF;
    IF NOT v_validated THEN
      RAISE EXCEPTION 'P0: CHECK % existe como NOT VALID; não é aceito como equivalente', p_con;
    END IF;

    v_expr_exist := pg_get_expr((SELECT conbin FROM pg_constraint WHERE oid = v_oid), v_rel);

    EXECUTE format(
      'CREATE TEMP TABLE %I (LIKE %s INCLUDING DEFAULTS) ON COMMIT DROP',
      v_probe, v_rel
    );
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s)',
      v_probe, p_con || '_probe', p_check_body
    );

    SELECT pg_get_expr(c.conbin, c.conrelid) INTO v_expr_want
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = v_probe
       AND c.conname = p_con || '_probe';

    IF pg_temp.fin_p0_strip_ws_outside_literals(v_expr_exist)
       IS DISTINCT FROM pg_temp.fin_p0_strip_ws_outside_literals(v_expr_want) THEN
      RAISE EXCEPTION
        'P0: CHECK % em % com expressão incompatível. Existe: [%] Esperado: [%]',
        p_con, v_rel, v_expr_exist, v_expr_want;
    END IF;
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I CHECK (%s)', v_rel, p_con, p_check_body);
END;
$f$;

-- ---------------------------------------------------------------------------
-- FK
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.fin_p0_ensure_fk(
  p_schema text,
  p_rel text,
  p_con text,
  p_cols text[],
  p_ref_schema text,
  p_ref_rel text,
  p_ref_cols text[],
  p_deltype "char",
  p_updtype "char",
  p_match "char" DEFAULT 's'  -- s=SIMPLE
) RETURNS void
LANGUAGE plpgsql
AS $f$
DECLARE
  v_rel regclass := pg_temp.fin_p0_regclass(p_schema, p_rel);
  v_ref regclass := pg_temp.fin_p0_regclass(p_ref_schema, p_ref_rel);
  v_keys smallint[] := pg_temp.fin_p0_attnums(v_rel, p_cols);
  v_fkeys smallint[] := pg_temp.fin_p0_attnums(v_ref, p_ref_cols);
  v_oid oid;
  v_match oid;
  v_name text;
  v_ok boolean;
  r record;
  v_cols_sql text;
  v_ref_cols_sql text;
  v_ondelete text;
  v_onupdate text;
BEGIN
  IF array_length(p_cols, 1) IS DISTINCT FROM array_length(p_ref_cols, 1) THEN
    RAISE EXCEPTION 'P0: FK % cardinalidade origem/destino distinta', p_con;
  END IF;

  SELECT c.oid INTO v_oid
    FROM pg_constraint c
   WHERE c.conname = p_con
     AND c.contype = 'f'
     AND c.connamespace = (SELECT oid FROM pg_namespace WHERE nspname = p_schema);

  IF v_oid IS NOT NULL THEN
    SELECT
      c.conrelid = v_rel
      AND c.confrelid = v_ref
      AND c.conkey::smallint[] = v_keys
      AND c.confkey::smallint[] = v_fkeys
      AND c.confdeltype = p_deltype
      AND c.confupdtype = p_updtype
      AND c.confmatchtype = p_match
      AND c.condeferrable IS FALSE
      AND c.condeferred IS FALSE
      AND c.convalidated IS TRUE
    INTO v_ok
    FROM pg_constraint c
    WHERE c.oid = v_oid;

    -- PG15+: confdelsetcols (lista de cols em SET NULL/DEFAULT). No PG14 a coluna não existe.
    IF coalesce(v_ok, false) AND current_setting('server_version_num')::int >= 150000 THEN
      -- confdelsetcols só existe no PG15+; exige lista vazia (sem subset de colunas).
      EXECUTE $q$
        SELECT CASE
                 WHEN c.confdeltype IN ('n','d') THEN
                   COALESCE(array_length(c.confdelsetcols::smallint[], 1), 0) = 0
                 ELSE true
               END
          FROM pg_constraint c WHERE c.oid = $1
      $q$ INTO v_ok USING v_oid;
    END IF;

    IF NOT coalesce(v_ok, false) THEN
      RAISE EXCEPTION
        'P0: FK % existe com definição estrutural diferente (inclui NOT VALID / match / defer / delsetcols). rel=% ref=%',
        p_con, v_rel, v_ref;
    END IF;
    RETURN;
  END IF;

  v_match := NULL;
  FOR r IN
    SELECT c.oid, c.conname
      FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.conrelid = v_rel
       AND c.confrelid = v_ref
       AND c.conkey::smallint[] = v_keys
       AND c.confkey::smallint[] = v_fkeys
       AND c.confdeltype = p_deltype
       AND c.confupdtype = p_updtype
       AND c.confmatchtype = p_match
       AND c.condeferrable IS FALSE
       AND c.condeferred IS FALSE
       AND c.convalidated IS TRUE
  LOOP
    IF v_match IS NOT NULL THEN
      RAISE EXCEPTION 'P0: FKs equivalentes ambíguas em % para %', v_rel, p_con;
    END IF;
    v_match := r.oid;
    v_name := r.conname;
  END LOOP;

  IF v_match IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conname = p_con
         AND c.connamespace = (SELECT oid FROM pg_namespace WHERE nspname = p_schema)
    ) THEN
      RAISE EXCEPTION 'P0: FK equivalente % encontrada, mas nome alvo % em uso', v_name, p_con;
    END IF;
    EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I', v_rel, v_name, p_con);
    RETURN;
  END IF;

  -- FK NOT VALID com mesma estrutura não é aceita como equivalente (não entra no loop).
  IF EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.conrelid = v_rel
       AND c.confrelid = v_ref
       AND c.conkey::smallint[] = v_keys
       AND c.confkey::smallint[] = v_fkeys
       AND c.convalidated IS FALSE
  ) THEN
    RAISE EXCEPTION
      'P0: existe FK NOT VALID estruturalmente semelhante em %→%; valide ou remova antes do P0',
      v_rel, v_ref;
  END IF;

  SELECT string_agg(quote_ident(x), ', ' ORDER BY ord)
    INTO v_cols_sql FROM unnest(p_cols) WITH ORDINALITY AS u(x, ord);
  SELECT string_agg(quote_ident(x), ', ' ORDER BY ord)
    INTO v_ref_cols_sql FROM unnest(p_ref_cols) WITH ORDINALITY AS u(x, ord);

  v_ondelete := CASE p_deltype
    WHEN 'c' THEN 'ON DELETE CASCADE'
    WHEN 'r' THEN 'ON DELETE RESTRICT'
    WHEN 'n' THEN 'ON DELETE SET NULL'
    WHEN 'd' THEN 'ON DELETE SET DEFAULT'
    ELSE 'ON DELETE NO ACTION'
  END;
  v_onupdate := CASE p_updtype
    WHEN 'c' THEN 'ON UPDATE CASCADE'
    WHEN 'r' THEN 'ON UPDATE RESTRICT'
    WHEN 'n' THEN 'ON UPDATE SET NULL'
    WHEN 'd' THEN 'ON UPDATE SET DEFAULT'
    ELSE 'ON UPDATE NO ACTION'
  END;

  EXECUTE format(
    'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES %s (%s) %s %s',
    v_rel, p_con, v_cols_sql, v_ref, v_ref_cols_sql, v_ondelete, v_onupdate
  );
END;
$f$;

-- ---------------------------------------------------------------------------
-- INDEX (indkey 0-based, indnkeyatts, DESC/NULLS, INCLUDE, opclass, collation)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.fin_p0_index_matches(
  p_indexrelid oid,
  p_rel regclass,
  p_unique boolean,
  p_keys smallint[],
  p_opt smallint[],
  p_pred_norm text,
  p_expect_opclasses oid[],
  p_expect_collations oid[]
) RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $f$
DECLARE
  i pg_index%ROWTYPE;
  v_keys smallint[];
  v_opt smallint[];
  v_opc oid[];
  v_coll oid[];
  v_am text;
  v_nulls_nd boolean;
  k int;
BEGIN
  SELECT * INTO i FROM pg_index WHERE indexrelid = p_indexrelid;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF i.indrelid IS DISTINCT FROM p_rel
     OR i.indisunique IS DISTINCT FROM p_unique
     OR NOT i.indisvalid
     OR NOT i.indisready
     OR i.indisprimary
     OR i.indnkeyatts IS DISTINCT FROM array_length(p_keys, 1)
     OR i.indnatts IS DISTINCT FROM i.indnkeyatts  -- sem INCLUDE
  THEN
    RETURN false;
  END IF;

  SELECT am.amname INTO v_am
    FROM pg_class ic
    JOIN pg_am am ON am.oid = ic.relam
   WHERE ic.oid = p_indexrelid;
  IF v_am IS DISTINCT FROM 'btree' THEN
    RETURN false;
  END IF;

  -- PG15+: indnullsnotdistinct; em 14 trata como false
  IF current_setting('server_version_num')::int >= 150000 THEN
    EXECUTE 'SELECT indnullsnotdistinct FROM pg_index WHERE indexrelid = $1'
      INTO v_nulls_nd
      USING p_indexrelid;
  ELSE
    v_nulls_nd := false;
  END IF;
  IF coalesce(v_nulls_nd, false) THEN
    RETURN false; -- P0 não usa NULLS NOT DISTINCT
  END IF;

  v_keys := pg_temp.fin_p0_int2vector_prefix(i.indkey, i.indnkeyatts);
  v_opt := pg_temp.fin_p0_int2vector_prefix(i.indoption, i.indnkeyatts);
  IF v_keys IS DISTINCT FROM p_keys OR v_opt IS DISTINCT FROM p_opt THEN
    RETURN false;
  END IF;

  v_opc := pg_temp.fin_p0_oidvector_prefix(i.indclass, i.indnkeyatts);
  v_coll := pg_temp.fin_p0_oidvector_prefix(i.indcollation, i.indnkeyatts);
  IF v_opc IS DISTINCT FROM p_expect_opclasses THEN
    RETURN false;
  END IF;
  -- collation 0 = default; comparar vetor esperado (zeros)
  IF v_coll IS DISTINCT FROM p_expect_collations THEN
    RETURN false;
  END IF;

  IF pg_temp.fin_p0_strip_ws_outside_literals(pg_get_expr(i.indpred, i.indrelid))
     IS DISTINCT FROM p_pred_norm THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$f$;

CREATE OR REPLACE FUNCTION pg_temp.fin_p0_ensure_index(
  p_schema text,
  p_rel text,
  p_idx text,
  p_unique boolean,
  p_cols text[],
  p_pred text,
  p_desc_cols text[] DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $f$
DECLARE
  v_rel regclass := pg_temp.fin_p0_regclass(p_schema, p_rel);
  v_keys smallint[] := pg_temp.fin_p0_attnums(v_rel, p_cols);
  v_opt smallint[] := pg_temp.fin_p0_expected_indoptions(array_length(p_cols, 1), p_desc_cols, p_cols);
  v_pred_norm text;
  v_opc oid[] := '{}';
  v_coll oid[] := '{}';
  v_att oid;
  v_idx_oid oid;
  v_equiv_oid oid;
  v_equiv_name text;
  r record;
  v_cols_sql text;
  v_cols_probe text;
  v_create text;
  v_probe text := format('_fin_p0_ix_%s', substr(md5(p_schema || '.' || p_rel || '.' || p_idx), 1, 12));
  j int;
BEGIN
  FOR j IN 1 .. array_length(p_cols, 1) LOOP
    SELECT a.atttypid INTO v_att
      FROM pg_attribute a
     WHERE a.attrelid = v_rel AND a.attname = p_cols[j] AND NOT a.attisdropped;
    v_opc := v_opc || pg_temp.fin_p0_default_opclass(v_att);
    v_coll := v_coll || pg_temp.fin_p0_expected_collation(v_rel, p_cols[j]);
  END LOOP;

  -- Predicado canônico via índice-sonda (não-único): PG reescreve IN→ANY/casts;
  -- comparar SQL-fonte cru com pg_get_expr causa falso negativo na 2ª execução.
  IF p_pred IS NULL THEN
    v_pred_norm := NULL;
  ELSE
    SELECT string_agg(quote_ident(x), ', ' ORDER BY ord)
      INTO v_cols_probe
      FROM unnest(p_cols) WITH ORDINALITY AS u(x, ord);
    EXECUTE format('DROP INDEX IF EXISTS %I.%I', p_schema, v_probe);
    BEGIN
      EXECUTE format(
        'CREATE INDEX %I ON %s USING btree (%s) WHERE %s',
        v_probe, v_rel, v_cols_probe, p_pred
      );
      SELECT pg_temp.fin_p0_strip_ws_outside_literals(pg_get_expr(i.indpred, i.indrelid))
        INTO v_pred_norm
        FROM pg_index i
        JOIN pg_class ic ON ic.oid = i.indexrelid
        JOIN pg_namespace n ON n.oid = ic.relnamespace
       WHERE n.nspname = p_schema
         AND ic.relname = v_probe;
      EXECUTE format('DROP INDEX %I.%I', p_schema, v_probe);
    EXCEPTION WHEN OTHERS THEN
      EXECUTE format('DROP INDEX IF EXISTS %I.%I', p_schema, v_probe);
      RAISE;
    END;
  END IF;

  SELECT i.indexrelid INTO v_idx_oid
    FROM pg_class ic
    JOIN pg_namespace n ON n.oid = ic.relnamespace
    JOIN pg_index i ON i.indexrelid = ic.oid
   WHERE n.nspname = p_schema
     AND ic.relname = p_idx
     AND ic.relkind = 'i';

  IF v_idx_oid IS NOT NULL THEN
    IF NOT pg_temp.fin_p0_index_matches(
         v_idx_oid, v_rel, p_unique, v_keys, v_opt, v_pred_norm, v_opc, v_coll
       ) THEN
      RAISE EXCEPTION
        'P0: índice % existe com definição estrutural diferente da planejada em %',
        p_idx, v_rel;
    END IF;
    RETURN;
  END IF;

  v_equiv_oid := NULL;
  FOR r IN
    SELECT ic.relname AS idxname, i.indexrelid
      FROM pg_index i
      JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = ic.relnamespace
     WHERE n.nspname = p_schema
       AND i.indrelid = v_rel
  LOOP
    IF pg_temp.fin_p0_index_matches(
         r.indexrelid, v_rel, p_unique, v_keys, v_opt, v_pred_norm, v_opc, v_coll
       ) THEN
      IF v_equiv_oid IS NOT NULL THEN
        RAISE EXCEPTION 'P0: índices equivalentes ambíguos a % (% vs %)', p_idx, v_equiv_name, r.idxname;
      END IF;
      v_equiv_oid := r.indexrelid;
      v_equiv_name := r.idxname;
    END IF;
  END LOOP;

  IF v_equiv_oid IS NOT NULL THEN
    RAISE NOTICE 'P0: índice equivalente a % já existe como % — sem duplicar', p_idx, v_equiv_name;
    RETURN;
  END IF;

  SELECT string_agg(
           CASE WHEN p_desc_cols IS NOT NULL AND x = ANY (p_desc_cols)
                THEN quote_ident(x) || ' DESC NULLS FIRST'
                ELSE quote_ident(x)
           END,
           ', ' ORDER BY ord
         )
    INTO v_cols_sql
    FROM unnest(p_cols) WITH ORDINALITY AS u(x, ord);

  v_create := format(
    'CREATE %sINDEX %I ON %s USING btree (%s)%s',
    CASE WHEN p_unique THEN 'UNIQUE ' ELSE '' END,
    p_idx,
    v_rel,
    v_cols_sql,
    CASE WHEN p_pred IS NULL THEN '' ELSE ' WHERE ' || p_pred END
  );
  EXECUTE v_create;
END;
$f$;

-- ---------------------------------------------------------------------------
-- Funções / triggers: não sobrescrever silenciosamente
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.fin_p0_ensure_trigger_fn(
  p_fn_name text,
  p_expected_src text
) RETURNS void
LANGUAGE plpgsql
AS $f$
DECLARE
  v_oid oid;
  v_src text;
  v_lang text;
  v_volatile "char";
  v_rettype oid;
  v_nargs int;
  v_secdef boolean;
  v_config text[];
  v_trigger_oid oid := 'trigger'::regtype::oid;
BEGIN
  SELECT p.oid, p.prosrc, l.lanname, p.provolatile, p.prorettype, p.pronargs, p.prosecdef, p.proconfig
    INTO v_oid, v_src, v_lang, v_volatile, v_rettype, v_nargs, v_secdef, v_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname = 'public'
     AND p.proname = p_fn_name
     AND pg_get_function_identity_arguments(p.oid) = '';

  IF v_oid IS NULL THEN
    EXECUTE format(
      'CREATE FUNCTION public.%I() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER VOLATILE AS %L',
      p_fn_name,
      p_expected_src
    );
    RETURN;
  END IF;

  -- Sem sobrescrita: qualquer divergência estrutural/segurança → ERRO
  IF v_lang IS DISTINCT FROM 'plpgsql' THEN
    RAISE EXCEPTION 'P0: função public.%s linguagem=% (esperado plpgsql)', p_fn_name, v_lang;
  END IF;
  IF v_rettype IS DISTINCT FROM v_trigger_oid THEN
    RAISE EXCEPTION 'P0: função public.%s retorno OID=% (esperado trigger)', p_fn_name, v_rettype;
  END IF;
  IF v_nargs IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'P0: função public.%s pronargs=% (esperado 0)', p_fn_name, v_nargs;
  END IF;
  IF v_volatile IS DISTINCT FROM 'v' THEN
    RAISE EXCEPTION 'P0: função public.%s volatilidade=% (esperado VOLATILE/v)', p_fn_name, v_volatile;
  END IF;
  IF v_secdef IS TRUE THEN
    RAISE EXCEPTION 'P0: função public.%s é SECURITY DEFINER — incompatível com o modelo P0 (INVOKER)', p_fn_name;
  END IF;
  IF v_config IS NOT NULL AND array_length(v_config, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'P0: função public.%s possui proconfig % — não suportado no P0', p_fn_name, v_config;
  END IF;
  IF pg_temp.fin_p0_strip_ws_outside_literals(v_src)
     IS DISTINCT FROM pg_temp.fin_p0_strip_ws_outside_literals(p_expected_src) THEN
    RAISE EXCEPTION
      'P0: função public.%s corpo divergente; não será sobrescrita.',
      p_fn_name;
  END IF;
END;
$f$;

-- Normaliza pg_get_triggerdef / template para comparação estável entre PG14–18.
CREATE OR REPLACE FUNCTION pg_temp.fin_p0_norm_triggerdef(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $f$
DECLARE
  s text := p;
BEGIN
  IF s IS NULL THEN
    RETURN NULL;
  END IF;
  s := replace(s, 'EXECUTE FUNCTION', 'EXECUTE PROCEDURE');
  s := replace(s, 'execute function', 'EXECUTE PROCEDURE');
  s := replace(s, ' ON public.', ' ON ');
  s := replace(s, ' ON PUBLIC.', ' ON ');
  s := replace(s, ' PROCEDURE public.', ' PROCEDURE ');
  s := replace(s, ' FUNCTION public.', ' FUNCTION ');
  -- pg_get_triggerdef ordena eventos (DELETE OR UPDATE); template pode usar UPDATE OR DELETE
  s := replace(s, 'DELETE OR UPDATE', 'UPDATE OR DELETE');
  s := replace(s, 'INSERT OR UPDATE', 'UPDATE OR INSERT');
  s := replace(s, 'DELETE OR INSERT', 'INSERT OR DELETE');
  s := replace(s, 'TRUNCATE OR UPDATE', 'UPDATE OR TRUNCATE');
  RETURN pg_temp.fin_p0_strip_ws_outside_literals(s);
END;
$f$;

CREATE OR REPLACE FUNCTION pg_temp.fin_p0_ensure_trigger(
  p_schema text,
  p_rel text,
  p_tgname text,
  p_fn_name text,
  p_timing text,   -- BEFORE
  p_events text    -- 'UPDATE' ou 'UPDATE OR DELETE'
) RETURNS void
LANGUAGE plpgsql
AS $f$
DECLARE
  v_rel regclass := pg_temp.fin_p0_regclass(p_schema, p_rel);
  v_tg oid;
  v_def text;
  v_want text;
  v_fn regprocedure;
  v_enabled "char";
  v_tgfoid oid;
  v_expect_fn oid;
BEGIN
  v_fn := format('public.%I()', p_fn_name)::regprocedure;
  v_expect_fn := v_fn::oid;

  SELECT t.oid, pg_get_triggerdef(t.oid), t.tgenabled, t.tgfoid
    INTO v_tg, v_def, v_enabled, v_tgfoid
    FROM pg_trigger t
   WHERE t.tgrelid = v_rel
     AND t.tgname = p_tgname
     AND NOT t.tgisinternal;

  v_want := format(
    'CREATE TRIGGER %I %s %s ON %s FOR EACH ROW EXECUTE PROCEDURE %s',
    p_tgname, p_timing, p_events, v_rel, v_fn
  );

  IF v_tg IS NOT NULL THEN
    -- O = origem/local (padrão CREATE); D = desabilitado — não equivalente operacional
    IF v_enabled = 'D' THEN
      RAISE EXCEPTION
        'P0: trigger % em % está DESABILITADO (tgenabled=D); não é equivalente a um trigger operacional. Não será reabilitado automaticamente.',
        p_tgname, v_rel;
    END IF;
    IF v_enabled NOT IN ('O', 'A') THEN
      RAISE EXCEPTION
        'P0: trigger % em % com tgenabled=% (esperado O ou A)',
        p_tgname, v_rel, v_enabled;
    END IF;
    IF v_tgfoid IS DISTINCT FROM v_expect_fn THEN
      RAISE EXCEPTION
        'P0: trigger % em % aponta para função OID % (esperado %)',
        p_tgname, v_rel, v_tgfoid, v_expect_fn;
    END IF;
    -- PG14: EXECUTE PROCEDURE; PG15+: EXECUTE FUNCTION. Qualificação public. varia.
    IF pg_temp.fin_p0_norm_triggerdef(v_def)
       IS DISTINCT FROM pg_temp.fin_p0_norm_triggerdef(v_want) THEN
      RAISE EXCEPTION
        'P0: trigger % em % diverge do esperado. Existe: [%] Esperado: [%]',
        p_tgname, v_rel, v_def, v_want;
    END IF;
    RETURN;
  END IF;

  EXECUTE v_want;
END;
$f$;

-- =============================================================================
-- Constraints / índices
-- =============================================================================
SELECT pg_temp.fin_p0_ensure_check('public','FIN_CONTRATO','CK_FIN_CONTRATO_REGRA',
  $$ "FG_REGRA_ATIVA" IN ('S', 'N') $$);
SELECT pg_temp.fin_p0_ensure_check('public','FIN_CONTRATO','CK_FIN_CONTRATO_POL',
  $$ "POLITICA_INADIMPLENCIA" IN ('ALERTA', 'BLOQUEIO') $$);
SELECT pg_temp.fin_p0_ensure_check('public','FIN_CONTRATO','CK_FIN_CONTRATO_ACTIVE',
  $$ "FGACTIVE" IN ('S', 'N', 'A', 'I') $$);

SELECT pg_temp.fin_p0_ensure_fk(
  'public','FIN_CONTRATO','FK_FIN_CONTRATO_TENANT',
  ARRAY['TENANT_ID'],'public','SAAS_CLIENTE_CONTRATANTE',ARRAY['TENANT_ID'],
  'a','a','s');

SELECT pg_temp.fin_p0_ensure_fk(
  'public','FIN_CONTRATO_COMPONENTE','FK_FIN_COMP_CONTRATO',
  ARRAY['ID_CONTRATO'],'public','FIN_CONTRATO',ARRAY['ID'],
  'c','a','s');

SELECT pg_temp.fin_p0_ensure_check('public','FIN_CONTRATO_COMPONENTE','CK_FIN_COMP_GRUPO',
  $$ "GRUPO" IN ('CONEXAO', 'USO_PLATAFORMA') $$);
SELECT pg_temp.fin_p0_ensure_check('public','FIN_CONTRATO_COMPONENTE','CK_FIN_COMP_TIPO',
  $$ "TIPO" IN ('FIXO', 'PERCENTUAL', 'POR_CARGA_ANUNCIADA') $$);
SELECT pg_temp.fin_p0_ensure_check('public','FIN_CONTRATO_COMPONENTE','CK_FIN_COMP_ATIVO',
  $$ "FG_ATIVO" IN ('S', 'N') $$);
SELECT pg_temp.fin_p0_ensure_check('public','FIN_CONTRATO_COMPONENTE','CK_FIN_COMP_VALOR',
  $$ ("VALOR_CENTAVOS" IS NULL OR "VALOR_CENTAVOS" >= 0)
     AND ("PERCENTUAL" IS NULL OR ("PERCENTUAL" >= 0 AND "PERCENTUAL" <= 100)) $$);

SELECT pg_temp.fin_p0_ensure_check('public','FIN_COBRANCA','CK_FIN_COB_MOD',
  $$ "MODALIDADE" IN ('CONEXAO', 'USO_PLATAFORMA') $$);
SELECT pg_temp.fin_p0_ensure_check('public','FIN_COBRANCA','CK_FIN_COB_PAG',
  $$ "PAGADOR_TIPO" IN ('MOTORISTA', 'TENANT') $$);
SELECT pg_temp.fin_p0_ensure_check('public','FIN_COBRANCA','CK_FIN_COB_STATUS',
  $$ "STATUS" IN ('ABERTA', 'PAGA', 'CANCELADA') $$);
SELECT pg_temp.fin_p0_ensure_check('public','FIN_COBRANCA','CK_FIN_COB_MOEDA',
  $$ "MOEDA" = 'BRL' $$);
SELECT pg_temp.fin_p0_ensure_check('public','FIN_COBRANCA','CK_FIN_COB_VALOR',
  $$ "VALOR_CENTAVOS" >= 0 $$);
SELECT pg_temp.fin_p0_ensure_check('public','FIN_COBRANCA','CK_FIN_COB_ORIGEM_CANC',
  $$ "ORIGEM_CANCELAMENTO" IS NULL
     OR "ORIGEM_CANCELAMENTO" IN ('TORRE', 'MOTORISTA', 'SISTEMA') $$);
SELECT pg_temp.fin_p0_ensure_check('public','FIN_COBRANCA','CK_FIN_COB_CONEXAO_REF',
  $$ "MODALIDADE" <> 'CONEXAO'
     OR ("IDCONVOCACAO" IS NOT NULL AND length(btrim("ID_CICLO_CONFIRMACAO")) > 0) $$);

SELECT pg_temp.fin_p0_ensure_fk(
  'public','FIN_COBRANCA_EVENTO','FK_FIN_EVT_COB',
  ARRAY['ID_COBRANCA'],'public','FIN_COBRANCA',ARRAY['ID'],
  'r','a','s');

SELECT pg_temp.fin_p0_ensure_check('public','FIN_COBRANCA_EVENTO','CK_FIN_EVT_TIPO',
  $$ "TIPO" IN ('CRIADA', 'BAIXA_MANUAL', 'REVERSAO_BAIXA', 'CANCELADA') $$);

SELECT pg_temp.fin_p0_ensure_index('public','FIN_CONTRATO','UK_FIN_CONTRATO_TENANT_VERSAO',
  true, ARRAY['TENANT_ID','VERSAO'], NULL);
SELECT pg_temp.fin_p0_ensure_index('public','FIN_CONTRATO','UK_FIN_CONTRATO_VIGENTE',
  true, ARRAY['TENANT_ID'],
  $$ "DH_FIM" IS NULL AND "FGACTIVE" IN ('S', 'A') $$);
SELECT pg_temp.fin_p0_ensure_index('public','FIN_CONTRATO','IX_FIN_CONTRATO_TENANT',
  false, ARRAY['TENANT_ID'], NULL);
SELECT pg_temp.fin_p0_ensure_index('public','FIN_CONTRATO_COMPONENTE','IX_FIN_COMP_CONTRATO',
  false, ARRAY['ID_CONTRATO','GRUPO'], NULL);
SELECT pg_temp.fin_p0_ensure_index('public','FIN_COBRANCA','UK_FIN_COB_CONV_ABERTA',
  true, ARRAY['IDCONVOCACAO'],
  $$ "MODALIDADE" = 'CONEXAO' AND "STATUS" = 'ABERTA' AND "IDCONVOCACAO" IS NOT NULL $$);
SELECT pg_temp.fin_p0_ensure_index('public','FIN_COBRANCA','UK_FIN_COB_CICLO_ABS',
  true, ARRAY['IDCONVOCACAO','ID_CICLO_CONFIRMACAO'],
  $$ "MODALIDADE" = 'CONEXAO' $$);

DO $body$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class ic
    JOIN pg_namespace n ON n.oid = ic.relnamespace
    WHERE n.nspname = 'public' AND ic.relname = 'UK_FIN_COB_CICLO_ATIVA' AND ic.relkind = 'i'
  ) THEN
    PERFORM pg_temp.fin_p0_ensure_index(
      'public','FIN_COBRANCA','UK_FIN_COB_CICLO_ATIVA',
      true, ARRAY['IDCONVOCACAO','ID_CICLO_CONFIRMACAO'],
      $pred$ "MODALIDADE" = 'CONEXAO' AND "STATUS" = 'ABERTA' AND "IDCONVOCACAO" IS NOT NULL $pred$
    );
    RAISE NOTICE 'P0: UK_FIN_COB_CICLO_ATIVA pré-existente validada (não criada pelo P0).';
  ELSE
    RAISE NOTICE 'P0: UK_FIN_COB_CICLO_ATIVA ausente — OK (ABS é canônico).';
  END IF;
END $body$;

SELECT pg_temp.fin_p0_ensure_index(
  'public','FIN_COBRANCA','IX_FIN_COB_TENANT_STATUS',
  false, ARRAY['TENANT_ID','STATUS','DH_CRIACAO'], NULL, ARRAY['DH_CRIACAO']);
SELECT pg_temp.fin_p0_ensure_index('public','FIN_COBRANCA','IX_FIN_COB_CONV',
  false, ARRAY['IDCONVOCACAO'], NULL);
SELECT pg_temp.fin_p0_ensure_index('public','FIN_COBRANCA','IX_FIN_COB_PAGADOR_MOT',
  false, ARRAY['PAGADOR_CDCADASTRO'],
  $$ "PAGADOR_TIPO" = 'MOTORISTA' $$);
SELECT pg_temp.fin_p0_ensure_index('public','FIN_COBRANCA','IX_FIN_COB_VIAGEM',
  false, ARRAY['TENANT_ID','IDVIAGEM'], NULL);
SELECT pg_temp.fin_p0_ensure_index('public','FIN_COBRANCA_EVENTO','IX_FIN_EVT_COB',
  false, ARRAY['ID_COBRANCA','DH_EVENTO'], NULL);

-- =============================================================================
-- Triggers / funções (corpo canônico; sem REPLACE silencioso)
-- =============================================================================
SELECT pg_temp.fin_p0_ensure_trigger_fn(
  'fn_fin_cob_valor_imutavel',
  $src$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."VALOR_CENTAVOS" IS DISTINCT FROM OLD."VALOR_CENTAVOS" THEN
    RAISE EXCEPTION 'FIN_COBRANCA.VALOR_CENTAVOS é imutável após a criação (ID=%)', OLD."ID"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$src$
);

SELECT pg_temp.fin_p0_ensure_trigger_fn(
  'fn_fin_evt_append_only',
  $src$
DECLARE
  v_role boolean;
  v_intent text;
BEGIN
  v_role := pg_has_role(CURRENT_USER, 'atlas_fin_manutencao', 'USAGE');
  v_intent := current_setting('atlas.fin_evt_manutencao', true);

  IF v_role AND v_intent IS NOT NULL AND v_intent = '1' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'FIN_COBRANCA_EVENTO é append-only. Manutenção: login membro de atlas_fin_manutencao + SET LOCAL ROLE atlas_fin_manutencao + SET LOCAL atlas.fin_evt_manutencao = ''1'''
    USING ERRCODE = 'integrity_constraint_violation';
END;
$src$
);

SELECT pg_temp.fin_p0_ensure_trigger(
  'public','FIN_COBRANCA','trg_fin_cob_valor_imutavel',
  'fn_fin_cob_valor_imutavel','BEFORE','UPDATE');

SELECT pg_temp.fin_p0_ensure_trigger(
  'public','FIN_COBRANCA_EVENTO','trg_fin_evt_append_only',
  'fn_fin_evt_append_only','BEFORE','UPDATE OR DELETE');

COMMIT;
