-- WMS — export produtos de ESTOQUE (donos 1 e 2) para planilha PESO_KG — carga em lote
--
-- Exclui produtos de FORNECEDOR (FG_FORNECEDOR_REF = 'S'), como na tela Cadastros WMS
-- sem marcar "Mostrar produtos de fornecedor". Esses são só de-para do XML de entrada.
--
-- Abrir no Excel (Brasil) sem bagunçar coluna / decimal:
--   1) Rode o SELECT EXPORT abaixo → botão Export (download).
--   2) No pgAdmin, ao exportar: formato CSV, codificação UTF-8,
--      separador de COLUNA = ponto e vírgula (;)  — NÃO use vírgula entre colunas.
--   3) No Excel: abra o .csv; PESO_KG já vem com vírgula decimal (0,100).
--      CODIGO vem com aspas/apóstrofo para não virar número (6.03.07.001.00).
--   4) Após editar: Salvar como .txt TAB ou subir com:
--        node scripts/wms_import_peso_produto_lote.js --arquivo "C:\caminho\pesos.txt"

-- ========== RESUMO ==========
SELECT p."CD_DONO",
       COUNT(*) AS produtos_estoque,
       COUNT(*) FILTER (WHERE p."PESO_KG" IS NULL OR p."PESO_KG" <= 0) AS sem_peso,
       COUNT(*) FILTER (WHERE p."PESO_KG" IS NOT NULL AND p."PESO_KG" > 0) AS com_peso
  FROM "WMS_PRODUTO_DONO" p
 WHERE p."TENANT_ID" = 'default'
   AND p."CD_DONO" IN (1, 2)
   AND COALESCE(p."FGACTIVE", 'S') = 'S'
   AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
 GROUP BY p."CD_DONO"
 ORDER BY p."CD_DONO";

-- (só conferência) quantos de fornecedor foram omitidos
SELECT p."CD_DONO", COUNT(*) AS omitidos_fornecedor
  FROM "WMS_PRODUTO_DONO" p
 WHERE p."TENANT_ID" = 'default'
   AND p."CD_DONO" IN (1, 2)
   AND COALESCE(p."FGACTIVE", 'S') = 'S'
   AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'S'
 GROUP BY p."CD_DONO"
 ORDER BY p."CD_DONO";

-- ========== EXPORT (estoque — donos 1 e 2) — use separador ; no pgAdmin ==========
SELECT p."CD_DONO",
       -- Apóstrofo inicial: Excel trata código como texto (pontos da máscara não viram data/número)
       CHR(39) || TRIM(p."CODIGO") AS "CODIGO",
       CASE
         WHEN p."PESO_KG" IS NOT NULL AND p."PESO_KG" > 0
         THEN REPLACE(TRIM(to_char(p."PESO_KG"::numeric, 'FM999999990.999')), '.', ',')
         ELSE ''
       END AS "PESO_KG",
       REPLACE(LEFT(TRIM(COALESCE(p."NOME", '')), 120), ';', ',') AS nome_referencia
  FROM "WMS_PRODUTO_DONO" p
 WHERE p."TENANT_ID" = 'default'
   AND p."CD_DONO" IN (1, 2)
   AND COALESCE(p."FGACTIVE", 'S') = 'S'
   AND COALESCE(p."FG_FORNECEDOR_REF", 'N') = 'N'
 ORDER BY p."CD_DONO", TRIM(p."CODIGO");
