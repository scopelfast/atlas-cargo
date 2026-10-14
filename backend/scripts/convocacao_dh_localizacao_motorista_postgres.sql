-- Marca quando o motorista usou "Enviar minha localização" na página pública (POST atualizar-localizacao).
-- O aceite da convocação exige este timestamp preenchido.
ALTER TABLE "CONVOCACAO" ADD COLUMN IF NOT EXISTS "DH_LOCALIZACAO_MOTORISTA" timestamp NULL;
