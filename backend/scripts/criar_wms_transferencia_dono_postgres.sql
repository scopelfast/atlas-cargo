-- WMS — transferência de estoque entre donos (documento + ledger).
-- Postgres, idempotente. Executar após adicionar_wms_movimento_estoque_postgres.sql.
--
-- Cada transferência grava UMA linha aqui (snapshot do documento) + DOIS
-- movimentos em "WMS_MOVIMENTO_ESTOQUE":
--   - SAÍDA  na origem  (QTD < 0, TP_MOVIMENTO = 'TRANSFERENCIA_SAIDA')
--   - ENTRADA no destino (QTD > 0, TP_MOVIMENTO = 'TRANSFERENCIA_ENTRADA')
--
-- A tabela é o "documento" (auditoria / PDF / histórico). O ledger é o que
-- de fato altera o saldo lógico — o relatório de Posição de Estoque já soma
-- "WMS_MOVIMENTO_ESTOQUE" então qualquer transferência aqui registrada
-- imediatamente reflete em ambos os donos (sai de um, entra no outro).
--
-- Observações:
--   - Lote/Validade são INFORMATIVOS no MVP (o saldo é por SKU; o
--     rastreamento por lote ficará para uma fase posterior, quando o ledger
--     ganhar dimensão lote/validade).
--   - Status: EFETIVADA (default) | CANCELADA. Cancelar não estorna
--     automaticamente; é manual (próxima fase).

CREATE TABLE IF NOT EXISTS "WMS_TRANSFERENCIA_DONO" (
  "CD_TRANSFERENCIA" BIGSERIAL PRIMARY KEY,
  "TENANT_ID" VARCHAR(64) NOT NULL,
  "CD_DONO_ORIGEM" INTEGER NOT NULL REFERENCES "WMS_DONO_ESTOQUE" ("CD_DONO") ON DELETE RESTRICT,
  "CD_DONO_DESTINO" INTEGER NOT NULL REFERENCES "WMS_DONO_ESTOQUE" ("CD_DONO") ON DELETE RESTRICT,
  "CD_PRODUTO_ORIGEM" INTEGER NOT NULL,
  "CD_PRODUTO_DESTINO" INTEGER NOT NULL,
  "CODIGO_PRODUTO" VARCHAR(40) NOT NULL,
  "NM_PRODUTO_SNAPSHOT" VARCHAR(255),
  "LOTE" VARCHAR(60),
  "VALIDADE" DATE,
  "QTD" NUMERIC(18, 6) NOT NULL CHECK ("QTD" > 0),
  "MOTIVO" VARCHAR(255),
  "ST_TRANSFERENCIA" VARCHAR(16) NOT NULL DEFAULT 'EFETIVADA',
  "REF_CD_MOVIMENTO_SAIDA" BIGINT REFERENCES "WMS_MOVIMENTO_ESTOQUE" ("CD_MOVIMENTO") ON DELETE SET NULL,
  "REF_CD_MOVIMENTO_ENTRADA" BIGINT REFERENCES "WMS_MOVIMENTO_ESTOQUE" ("CD_MOVIMENTO") ON DELETE SET NULL,
  "DH_REGISTRO" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "DH_CANCELAMENTO" TIMESTAMPTZ,
  "SG_USER" VARCHAR(64),
  "SG_USER_CANCEL" VARCHAR(64),
  CONSTRAINT chk_transf_donos_diferentes CHECK ("CD_DONO_ORIGEM" <> "CD_DONO_DESTINO"),
  CONSTRAINT chk_transf_status CHECK ("ST_TRANSFERENCIA" IN ('EFETIVADA', 'CANCELADA'))
);

COMMENT ON TABLE "WMS_TRANSFERENCIA_DONO" IS
  'Documento de transferência de estoque entre donos. Cada linha corresponde a 2 movimentos em WMS_MOVIMENTO_ESTOQUE (SAIDA na origem + ENTRADA no destino).';

CREATE INDEX IF NOT EXISTS idx_wms_transf_tenant_dh
  ON "WMS_TRANSFERENCIA_DONO" ("TENANT_ID", "DH_REGISTRO" DESC);

CREATE INDEX IF NOT EXISTS idx_wms_transf_tenant_origem
  ON "WMS_TRANSFERENCIA_DONO" ("TENANT_ID", "CD_DONO_ORIGEM");

CREATE INDEX IF NOT EXISTS idx_wms_transf_tenant_destino
  ON "WMS_TRANSFERENCIA_DONO" ("TENANT_ID", "CD_DONO_DESTINO");

CREATE INDEX IF NOT EXISTS idx_wms_transf_tenant_produto
  ON "WMS_TRANSFERENCIA_DONO" ("TENANT_ID", "CD_PRODUTO_ORIGEM");
