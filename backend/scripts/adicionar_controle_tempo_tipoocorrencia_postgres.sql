-- =============================================
-- Controle de tempo por situação (alertas)
-- Adiciona em TIPOOCORRENCIA: ligado/desligado + tempo máximo em minutos.
-- =============================================

ALTER TABLE "TIPOOCORRENCIA"
ADD COLUMN IF NOT EXISTS "FG_CONTROLE_TEMPO" CHAR(1) NULL DEFAULT 'N';

ALTER TABLE "TIPOOCORRENCIA"
ADD COLUMN IF NOT EXISTS "TEMPO_MAXIMO_MINUTOS" INTEGER NULL;

COMMENT ON COLUMN "TIPOOCORRENCIA"."FG_CONTROLE_TEMPO" IS 'S=controlar tempo para alerta, N=não controlar';
COMMENT ON COLUMN "TIPOOCORRENCIA"."TEMPO_MAXIMO_MINUTOS" IS 'Tempo máximo (min) nesta situação antes de gerar alerta; usado quando FG_CONTROLE_TEMPO=S';
