-- Auditoria das regras de compatibilidade (Gerenciar Viagens – Aba Compatíveis)
-- Cada alteração nas chaves regra_compativel_* é registrada aqui.

CREATE TABLE IF NOT EXISTS "REGRA_COMPATIVEL_AUDIT" (
  "ID"                SERIAL PRIMARY KEY,
  "DHALTERACAO"       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "SGUSER"            VARCHAR(50) NULL,
  "CHAVE"             VARCHAR(80) NOT NULL,
  "VALOR_ANTERIOR"    VARCHAR(20) NULL,
  "VALOR_NOVO"        VARCHAR(20) NULL
);

COMMENT ON TABLE "REGRA_COMPATIVEL_AUDIT" IS 'Histórico de alterações das regras de compatibilidade (rastreamento, classe frota, local embarque, local desembarque).';

CREATE INDEX IF NOT EXISTS "IX_REGRA_COMPATIVEL_AUDIT_DH" ON "REGRA_COMPATIVEL_AUDIT" ("DHALTERACAO");
CREATE INDEX IF NOT EXISTS "IX_REGRA_COMPATIVEL_AUDIT_CHAVE" ON "REGRA_COMPATIVEL_AUDIT" ("CHAVE");
