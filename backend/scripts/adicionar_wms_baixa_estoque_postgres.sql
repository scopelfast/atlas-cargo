-- WMS — baixas / perdas / vencimentos (documento + ledger).
-- PostgreSQL, idempotente. Executar após adicionar_wms_movimento_estoque_postgres.sql

CREATE TABLE IF NOT EXISTS "WMS_MOTIVO_BAIXA" (
  "CD_MOTIVO_BAIXA" SERIAL PRIMARY KEY,
  "CODIGO" VARCHAR(16) NOT NULL,
  "DESCRICAO" VARCHAR(120) NOT NULL,
  "ROTULO_MOVIMENTO" VARCHAR(160) NOT NULL,
  "CODIGO_OL" VARCHAR(16),
  "TP_MOVIMENTO" VARCHAR(32) NOT NULL DEFAULT 'BAIXA_ESTOQUE',
  "EXIGE_LOTE_VALIDADE" CHAR(1) NOT NULL DEFAULT 'S',
  "FGACTIVE" CHAR(1) NOT NULL DEFAULT 'S',
  "ORDEM" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT uq_wms_motivo_baixa_codigo UNIQUE ("CODIGO"),
  CONSTRAINT chk_wms_motivo_baixa_fg CHECK ("FGACTIVE" IN ('S', 'N')),
  CONSTRAINT chk_wms_motivo_baixa_lv CHECK ("EXIGE_LOTE_VALIDADE" IN ('S', 'N'))
);

COMMENT ON TABLE "WMS_MOTIVO_BAIXA" IS 'Catálogo de motivos de baixa/perda (vencido, avaria, segregado, etc.).';
COMMENT ON COLUMN "WMS_MOTIVO_BAIXA"."CODIGO_OL" IS 'Código legado OL quando existir (ex.: 21 = produto vencido).';
COMMENT ON COLUMN "WMS_MOTIVO_BAIXA"."EXIGE_LOTE_VALIDADE" IS 'S=exige lote+validade na linha (shelf-life); N=permite baixa só por SKU.';

INSERT INTO "WMS_MOTIVO_BAIXA" ("CODIGO", "DESCRICAO", "ROTULO_MOVIMENTO", "CODIGO_OL", "TP_MOVIMENTO", "EXIGE_LOTE_VALIDADE", "ORDEM")
VALUES
  ('21', 'Produto vencido (OL)', 'Retirada — Produto vencido (OL 21)', '21', 'BAIXA_VENCIDO', 'S', 10),
  ('VENCIDO', 'Produto vencido', 'Retirada — Produto vencido', NULL, 'BAIXA_VENCIDO', 'S', 11),
  ('AVARIA', 'Avaria / dano físico', 'Retirada — Avaria', NULL, 'BAIXA_AVARIA', 'S', 20),
  ('SEGREGADO', 'Segregado / quarentena', 'Retirada — Segregado', NULL, 'BAIXA_SEGREGADO', 'S', 30),
  ('PERDA', 'Perda operacional', 'Retirada — Perda', NULL, 'BAIXA_PERDA', 'N', 40),
  ('QUEBRA', 'Quebra (embalagem/unidade)', 'Retirada — Quebra', NULL, 'BAIXA_QUEBRA', 'S', 50),
  ('RECALL', 'Recall / retirada de mercado', 'Retirada — Recall', NULL, 'BAIXA_RECALL', 'S', 60),
  ('DOACAO', 'Doação / descarte social', 'Retirada — Doação', NULL, 'BAIXA_DOACAO', 'S', 70),
  ('AMOSTRA', 'Amostra / degustação', 'Retirada — Amostra', NULL, 'BAIXA_AMOSTRA', 'N', 80),
  ('CONSUMO_INT', 'Consumo interno', 'Retirada — Consumo interno', NULL, 'BAIXA_CONSUMO_INTERNO', 'N', 90),
  ('QUALIDADE', 'Ajuste qualidade', 'Retirada — Ajuste qualidade', NULL, 'BAIXA_QUALIDADE', 'S', 100),
  ('FURTO', 'Furto / roubo', 'Retirada — Furto/roubo', NULL, 'BAIXA_FURTO', 'N', 110),
  ('CONTAMINACAO', 'Contaminação / risco alimentar', 'Retirada — Contaminação', NULL, 'BAIXA_CONTAMINACAO', 'S', 120),
  ('CADEIA_FRIOS', 'Quebra de cadeia de frio', 'Retirada — Quebra cadeia de frio', NULL, 'BAIXA_CADEIA_FRIOS', 'S', 130),
  ('EMB_VIOLADA', 'Embalagem violada / lacre rompido', 'Retirada — Embalagem violada', NULL, 'BAIXA_EMB_VIOLADA', 'S', 140),
  ('DEVOLUCAO', 'Devolução / descarte pós-devolução', 'Retirada — Devolução', NULL, 'BAIXA_DEVOLUCAO', 'S', 150),
  ('BLOQUEIO_REG', 'Bloqueio regulatório / recall interno', 'Retirada — Bloqueio regulatório', NULL, 'BAIXA_BLOQUEIO_REG', 'S', 160),
  ('EXTRAVIO', 'Extravio / não localizado', 'Retirada — Extravio', NULL, 'BAIXA_EXTRAVIO', 'N', 170),
  ('OBSOLETO', 'Obsoleto / descontinuado', 'Retirada — Obsoleto', NULL, 'BAIXA_OBSOLETO', 'N', 180),
  ('BONIFICACAO', 'Bonificação / brinde promocional', 'Retirada — Bonificação', NULL, 'BAIXA_BONIFICACAO', 'S', 190),
  ('RECLASSIFICACAO', 'Reclassificação / downgrade', 'Retirada — Reclassificação', NULL, 'BAIXA_RECLASSIFICACAO', 'S', 200),
  ('DESCARTE', 'Descarte / descaracterização', 'Retirada — Descarte', NULL, 'BAIXA_DESCARTE', 'S', 210)
