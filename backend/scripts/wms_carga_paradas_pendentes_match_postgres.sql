-- wms_carga_paradas_pendentes_match_postgres.sql
-- Diagnostico alinhado ao backend (montar paradas): CNPJ NF + fallback PJ dono da carga.
-- So lista paradas que AINDA falhariam apos reiniciar Node e Montar paradas.
--
-- pgAdmin: aba NOVA -> ROLLBACK; -> F5 neste arquivo (Auto-commit ligado).
-- Ajuste em params: cd_carga, tenant_id

WITH params AS (
  SELECT 1::integer AS cd_carga, 'default'::text AS tenant_id
),
carga_dono AS (
  SELECT p.cd_carga,
         p.tenant_id,
         c."CD_DONO",
         right(lpad(regexp_replace(trim(coalesce(d."CGC", '')), '[^0-9]', '', 'g'), 14, '0'), 14) AS cnpj_dono_14
    FROM params p
    JOIN "WMS_CARGA_PROGRAMADA" c ON c."CD_CARGA" = p.cd_carga AND c."TENANT_ID" = p.tenant_id
    LEFT JOIN "WMS_DONO_ESTOQUE" d ON d."CD_DONO" = c."CD_DONO" AND d."TENANT_ID" = c."TENANT_ID"
),
nf_carga AS (
  SELECT j."ORDEM",
         n."CD_NFE_SAIDA",
         n."NUMERO_NF",
         n."SERIE",
         right(lpad(regexp_replace(trim(coalesce(n."CNPJ_ENTREGA", n."CNPJ_DEST", '')), '[^0-9]', '', 'g'), 14, '0'), 14) AS cnpj_14,
         upper(trim(coalesce(n."UF_DEST", ''))) AS uf,
         trim(coalesce(n."XMUN_DEST", '')) AS municipio,
         left(regexp_replace(coalesce(n."CEP_DEST", ''), '[^0-9]', '', 'g'), 8) AS cep8,
         upper(trim(coalesce(n."XLGR_DEST", ''))) AS logradouro,
         coalesce(nullif(trim(coalesce(n."NRO_DEST", '')), ''), 'S/N') AS numero,
         coalesce(
           nullif(trim(coalesce(n."XNOME_ENTREGA", '')), ''),
           nullif(trim(coalesce(n."XNOME_DEST", '')), ''),
           nullif(trim(coalesce(n."XLGR_DEST", '')), '') || ', ' || coalesce(nullif(trim(coalesce(n."NRO_DEST", '')), ''), 'S/N')
         ) AS nm_entrega_nf
    FROM "WMS_CARGA_PROGRAMADA_NFE" j
    JOIN "WMS_NFE_SAIDA" n ON n."CD_NFE_SAIDA" = j."CD_NFE_SAIDA"
    CROSS JOIN params p
   WHERE j."CD_CARGA" = p.cd_carga
     AND n."TENANT_ID" = p.tenant_id
),
-- PJ matriz: CGC em WMS_DONO_ESTOQUE pode divergir; fallback = CD_CLIENTE mais citado nas NF
cliente_dono_resolvido AS (
  SELECT cd.cd_carga,
         cd.tenant_id,
         cd."CD_DONO",
         cd.cnpj_dono_14,
         COALESCE(
           cg_d."CDCADASTRO",
           (
             SELECT pick."CDCADASTRO"
               FROM (
                 SELECT cc2."CDCADASTRO", count(DISTINCT nf.cnpj_14)::integer AS n
                   FROM nf_carga nf
                   JOIN (
                     SELECT right(lpad(regexp_replace(trim(coalesce(cg."CGCCPF", '')), '[^0-9]', '', 'g'), 14, '0'), 14) AS cnpj_14,
                            cg."CDCADASTRO"
                       FROM "CADASTROGERAL" cg
                       CROSS JOIN params p2
                      WHERE cg."FGACTIVE" = 'A'
                        AND cg."FGFISICAJURIDICA" = 'J'
                        AND (cg."TENANT_ID" = p2.tenant_id OR cg."TENANT_ID" IS NULL OR trim(coalesce(cg."TENANT_ID", '')) = '')
                   ) cc2 ON cc2.cnpj_14 = nf.cnpj_14
                  GROUP BY cc2."CDCADASTRO"
                  ORDER BY n DESC
                  LIMIT 1
               ) pick
           )
         ) AS cd_cliente_dono
    FROM carga_dono cd
    CROSS JOIN params p
    LEFT JOIN "CADASTROGERAL" cg_d
      ON cg_d."FGACTIVE" = 'A'
     AND cg_d."FGFISICAJURIDICA" = 'J'
     AND (cg_d."TENANT_ID" = p.tenant_id OR cg_d."TENANT_ID" IS NULL OR trim(coalesce(cg_d."TENANT_ID", '')) = '')
     AND right(lpad(regexp_replace(trim(coalesce(cg_d."CGCCPF", '')), '[^0-9]', '', 'g'), 14, '0'), 14) = cd.cnpj_dono_14
),
paradas AS (
  SELECT cnpj_14,
         uf,
         municipio,
         cep8,
         logradouro,
         numero,
         nm_entrega_nf,
         regexp_replace(
           upper(
             translate(
               trim(coalesce(nm_entrega_nf, '')),
               'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝŸàáâãäåæçèéêëìíîïðñòóôõöøùúûüýÿ',
               'AAAAAAACEEEEIIIIDNOOOOOOUUUUYYaaaaaaaceeeeiiiidnoooooouuuuyy'
             )
           ),
           '[^A-Z0-9]', '', 'g'
         ) AS nm_entrega_norm,
         coalesce(nullif(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 upper(regexp_replace(trim(coalesce(numero, '')), '\s+', '', 'g')),
                 '^(S/N|SN|-|\.)$', 'SN', 'i'
               ),
               '^N\.', '', 'i'
             ),
             '[^A-Z0-9]', '', 'g'
           ), ''
         ), 'SN') AS num_norm,
         count(*)::integer AS qtd_nf,
         min("ORDEM") AS ordem_min,
         string_agg("NUMERO_NF"::text || '/' || coalesce("SERIE", ''), ', ' ORDER BY "ORDEM") AS nfs_lista
    FROM nf_carga
   WHERE cnpj_14 <> '' AND length(cnpj_14) = 14
   GROUP BY cnpj_14, uf, municipio, cep8, logradouro, numero, nm_entrega_nf
),
cad_end AS (
  SELECT e."CD_ENDERECO_ENTREGA",
         e."DS_PONTO_ENTREGA",
         e."LOGRADOURO",
         e."NUMERO",
         e."CEP",
         e."UF_ENTREGA",
         e."NM_MUNICIPIO",
         e."LATITUDE",
         e."LONGITUDE",
         e."CD_CLIENTE",
         cc.cnpj_14 AS cnpj_cad_14,
         regexp_replace(upper(trim(coalesce(e."LOGRADOURO", ''))), '[^A-Z0-9]', '', 'g') AS logr_norm,
         coalesce(nullif(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 upper(regexp_replace(trim(coalesce(e."NUMERO", '')), '\s+', '', 'g')),
                 '^(S/N|SN|-|\.)$', 'SN', 'i'
               ),
               '^N\.', '', 'i'
             ),
             '[^A-Z0-9]', '', 'g'
           ), ''
         ), 'SN') AS num_norm,
         regexp_replace(
           upper(
             translate(
               trim(coalesce(e."DS_PONTO_ENTREGA", '')),
               'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝŸàáâãäåæçèéêëìíîïðñòóôõöøùúûüýÿ',
               'AAAAAAACEEEEIIIIDNOOOOOOUUUUYYaaaaaaaceeeeiiiidnoooooouuuuyy'
             )
           ),
           '[^A-Z0-9]', '', 'g'
         ) AS ds_ponto_norm,
         (e."LATITUDE" IS NOT NULL AND e."LONGITUDE" IS NOT NULL) AS tem_coord
    FROM "CADASTRO_ENDERECO_ENTREGA" e
    JOIN (
      SELECT right(lpad(regexp_replace(trim(coalesce(cg."CGCCPF", '')), '[^0-9]', '', 'g'), 14, '0'), 14) AS cnpj_14,
             cg."CDCADASTRO"
        FROM "CADASTROGERAL" cg
        CROSS JOIN params p
       WHERE cg."FGACTIVE" = 'A'
         AND cg."FGFISICAJURIDICA" = 'J'
         AND (cg."TENANT_ID" = p.tenant_id OR cg."TENANT_ID" IS NULL OR trim(coalesce(cg."TENANT_ID", '')) = '')
    ) cc ON cc."CDCADASTRO" = e."CD_CLIENTE"
    CROSS JOIN params p
   WHERE e."TENANT_ID" = p.tenant_id
     AND e."FGACTIVE" = 'A'
),
candidatos AS (
  SELECT p.*,
         cdr.cnpj_dono_14,
         cdr.cd_cliente_dono,
         (SELECT count(*)::integer
            FROM cad_end ce
           WHERE ce.cnpj_cad_14 = p.cnpj_14
             AND p.cep8 <> ''
             AND upper(trim(coalesce(ce."UF_ENTREGA", ''))) = p.uf
             AND left(regexp_replace(coalesce(ce."CEP", ''), '[^0-9]', '', 'g'), 8) = p.cep8
             AND ce.logr_norm = regexp_replace(upper(trim(coalesce(p.logradouro, ''))), '[^A-Z0-9]', '', 'g')
             AND ce.num_norm = p.num_norm) AS qtd_match_cep_cnpj,
         (SELECT count(*)::integer
            FROM cad_end ce
           WHERE ce.cnpj_cad_14 = p.cnpj_14
             AND p.cep8 <> ''
             AND upper(trim(coalesce(ce."UF_ENTREGA", ''))) = p.uf
             AND left(regexp_replace(coalesce(ce."CEP", ''), '[^0-9]', '', 'g'), 8) = p.cep8
             AND ce.logr_norm = regexp_replace(upper(trim(coalesce(p.logradouro, ''))), '[^A-Z0-9]', '', 'g')
             AND ce.num_norm = p.num_norm
             AND ce.tem_coord) AS qtd_match_cep_com_coord_cnpj,
         (SELECT count(*)::integer
            FROM cad_end ce
           WHERE ce.cnpj_cad_14 = p.cnpj_14
             AND upper(trim(coalesce(ce."DS_PONTO_ENTREGA", ''))) = upper(trim(p.nm_entrega_nf))
             AND ce.num_norm = p.num_norm) AS qtd_match_nome_cnpj,
         (SELECT count(*)::integer
            FROM cad_end ce
           WHERE ce.cnpj_cad_14 = p.cnpj_14
             AND ce.ds_ponto_norm = p.nm_entrega_norm
             AND ce.num_norm = p.num_norm) AS qtd_match_nome_norm_cnpj,
         (SELECT count(*)::integer
            FROM cad_end ce
           WHERE ce.cnpj_cad_14 = p.cnpj_14
             AND ce.ds_ponto_norm = p.nm_entrega_norm
             AND ce.tem_coord) AS qtd_coord_nome_norm_cnpj,
         (SELECT count(*)::integer
            FROM cad_end ce
           WHERE ce.cnpj_cad_14 = p.cnpj_14
             AND upper(trim(coalesce(ce."DS_PONTO_ENTREGA", ''))) = upper(trim(p.nm_entrega_nf))
             AND ce.tem_coord) AS qtd_coord_nome_exato_cnpj,
         (SELECT count(*)::integer
            FROM cad_end ce
           WHERE cdr.cd_cliente_dono IS NOT NULL
             AND ce."CD_CLIENTE" = cdr.cd_cliente_dono
             AND ce.ds_ponto_norm = p.nm_entrega_norm) AS qtd_match_nome_norm_dono,
         (SELECT count(*)::integer
            FROM cad_end ce
           WHERE cdr.cd_cliente_dono IS NOT NULL
             AND ce."CD_CLIENTE" = cdr.cd_cliente_dono
             AND ce.ds_ponto_norm = p.nm_entrega_norm
             AND ce.tem_coord) AS qtd_coord_nome_norm_dono
    FROM paradas p
    CROSS JOIN cliente_dono_resolvido cdr
),
com_diag AS (
  SELECT c.*,
         CASE
           WHEN c.cnpj_14 IS NULL OR length(c.cnpj_14) <> 14 THEN 'DADOS_NF_INCOMPLETOS'
           WHEN c.logradouro = '' OR c.uf = '' THEN 'DADOS_NF_INCOMPLETOS'
           WHEN c.qtd_coord_nome_norm_dono = 1 THEN 'OK_APP'
           WHEN c.qtd_coord_nome_norm_cnpj = 1 THEN 'OK_APP'
           WHEN c.qtd_coord_nome_exato_cnpj >= 1 AND c.qtd_match_nome_cnpj = 1 THEN 'OK_APP'
           WHEN c.qtd_match_cep_com_coord_cnpj = 1 THEN 'OK_APP'
           WHEN c.qtd_match_cep_cnpj = 1 AND c.qtd_match_cep_com_coord_cnpj = 0 THEN 'SEM_COORDENADAS'
           WHEN c.qtd_match_nome_norm_dono >= 1 AND c.qtd_coord_nome_norm_dono = 0 THEN 'SEM_COORDENADAS'
           WHEN c.qtd_match_nome_norm_cnpj >= 1 AND c.qtd_coord_nome_norm_cnpj = 0 THEN 'SEM_COORDENADAS'
           WHEN c.qtd_match_cep_cnpj = 0 AND c.qtd_match_nome_norm_cnpj = 0 AND c.qtd_match_nome_norm_dono = 0 THEN 'NAO_ENCONTRADO'
           WHEN c.qtd_match_cep_cnpj > 1 AND c.qtd_match_nome_cnpj <> 1 THEN 'AMBIGUO'
           WHEN c.qtd_match_nome_norm_dono > 1 THEN 'AMBIGUO'
           ELSE 'PENDENTE'
         END AS diagnostico,
         CASE
           WHEN c.qtd_coord_nome_norm_dono = 1 THEN 'NOME_PONTO_DONO'
           WHEN c.qtd_coord_nome_norm_cnpj = 1 THEN 'NOME_PONTO_NORM'
           WHEN c.qtd_match_cep_com_coord_cnpj = 1 THEN 'ENDERECO'
           WHEN c.qtd_match_nome_cnpj = 1 THEN 'NOME_PONTO'
           ELSE NULL
         END AS match_via_esperado
    FROM candidatos c
)
SELECT d.ordem_min,
       d.qtd_nf,
       d.nfs_lista,
       d.cnpj_14,
       d.cnpj_dono_14,
       d.cd_cliente_dono,
       d.nm_entrega_nf,
       d.logradouro,
       d.numero,
       d.municipio,
       d.uf,
       d.cep8,
       d.diagnostico,
       d.match_via_esperado,
       d.qtd_match_cep_cnpj,
       d.qtd_match_cep_com_coord_cnpj,
       d.qtd_match_nome_cnpj,
       d.qtd_match_nome_norm_cnpj,
       d.qtd_coord_nome_norm_cnpj,
       d.qtd_coord_nome_exato_cnpj,
       d.qtd_match_nome_norm_dono,
       d.qtd_coord_nome_norm_dono,
       CASE d.diagnostico
         WHEN 'OK_APP' THEN 'Montar paradas deve resolver (reinicie Node + Ctrl+F5 se ainda pendente).'
         WHEN 'SEM_COORDENADAS' THEN 'Cadastre lat/lon no ponto DS_PONTO_ENTREGA = nome da NF.'
         WHEN 'NAO_ENCONTRADO' THEN 'Crie/ajuste ponto no PJ dono (cd_cliente_dono) com DS_PONTO_ENTREGA igual ao da NF.'
         WHEN 'AMBIGUO' THEN 'Varios pontos no cadastro; deixe um ativo ou diferencie DS_PONTO_ENTREGA.'
         ELSE 'Conferir manualmente.'
       END AS acao_sugerida
  FROM com_diag d
 WHERE d.diagnostico <> 'OK_APP'
 ORDER BY d.ordem_min;
