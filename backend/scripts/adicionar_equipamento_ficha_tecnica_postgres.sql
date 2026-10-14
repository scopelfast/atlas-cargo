-- Nome: adicionar_equipamento_ficha_tecnica_postgres.sql
-- Objetivo: dados complementares do veículo/equipamento (espelho parcial do legado VEICULO),
--           1:1 com EQUIPAMENTO. Uso exclusivo pelo módulo Gerenciar Equipamentos (aba Ficha técnica).
-- Executar no PostgreSQL (Atlas). Idempotente.

CREATE TABLE IF NOT EXISTS "EQUIPAMENTO_FICHA_TECNICA" (
  "IDEQUIPAMENTO" numeric(15,0) NOT NULL,
  "TENANT_ID" varchar(64) NOT NULL,
  "NRRENAVAM" varchar(20) NULL,
  "NRCHASSI" varchar(20) NULL,
  "NRFROTA" varchar(10) NULL,
  "NUMEROCARROCERIA" varchar(20) NULL,
  "CATEGORIACNH" varchar(5) NULL,
  "TARA" numeric(15,6) NULL,
  "CAPACTRACAO" numeric(15,6) NULL,
  "CAPACTANQUE" numeric(15,6) NULL,
  "DHMAINTENANCE" timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  "SGUSER" varchar(50) NULL,
  CONSTRAINT "PK_EQUIPAMENTO_FICHA_TECNICA" PRIMARY KEY ("IDEQUIPAMENTO")
);

CREATE INDEX IF NOT EXISTS "IX_EQ_FICHA_TEC_TENANT" ON "EQUIPAMENTO_FICHA_TECNICA" ("TENANT_ID");

COMMENT ON TABLE "EQUIPAMENTO_FICHA_TECNICA" IS 'Complemento veicular (RENAVAM frota, chassi, frota, carroceria, etc.) — Gerenciar Equipamentos.';
COMMENT ON COLUMN "EQUIPAMENTO_FICHA_TECNICA"."NRRENAVAM" IS 'RENAVAM no cadastro da frota (distinto do RENAVAM informado pelo motorista no app, se existir).';
