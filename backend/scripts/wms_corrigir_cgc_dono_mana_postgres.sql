-- Corrige CGC do dono Mana (piloto) quando estiver 02143616012668 -> matriz 02143616000147
UPDATE "WMS_DONO_ESTOQUE" d
   SET "CGC" = '02143616000147'
 WHERE d."TENANT_ID" = 'default'
   AND trim(coalesce(d."NOME", '')) ILIKE '%mana%'
   AND right(lpad(regexp_replace(trim(coalesce(d."CGC", '')), '[^0-9]', '', 'g'), 14, '0'), 14) <> '02143616000147';

SELECT "CD_DONO", "NOME", "CGC" FROM "WMS_DONO_ESTOQUE" WHERE "TENANT_ID" = 'default' AND "NOME" ILIKE '%mana%';
