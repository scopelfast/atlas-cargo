-- WMS — preservar a DATA ORIGINAL da entrada de NF-e mesmo após reaberturas.
-- PostgreSQL, idempotente.
--
-- Problema: o relatório de Movimentação usa `DH_ENCERRAMENTO` como data da
-- entrada do estoque. Como `DH_ENCERRAMENTO` é sobrescrito a cada vez que
-- a NF é reaberta + encerrada de novo, o histórico da entrada "anda no
-- tempo" e fica datado no momento do último ajuste — o que destrói a
-- auditoria temporal do estoque.
--
-- Solução: nova coluna `DH_PRIMEIRO_ENCERRAMENTO` que GUARDA a data do
-- PRIMEIRO encerramento e NUNCA é sobrescrita em reaberturas. O serviço
-- `encerrarRecebimento` passa a usar `COALESCE(..., CURRENT_TIMESTAMP)`
-- para preservá-la. Relatórios de movimentação e auditoria passam a usar
-- essa coluna como data oficial da entrada.

ALTER TABLE "WMS_NFE_ENTRADA"
  ADD COLUMN IF NOT EXISTS "DH_PRIMEIRO_ENCERRAMENTO" TIMESTAMPTZ;

COMMENT ON COLUMN "WMS_NFE_ENTRADA"."DH_PRIMEIRO_ENCERRAMENTO"
  IS 'Data/hora do PRIMEIRO encerramento. NÃO é atualizada em reaberturas. Use isto como data oficial da entrada do estoque (relatórios de movimentação/auditoria).';

-- Backfill: para NFs já encerradas antes desta coluna existir, copia o
-- DH_ENCERRAMENTO atual (melhor aproximação possível). Só sobrescreve
-- linhas onde DH_PRIMEIRO_ENCERRAMENTO está nulo e DH_ENCERRAMENTO existe.
UPDATE "WMS_NFE_ENTRADA"
   SET "DH_PRIMEIRO_ENCERRAMENTO" = "DH_ENCERRAMENTO"
 WHERE "DH_PRIMEIRO_ENCERRAMENTO" IS NULL
   AND "DH_ENCERRAMENTO" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wms_nfe_entrada_dh_prim_enc
  ON "WMS_NFE_ENTRADA" ("TENANT_ID", "DH_PRIMEIRO_ENCERRAMENTO" DESC);
