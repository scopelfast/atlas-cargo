-- =============================================
-- Permitir NULL em ENDERECO, NRENDERECO e BAIRRO (CADASTROGERAL)
-- Endereço, número e bairro passam a ser opcionais no cadastro.
-- PostgreSQL
-- =============================================

ALTER TABLE "CADASTROGERAL" ALTER COLUMN "ENDERECO" DROP NOT NULL;
ALTER TABLE "CADASTROGERAL" ALTER COLUMN "NRENDERECO" DROP NOT NULL;
ALTER TABLE "CADASTROGERAL" ALTER COLUMN "BAIRRO" DROP NOT NULL;

-- Comentários (opcional)
COMMENT ON COLUMN "CADASTROGERAL"."ENDERECO" IS 'Endereço (logradouro). Opcional.';
COMMENT ON COLUMN "CADASTROGERAL"."NRENDERECO" IS 'Número do endereço. Opcional.';
COMMENT ON COLUMN "CADASTROGERAL"."BAIRRO" IS 'Bairro. Opcional.';
