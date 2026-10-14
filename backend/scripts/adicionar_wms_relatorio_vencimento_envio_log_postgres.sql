-- Log de execuções do job de relatório de vencimento WMS (auditoria / últimos envios).
-- PostgreSQL, idempotente. Relacionado: docs/WMS_ESTRATEGIA_INVENTARIO_ALERTAS_DASHBOARDS.md

CREATE TABLE IF NOT EXISTS "WMS_RELATORIO_VENCIMENTO_ENVIO" (
  "CD_ENVIO" BIGSERIAL PRIMARY KEY,
  "TENANT_ID" VARCHAR(64) NOT NULL,
  "DH_ENVIO" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "NU_LINHAS" INTEGER NOT NULL,
  "ST_EMAIL" CHAR(1) NOT NULL,
  "DS_DETALHE" VARCHAR(500),
  "NM_ANEXO" VARCHAR(200),
  "EMAIL_MESSAGE_ID" VARCHAR(300),
  CONSTRAINT chk_wms_rel_venc_envio_st CHECK ("ST_EMAIL" IN ('S', 'N', 'E'))
);

COMMENT ON TABLE "WMS_RELATORIO_VENCIMENTO_ENVIO" IS 'Histórico do job de relatório de vencimento: linhas no horizonte e resultado do e-mail (S/N/E).';
COMMENT ON COLUMN "WMS_RELATORIO_VENCIMENTO_ENVIO"."ST_EMAIL" IS 'S=enviado, N=não enviado (skip), E=erro ao enviar.';

CREATE INDEX IF NOT EXISTS idx_wms_rel_venc_envio_tenant_dh
  ON "WMS_RELATORIO_VENCIMENTO_ENVIO" ("TENANT_ID", "DH_ENVIO" DESC);
