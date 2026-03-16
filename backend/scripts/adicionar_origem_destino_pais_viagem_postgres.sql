-- =============================================
-- OPCIONAL: Adiciona colunas ORIGEM_PAIS e DESTINO_PAIS na tabela VIAGEMMESTRE (PostgreSQL)
-- Só execute se precisar persistir país na viagem sem roteiro.
-- No fluxo normal, origem/destino vêm do ROTEIRO (viagem.IDROTEIRO -> ROTEIRO -> CIDADE -> PAIS).
-- Executar UMA VEZ apenas se sua regra de negócio exigir país na viagem sem roteiro.
-- =============================================

ALTER TABLE "VIAGEMMESTRE"
  ADD COLUMN IF NOT EXISTS "ORIGEM_PAIS" VARCHAR(10) NULL;

ALTER TABLE "VIAGEMMESTRE"
  ADD COLUMN IF NOT EXISTS "DESTINO_PAIS" VARCHAR(10) NULL;

COMMENT ON COLUMN "VIAGEMMESTRE"."ORIGEM_PAIS" IS 'Sigla do país de origem (ex: BR). Usado quando a viagem não tem roteiro ou para exibir na tela.';
COMMENT ON COLUMN "VIAGEMMESTRE"."DESTINO_PAIS" IS 'Sigla do país de destino (ex: BR). Usado quando a viagem não tem roteiro ou para exibir na tela.';
