-- Embarque WMS vinculado a Unidade de Negócio (CADASTROGERAL.FGUNIDADENEGOCIO = 'S').
-- Permite assinatura estável do roteiro (emb:cg:CDCADASTRO) em vez de depender só de lat/lon digitados.
-- PostgreSQL, idempotente. Integridade com CADASTROGERAL é garantida na API (tenant + flag UN).

ALTER TABLE "WMS_CARGA_ROTA_OPERACIONAL"
  ADD COLUMN IF NOT EXISTS "CD_CADASTRO_EMBARQUE" NUMERIC(15, 0) NULL;

COMMENT ON COLUMN "WMS_CARGA_ROTA_OPERACIONAL"."CD_CADASTRO_EMBARQUE" IS 'Opcional: CDCADASTRO da unidade de negócio usada como ponto de embarque (coords do cadastro).';