ON CONFLICT ("CODIGO") DO NOTHING;

CREATE TABLE IF NOT EXISTS "WMS_BAIXA_ESTOQUE" (
  "CD_BAIXA" BIGSERIAL PRIMARY KEY,
  "TENANT_ID" VARCHAR(64) NOT NULL,
  "CD_DONO" INTEGER NOT NULL REFERENCES "WMS_DONO_ESTOQUE" ("CD_DONO") ON DELETE CASCADE,
  "CD_MOTIVO_BAIXA" INTEGER NOT NULL REFERENCES "WMS_MOTIVO_BAIXA" ("CD_MOTIVO_BAIXA"),
  "NR_DOCUMENTO" VARCHAR(20) NOT NULL,
  "ST_BAIXA" VARCHAR(16) NOT NULL DEFAULT 'CONFIRMADO',
  "DH_BAIXA" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "SG_USER" VARCHAR(64),
  "OBSERVACAO" VARCHAR(500),
  "ORIGEM" VARCHAR(24) NOT NULL DEFAULT 'SHELF_LIFE',
  CONSTRAINT uq_wms_baixa_est_tenant_nr UNIQUE ("TENANT_ID", "NR_DOCUMENTO"),
  CONSTRAINT chk_wms_baixa_est_st CHECK ("ST_BAIXA" IN ('CONFIRMADO', 'ESTORNADO'))
);

COMMENT ON TABLE "WMS_BAIXA_ESTOQUE" IS 'Documento de baixa/perda de estoque (vencido, avaria, segregado…). Gera WMS_MOVIMENTO_ESTOQUE.';

CREATE INDEX IF NOT EXISTS idx_wms_baixa_est_tenant_dono_dh
  ON "WMS_BAIXA_ESTOQUE" ("TENANT_ID", "CD_DONO", "DH_BAIXA" DESC);

CREATE TABLE IF NOT EXISTS "WMS_BAIXA_ESTOQUE_LINHA" (
  "CD_BAIXA_LINHA" BIGSERIAL PRIMARY KEY,
  "CD_BAIXA" BIGINT NOT NULL REFERENCES "WMS_BAIXA_ESTOQUE" ("CD_BAIXA") ON DELETE CASCADE,
  "CD_PRODUTO" INTEGER NOT NULL,
  "LOTE" VARCHAR(80) NOT NULL DEFAULT '',
  "VALIDADE" DATE,
  "QTD_BAIXA" NUMERIC(18, 6) NOT NULL,
  "QTD_SALDO_SKU_ANTES" NUMERIC(18, 6),
  "QTD_SALDO_EST_ANTES" NUMERIC(18, 6),
  "CODIGO_PRODUTO" VARCHAR(80),
  "NM_PRODUTO" VARCHAR(200),
  "REF_CD_MOVIMENTO" BIGINT,
  "DIAS_ATE_VENCIMENTO" INTEGER
);

COMMENT ON TABLE "WMS_BAIXA_ESTOQUE_LINHA" IS 'Detalhe lote/validade da baixa; ledger continua por SKU (soma das linhas do mesmo produto).';

CREATE INDEX IF NOT EXISTS idx_wms_baixa_linha_baixa
  ON "WMS_BAIXA_ESTOQUE_LINHA" ("CD_BAIXA");

CREATE INDEX IF NOT EXISTS idx_wms_baixa_linha_prod_val
  ON "WMS_BAIXA_ESTOQUE_LINHA" ("CD_PRODUTO", "VALIDADE");

ALTER TABLE "WMS_MOVIMENTO_ESTOQUE"
  ADD COLUMN IF NOT EXISTS "REF_CD_BAIXA" BIGINT;

COMMENT ON COLUMN "WMS_MOVIMENTO_ESTOQUE"."REF_CD_BAIXA" IS 'Documento WMS_BAIXA_ESTOQUE quando TP_MOVIMENTO é baixa/perda.';

CREATE INDEX IF NOT EXISTS idx_wms_movimento_ref_baixa
  ON "WMS_MOVIMENTO_ESTOQUE" ("TENANT_ID", "REF_CD_BAIXA")
  WHERE "REF_CD_BAIXA" IS NOT NULL;
