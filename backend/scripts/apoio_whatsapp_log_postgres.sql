-- Log de Suporte / Pedido de apoio via WhatsApp (canal Switch do tenant default).
-- Idempotente. Não altera FIN_* nem Switch token.

CREATE TABLE IF NOT EXISTS "APOIO_WHATSAPP_LOG" (
  "ID" bigserial PRIMARY KEY,
  "DH" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "TIPO" varchar(20) NOT NULL,
  "ORIGEM" varchar(20) NOT NULL,
  "TENANT_ORIGEM" varchar(64) NOT NULL,
  "SGUSUARIO" varchar(80) NULL,
  "ASSUNTO" varchar(120) NULL,
  "TIPO_AJUDA" varchar(40) NULL,
  "PAGINA" varchar(200) NULL,
  "RESULTADO" char(1) NOT NULL,
  "DETALHE" varchar(400) NULL,
  "DESTINO_MASCARA" varchar(20) NULL,
  "FINGERPRINT" varchar(64) NULL,
  "IP" varchar(64) NULL,
  CONSTRAINT "CK_APOIO_WHATSAPP_TIPO" CHECK ("TIPO" IN ('SUPORTE', 'APOIO')),
  CONSTRAINT "CK_APOIO_WHATSAPP_ORIGEM" CHECK ("ORIGEM" IN ('PAINEL', 'MOTORISTA')),
  CONSTRAINT "CK_APOIO_WHATSAPP_RES" CHECK ("RESULTADO" IN ('S', 'N'))
);

CREATE INDEX IF NOT EXISTS "IX_APOIO_WHATSAPP_LOG_DH"
  ON "APOIO_WHATSAPP_LOG" ("DH" DESC);

CREATE INDEX IF NOT EXISTS "IX_APOIO_WHATSAPP_LOG_FP"
  ON "APOIO_WHATSAPP_LOG" ("TENANT_ORIGEM", "FINGERPRINT", "DH" DESC);

INSERT INTO "CONFIGURACAO" ("TENANT_ID", "CHAVE", "VALOR", "DESCRICAO")
SELECT 'default', 'whatsapp_destino_suporte', '', 'Celular destino Atlas para Suporte e Pedido de apoio (DDI+DDD)'
WHERE NOT EXISTS (
  SELECT 1 FROM "CONFIGURACAO" c
  WHERE c."CHAVE" = 'whatsapp_destino_suporte'
    AND COALESCE(NULLIF(TRIM(c."TENANT_ID"::text), ''), 'default') = 'default'
);
