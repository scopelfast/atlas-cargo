-- Registro da recuperação de senha (motorista e painel).
-- Não guarda código nem senha. Idempotente.

CREATE TABLE IF NOT EXISTS "RECUPERACAO_SENHA_LOG" (
  "ID" bigserial PRIMARY KEY,
  "DH" timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "CANAL" varchar(20) NOT NULL,
  "EVENTO" varchar(40) NOT NULL,
  "RESULTADO" char(1) NOT NULL,
  "IDENTIFICADOR" varchar(80) NULL,
  "CDCADASTRO" numeric(15,0) NULL,
  "DESTINO" varchar(20) NULL,
  "DETALHE" varchar(400) NULL,
  "IP" varchar(64) NULL
);

CREATE INDEX IF NOT EXISTS "IX_RECUPERACAO_SENHA_LOG_DH"
  ON "RECUPERACAO_SENHA_LOG" ("DH" DESC);
