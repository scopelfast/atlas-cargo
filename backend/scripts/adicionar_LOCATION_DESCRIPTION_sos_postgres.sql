-- Adicionar coluna LOCATION_DESCRIPTION na tabela SOS_ALERTS (PostgreSQL)
-- O que é gravado: descrição textual do local do SOS (ex.: endereço da geocodificação reversa
-- ou texto digitado pelo operador no modal "Tratar" - campo "Descrição / Detalhes do Local").
-- Exemplo de valor: "Estrada da Ribeira, Roseira, Colombo, Paraná"

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'SOS_ALERTS'
      AND column_name = 'LOCATION_DESCRIPTION'
  ) THEN
    ALTER TABLE public."SOS_ALERTS"
    ADD COLUMN "LOCATION_DESCRIPTION" VARCHAR(500) NULL;
    RAISE NOTICE 'Coluna LOCATION_DESCRIPTION adicionada à tabela SOS_ALERTS.';
  ELSE
    RAISE NOTICE 'Coluna LOCATION_DESCRIPTION já existe em SOS_ALERTS.';
  END IF;
END $$;
